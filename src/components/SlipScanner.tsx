"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type ProposedBet = {
  date: string | null;
  capper: string | null;
  league: string | null;
  market: string | null;
  play: string | null;
  selection?: string | null;
  line?: number | null;
  odds: number | null;
  units: number | null;
  opponent: string | null;
  notes: string | null;
};

export default function SlipScanner({ onAdded }: { onAdded: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [book, setBook] = useState("");
  const [slipRef, setSlipRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [issues, setIssues] = useState<string[]>([]);
  const [bets, setBets] = useState<ProposedBet[]>([]);
  const [err, setErr] = useState("");

  async function scan() {
    setErr("");
    setIssues([]);
    setBets([]);
    if (!file) return;

    setBusy(true);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        window.location.href = "/";
        return;
      }

      const fd = new FormData();
      fd.append("file", file);
      if (book.trim()) fd.append("book", book.trim());
      if (slipRef.trim()) fd.append("slip_ref", slipRef.trim());

      const res = await fetch("/api/slips/scan", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });

      const out = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(out?.error ?? "Scan failed");
        return;
      }

      const extracted = out.extracted || {};
      setIssues(out.issues || extracted.issues || []);
      setBets(Array.isArray(extracted.bets) ? extracted.bets : []);
    } finally {
      setBusy(false);
    }
  }

  async function addToLedger() {
    setErr("");
    if (!bets.length) return;

    const rows = bets
      .map((b) => ({
        date: b.date,
        capper: b.capper ?? "Personal",
        league: b.league ?? "UNKNOWN",
        market: b.market ?? "UNKNOWN",
        play: b.play ?? "",
        selection: b.selection ?? null,
        line: b.line ?? null,
        odds: b.odds,
        units: b.units ?? 1,
        opponent: b.opponent ?? null,
        notes: b.notes ?? null,
        book: book.trim() || null,
        slip_ref: slipRef.trim() || null,
        status: "OPEN",
        result: "OPEN",
      }))
      .filter((r) => r.play);

    if (!rows.length) {
      setErr("Nothing to add (missing play field).");
      return;
    }

    setBusy(true);
    try {
      const { error } = await supabase.from("bets").insert(rows as any);
      if (error) {
        setErr(error.message);
        return;
      }
      setFile(null);
      setBets([]);
      setIssues([]);
      onAdded();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="border rounded p-4 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="font-semibold">Slip Scanner</h2>
        <div className="text-xs text-gray-600">AI proposes → you review → you add</div>
      </div>

      <div className="grid gap-2 md:grid-cols-3">
        <div className="space-y-1">
          <div className="text-sm font-medium">Book (optional)</div>
          <input className="border rounded px-2 py-2 w-full" value={book} onChange={(e) => setBook(e.target.value)} />
        </div>
        <div className="space-y-1">
          <div className="text-sm font-medium">Slip Ref (optional)</div>
          <input className="border rounded px-2 py-2 w-full" value={slipRef} onChange={(e) => setSlipRef(e.target.value)} />
        </div>
        <div className="space-y-1">
          <div className="text-sm font-medium">Upload image</div>
          <input
            className="border rounded px-2 py-2 w-full"
            type="file"
            accept="image/*"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            disabled={busy}
          />
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        <button
          onClick={scan}
          disabled={busy || !file}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400"
        >
          {busy ? "Scanning…" : "Scan slip"}
        </button>

        <button
          onClick={addToLedger}
          disabled={busy || bets.length === 0}
          className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:bg-gray-400"
        >
          Add to ledger
        </button>
      </div>

      {err ? <div className="border border-red-300 bg-red-50 text-red-800 rounded p-3">{err}</div> : null}

      {issues.length ? (
        <div className="border rounded p-3 bg-yellow-50">
          <div className="font-semibold text-sm">Checks / warnings</div>
          <ul className="list-disc ml-5 text-sm">
            {issues.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {bets.length ? (
        <div className="space-y-2">
          <div className="font-semibold text-sm">Proposed bets (editable in code next step)</div>
          <div className="text-xs text-gray-600">
            For now this shows what was extracted. Next improvement: inline editing per row before insert.
          </div>
          <pre className="border rounded p-3 text-xs overflow-auto">{JSON.stringify(bets, null, 2)}</pre>
        </div>
      ) : null}
    </section>
  );
}
