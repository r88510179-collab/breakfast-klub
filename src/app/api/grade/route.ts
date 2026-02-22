// src/app/api/slips/grade/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type BetRow = {
  id: string;
  date: string;
  capper: string;
  league: string;
  market: string;
  play: string;
  odds?: number | null;
  units?: number | null;
  opponent?: string | null;
  final_score?: string | null;
  status: string;
  result: string;
  notes?: string | null;
  book?: string | null;
  slip_ref?: string | null;
  ai_meta?: any;
  created_at?: string;
};

type ExtractedTicket = {
  ticket_status?: string; // OPEN | FINAL
  ticket_result?: string; // WIN | LOSS | PUSH | VOID | CASHOUT | OPEN
  book?: string | null;
  slip_ref?: string | null;
  paid_amount?: number | null;
  final_score_visible?: boolean;
  evidence?: {
    won_tag?: boolean;
    lost_tag?: boolean;
    confetti?: boolean;
    paid_amount_shown?: boolean;
    final_score_shown?: boolean;
  };
  notes?: string | null;
};

type ExtractedLeg = {
  leg_index?: number | null;
  total_legs?: number | null;
  parlay?: boolean;
  market?: string | null;
  play?: string | null;
  selection?: string | null;
  line?: number | string | null;
  odds?: number | string | null;
  opponent?: string | null;
  result?: string | null; // WIN|LOSS|PUSH|VOID|OPEN
  final_score?: string | null;
  player_name?: string | null;
  team_name?: string | null;
  confidence?: number | null;
};

type ExtractedGrade = {
  ticket: ExtractedTicket;
  bets: ExtractedLeg[];
  issues?: string[];
};

function getBearerToken(req: Request): string {
  const h = req.headers.get("authorization") || "";
  if (h.toLowerCase().startsWith("bearer ")) return h.slice(7).trim();
  return "";
}

function stripJson(raw: string) {
  return raw
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
}

function safeJsonParse(raw: string): any | null {
  const s = stripJson(raw);
  const firstObj = s.indexOf("{");
  const lastObj = s.lastIndexOf("}");
  if (firstObj !== -1 && lastObj !== -1 && lastObj > firstObj) {
    try {
      return JSON.parse(s.slice(firstObj, lastObj + 1));
    } catch {}
  }
  const firstArr = s.indexOf("[");
  const lastArr = s.lastIndexOf("]");
  if (firstArr !== -1 && lastArr !== -1 && lastArr > firstArr) {
    try {
      return JSON.parse(s.slice(firstArr, lastArr + 1));
    } catch {}
  }
  return null;
}

function normalizeStatus(v: any): "OPEN" | "FINAL" {
  const s = String(v ?? "").toUpperCase();
  return s === "FINAL" ? "FINAL" : "OPEN";
}

function normalizeResult(v: any): "OPEN" | "WIN" | "LOSS" | "PUSH" | "VOID" | "CASHOUT" {
  const s = String(v ?? "").toUpperCase();
  if (["WIN", "LOSS", "PUSH", "VOID", "CASHOUT"].includes(s)) return s as any;
  return "OPEN";
}

function toDataUrl(file: File, bytes: ArrayBuffer): string {
  const mime = file.type || "image/jpeg";
  const b64 = Buffer.from(bytes).toString("base64");
  return `data:${mime};base64,${b64}`;
}

function getOpenRouterVisionModels(): string[] {
  // Set this in Vercel for easy reordering/fallbacks:
  // OPENROUTER_VISION_MODELS=nvidia/nemotron-nano-12b-v2-vl:free,qwen/qwen3-vl-30b-a3b-thinking,qwen/qwen3-vl-235b-a22b-thinking
  const fromEnv = (process.env.OPENROUTER_VISION_MODELS || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

  if (fromEnv.length) return fromEnv;

  // Reasonable defaults from the models you listed
  return [
    "nvidia/nemotron-nano-12b-v2-vl:free",
    "qwen/qwen3-vl-30b-a3b-thinking",
    "qwen/qwen3-vl-235b-a22b-thinking",
  ];
}

async function openRouterVisionGrade(params: {
  imageDataUrl: string;
  book?: string;
  slipRef?: string;
}) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("Missing OPENROUTER_API_KEY");

  const models = getOpenRouterVisionModels();
  const referer = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
  const title = "Breakfast Klub Slip Grader";

  const prompt = [
    "You are grading a sportsbook slip screenshot (settled/won/lost/cashed out slip).",
    "Extract ONLY what is visible in the image. Do not guess.",
    "Goal: determine whether the ticket is settled and parse ticket-level settlement + visible legs.",
    "",
    "Return STRICT JSON only with this schema:",
    "{",
    '  "ticket": {',
    '    "ticket_status": "OPEN|FINAL",',
    '    "ticket_result": "OPEN|WIN|LOSS|PUSH|VOID|CASHOUT",',
    '    "book": string|null,',
    '    "slip_ref": string|null,',
    '    "paid_amount": number|null,',
    '    "final_score_visible": boolean,',
    '    "evidence": {',
    '      "won_tag": boolean,',
    '      "lost_tag": boolean,',
    '      "confetti": boolean,',
    '      "paid_amount_shown": boolean,',
    '      "final_score_shown": boolean',
    "    },",
    '    "notes": string|null',
    "  },",
    '  "bets": [',
    "    {",
    '      "leg_index": number|null,',
    '      "total_legs": number|null,',
    '      "parlay": boolean,',
    '      "market": string|null,',
    '      "play": string|null,',
    '      "selection": string|null,',
    '      "line": number|string|null,',
    '      "odds": number|string|null,',
    '      "opponent": string|null,',
    '      "result": "OPEN|WIN|LOSS|PUSH|VOID"|null,',
    '      "final_score": string|null,',
    '      "player_name": string|null,',
    '      "team_name": string|null,',
    '      "confidence": number|null',
    "    }",
    "  ],",
    '  "issues": string[]',
    "}",
    "",
    "Rules:",
    "- If the screenshot clearly shows WON/LOST/cashed out/paid/confetti/final results, ticket_status should be FINAL.",
    "- If the screenshot is ambiguous or still live, ticket_status=OPEN.",
    "- If only some legs are visible, include only visible legs and add an issue explaining partial visibility.",
    "- Do not invent hidden legs from a collapsed parlay card.",
    `- If provided outside the image: book=${params.book || "(none)"}, slip_ref=${params.slipRef || "(none)"}; use as hints only.`,
  ].join("\n");

  let lastErr: any = null;

  for (const model of models) {
    try {
      const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          "HTTP-Referer": referer,
          "X-Title": title,
        },
        body: JSON.stringify({
          model,
          temperature: 0,
          max_tokens: 1800,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: prompt },
                { type: "image_url", image_url: { url: params.imageDataUrl } },
              ],
            },
          ],
        }),
      });

      const out = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        const msg =
          out?.error?.message ||
          out?.message ||
          `OpenRouter ${model} failed (HTTP ${resp.status})`;
        throw new Error(msg);
      }

      const raw = out?.choices?.[0]?.message?.content;
      const text =
        typeof raw === "string"
          ? raw
          : Array.isArray(raw)
          ? raw.map((x: any) => (typeof x?.text === "string" ? x.text : "")).join("\n")
          : "";

      const parsed = safeJsonParse(text);
      if (!parsed || typeof parsed !== "object") {
        throw new Error(`Model ${model} returned non-JSON / unparsable JSON`);
      }

      return { model, parsed };
    } catch (e: any) {
      lastErr = new Error(`${model} failed: ${e?.message ?? String(e)}`);
    }
  }

  throw lastErr ?? new Error("All vision providers failed");
}

function normalizeExtracted(parsed: any): ExtractedGrade {
  const ticketRaw = parsed?.ticket ?? {};
  const betsRaw = Array.isArray(parsed?.bets) ? parsed.bets : [];

  const ticket: ExtractedTicket = {
    ticket_status: normalizeStatus(ticketRaw.ticket_status),
    ticket_result: normalizeResult(ticketRaw.ticket_result),
    book: ticketRaw.book ? String(ticketRaw.book) : null,
    slip_ref: ticketRaw.slip_ref ? String(ticketRaw.slip_ref) : null,
    paid_amount:
      ticketRaw.paid_amount === null || ticketRaw.paid_amount === undefined
        ? null
        : Number(ticketRaw.paid_amount),
    final_score_visible: Boolean(ticketRaw.final_score_visible),
    evidence: {
      won_tag: Boolean(ticketRaw?.evidence?.won_tag),
      lost_tag: Boolean(ticketRaw?.evidence?.lost_tag),
      confetti: Boolean(ticketRaw?.evidence?.confetti),
      paid_amount_shown: Boolean(ticketRaw?.evidence?.paid_amount_shown),
      final_score_shown: Boolean(ticketRaw?.evidence?.final_score_shown),
    },
    notes: ticketRaw.notes ? String(ticketRaw.notes) : null,
  };

  const bets: ExtractedLeg[] = betsRaw.map((b: any) => ({
    leg_index:
      b?.leg_index === null || b?.leg_index === undefined ? null : Number(b.leg_index),
    total_legs:
      b?.total_legs === null || b?.total_legs === undefined ? null : Number(b.total_legs),
    parlay: Boolean(b?.parlay),
    market: b?.market ? String(b.market) : null,
    play: b?.play ? String(b.play) : null,
    selection: b?.selection ? String(b.selection) : null,
    line: b?.line ?? null,
    odds: b?.odds ?? null,
    opponent: b?.opponent ? String(b.opponent) : null,
    result: b?.result ? normalizeResult(b.result) : null,
    final_score: b?.final_score ? String(b.final_score) : null,
    player_name: b?.player_name ? String(b.player_name) : null,
    team_name: b?.team_name ? String(b.team_name) : null,
    confidence:
      b?.confidence === null || b?.confidence === undefined ? null : Number(b.confidence),
  }));

  const issues = Array.isArray(parsed?.issues)
    ? parsed.issues.map((x: any) => String(x))
    : [];

  return { ticket, bets, issues };
}

function norm(s: any) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokenSet(s: any): Set<string> {
  return new Set(norm(s).split(" ").filter((x) => x.length >= 2));
}

function overlapScore(a: string, b: string): number {
  const A = tokenSet(a);
  const B = tokenSet(b);
  if (!A.size || !B.size) return 0;
  let hit = 0;
  for (const t of A) if (B.has(t)) hit++;
  return hit / Math.max(A.size, B.size);
}

type GradeProposal = {
  bet_id: string;
  match_reason: string;
  confidence: number;
  before: {
    status: string;
    result: string;
    final_score: string | null;
    notes: string | null;
  };
  after: {
    status: "OPEN" | "FINAL";
    result: "OPEN" | "WIN" | "LOSS" | "PUSH" | "VOID" | "CASHOUT";
    final_score: string | null;
    notes_append: string | null;
  };
};

function buildProposals(openBets: BetRow[], extracted: ExtractedGrade, opts: { slipRefHint?: string; bookHint?: string }) {
  const proposals: GradeProposal[] = [];
  const issues: string[] = [];

  const ticketStatus = normalizeStatus(extracted.ticket.ticket_status);
  const ticketResult = normalizeResult(extracted.ticket.ticket_result);

  const slipRef = (opts.slipRefHint || extracted.ticket.slip_ref || "").trim();
  const bookHint = (opts.bookHint || extracted.ticket.book || "").trim().toLowerCase();

  let candidates = openBets;

  if (slipRef) {
    candidates = candidates.filter((b: any) => String(b?.slip_ref ?? "").trim() === slipRef);
    if (!candidates.length) {
      issues.push(`No OPEN bets found with slip_ref="${slipRef}".`);
      return { proposals, issues, matchedCount: 0 };
    }
  } else {
    issues.push("No slip_ref provided/detected. Matching will be fuzzy and review is required.");
  }

  if (bookHint) {
    const withBook = candidates.filter((b: any) =>
      String(b?.book ?? "").toLowerCase().includes(bookHint)
    );
    if (withBook.length) candidates = withBook;
  }

  // If slip-level final result is visible and we have multiple rows tied to one slip_ref,
  // treat it as a slip-level settlement (including parlay legs stored as separate rows).
  if (ticketStatus === "FINAL" && ticketResult !== "OPEN" && candidates.length) {
    const scoreText =
      extracted.bets.find((x) => x.final_score)?.final_score ||
      (extracted.ticket.final_score_visible ? "Final shown on settled slip" : null);

    for (const b of candidates) {
      const noteParts = [
        "[AI Grade / settled slip]",
        `ticket=${ticketResult}`,
        extracted.ticket.evidence?.confetti ? "confetti" : null,
        extracted.ticket.evidence?.won_tag ? "WON tag" : null,
        extracted.ticket.evidence?.lost_tag ? "LOST tag" : null,
        extracted.ticket.evidence?.paid_amount_shown ? "paid shown" : null,
        extracted.ticket.paid_amount != null ? `paid=${extracted.ticket.paid_amount}` : null,
      ].filter(Boolean);

      proposals.push({
        bet_id: b.id,
        match_reason: slipRef ? `Matched by slip_ref ${slipRef}` : "Slip-level fuzzy match",
        confidence: slipRef ? 0.99 : 0.7,
        before: {
          status: String(b.status ?? "OPEN"),
          result: String(b.result ?? "OPEN"),
          final_score: (b as any).final_score ?? null,
          notes: (b as any).notes ?? null,
        },
        after: {
          status: "FINAL",
          result: ticketResult,
          final_score: scoreText ?? ((b as any).final_score ?? null),
          notes_append: noteParts.join(" | "),
        },
      });
    }

    return { proposals, issues, matchedCount: candidates.length };
  }

  // Fallback: leg-level matching (partial/cropped slips)
  const visibleLegs = extracted.bets.filter((x) => x.play || x.selection || x.opponent);
  if (!visibleLegs.length) {
    issues.push("No visible legs could be extracted from the settled slip.");
    return { proposals, issues, matchedCount: 0 };
  }

  for (const leg of visibleLegs) {
    const legResult = leg.result ? normalizeResult(leg.result) : "OPEN";
    if (legResult === "OPEN") continue;

    let best: { bet: BetRow; score: number } | null = null;

    for (const b of candidates) {
      const s1 = overlapScore(
        `${leg.play || ""} ${leg.selection || ""} ${leg.market || ""} ${leg.opponent || ""}`,
        `${b.play || ""} ${b.market || ""} ${(b as any).selection || ""} ${b.opponent || ""}`
      );

      const s2 = overlapScore(leg.opponent || "", b.opponent || "");
      const s3 = overlapScore(leg.market || "", b.market || "");
      const score = s1 * 0.65 + s2 * 0.2 + s3 * 0.15;

      if (!best || score > best.score) best = { bet: b, score };
    }

    if (!best || best.score < 0.35) {
      issues.push(`Could not confidently match visible leg "${leg.play || leg.selection || "unknown"}".`);
      continue;
    }

    const b = best.bet;
    const noteParts = [
      "[AI Grade / visible leg]",
      `leg=${legResult}`,
      leg.leg_index != null ? `leg#${leg.leg_index}` : null,
      leg.total_legs != null ? `of ${leg.total_legs}` : null,
    ].filter(Boolean);

    proposals.push({
      bet_id: b.id,
      match_reason: `Fuzzy leg match (${best.score.toFixed(2)})`,
      confidence: Number(best.score.toFixed(2)),
      before: {
        status: String(b.status ?? "OPEN"),
        result: String(b.result ?? "OPEN"),
        final_score: (b as any).final_score ?? null,
        notes: (b as any).notes ?? null,
      },
      after: {
        status: "FINAL",
        result: legResult,
        final_score: leg.final_score ?? ((b as any).final_score ?? null),
        notes_append: noteParts.join(" | "),
      },
    });
  }

  return { proposals, issues, matchedCount: proposals.length };
}

export async function POST(req: Request) {
  try {
    const token = getBearerToken(req);
    if (!token) {
      return NextResponse.json({ error: "Missing Authorization Bearer token" }, { status: 401 });
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anon) {
      return NextResponse.json({ error: "Missing Supabase env vars" }, { status: 500 });
    }

    const supabase = createClient(url, anon, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const fd = await req.formData();
    const file = fd.get("file");
    const commit = String(fd.get("commit") ?? "false").toLowerCase() === "true";
    const book = String(fd.get("book") ?? "").trim();
    const slipRef = String(fd.get("slip_ref") ?? "").trim();

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing image file" }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const imageDataUrl = toDataUrl(file, bytes);

    // Pull OPEN bets (narrow when possible)
    let q = supabase
      .from("bets")
      .select("*")
      .eq("status", "OPEN")
      .order("date", { ascending: false })
      .order("created_at", { ascending: false });

    if (slipRef) q = q.eq("slip_ref", slipRef);
    if (book) q = q.ilike("book", `%${book}%`);

    const { data: openBetsData, error: openErr } = await q;
    if (openErr) {
      return NextResponse.json({ error: openErr.message }, { status: 500 });
    }

    const openBets = (openBetsData ?? []) as BetRow[];

    const { model, parsed } = await openRouterVisionGrade({
      imageDataUrl,
      book: book || undefined,
      slipRef: slipRef || undefined,
    });

    const extracted = normalizeExtracted(parsed);
    const { proposals, issues, matchedCount } = buildProposals(openBets, extracted, {
      slipRefHint: slipRef || undefined,
      bookHint: book || undefined,
    });

    // Safety checks / balances:
    // - No automatic commit if no proposals
    // - No automatic commit if fuzzy matches are low-confidence
    const lowConfidence = proposals.filter((p) => p.confidence < 0.75);
    const commitBlockedReasons: string[] = [];
    if (!proposals.length) commitBlockedReasons.push("No grade proposals generated.");
    if (lowConfidence.length) {
      commitBlockedReasons.push(
        `Low-confidence matches present (${lowConfidence.length}). Review before applying.`
      );
    }

    if (!commit || commitBlockedReasons.length) {
      return NextResponse.json({
        ok: true,
        mode: "preview",
        provider_model: model,
        extracted,
        summary: {
          open_bets_considered: openBets.length,
          matched_count: matchedCount,
          proposals_count: proposals.length,
          can_commit: commitBlockedReasons.length === 0,
          commit_blocked_reasons: commitBlockedReasons,
        },
        issues: [...(extracted.issues ?? []), ...issues],
        proposals,
      });
    }

    // Commit updates
    const updated: string[] = [];
    for (const p of proposals) {
      const existing = openBets.find((b) => b.id === p.bet_id);
      if (!existing) continue;

      const existingNotes = ((existing as any).notes ?? "") as string;
      const noteAppend = p.after.notes_append ? ` ${p.after.notes_append}` : "";
      const mergedNotes = `${existingNotes}${noteAppend}`.trim() || null;

      const patch: any = {
        status: p.after.status,
        result: p.after.result,
        final_score: p.after.final_score,
        notes: mergedNotes,
      };

      const { error } = await supabase.from("bets").update(patch).eq("id", p.bet_id).eq("status", "OPEN");
      if (error) {
        return NextResponse.json(
          { error: `Failed updating ${p.bet_id}: ${error.message}` },
          { status: 500 }
        );
      }

      updated.push(p.bet_id);
    }

    return NextResponse.json({
      ok: true,
      mode: "commit",
      provider_model: model,
      updated_count: updated.length,
      updated_bet_ids: updated,
      issues: [...(extracted.issues ?? []), ...issues],
      proposals,
      extracted,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Grade failed" }, { status: 500 });
  }
}
