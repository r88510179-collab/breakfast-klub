import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

type ExtractedBet = {
  date?: string;
  capper?: string;
  league?: string;
  market?: string;
  play?: string;
  selection?: string;
  line?: number | string | null;
  odds?: number | string | null;
  units?: number | string | null;
  opponent?: string;
  notes?: string;
};

type ScanResponse = {
  issues: string[];
  extracted: {
    bets: ExtractedBet[];
    meta?: Record<string, any>;
  };
};

function getBearerToken(req: Request): string {
  const h = req.headers.get("authorization") || "";
  if (h.toLowerCase().startsWith("bearer ")) return h.slice(7).trim();
  return "";
}

function stripJsonFences(raw: string) {
  return raw
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
}

function tryParseJsonObject(raw: string): any | null {
  const s = stripJsonFences(raw);

  // direct parse
  try {
    return JSON.parse(s);
  } catch {}

  // extract first {...}
  const firstObj = s.indexOf("{");
  const lastObj = s.lastIndexOf("}");
  if (firstObj >= 0 && lastObj > firstObj) {
    try {
      return JSON.parse(s.slice(firstObj, lastObj + 1));
    } catch {}
  }

  // extract first [...]
  const firstArr = s.indexOf("[");
  const lastArr = s.lastIndexOf("]");
  if (firstArr >= 0 && lastArr > firstArr) {
    try {
      return JSON.parse(s.slice(firstArr, lastArr + 1));
    } catch {}
  }

  return null;
}

function contentToString(content: any): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => {
        if (typeof c === "string") return c;
        if (c?.type === "text" && typeof c?.text === "string") return c.text;
        return "";
      })
      .join("\n")
      .trim();
  }
  return "";
}

function normalizeLine(v: any): string {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

function normalizeOdds(v: any): string {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

function ensureArray<T>(v: any): T[] {
  return Array.isArray(v) ? v : [];
}

function normalizeExtractedOutput(raw: any, fallbackCapper = "", fallbackDate = ""): ScanResponse {
  const issues: string[] = ensureArray<string>(raw?.issues).map((x) => String(x));

  let betsRaw = raw?.extracted?.bets ?? raw?.bets ?? [];
  if (!Array.isArray(betsRaw)) betsRaw = [];

  const bets: ExtractedBet[] = betsRaw.map((b: any) => ({
    date: b?.date ? String(b.date) : fallbackDate || undefined,
    capper: b?.capper ? String(b.capper) : fallbackCapper || undefined,
    league: b?.league ? String(b.league) : "",
    market: b?.market ? String(b.market) : "",
    play: b?.play ? String(b.play) : "",
    selection: b?.selection ? String(b.selection) : "",
    line: b?.line ?? "",
    odds: b?.odds ?? "",
    units: b?.units ?? "",
    opponent: b?.opponent ? String(b.opponent) : "",
    notes: b?.notes ? String(b.notes) : "",
  }));

  return {
    issues,
    extracted: {
      bets,
      meta: raw?.extracted?.meta ?? raw?.meta ?? {},
    },
  };
}

function toDataUrl(file: File, bytes: Buffer): string {
  const mime = file.type || "image/jpeg";
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

function buildVisionPrompt(params: {
  book?: string;
  slipRef?: string;
  filename?: string;
}) {
  const { book = "", slipRef = "", filename = "" } = params;

  return `
You are extracting sportsbook slip / capper graphic bet data into structured JSON for a betting ledger.

IMPORTANT GOAL:
- Extract EVERY visible betting line / leg.
- Do NOT collapse a parlay graphic into only 1 row if multiple legs are shown.
- If a parlay has 4 legs shown, return 4 bet rows (one per leg).
- If a capper promo image shows a 3-pick parlay with player props, return 3 rows (one per leg).
- When information is missing/unclear, leave blank and add an issue.

Image context (may be blank):
- book (user-entered): ${book || "(none)"}
- slip_ref (user-entered): ${slipRef || "(none)"}
- filename: ${filename || "(unknown)"}

OUTPUT STRICT JSON ONLY (no markdown fences):
{
  "issues": ["string", "..."],
  "extracted": {
    "meta": {
      "book": "string or empty",
      "slip_ref": "string or empty",
      "bet_type": "parlay|straight|unknown",
      "parlay_legs_count_visible": number | null,
      "overall_odds": number | string | null,
      "wager": number | string | null,
      "to_pay": number | string | null,
      "payout": number | string | null,
      "capper_detected": "string or empty"
    },
    "bets": [
      {
        "date": "YYYY-MM-DD or empty",
        "capper": "string or empty",
        "league": "NBA/NCAAM/NFL/EPL/ATP/etc or best guess raw text",
        "market": "Spread|Moneyline|Total|Player Prop - Points|Player Prop - Assists|Player Prop - Rebounds|etc",
        "play": "human-readable full leg text",
        "selection": "team/player/over/under selection if separable",
        "line": number or string or null,
        "odds": number or string or null,
        "units": null,
        "opponent": "opponent or matchup if visible",
        "notes": "extra details (parlay context, wager/payout, timestamps, uncertainty)"
      }
    ]
  }
}

EXTRACTION RULES:
1) Return one row per visible leg.
2) Preserve leg odds if shown next to each leg.
3) If only overall parlay odds are shown, include that in meta.overall_odds and mention in each row notes.
4) If both overall and per-leg odds are shown, use per-leg odds for each row and overall in meta.
5) For player props like "5+ De'Aaron Fox Assists":
   - market = "Player Prop - Assists"
   - selection = "De'Aaron Fox Assists"
   - line = 5
   - play = "De'Aaron Fox Assists 5+"
6) For spreads like "#7 Purdue +4.5":
   - market = "Spread"
   - selection = "Purdue"
   - line = 4.5
   - play = "Purdue +4.5"
7) For moneyline like "Xavier TO WIN":
   - market = "Moneyline"
   - selection = "Xavier"
   - line = null
   - play = "Xavier ML"
8) Infer league when logos/teams clearly indicate it (e.g., PHO/SAS/ATL/PHI/DET/NY = NBA).
9) Detect capper branding text (example: "HARRY LOCK PICKS") and set capper if visible.
10) If anything is uncertain, still return the row and list an issue instead of skipping.

Return JSON only.
`.trim();
}

async function callOpenRouterVision(opts: {
  apiKey: string;
  models: string[];
  dataUrl: string;
  prompt: string;
}) {
  const { apiKey, models, dataUrl, prompt } = opts;

  let lastErr: any = null;
  const failures: string[] = [];

  for (const model of models) {
    const m = model.trim();
    if (!m) continue;

    try {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          // Optional but helpful for OpenRouter analytics/debugging
          "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
          "X-Title": "Breakfast Klub Tracker",
        },
        body: JSON.stringify({
          model: m,
          temperature: 0.1,
          max_tokens: 2200,
          messages: [
            {
              role: "system",
              content:
                "You extract sportsbook slips and capper graphics into strict JSON. Do not omit visible legs.",
            },
            {
              role: "user",
              content: [
                { type: "text", text: prompt },
                { type: "image_url", image_url: { url: dataUrl } },
              ],
            },
          ],
        }),
      });

      const out = await res.json().catch(() => ({}));

      if (!res.ok) {
        const msg =
          out?.error?.message ||
          out?.message ||
          `${res.status} ${res.statusText || "OpenRouter error"}`;
        failures.push(`${m} failed: ${msg}`);
        lastErr = new Error(msg);
        continue;
      }

      const content = contentToString(out?.choices?.[0]?.message?.content);
      if (!content) {
        failures.push(`${m} failed: empty response content`);
        lastErr = new Error("Empty model response");
        continue;
      }

      return { model: m, content, raw: out, failures };
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      failures.push(`${m} failed: ${msg}`);
      lastErr = e;
    }
  }

  const details = failures.length ? failures.join(" | ") : lastErr?.message || "Unknown error";
  throw new Error(`All vision providers failed. ${details}`);
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

    // Validate user session via Supabase + bearer token (RLS-friendly auth check)
    const supabase = createClient(url, anon, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const form = await req.formData();
    const file = form.get("file");
    const book = String(form.get("book") ?? "").trim();
    const slipRef = String(form.get("slip_ref") ?? "").trim();

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing image file" }, { status: 400 });
    }

    if (!file.type?.startsWith("image/")) {
      return NextResponse.json({ error: "Only image uploads are supported" }, { status: 400 });
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    if (!bytes.length) {
      return NextResponse.json({ error: "Uploaded image is empty" }, { status: 400 });
    }

    // ~12 MB guardrail (adjust if needed)
    if (bytes.length > 12 * 1024 * 1024) {
      return NextResponse.json({ error: "Image too large (max ~12MB)" }, { status: 413 });
    }

    const dataUrl = toDataUrl(file, bytes);

    const openrouterKey = process.env.OPENROUTER_API_KEY;
    if (!openrouterKey) {
      return NextResponse.json(
        {
          error:
            "OPENROUTER_API_KEY is not set. Add it in Vercel Project Settings → Environment Variables.",
        },
        { status: 500 }
      );
    }

    // Put your preferred FREE vision models first in Vercel env:
    // OPENROUTER_VISION_MODELS=modelA,modelB,modelC
    // Example placeholders shown below; replace with the exact models you selected.
    const visionModels = (
      process.env.OPENROUTER_VISION_MODELS ||
      [
        // Replace these with your exact OpenRouter free vision model IDs
        "qwen/qwen2.5-vl-72b-instruct:free",
        "meta-llama/llama-3.2-11b-vision-instruct:free",
      ].join(",")
    )
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (!visionModels.length) {
      return NextResponse.json(
        { error: "No vision models configured. Set OPENROUTER_VISION_MODELS in Vercel." },
        { status: 500 }
      );
    }

    const prompt = buildVisionPrompt({
      book,
      slipRef,
      filename: file.name,
    });

    const result = await callOpenRouterVision({
      apiKey: openrouterKey,
      models: visionModels,
      dataUrl,
      prompt,
    });

    const parsed = tryParseJsonObject(result.content);
    if (!parsed) {
      return NextResponse.json(
        {
          error: "Vision model returned non-JSON output",
          model: result.model,
          raw_preview: result.content.slice(0, 2000),
          failures: result.failures,
        },
        { status: 422 }
      );
    }

    const normalized = normalizeExtractedOutput(parsed, "", "");

    // Extra safety checks / hints
    const extraIssues = [...normalized.issues];

    if (!normalized.extracted.bets.length) {
      extraIssues.push("No bet rows were extracted from the image.");
    }

    // Warn when image clearly says parlay and we got too few rows
    const fullText = JSON.stringify(parsed).toLowerCase() + " " + result.content.toLowerCase();
    const mentionsParlay =
      fullText.includes("parlay") || /(\d+)\s*pick\s*parlay/i.test(result.content);

    if (mentionsParlay && normalized.extracted.bets.length <= 1) {
      extraIssues.push(
        "Parlay detected but only 1 row extracted. Review image and add missing legs manually if needed."
      );
    }

    // Force notes enrichment for parlay context if meta has wager/payout/overall odds
    const meta = normalized.extracted.meta ?? {};
    const parlayNoteParts: string[] = [];
    if (meta?.bet_type) parlayNoteParts.push(`bet_type=${meta.bet_type}`);
    if (meta?.overall_odds !== undefined && meta?.overall_odds !== null && meta?.overall_odds !== "")
      parlayNoteParts.push(`overall_odds=${meta.overall_odds}`);
    if (meta?.wager !== undefined && meta?.wager !== null && meta?.wager !== "")
      parlayNoteParts.push(`wager=${meta.wager}`);
    if (meta?.to_pay !== undefined && meta?.to_pay !== null && meta?.to_pay !== "")
      parlayNoteParts.push(`to_pay=${meta.to_pay}`);
    if (meta?.payout !== undefined && meta?.payout !== null && meta?.payout !== "")
      parlayNoteParts.push(`payout=${meta.payout}`);

    const capperDetected = String(meta?.capper_detected ?? "").trim();

    const bets = normalized.extracted.bets.map((b) => {
      const currentNotes = String(b.notes ?? "").trim();
      const injected: string[] = [];

      if (capperDetected && !String(b.capper ?? "").trim()) {
        b.capper = capperDetected;
      }

      if (parlayNoteParts.length) injected.push(parlayNoteParts.join(", "));
      if (book) injected.push(`book=${book}`);
      if (slipRef) injected.push(`slip_ref=${slipRef}`);

      const mergedNotes = [currentNotes, ...injected].filter(Boolean).join(" | ");
      return {
        ...b,
        notes: mergedNotes || "",
        line: normalizeLine(b.line),
        odds: normalizeOdds(b.odds),
        units: b.units ?? "",
      };
    });

    // Detect obvious missed leg count mismatch if model reported visible leg count
    const reportedLegs = Number(meta?.parlay_legs_count_visible);
    if (Number.isFinite(reportedLegs) && reportedLegs > 0 && bets.length < reportedLegs) {
      extraIssues.push(
        `Visible parlay legs may be ${reportedLegs}, but only ${bets.length} rows were extracted. Review/edit before adding to ledger.`
      );
    }

    return NextResponse.json({
      issues: extraIssues,
      extracted: {
        bets,
        meta: { ...(normalized.extracted.meta ?? {}), model_used: result.model },
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Scan failed" },
      { status: 500 }
    );
  }
}
