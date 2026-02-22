import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type ExtractedBet = {
  date?: string;
  capper?: string;
  league?: string;
  market?: string;
  play?: string;
  selection?: string;
  line?: string | number | null;
  odds?: string | number | null;
  units?: string | number | null;
  opponent?: string;
  notes?: string;
};

type ScanResponseShape = {
  bets: ExtractedBet[];
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

  // Try direct parse
  try {
    return JSON.parse(s);
  } catch {
    // Try extracting largest object
    const firstObj = s.indexOf("{");
    const lastObj = s.lastIndexOf("}");
    if (firstObj !== -1 && lastObj !== -1 && lastObj > firstObj) {
      try {
        return JSON.parse(s.slice(firstObj, lastObj + 1));
      } catch {}
    }

    // Try extracting largest array
    const firstArr = s.indexOf("[");
    const lastArr = s.lastIndexOf("]");
    if (firstArr !== -1 && lastArr !== -1 && lastArr > firstArr) {
      try {
        return JSON.parse(s.slice(firstArr, lastArr + 1));
      } catch {}
    }
  }

  return null;
}

function asStr(v: any) {
  if (v === null || v === undefined) return "";
  return String(v);
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeBet(b: any): ExtractedBet {
  return {
    date: b?.date ? asStr(b.date) : todayISO(),
    capper: b?.capper ? asStr(b.capper) : "",
    league: b?.league ? asStr(b.league) : "",
    market: b?.market ? asStr(b.market) : "",
    play: b?.play ? asStr(b.play) : "",
    selection: b?.selection ? asStr(b.selection) : "",
    line: b?.line ?? "",
    odds: b?.odds ?? "",
    units: b?.units ?? "",
    opponent: b?.opponent ? asStr(b.opponent) : "",
    notes: b?.notes ? asStr(b.notes) : "",
  };
}

function normalizeExtractedShape(parsed: any): ScanResponseShape {
  // Accept a few possible shapes from model responses
  let bets: any[] = [];
  let issues: string[] = [];

  if (Array.isArray(parsed)) {
    bets = parsed;
  } else if (parsed && typeof parsed === "object") {
    if (Array.isArray(parsed.bets)) bets = parsed.bets;
    if (Array.isArray(parsed.rows)) bets = parsed.rows;
    if (Array.isArray(parsed.legs) && !bets.length) {
      // If model returns legs instead of bets, convert legs -> bets
      bets = parsed.legs.map((leg: any) => ({
        date: parsed.date,
        capper: parsed.capper,
        league: parsed.league,
        market: leg.market || parsed.market || "Parlay",
        play: leg.play || leg.selection || "",
        selection: leg.selection || "",
        line: leg.line ?? "",
        odds: leg.odds ?? "",
        units: parsed.units ?? "",
        opponent: leg.opponent || leg.matchup || "",
        notes: parsed.notes || "Parsed from parlay legs",
      }));
    }
    if (Array.isArray(parsed.issues)) {
      issues = parsed.issues.map((x: any) => asStr(x)).filter(Boolean);
    }
  }

  const normalized = bets
    .map(normalizeBet)
    .filter((b) => b.play || b.market || b.league || b.opponent);

  return { bets: normalized, issues };
}

async function callOpenRouterVision(args: {
  apiKey: string;
  model: string;
  imageDataUrl: string;
  book?: string;
  slipRef?: string;
}) {
  const { apiKey, model, imageDataUrl, book, slipRef } = args;

  const systemPrompt = [
    "You extract sportsbook slips / betting graphics into structured JSON.",
    "Return STRICT JSON only (no markdown fences).",
    "You MUST extract ALL visible picks/legs (do not stop at 2 if 4 are visible).",
    "If the image is a parlay, prefer ONE ROW PER LEG so the user can review/edit each leg before saving.",
    "If overall parlay odds/wager/payout are visible, repeat them in each leg's notes (or odds if leg odds are missing).",
    "If the image is a capper graphic (not a live sportsbook ticket), still extract rows from visible picks/legs.",
    "Infer capper from header/branding text when visible (e.g., 'Harry Lock Picks').",
    "Use best-guess league (NBA, NCAAM, NFL, MLB, NHL, ATP, WTA, EPL, UCL, etc.) from matchup/player/team context.",
    "Do not invent hidden legs or stats not visible.",
    "If uncertain, include warnings in issues[].",
    "",
    "JSON schema:",
    "{",
    '  "bets": [',
    "    {",
    '      "date": "YYYY-MM-DD or empty",',
    '      "capper": "string",',
    '      "league": "string",',
    '      "market": "string",',
    '      "play": "string",',
    '      "selection": "string",',
    '      "line": "string|number|null",',
    '      "odds": "string|number|null",',
    '      "units": "string|number|null",',
    '      "opponent": "string",',
    '      "notes": "string"',
    "    }",
    "  ],",
    '  "issues": ["string"]',
    "}",
  ].join("\n");

  const userText = [
    "Extract all visible bets/legs from this image.",
    `Book hint: ${book || ""}`,
    `Slip ref hint: ${slipRef || ""}`,
    "Important: if there are 3, 4, or more legs visible, include every one.",
    "Do not return prose, only JSON.",
  ].join("\n");

  const body = {
    model,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: [
          { type: "text", text: userText },
          { type: "image_url", image_url: { url: imageDataUrl } },
        ],
      },
    ],
  };

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      // Optional but recommended for OpenRouter
      ...(process.env.NEXT_PUBLIC_APP_URL ? { "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL } : {}),
      ...(process.env.NEXT_PUBLIC_APP_NAME ? { "X-Title": process.env.NEXT_PUBLIC_APP_NAME } : {}),
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {}

  if (!res.ok) {
    const errMsg =
      json?.error?.message ||
      json?.message ||
      `HTTP ${res.status}`;
    throw new Error(errMsg);
  }

  const content = json?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;

  // Some providers may return content blocks
  if (Array.isArray(content)) {
    const joined = content
      .map((c: any) => (typeof c?.text === "string" ? c.text : typeof c === "string" ? c : ""))
      .filter(Boolean)
      .join("\n");
    if (joined) return joined;
  }

  throw new Error("No model response content");
}

async function tryVisionModels(args: {
  apiKey: string;
  imageDataUrl: string;
  book?: string;
  slipRef?: string;
}) {
  const configured = [
    process.env.OPENROUTER_VISION_MODEL_PRIMARY || "nvidia/nemotron-nano-12b-v2-vl:free",
    process.env.OPENROUTER_VISION_MODEL_SECONDARY || "qwen/qwen3-vl-30b-a3b-thinking",
    process.env.OPENROUTER_VISION_MODEL_TERTIARY || "qwen/qwen3-vl-235b-a22b-thinking",
    process.env.OPENROUTER_VISION_MODEL_QUATERNARY || "google/gemma-3-27b-it:free",
  ].filter(Boolean);

  const tried: string[] = [];
  const errors: string[] = [];

  for (const model of configured) {
    tried.push(model);
    try {
      const raw = await callOpenRouterVision({
        ...args,
        model,
      });
      return { raw, model, tried, errors };
    } catch (e: any) {
      const msg = e?.message || String(e);
      errors.push(`${model} failed: ${msg}`);
      // continue to next provider/model
    }
  }

  throw new Error(
    `All vision providers failed. ${errors.join(" | ")}`
  );
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

    // Validate user session via Supabase (RLS-safe pattern)
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
    const book = asStr(form.get("book")).trim();
    const slipRef = asStr(form.get("slip_ref")).trim();

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing image file" }, { status: 400 });
    }

    if (!file.type?.startsWith("image/")) {
      return NextResponse.json({ error: "Only image uploads are supported" }, { status: 400 });
    }

    // Keep payload sizes manageable for API calls
    const maxBytes = 8 * 1024 * 1024; // 8 MB
    if (file.size > maxBytes) {
      return NextResponse.json(
        { error: "Image is too large (>8MB). Crop the slip and try again." },
        { status: 400 }
      );
    }

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "OPENROUTER_API_KEY is not configured on the server" },
        { status: 500 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const imageDataUrl = `data:${file.type};base64,${buffer.toString("base64")}`;

    const { raw, model, tried, errors } = await tryVisionModels({
      apiKey,
      imageDataUrl,
      book,
      slipRef,
    });

    const parsed = safeJsonParse(raw);
    if (!parsed) {
      return NextResponse.json(
        {
          error: "Vision model response was not valid JSON",
          provider: model,
          tried,
          raw_preview: raw.slice(0, 2000),
        },
        { status: 422 }
      );
    }

    const normalized = normalizeExtractedShape(parsed);

    if (!normalized.bets.length) {
      return NextResponse.json(
        {
          error: "No bets/legs detected from image",
          provider: model,
          tried,
          issues: [
            ...(normalized.issues || []),
            "Try cropping closer to the slip content (remove large background graphics).",
            "For capper graphics, ensure the actual pick box is readable.",
          ],
        },
        { status: 422 }
      );
    }

    // Post-process hints for common capper graphics / parlays
    const enrichedBets = normalized.bets.map((b) => {
      const notes: string[] = [];
      if (b.notes) notes.push(String(b.notes));
      if (book) notes.push(`Book=${book}`);
      if (slipRef) notes.push(`SlipRef=${slipRef}`);

      return {
        ...b,
        date: b.date || todayISO(),
        capper: b.capper || "Personal",
        notes: notes.join(" | ") || "",
      };
    });

    return NextResponse.json({
      provider_used: model,
      providers_tried: tried,
      warnings_from_fallbacks: errors,
      issues: normalized.issues || [],
      extracted: { bets: enrichedBets },
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Scan failed" },
      { status: 500 }
    );
  }
}
