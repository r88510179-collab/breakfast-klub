// src/app/api/slips/scan/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

type VisionProviderName = "mistral" | "groq" | "hf" | "cerebras";

type VisionProviderConfig = {
  name: VisionProviderName;
  baseUrl: string;
  apiKey: string;
  model: string;
};

type ExtractedBet = {
  date: string;
  capper: string;
  league: string;
  market: string;
  play: string;
  selection: string;
  line: string;
  odds: string;
  units: string;
  opponent: string;
  notes: string;
};

type ExtractedPayload = {
  bets: ExtractedBet[];
};

type ProviderExtractionResult = {
  provider: VisionProviderName;
  model: string;
  extracted: ExtractedPayload;
  issues: string[];
  rawText?: string;
};

function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

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
  const firstBrace = s.indexOf("{");
  const lastBrace = s.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) return null;

  const candidate = s.slice(firstBrace, lastBrace + 1);
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

function asString(v: any): string {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

function toArrayStrings(v: any): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => asString(x)).filter(Boolean);
}

function normalizeDateMaybe(v: any): string {
  const s = asString(v);
  if (!s) return "";

  // Accept YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // Try common mm/dd/yyyy or m/d/yy parsing
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) {
    const mm = Number(m[1]);
    const dd = Number(m[2]);
    let yy = Number(m[3]);
    if (yy < 100) yy += 2000;
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31 && yy >= 2000 && yy <= 2100) {
      const mm2 = String(mm).padStart(2, "0");
      const dd2 = String(dd).padStart(2, "0");
      return `${yy}-${mm2}-${dd2}`;
    }
  }

  return s; // keep raw if model gave something else; UI can edit
}

function normalizeBet(b: any): ExtractedBet {
  return {
    date: normalizeDateMaybe(b?.date),
    capper: asString(b?.capper),
    league: asString(b?.league),
    market: asString(b?.market),
    play: asString(b?.play),
    selection: asString(b?.selection),
    line: asString(b?.line),
    odds: asString(b?.odds),
    units: asString(b?.units) || "1",
    opponent: asString(b?.opponent),
    notes: asString(b?.notes),
  };
}

function normalizeExtractedJson(j: any): { extracted: ExtractedPayload; issues: string[] } {
  const issues: string[] = [];

  let betsRaw: any[] = [];
  if (Array.isArray(j?.bets)) betsRaw = j.bets;
  else if (Array.isArray(j?.extracted?.bets)) betsRaw = j.extracted.bets;
  else if (Array.isArray(j)) betsRaw = j;
  else {
    issues.push("AI response did not include a bets array.");
  }

  const bets = betsRaw.map(normalizeBet);

  // Remove rows that are completely empty
  const filtered = bets.filter((b) => {
    const values = [
      b.date,
      b.capper,
      b.league,
      b.market,
      b.play,
      b.selection,
      b.line,
      b.odds,
      b.units,
      b.opponent,
      b.notes,
    ];
    return values.some((x) => String(x || "").trim() !== "");
  });

  if (bets.length !== filtered.length) {
    issues.push(`Removed ${bets.length - filtered.length} empty extracted row(s).`);
  }

  // Basic per-row warnings (non-blocking)
  filtered.forEach((b, i) => {
    const missing: string[] = [];
    if (!b.league) missing.push("league");
    if (!b.market) missing.push("market");
    if (!b.play) missing.push("play");
    if (!b.odds) missing.push("odds");
    if (missing.length) issues.push(`Row ${i + 1}: missing/unclear ${missing.join(", ")}.`);
  });

  return { extracted: { bets: filtered }, issues };
}

function getVisionProviders(): VisionProviderConfig[] {
  const list: VisionProviderConfig[] = [];

  const mistralKey = env("MISTRAL_API_KEY");
  const mistralVision = env("MISTRAL_VISION_MODEL");
  if (mistralKey && mistralVision) {
    list.push({
      name: "mistral",
      baseUrl: "https://api.mistral.ai/v1",
      apiKey: mistralKey,
      model: mistralVision,
    });
  }

  const groqKey = env("GROQ_API_KEY");
  const groqVision = env("GROQ_VISION_MODEL");
  if (groqKey && groqVision) {
    list.push({
      name: "groq",
      baseUrl: "https://api.groq.com/openai/v1",
      apiKey: groqKey,
      model: groqVision,
    });
  }

  const hfKey = env("HF_TOKEN"); // user renamed secret to HF_TOKEN
  const hfVision = env("HF_VISION_MODEL");
  if (hfKey && hfVision) {
    list.push({
      name: "hf",
      baseUrl: "https://router.huggingface.co/v1",
      apiKey: hfKey,
      model: hfVision,
    });
  }

  const cerebrasKey = env("CEREBRAS_API_KEY");
  const cerebrasVision = env("CEREBRAS_VISION_MODEL");
  if (cerebrasKey && cerebrasVision) {
    list.push({
      name: "cerebras",
      baseUrl: "https://api.cerebras.ai/v1",
      apiKey: cerebrasKey,
      model: cerebrasVision,
    });
  }

  return list;
}

function extractionPrompt(meta: { book?: string; slipRef?: string }) {
  const hints: string[] = [];
  if (meta.book) hints.push(`Book: ${meta.book}`);
  if (meta.slipRef) hints.push(`Slip reference: ${meta.slipRef}`);

  return [
    "You are a sportsbook slip extraction engine.",
    "Read the uploaded sportsbook slip image and extract bet(s).",
    "Return STRICT JSON only. No markdown fences. No commentary.",
    "",
    "Rules:",
    "- Extract one object per wager/leg that should become a ledger row.",
    "- If a parlay is shown, you may return multiple rows (one per leg) if leg details are visible.",
    "- If details are missing/unclear, leave the field as an empty string and add a warning in issues.",
    "- Do NOT invent teams, odds, lines, player names, dates, or results.",
    "- Do NOT grade the bet here. This route only extracts/open-logs.",
    "- Use strings for all fields (even line/odds/units).",
    "- Date should be YYYY-MM-DD if visible; otherwise empty string.",
    "- Capper may be empty if not shown.",
    "- League examples: NBA, NFL, NCAAM, EPL, ATP, WTA, MLB, NHL, UFC, etc.",
    "- Market examples: Spread, Moneyline, Total, Player Prop, SGP, Parlay, ML, Total Goals.",
    "",
    "Return this exact JSON schema:",
    "{",
    '  "bets": [',
    "    {",
    '      "date": "",',
    '      "capper": "",',
    '      "league": "",',
    '      "market": "",',
    '      "play": "",',
    '      "selection": "",',
    '      "line": "",',
    '      "odds": "",',
    '      "units": "",',
    '      "opponent": "",',
    '      "notes": ""',
    "    }",
    "  ],",
    '  "issues": ["warning 1", "warning 2"]',
    "}",
    "",
    hints.length ? `Context hints:\n- ${hints.join("\n- ")}` : "No extra context hints.",
  ].join("\n");
}

async function fileToDataUrl(file: File): Promise<string> {
  const buf = Buffer.from(await file.arrayBuffer());
  const mime = file.type || "application/octet-stream";
  const base64 = buf.toString("base64");
  return `data:${mime};base64,${base64}`;
}

function extractAssistantText(openAIResponse: any): string {
  const msg = openAIResponse?.choices?.[0]?.message;
  const content = msg?.content;

  if (typeof content === "string") return content;

  // Some providers return content parts
  if (Array.isArray(content)) {
    const textPart = content.find((p: any) => p?.type === "text" && typeof p?.text === "string");
    if (textPart?.text) return textPart.text;

    // fallback concat
    return content
      .map((p: any) => (typeof p?.text === "string" ? p.text : ""))
      .join("\n")
      .trim();
  }

  return "";
}

async function callVisionProvider(
  provider: VisionProviderConfig,
  imageDataUrl: string,
  meta: { book?: string; slipRef?: string }
): Promise<ProviderExtractionResult> {
  const body = {
    model: provider.model,
    temperature: 0,
    max_tokens: 1400,
    messages: [
      {
        role: "system",
        content:
          "You are a precise sportsbook OCR/data extraction model. Return strict JSON only and never invent missing data.",
      },
      {
        role: "user",
        content: [
          { type: "text", text: extractionPrompt(meta) },
          { type: "image_url", image_url: { url: imageDataUrl } },
        ],
      },
    ],
    // Some providers support this, some ignore it
    response_format: { type: "json_object" },
  };

  const res = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  const raw = await res.text();
  let parsedApi: any = null;
  try {
    parsedApi = JSON.parse(raw);
  } catch {
    // leave null; we still surface response text below
  }

  if (!res.ok) {
    const apiMsg =
      parsedApi?.error?.message ||
      parsedApi?.message ||
      raw.slice(0, 500) ||
      `HTTP ${res.status}`;
    throw new Error(`${provider.name} (${provider.model}) failed: ${apiMsg}`);
  }

  const assistantText = extractAssistantText(parsedApi);
  if (!assistantText) {
    throw new Error(`${provider.name} (${provider.model}) returned no assistant text`);
  }

  const parsedJson = safeJsonParse(assistantText);
  if (!parsedJson) {
    throw new Error(`${provider.name} (${provider.model}) returned non-JSON output`);
  }

  const norm = normalizeExtractedJson(parsedJson);
  const aiIssues = toArrayStrings(parsedJson?.issues);

  const combinedIssues = Array.from(new Set([...aiIssues, ...norm.issues]));

  return {
    provider: provider.name,
    model: provider.model,
    extracted: norm.extracted,
    issues: combinedIssues,
    rawText: assistantText,
  };
}

function scoreExtraction(r: ProviderExtractionResult): number {
  // Prefer more rows (up to a point) + more filled key fields
  let score = 0;
  score += Math.min(r.extracted.bets.length, 10) * 20;

  for (const b of r.extracted.bets) {
    if (b.league) score += 4;
    if (b.market) score += 4;
    if (b.play) score += 6;
    if (b.odds) score += 4;
    if (b.units) score += 2;
    if (b.opponent) score += 2;
    if (b.selection) score += 2;
  }

  // Slight penalty for warnings
  score -= r.issues.length;
  return score;
}

function compareExtractions(a: ProviderExtractionResult, b: ProviderExtractionResult): string[] {
  const warnings: string[] = [];

  const aRows = a.extracted.bets.length;
  const bRows = b.extracted.bets.length;
  if (aRows !== bRows) {
    warnings.push(
      `Cross-check mismatch: ${a.provider} found ${aRows} row(s) but ${b.provider} found ${bRows} row(s). Review before insert.`
    );
  }

  const count = Math.min(aRows, bRows);
  for (let i = 0; i < count; i++) {
    const x = a.extracted.bets[i];
    const y = b.extracted.bets[i];
    const diffs: string[] = [];
    if ((x.league || "").toLowerCase() !== (y.league || "").toLowerCase()) diffs.push("league");
    if ((x.market || "").toLowerCase() !== (y.market || "").toLowerCase()) diffs.push("market");
    if ((x.play || "").toLowerCase() !== (y.play || "").toLowerCase()) diffs.push("play");
    if ((x.odds || "") !== (y.odds || "")) diffs.push("odds");
    if ((x.line || "") !== (y.line || "")) diffs.push("line");

    if (diffs.length) {
      warnings.push(
        `Cross-check mismatch row ${i + 1}: differing ${diffs.join(", ")} between ${a.provider} and ${b.provider}.`
      );
    }
  }

  return warnings;
}

async function runExtractionWithFallbacks(
  imageDataUrl: string,
  meta: { book?: string; slipRef?: string }
): Promise<{
  chosen: ProviderExtractionResult;
  crossCheck?: ProviderExtractionResult;
  issues: string[];
}> {
  const providers = getVisionProviders();

  if (!providers.length) {
    throw new Error(
      "No vision providers configured. Add MISTRAL_API_KEY + MISTRAL_VISION_MODEL (recommended) or another *_VISION_MODEL."
    );
  }

  // Primary order is already Mistral -> Groq -> HF -> Cerebras
  const failures: string[] = [];
  let chosen: ProviderExtractionResult | null = null;
  let chosenProviderIndex = -1;

  for (let i = 0; i < providers.length; i++) {
    const p = providers[i];
    try {
      const r = await callVisionProvider(p, imageDataUrl, meta);

      // Accept valid JSON even if no rows; user can review warnings.
      chosen = r;
      chosenProviderIndex = i;
      break;
    } catch (e: any) {
      failures.push(e?.message ?? String(e));
    }
  }

  if (!chosen) {
    throw new Error(`All vision providers failed. ${failures.join(" | ")}`);
  }

  const issues = [...chosen.issues];
  if (failures.length) {
    issues.push(`Fallbacks attempted before success: ${failures.length}.`);
  }

  // Optional cross-check using the next available provider (non-blocking)
  let crossCheck: ProviderExtractionResult | undefined;
  for (let i = 0; i < providers.length; i++) {
    if (i === chosenProviderIndex) continue;
    try {
      crossCheck = await callVisionProvider(providers[i], imageDataUrl, meta);
      break;
    } catch {
      // non-blocking cross-check failure
    }
  }

  if (crossCheck) {
    issues.push(...compareExtractions(chosen, crossCheck));

    // If chosen looks much worse than cross-check, prefer the stronger extraction but warn.
    const chosenScore = scoreExtraction(chosen);
    const crossScore = scoreExtraction(crossCheck);
    if (crossScore >= chosenScore + 12) {
      issues.push(
        `Auto-selected cross-check result from ${crossCheck.provider} because it produced more complete extraction than ${chosen.provider}.`
      );
      return { chosen: crossCheck, crossCheck: chosen, issues: Array.from(new Set(issues)) };
    }
  }

  return { chosen, crossCheck, issues: Array.from(new Set(issues)) };
}

export async function POST(req: Request) {
  try {
    const token = getBearerToken(req);
    if (!token) {
      return NextResponse.json({ error: "Missing Authorization Bearer token" }, { status: 401 });
    }

    const supabaseUrl = env("NEXT_PUBLIC_SUPABASE_URL");
    const supabaseAnon = env("NEXT_PUBLIC_SUPABASE_ANON_KEY");
    if (!supabaseUrl || !supabaseAnon) {
      return NextResponse.json({ error: "Missing Supabase env vars" }, { status: 500 });
    }

    // Validate user using bearer token so only authenticated users can scan
    const supabase = createClient(supabaseUrl, supabaseAnon, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const form = await req.formData();
    const fileVal = form.get("file");
    const book = asString(form.get("book"));
    const slipRef = asString(form.get("slip_ref"));

    if (!(fileVal instanceof File)) {
      return NextResponse.json({ error: "Missing file upload" }, { status: 400 });
    }

    const file = fileVal as File;

    if (!file.type || !file.type.startsWith("image/")) {
      return NextResponse.json(
        { error: "Only image uploads are supported for slip scan right now (jpg/png/webp/heic where browser-supported)." },
        { status: 400 }
      );
    }

    // Basic size guard (12 MB)
    if (file.size > 12 * 1024 * 1024) {
      return NextResponse.json(
        { error: "Image is too large. Please upload a smaller image (max ~12MB)." },
        { status: 400 }
      );
    }

    const imageDataUrl = await fileToDataUrl(file);

    const { chosen, crossCheck, issues } = await runExtractionWithFallbacks(imageDataUrl, {
      book: book || undefined,
      slipRef: slipRef || undefined,
    });

    // Final non-blocking warnings
    const finalIssues = [...issues];
    if (!chosen.extracted.bets.length) {
      finalIssues.push("AI could not confidently extract any bet rows from this image. Try a clearer crop or add rows manually.");
    }

    // Ensure all rows contain strings only
    const extracted: ExtractedPayload = {
      bets: chosen.extracted.bets.map((b) => ({
        date: asString(b.date),
        capper: asString(b.capper),
        league: asString(b.league),
        market: asString(b.market),
        play: asString(b.play),
        selection: asString(b.selection),
        line: asString(b.line),
        odds: asString(b.odds),
        units: asString(b.units) || "1",
        opponent: asString(b.opponent),
        notes: asString(b.notes),
      })),
    };

    return NextResponse.json({
      ok: true,
      extracted,
      issues: Array.from(new Set(finalIssues)),
      meta: {
        provider: chosen.provider,
        model: chosen.model,
        cross_check_provider: crossCheck?.provider ?? null,
        cross_check_model: crossCheck?.model ?? null,
        file_name: file.name || null,
        file_type: file.type || null,
        file_size: file.size || 0,
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Slip scan failed" },
      { status: 500 }
    );
  }
}
