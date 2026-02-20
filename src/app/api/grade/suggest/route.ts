import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { runPrimary } from "@/lib/ai/router";
import type { ChatMessage } from "@/lib/ai/openaiCompat";
import { getFinalFromESPN, getFinalFromMLB, getFinalFromNHL } from "@/lib/sports/finals";

function getBearerToken(req: Request): string {
  const h = req.headers.get("authorization") || "";
  if (h.toLowerCase().startsWith("bearer ")) return h.slice(7).trim();
  return "";
}

function toYYYYMMDD(d: string) {
  return d.replaceAll("-", "");
}

function safeJsonParse(raw: string) {
  const s = raw.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first === -1 || last === -1) throw new Error("No JSON found");
  return JSON.parse(s.slice(first, last + 1));
}

// deterministic grading once we know selection+line
function gradeFromFinal(args: {
  market: string;
  selection: string | null;
  line: number | null;
  final: { home: string; away: string; homeScore: number; awayScore: number };
}) {
  const market = args.market.toLowerCase();
  const home = args.final.home;
  const away = args.final.away;
  const hs = args.final.homeScore;
  const as = args.final.awayScore;

  const total = hs + as;
  const winner = hs > as ? home : as > hs ? away : "TIE";

  if (market.includes("moneyline") || market === "ml") {
    if (!args.selection) return { result: "OPEN", needs_manual: true, reason: "Missing selection for ML" };
    if (winner === "TIE") return { result: "PUSH", needs_manual: false };
    return { result: winner.toLowerCase().includes(args.selection.toLowerCase()) ? "WIN" : "LOSS", needs_manual: false };
  }

  if (market.includes("total") || market.includes("over") || market.includes("under")) {
    if (args.line === null || args.selection === null) return { result: "OPEN", needs_manual: true, reason: "Missing total line/selection" };
    const isOver = args.selection.toLowerCase().includes("over");
    const isUnder = args.selection.toLowerCase().includes("under");
    if (!isOver && !isUnder) return { result: "OPEN", needs_manual: true, reason: "Selection not over/under" };

    if (total === args.line) return { result: "PUSH", needs_manual: false };
    if (isOver) return { result: total > args.line ? "WIN" : "LOSS", needs_manual: false };
    return { result: total < args.line ? "WIN" : "LOSS", needs_manual: false };
  }

  if (market.includes("spread")) {
    if (args.line === null || !args.selection) return { result: "OPEN", needs_manual: true, reason: "Missing spread line/selection" };

    // Determine which team is selected
    const sel = args.selection.toLowerCase();
    const isHome = home.toLowerCase().includes(sel);
    const isAway = away.toLowerCase().includes(sel);

    if (!isHome && !isAway) return { result: "OPEN", needs_manual: true, reason: "Selection does not match home/away team names" };

    const margin = isHome ? (hs - as) : (as - hs);
    const adj = margin + (args.line ?? 0);

    if (adj === 0) return { result: "PUSH", needs_manual: false };
    return { result: adj > 0 ? "WIN" : "LOSS", needs_manual: false };
  }

  return { result: "OPEN", needs_manual: true, reason: "Market not supported yet" };
}

export async function POST(req: Request) {
  const token = getBearerToken(req);
  if (!token) return NextResponse.json({ error: "Missing Authorization Bearer token" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const bet_id = String(body?.bet_id ?? "").trim();
  if (!bet_id) return NextResponse.json({ error: "Missing bet_id" }, { status: 400 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const supabase = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    accessToken: async () => token,
  });

  const { data: userData, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !userData?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: bet, error } = await supabase.from("bets").select("*").eq("id", bet_id).single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const league = String(bet.league ?? "");
  const date = String(bet.date ?? "");
  const market = String(bet.market ?? "");
  const play = String(bet.play ?? "");
  const opponent = String(bet.opponent ?? "");

  // AI parse step (only needed if selection/line missing)
  let selection: string | null = bet.selection ?? null;
  let line: number | null = bet.line ?? null;

  if (!selection || line === null) {
    const parseMessages: ChatMessage[] = [
      {
        role: "system",
        content:
          'Parse a sportsbook bet into JSON: {"selection": string|null, "line": number|null, "market": string|null}. Return STRICT JSON only.',
      },
      { role: "user", content: JSON.stringify({ league, market, play, opponent }, null, 2) },
    ];

    try {
      const raw = await runPrimary("fast", parseMessages);
      const parsed = safeJsonParse(raw);
      selection = selection ?? (typeof parsed.selection === "string" ? parsed.selection : null);
      line = line ?? (typeof parsed.line === "number" ? parsed.line : null);
    } catch {
      // keep nulls
    }
  }

  // Fetch final score from best source for the league
  let final = null as any;

  // Start with league-specific sources
  if (league.toUpperCase() === "MLB") {
    final = await getFinalFromMLB({ date, teamA: play, teamB: opponent }).catch(() => null);
  } else if (league.toUpperCase() === "NHL") {
    final = await getFinalFromNHL({ date, teamA: play, teamB: opponent }).catch(() => null);
  }

  // ESPN fallback for “all major sports” where we don’t have a direct league feed yet
  if (!final) {
    const map: any = {
      NBA: { sport: "basketball", league: "nba" },
      NFL: { sport: "football", league: "nfl" },
      MLB: { sport: "baseball", league: "mlb" },
      NHL: { sport: "hockey", league: "nhl" },
      NCAAM: { sport: "basketball", league: "mens-college-basketball" },
      NCAAF: { sport: "football", league: "college-football" },
    };

    const m = map[league.toUpperCase()];
    if (m && date) {
      final = await getFinalFromESPN({
        sport: m.sport,
        league: m.league,
        yyyymmdd: toYYYYMMDD(date),
        teamA: play,
        teamB: opponent,
      }).catch(() => null);
    }
  }

  if (!final) {
    return NextResponse.json({
      ok: false,
      needs_manual: true,
      message: "Could not resolve a final score from sources. Check team names/opponent/date.",
      parsed: { selection, line },
    });
  }

  const grade = gradeFromFinal({
    market,
    selection,
    line,
    final: { home: final.home, away: final.away, homeScore: final.homeScore, awayScore: final.awayScore },
  });

  return NextResponse.json({
    ok: true,
    final,
    parsed: { selection, line },
    grade,
  });
}
