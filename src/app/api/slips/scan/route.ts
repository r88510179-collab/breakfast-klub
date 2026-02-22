import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getBearerToken(req: Request): string {
  const h = req.headers.get("authorization") || "";
  if (h.toLowerCase().startsWith("bearer ")) return h.slice(7).trim();
  return "";
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
      return NextResponse.json(
        {
          error:
            "Missing Supabase env vars (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY)",
        },
        { status: 500 }
      );
    }

    // Use anon key + user bearer token so auth/RLS applies to this user
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
      return NextResponse.json(
        { error: "No file uploaded (field name must be 'file')" },
        { status: 400 }
      );
    }

    if (!file.type?.startsWith("image/")) {
      return NextResponse.json(
        { error: `Unsupported file type: ${file.type || "unknown"}` },
        { status: 400 }
      );
    }

    // Read bytes so we confirm upload path works
    const bytes = await file.arrayBuffer();
    const sizeKB = Math.round(bytes.byteLength / 1024);

    // TEMP STUB: returns one editable row to prove the scanner flow works.
    // Replace this later with OCR/vision extraction.
    return NextResponse.json({
      issues: [
        "Scanner endpoint is connected, but OCR/vision extraction is not implemented yet.",
        `Received image: ${file.name} (${file.type}, ~${sizeKB} KB)`,
        "Edit the proposed row and click Add to ledger to test the review/confirm workflow.",
      ],
      extracted: {
        bets: [
          {
            date: new Date().toISOString().slice(0, 10),
            capper: "Personal",
            league: "",
            market: "",
            play: "",
            selection: "",
            line: "",
            odds: "",
            units: "1",
            opponent: "",
            notes: [book ? `Book=${book}` : "", slipRef ? `SlipRef=${slipRef}` : "", `SourceFile=${file.name}`]
              .filter(Boolean)
              .join(" | "),
          },
        ],
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Slip scan route error" }, { status: 500 });
  }
}
