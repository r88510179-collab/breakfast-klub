import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type ResolveItem = {
  league_text?: string;
  sport_key?: string;
  league_key?: string;
  scoreboard_url?: string;
};

type RegistryRow = {
  sport_key: string;
  league_key: string;
  league_abbrev?: string | null;
  league_name?: string | null;
  scoreboard_url: string;
  aliases?: string[] | string | null;
};

function getBearerToken(req: Request): string {
  const h = req.headers.get("authorization") || "";
  if (h.toLowerCase().startsWith("bearer ")) return h.slice(7).trim();
  return "";
}

function norm(s: any) {
  return String(s ?? "")
    .toLowerCase()
    .trim()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ");
}

function parseAliases(v: any): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.map(String).filter(Boolean);
  if (typeof v === "string") {
    // allow comma-separated aliases in DB
    return v
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
  }
  return [];
}

// Built-in fallback map so you can scan immediately even before populating full registry
const BUILTIN: RegistryRow[] = [
  // Major US
  { sport_key: "basketball", league_key: "nba", league_abbrev: "NBA", league_name: "National Basketball Association", scoreboard_url: "https://www.espn.com/nba/scoreboard", aliases: ["nba"] },
  { sport_key: "basketball", league_key: "wnba", league_abbrev: "WNBA", league_name: "WNBA", scoreboard_url: "https://www.espn.com/wnba/scoreboard", aliases: ["wnba"] },
  { sport_key: "basketball", league_key: "ncaam", league_abbrev: "NCAAM", league_name: "NCAA Men's Basketball", scoreboard_url: "https://www.espn.com/mens-college-basketball/scoreboard", aliases: ["ncaam", "ncaab", "ncaa men", "college basketball men", "mens college basketball"] },
  { sport_key: "basketball", league_key: "ncaaw", league_abbrev: "NCAAW", league_name: "NCAA Women's Basketball", scoreboard_url: "https://www.espn.com/womens-college-basketball/scoreboard", aliases: ["ncaaw", "wcbb", "womens college basketball", "ncaa women"] },

  { sport_key: "football", league_key: "nfl", league_abbrev: "NFL", league_name: "National Football League", scoreboard_url: "https://www.espn.com/nfl/scoreboard", aliases: ["nfl"] },
  { sport_key: "football", league_key: "ncaaf", league_abbrev: "NCAAF", league_name: "NCAA Football", scoreboard_url: "https://www.espn.com/college-football/scoreboard", aliases: ["ncaaf", "cfb", "college football"] },

  { sport_key: "baseball", league_key: "mlb", league_abbrev: "MLB", league_name: "Major League Baseball", scoreboard_url: "https://www.espn.com/mlb/scoreboard", aliases: ["mlb"] },
  { sport_key: "baseball", league_key: "ncaa_baseball", league_abbrev: "CBASE", league_name: "NCAA Baseball", scoreboard_url: "https://www.espn.com/college-baseball/scoreboard", aliases: ["college baseball", "ncaa baseball", "cbase"] },

  { sport_key: "hockey", league_key: "nhl", league_abbrev: "NHL", league_name: "National Hockey League", scoreboard_url: "https://www.espn.com/nhl/scoreboard", aliases: ["nhl"] },

  // Soccer (common)
  { sport_key: "soccer", league_key: "epl", league_abbrev: "EPL", league_name: "English Premier League", scoreboard_url: "https://www.espn.com/soccer/scoreboard/_/league/eng.1", aliases: ["epl", "premier league", "english premier league"] },
  { sport_key: "soccer", league_key: "laliga", league_abbrev: "LALIGA", league_name: "LaLiga", scoreboard_url: "https://www.espn.com/soccer/scoreboard/_/league/esp.1", aliases: ["laliga", "la liga"] },
  { sport_key: "soccer", league_key: "serie_a", league_abbrev: "SERIEA", league_name: "Serie A", scoreboard_url: "https://www.espn.com/soccer/scoreboard/_/league/ita.1", aliases: ["serie a", "seriea"] },
  { sport_key: "soccer", league_key: "bundesliga", league_abbrev: "BUND", league_name: "Bundesliga", scoreboard_url: "https://www.espn.com/soccer/scoreboard/_/league/ger.1", aliases: ["bundesliga", "bund"] },
  { sport_key: "soccer", league_key: "ligue_1", league_abbrev: "L1", league_name: "Ligue 1", scoreboard_url: "https://www.espn.com/soccer/scoreboard/_/league/fra.1", aliases: ["ligue 1", "ligue1"] },
  { sport_key: "soccer", league_key: "mls", league_abbrev: "MLS", league_name: "Major League Soccer", scoreboard_url: "https://www.espn.com/soccer/scoreboard/_/league/usa.1", aliases: ["mls"] },
  { sport_key: "soccer", league_key: "uefa_cl", league_abbrev: "UCL", league_name: "UEFA Champions League", scoreboard_url: "https://www.espn.com/soccer/scoreboard/_/league/uefa.champions", aliases: ["ucl", "uefa champions league", "champions league"] },
  { sport_key: "soccer", league_key: "uefa_el", league_abbrev: "UEL", league_name: "UEFA Europa League", scoreboard_url: "https://www.espn.com/soccer/scoreboard/_/league/uefa.europa", aliases: ["uel", "uefa europa league", "europa league"] },

  // Tennis
  { sport_key: "tennis", league_key: "atp", league_abbrev: "ATP", league_name: "ATP", scoreboard_url: "https://www.espn.com/tennis/scoreboard", aliases: ["atp", "mens tennis"] },
  { sport_key: "tennis", league_key: "wta", league_abbrev: "WTA", league_name: "WTA", scoreboard_url: "https://www.espn.com/tennis/scoreboard", aliases: ["wta", "womens tennis"] },
  { sport_key: "tennis", league_key: "tennis", league_abbrev: "TENNIS", league_name: "Tennis", scoreboard_url: "https://www.espn.com/tennis/scoreboard", aliases: ["tennis"] },

  // Combat / misc
  { sport_key: "mma", league_key: "ufc", league_abbrev: "UFC", league_name: "UFC", scoreboard_url: "https://www.espn.com/mma/scoreboard", aliases: ["ufc", "mma"] },
  { sport_key: "boxing", league_key: "boxing", league_abbrev: "BOXING", league_name: "Boxing", scoreboard_url: "https://www.espn.com/boxing/", aliases: ["boxing"] },
  { sport_key: "golf", league_key: "pga", league_abbrev: "PGA", league_name: "PGA Tour", scoreboard_url: "https://www.espn.com/golf/leaderboard", aliases: ["pga", "golf", "pga tour"] },

  // Olympic / broad
  { sport_key: "olympics", league_key: "olympics", league_abbrev: "OLY", league_name: "Olympics", scoreboard_url: "https://www.espn.com/olympics/", aliases: ["olympics", "olympic"] },
];

function rowTokens(r: RegistryRow): string[] {
  return [
    r.sport_key,
    r.league_key,
    r.league_abbrev ?? "",
    r.league_name ?? "",
    ...(parseAliases(r.aliases) ?? []),
  ]
    .map(norm)
    .filter(Boolean);
}

function matchRegistry(rows: RegistryRow[], input: ResolveItem) {
  const raw = input.league_text || input.league_key || "";
  const q = norm(raw);
  if (!q) {
    return { resolved: null, candidates: [] as any[] };
  }

  // Exact-ish match first
  const exact = rows.find((r) => rowTokens(r).includes(q));

  // Candidate contains match
  const candidates = rows
    .filter((r) => rowTokens(r).some((t) => t.includes(q) || q.includes(t)))
    .slice(0, 8)
    .map((r) => ({
      sport_key: r.sport_key,
      league_key: r.league_key,
      league_abbrev: r.league_abbrev ?? null,
      league_name: r.league_name ?? null,
      scoreboard_url: r.scoreboard_url,
      source: "candidate" as const,
    }));

  const winner = exact ?? (candidates.length === 1
    ? rows.find((r) => r.league_key === candidates[0].league_key && r.sport_key === candidates[0].sport_key)
    : null);

  if (!winner) return { resolved: null, candidates };

  return {
    resolved: {
      sport_key: winner.sport_key,
      league_key: winner.league_key,
      league_abbrev: winner.league_abbrev ?? null,
      league_name: winner.league_name ?? null,
      scoreboard_url: winner.scoreboard_url,
      source: "registry" as const,
    },
    candidates,
  };
}

export async function POST(req: Request) {
  try {
    const token = getBearerToken(req);
    if (!token) return NextResponse.json({ error: "Missing Authorization Bearer token" }, { status: 401 });

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anon) return NextResponse.json({ error: "Missing Supabase env vars" }, { status: 500 });

    const supabase = createClient(url, anon, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const items = Array.isArray(body?.items) ? (body.items as ResolveItem[]) : [];

    // Try DB-backed registry first (optional)
    let registryRows: RegistryRow[] = [];
    try {
      const { data, error } = await supabase
        .from("league_registry")
        .select("sport_key, league_key, league_abbrev, league_name, scoreboard_url, aliases")
        .limit(1000);

      if (!error && Array.isArray(data)) {
        registryRows = (data as any[]).map((r) => ({
          sport_key: String(r.sport_key),
          league_key: String(r.league_key),
          league_abbrev: r.league_abbrev ?? null,
          league_name: r.league_name ?? null,
          scoreboard_url: String(r.scoreboard_url),
          aliases: r.aliases ?? null,
        }));
      }
    } catch {
      // ignore and fallback
    }

    const allRows = [...registryRows, ...BUILTIN];

    const results = items.map((input) => {
      const m = matchRegistry(allRows, input);
      return {
        input,
        resolved: m.resolved,
        candidates: m.candidates,
      };
    });

    return NextResponse.json({ results });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Resolve failed" }, { status: 500 });
  }
}
