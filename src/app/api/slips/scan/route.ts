import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { ChatMessage } from "@/lib/ai/openaiCompat";
import { runSlipScanConsensus, runSlipScanPrimary, runVerifier } from "@/lib/ai/router";

export const runtime = "nodejs";

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

  // Try object first
  try {
    return JSON.parse(s);
  } catch {}

  // Try slicing to outermost object
  const firstObj = s.indexOf("{");
  const lastObj = s.lastIndexOf("}");
  if (firstObj !== -1 && lastObj !== -1 && lastObj > firstObj) {
    try {
      return JSON.parse(s.slice(firstObj, lastObj + 1));
    } catch {}
  }

  return null;
}

function toDataUrl(file: File, buf: ArrayBuffer) {
  const mime = file.type || "image/jpeg";
  const base64 = Buffer.from(buf).toString("base64");
  return `data:${mime};base64,${base64}`;
}

function asStr(v: any) {
  if (v === null || v === undefined) return "";
  return String(v);
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeBetRow(raw: any) {
  // Keep as strings because your UI edits these before insert
  return {
    date: raw?.date ? asStr(raw.date).slice(0, 10) : todayISO(),
    capper: raw?.capper ? asStr(raw.capper) : "Personal",
    league: raw?.league ? asStr(raw.league) : "",
    market: raw?.market ? asStr(raw.market) : "",
    play: raw?.play ? asStr(raw.play) : "",
    selection: raw?.selection ? asStr(raw.selection) : "",
    line: raw?.line === null || raw?.line === undefined ? "" : asStr(raw.line),
    odds: raw?.odds === null || raw?.odds === undefined ? "" : asStr(raw.odds),
    units: raw?.units === null || raw?.units === undefined ? "1" : asStr(raw.units),
    opponent: raw?.opponent ? asStr(raw.opponent) : "",
    notes: raw?.notes ? asStr(raw.notes) : "",
  };
}

function validateExtractedShape(j: any) {
  if (!j || typeof j !== "object") return { ok: false, reason: "No JSON object returned." };

  const extracted = j.extracted;
  if (!extracted || typeof extracted !== "object") {
    return { ok: false, reason: "Missing extracted object." };
  }

  const bets = Array.isArray(extracted.bets) ? extracted.bets : null;
  if (!bets) return { ok: false, reason: "Missing extracted.bets array." };

  return { ok: true as const };
}

function buildPrimaryPrompt(params: { book?: string; slipRef?: string; imageMime: string }) {
  const { book, slipRef, imageMime } = params;

  return [
    "You are extracting sportsbook slip / bet card data from an image.",
    "Return STRICT JSON only (no markdown fences, no commentary).",
    "",
    "Rules:",
    "- If multiple bets/legs are visible and should be tracked separately, return multiple rows in extracted.bets.",
    "- If something is unclear, leave the field empty and add a warning in `issues`.",
    "- Do NOT invent teams, lines, odds, units, dates, or results.",
    "- `units` should be the stake in units ONLY if visible or inferable from the image. Otherwise default to \"1\".",
    "- `date` should be YYYY-MM-DD if visible; if not visible, leave blank.",
    "- `league` should be a short human-readable league tag from the image (examples: NBA, NCAAM, EPL, ATP, WTA, UFC, MLB, NHL).",
    "- `market` examples: Spread, Moneyline, Total, Player Prop, SGP, Parlay, Team Total.",
    "- `play` should be the main bet description users can read in the ledger.",
    "- `selection` is the side/selection if separable (e.g., Over, Under, Team name, player prop selection).",
    "- `line` should be numeric if visible, otherwise empty string.",
    "- `odds` should be American odds if visible (e.g. -110, +145), otherwise empty string.",
    "- `opponent` can be opponent or matchup text.",
    "",
    "Output schema:",
    "{",
    '  "issues": ["string", "..."],',
    '  "extracted": {',
    '    "bets": [',
    "      {",
    '        "date": "YYYY-MM-DD or empty",',
    '        "capper": "string or empty",',
    '        "league": "string or empty",',
    '        "market": "string or empty",',
    '        "play": "string or empty",',
    '        "selection": "string or empty",',
    '        "line": "string|number|empty",',
    '        "odds": "string|number|empty",',
    '        "units": "string|number|empty",',
    '        "opponent": "string or empty",',
    '        "notes": "string or empty"',
    "      }",
    "    ]",
    "  }",
    "}",
    "",
    `Context: book=${book || ""}; slip_ref=${slipRef || ""}; image_mime=${imageMime}`,
    "If you can identify the sportsbook or slip reference in the image, note it in issues if it conflicts with provided context.",
  ].join("\n");
}

function buildVerifierPrompt(rawPrimary: string, parsedPrimary: any) {
  return [
    "You are a strict JSON/schema verifier for extracted bet rows.",
    "You do NOT have the image. Only verify/repair JSON structure and internal consistency.",
    "Return STRICT JSON only (no markdown).",
    "",
    "Tasks:",
    "1) Ensure output matches schema exactly: { issues: string[], extracted: { bets: [...] } }",
    "2) If any fields are missing, fill with empty string (or [] for issues) rather than inventing facts",
    "3) Preserve values from the proposed extraction whenever possible",
    "",
    "Proposed raw output:",
    rawPrimary,
    "",
    "Parsed proposed output (if parse succeeded):",
    JSON.stringify(parsedPrimary ?? null),
  ].join("\n");
}

function addDeterministicWarnings(rows: any[], existingIssues: string[]) {
  const issues = [...existingIssues];

  if (!rows.length) issues.push("No bet rows were extracted from the image.");

  rows.forEach((r, i) => {
    const rowNum = i + 1;

    if (!r.play?.trim()) issues.push(`Row ${rowNum}: missing play`);
    if (!r.market?.trim()) issues.push(`Row ${rowNum}: missing market`);
    if (!r.league?.trim()) issues.push(`Row ${rowNum}: missing league`);

    const odds = String(r.odds ?? "").trim();
    if (odds && !/^[-+]?\d+(\.\d+)?$/.test(odds)) {
      issues.push(`Row ${rowNum}: odds not numeric-looking ("${odds}")`);
    }

    const units = String(r.units ?? "").trim();
    if (units && !/^[-+]?\d+(\.\d+)?$/.test(units)) {
      issues.push(`Row ${rowNum}: units not numeric-looking ("${units}")`);
    }

    const date = String(r.date ?? "").trim();
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      issues.push(`Row ${rowNum}: date not YYYY-MM-DD ("${date}")`);
    }
  });

  return Array.from(new Set(issues));
}

export async function POST(req: Request) {
  try {
    const token = getBearerToken(req);
    if (!token) return NextResponse.json({ error: "Missing Authorization Bearer token" }, { status: 401 });

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anon) return NextResponse.json({ error: "Missing Supabase env vars" }, { status: 500 });

    // User-scoped client so RLS applies (and to validate session)
    const supabase = createClient(url, anon, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const form = await req.formData();
    const file = form.get("file");
    const book = String(form.get("book") ?? "").trim();
    const slipRef = String(form.get("slip_ref") ?? "").trim();

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing file upload" }, { status: 400 });
    }

    if (!file.type?.startsWith("image/")) {
      return NextResponse.json({ error: "Only image uploads are supported right now" }, { status: 400 });
    }

    const maxBytes = 8 * 1024 * 1024; // 8MB
    if (file.size > maxBytes) {
      return NextResponse.json({ error: "Image too large (max 8MB)" }, { status: 400 });
    }

    const buf = await file.arrayBuffer();
    const dataUrl = toDataUrl(file, buf);

    const systemPrompt = buildPrimaryPrompt({
      book,
      slipRef,
      imageMime: file.type || "image/jpeg",
    });

    const visionMessages: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: [
          { type: "text", text: "Extract the sportsbook slip data from this image into the required JSON schema." },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ];

    // Primary extraction (consensus if possible, otherwise single)
    let primaryRaw = "";
    let altRaw: string | null = null;

    try {
      const { a, b } = await runSlipScanConsensus(visionMessages);
      primaryRaw = a;
      altRaw = b;
    } catch {
      primaryRaw = await runSlipScanPrimary(visionMessages);
    }

    let primaryJson = safeJsonParse(primaryRaw);
    let primaryValid = validateExtractedShape(primaryJson);

    // If primary invalid and we have an alternate, try it
    if (!primaryValid.ok && altRaw) {
      const altJson = safeJsonParse(altRaw);
      const altValid = validateExtractedShape(altJson);
      if (altValid.ok) {
        primaryJson = altJson;
        primaryValid = altValid;
      }
    }

    // Text-only verifier/repair for schema cleanup
    if (!primaryValid.ok || primaryJson) {
      try {
        const verifierMessages: ChatMessage[] = [
          { role: "system", content: buildVerifierPrompt(primaryRaw, primaryJson) },
          { role: "user", content: "Repair/return strict JSON now." },
        ];

        const verifierRaw = await runVerifier(verifierMessages);
        const verifierJson = safeJsonParse(verifierRaw);
        const verifierValid = validateExtractedShape(verifierJson);

        if (verifierValid.ok) {
          primaryJson = verifierJson;
          primaryValid = verifierValid;
        }
      } catch {
        // Non-fatal; we'll continue with primary if valid
      }
    }

    if (!primaryValid.ok || !primaryJson) {
      return NextResponse.json(
        {
          error: "AI extraction failed validation",
          details: primaryValid,
          raw_preview: String(primaryRaw).slice(0, 800),
        },
        { status: 422 }
      );
    }

    const rawIssues = Array.isArray(primaryJson.issues)
      ? primaryJson.issues.map((x: any) => String(x)).filter(Boolean)
      : [];

    const rawBets = Array.isArray(primaryJson?.extracted?.bets) ? primaryJson.extracted.bets : [];
    const normalizedRows = rawBets.map(normalizeBetRow);

    let issues = addDeterministicWarnings(normalizedRows, rawIssues);

    // Optional duplicate warning by slip_ref (if your bets table has slip_ref column)
    if (slipRef) {
      try {
        const { data: dupes, error: dupeErr } = await supabase
          .from("bets")
          .select("id")
          .eq("slip_ref", slipRef)
          .limit(5);

        if (!dupeErr && Array.isArray(dupes) && dupes.length > 0) {
          issues.push(`Possible duplicate: ${dupes.length} existing row(s) already use slip_ref "${slipRef}".`);
        }
      } catch {
        // ignore if column/table differs
      }
    }

    return NextResponse.json({
      issues: Array.from(new Set(issues)),
      extracted: {
        bets: normalizedRows,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Scan failed" }, { status: 500 });
  }
}
