import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { ChatMessage } from "@/lib/ai/openaiCompat";
import { runConsensus, runPrimary, runVerifier, type Strategy } from "@/lib/ai/router";
import { betsToCSV, netUnits, toNumber, type BetRow } from "@/lib/ledger";

function getBearerToken(req: Request): string {
  const h = req.headers.get("authorization") || "";
  if (h.toLowerCase().startsWith("bearer ")) return h.slice(7).trim();
  return "";
}

function jsonFromModel(raw: string): any | null {
  // Expect strict JSON, but models sometimes wrap in ```json ... ```
  const cleaned = raw.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) return null;
  try {
    return JSON.parse(cleaned.slice(first, last + 1));
  } catch {
    return null;
  }
}

function computeLedgerFacts(bets: BetRow[]) {
  const open = bets.filter((b) => String(b.status).toUpperCase() === "OPEN");
  const finals = bets.filter((b) => String(b.status).toUpperCase() === "FINAL");

  const wins = finals.filter((b) => String(b.result).toUpperCase() === "WIN").length;
  const losses = finals.filter((b) => String(b.result).toUpperCase() === "LOSS").length;
  const pushes = finals.filter((b) => String(b.result).toUpperCase() === "PUSH").length;

  const risk = finals.reduce((a, b) => a + toNumber(b.units, 0), 0);
  const net = finals.reduce((a, b) => a + netUnits(b), 0);
  const roi = risk > 0 ? net / risk : 0;

  return {
    open_count: open.length,
    final_wins: wins,
    final_losses: losses,
    final_pushes: pushes,
    final_risk_units: Number(risk.toFixed(4)),
    final_net_units: Number(net.toFixed(4)),
    final_roi: Number(roi.toFixed(6)),
  };
}

function buildContext(bets: BetRow[]) {
  const open = bets.filter((b) => String(b.status).toUpperCase() === "OPEN").slice(0, 50);
  const finals = bets.filter((b) => String(b.status).toUpperCase() === "FINAL").slice(0, 50);

  const facts = computeLedgerFacts(bets);

  return {
    facts,
    open_bets_sample: open.map((b) => ({
      id: b.id,
      date: b.date,
      capper: b.capper,
      league: b.league,
      market: b.market,
      play: b.play,
      odds: b.odds,
      units: b.units,
      opponent: b.opponent ?? null,
      notes: b.notes ?? null,
    })),
    final_bets_sample: finals.map((b) => ({
      id: b.id,
      date: b.date,
      capper: b.capper,
      league: b.league,
      market: b.market,
      play: b.play,
      odds: b.odds,
      units: b.units,
      result: b.result,
      final_score: b.final_score ?? null,
    })),
  };
}

function validateResponseJson(j: any, betsById: Set<string>, facts: any) {
  if (!j || typeof j !== "object") return { ok: false, reason: "No JSON object returned." };

  const answer = j.answer_markdown;
  if (typeof answer !== "string" || !answer.trim()) return { ok: false, reason: "Missing answer_markdown." };

  const used = Array.isArray(j.used_bet_ids) ? j.used_bet_ids : [];
  for (const id of used) {
    if (typeof id === "string" && id && !betsById.has(id)) {
      return { ok: false, reason: `Unknown bet id referenced: ${id}` };
    }
  }

  // Enforce “numbers must match server facts”
  const nums = j.numbers_used;
  if (!nums || typeof nums !== "object") return { ok: false, reason: "Missing numbers_used." };

  const keys = Object.keys(facts);
  for (const k of keys) {
    if (nums[k] === undefined) return { ok: false, reason: `numbers_used missing ${k}` };
    if (Number(nums[k]) !== Number(facts[k])) return { ok: false, reason: `numbers_used.${k} does not match ledger facts` };
  }

  return { ok: true as const, answer_markdown: answer, used_bet_ids: used };
}

export async function POST(req: Request) {
  const token = getBearerToken(req);
  if (!token) return NextResponse.json({ error: "Missing Authorization Bearer token" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const prompt = String(body?.prompt ?? "").trim();
  const strategy = (String(body?.strategy ?? "balanced").toLowerCase() as Strategy) || "balanced";

  if (!prompt) return NextResponse.json({ error: "Missing prompt" }, { status: 400 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  // Use the user's access token for RLS-safe reads :contentReference[oaicite:8]{index=8}
  const supabase = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    accessToken: async () => token,
  });

  const { data: userData, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !userData?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: bets, error } = await supabase.from("bets").select("*").order("date", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const betRows = (bets ?? []) as BetRow[];
  const betsById = new Set(betRows.map((b) => b.id));

  // Deterministic “verified” intents (no model needed)
  const p = prompt.toLowerCase();
  if (p.includes("export open")) {
    const open = betRows.filter((b) => String(b.status).toUpperCase() === "OPEN");
    return NextResponse.json({ answer_markdown: "CSV (OPEN)\n\n```csv\n" + betsToCSV(open) + "\n```" });
  }
  if (p.includes("export all")) {
    return NextResponse.json({ answer_markdown: "CSV (ALL)\n\n```csv\n" + betsToCSV(betRows) + "\n```" });
  }

  const ctx = buildContext(betRows);

  const system: ChatMessage = {
    role: "system",
    content:
      [
        "You are the Breakfast Klub Tracker assistant.",
        "You MUST use only the provided ledger context. Do not invent bets, IDs, scores, or totals.",
        "Return STRICT JSON only (no markdown fences).",
        "Schema:",
        "{",
        '  "answer_markdown": "string",',
        '  "used_bet_ids": ["id", "..."],',
        '  "numbers_used": {',
        "     open_count, final_wins, final_losses, final_pushes, final_risk_units, final_net_units, final_roi",
        "  }",
        "}",
        "numbers_used MUST match the facts provided exactly.",
      ].join("\n"),
  };

  const user: ChatMessage = {
    role: "user",
    content: JSON.stringify(
      {
        prompt,
        context: ctx,
      },
      null,
      2
    ),
  };

  const messages: ChatMessage[] = [system, user];

  try {
    // Primary step
    let primaryRaw: string;
    let altRaw: string | null = null;

    if (strategy === "consensus") {
      const { a, b } = await runConsensus(messages);
      primaryRaw = a;
      altRaw = b;
    } else {
      primaryRaw = await runPrimary(strategy, messages);
    }

    let primaryJson = jsonFromModel(primaryRaw);
    let primaryValid = validateResponseJson(primaryJson, betsById, ctx.facts);

    // If consensus provided two drafts and first is invalid, try second
    if (!primaryValid.ok && altRaw) {
      const altJson = jsonFromModel(altRaw);
      const altValid = validateResponseJson(altJson, betsById, ctx.facts);
      if (altValid.ok) {
        primaryJson = altJson;
        primaryValid = altValid;
      }
    }

    // Verifier step (balanced/consensus) or repair if invalid
    if (strategy !== "fast") {
      const verifierMessages: ChatMessage[] = [
        {
          role: "system",
          content:
            [
              "You are a strict verifier.",
              "Check whether the proposed JSON answer is consistent with the provided context facts and bet IDs.",
              "Return STRICT JSON only:",
              '{ "verdict": "PASS"|"FAIL", "reason": "string", "fixed": <full answer json if FAIL else null> }',
              "If FAIL, produce a corrected full answer JSON following the original schema and using only the context.",
            ].join("\n"),
        },
        {
          role: "user",
          content: JSON.stringify(
            {
              context: ctx,
              proposed: primaryJson,
              validation_result: primaryValid,
            },
            null,
            2
          ),
        },
      ];

      const verifierRaw = await runVerifier(verifierMessages);
      const verifierJson = jsonFromModel(verifierRaw);

      if (verifierJson?.verdict === "PASS" && primaryValid.ok) {
        return NextResponse.json({ answer_markdown: primaryValid.answer_markdown });
      }

      if (verifierJson?.verdict === "FAIL" && verifierJson.fixed) {
        const fixedValid = validateResponseJson(verifierJson.fixed, betsById, ctx.facts);
        if (fixedValid.ok) return NextResponse.json({ answer_markdown: fixedValid.answer_markdown });
      }
    }

    // If fast mode OR verifier couldn’t fix, but primary is valid, return it
    if (primaryValid.ok) return NextResponse.json({ answer_markdown: primaryValid.answer_markdown });

    return NextResponse.json(
      { error: "AI output failed validation", details: primaryValid },
      { status: 422 }
    );
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "AI error" }, { status: 500 });
  }
}
