import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { runVerifier } from "@/lib/ai/router";
import type { ChatMessage } from "@/lib/ai/openaiCompat";

function getBearerToken(req: Request): string {
  const h = req.headers.get("authorization") || "";
  if (h.toLowerCase().startsWith("bearer ")) return h.slice(7).trim();
  return "";
}

function stripJson(raw: string) {
  const s = raw.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
  return s;
}

function safeJsonParse(raw: string): any {
  const s = stripJson(raw);
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) throw new Error("No JSON object found in model output");
  return JSON.parse(s.slice(first, last + 1));
}

async function mistralVisionExtract(args: {
  apiKey: string;
  model: string;
  mime: string;
  base64: string;
  hint?: { book?: string; slip_ref?: string };
}) {
  // Mistral vision uses Chat Completions with content parts (text + image_url).
  // Docs: vision via chat completions; URL or base64 allowed. :contentReference[oaicite:7]{index=7}
  const dataUrl = `data:${args.mime};base64,${args.base64}`;

  const system = [
    "You extract sportsbook slips into structured bet rows.",
    "Return STRICT JSON only. No markdown.",
    "If uncertain, leave fields null and add an issue.",
    "",
    "JSON schema:",
    "{",
    '  "book": string|null,',
    '  "slip_ref": string|null,',
    '  "bets": [',
    "    {",
    '      "date": "YYYY-MM-DD"|null,',
    '      "capper": string|null,',
    '      "league": string|null,',
    '      "market": string|null,',
    '      "play": string|null,',
    '      "selection": string|null,',
    '      "line": number|null,',
    '      "odds": number|null,',
    '      "units": number|null,',
    '      "opponent": string|null,',
    '      "notes": string|null',
    "    }",
    "  ],",
    '  "issues": [string]',
    "}",
    "",
    "Rules:",
    "- Do NOT invent data not visible in the image.",
    "- odds should be American odds if visible (e.g., -110, +150).",
    "- units should be units risked if visible; else null.",
    "- default status/result are not set here (ledger will store OPEN/OPEN).",
  ].join("\n");

  const userText = [
    "Extract all bet legs from this slip image.",
    "If multiple legs, output multiple entries in bets[].",
    "Hints:",
    JSON.stringify(args.hint ?? {}, null, 2),
  ].join("\n");

  const payload = {
    model: args.model,
    messages: [
      { role: "system", content: system },
      {
        role: "user",
        content: [
          { type: "text", text: userText },
          { type: "image_url", image_url: dataUrl },
        ],
      },
    ],
    temperature: 0.1,
    max_tokens: 1200,
  };

  const res = await fetch("https://api.mistral.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Mistral vision error (${res.status}): ${t.slice(0, 300)}`);
  }

  const j: any = await res.json();
  const content = j?.choices?.[0]?.message?.content;
  if (!content) throw new Error("Mistral returned empty content");
  return safeJsonParse(content);
}

export async function POST(req: Request) {
  const token = getBearerToken(req);
  if (!token) return NextResponse.json({ error: "Missing Authorization Bearer token" }, { status: 401 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const supabase = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    accessToken: async () => token,
  });

  const { data: userData, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !userData?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const form = await req.formData();
  const file = form.get("file");
  const book = String(form.get("book") ?? "").trim() || null;
  const slip_ref = String(form.get("slip_ref") ?? "").trim() || null;

  if (!(file instanceof File)) return NextResponse.json({ error: "Missing file" }, { status: 400 });

  const mime = file.type || "image/png";
  const buf = Buffer.from(await file.arrayBuffer());
  const base64 = buf.toString("base64");

  const mistralKey = process.env.MISTRAL_API_KEY;
  const visionModel = process.env.MISTRAL_VISION_MODEL || "mistral-small-2506";
  if (!mistralKey) return NextResponse.json({ error: "Missing MISTRAL_API_KEY" }, { status: 500 });

  // 1) Vision extraction
  const extracted = await mistralVisionExtract({
    apiKey: mistralKey,
    model: visionModel,
    mime,
    base64,
    hint: { book: book ?? undefined, slip_ref: slip_ref ?? undefined },
  });

  // 2) Verifier pass (flags inconsistencies, missing required fields, etc.)
  const verifierMessages: ChatMessage[] = [
    {
      role: "system",
      content:
        "You are a strict verifier. Review extracted slip JSON, list issues, and suggest corrections. Return STRICT JSON: { issues: string[], corrected: object }",
    },
    { role: "user", content: JSON.stringify(extracted, null, 2) },
  ];

  let verified: any = null;
  try {
    const vraw = await runVerifier(verifierMessages);
    verified = safeJsonParse(vraw);
  } catch {
    verified = { issues: ["Verifier failed; use manual review."], corrected: extracted };
  }

  // 3) Store scan record (PENDING)
  const { data: scanRow, error: scanErr } = await supabase
    .from("slip_scans")
    .insert({
      user_id: userData.user.id,
      book,
      slip_ref,
      extracted: verified?.corrected ?? extracted,
      issues: verified?.issues ?? extracted?.issues ?? [],
      status: "PENDING",
    })
    .select("*")
    .single();

  if (scanErr) {
    return NextResponse.json({ error: scanErr.message }, { status: 500 });
  }

  return NextResponse.json({
    scan_id: scanRow.id,
    extracted: scanRow.extracted,
    issues: scanRow.issues,
  });
}
