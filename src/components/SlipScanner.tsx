"use client";

import { useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { resolveLeagues } from "@/lib/leagues/client";

type ProposedBet = {
  date: string; // YYYY-MM-DD (we’ll default if missing)
  capper: string;
  league: string;
  market: string;
  play: string;

  selection: string;
  line: string; // keep as string for editing; convert to number on save if possible
  odds: string;
  units: string;

  opponent: string;
  notes: string;
};

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function asStr(v: any) {
  if (v === null || v === undefined) return "";
  return String(v);
}

export default function SlipScanner({
  cappers,
  onAdded,
}: {
  cappers: string[];
  onAdded: () => void | Promise<void>;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [book, setBook] = useState("");
  const [slipRef, setSlipRef] = useState("");

  const [busy, setBusy] = useState(false);
  const [issues, setIssues] = useState<string[]>([]);
  const [rows, setRows] = useState<ProposedBet[]>([]);
  const [err, setErr] = useState("");

  const capperOptions = useMemo(() => {
    const base = (cappers ?? []).filter(Boolean);
    const uniq = Array.from(new Set(base)).sort((a, b) => a.localeCompare(b));
    return uniq;
  }, [cappers]);

  function updateRow(i: number, key: keyof ProposedBet, value: string) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [key]: value } : r)));
  }

  function removeRow(i: number) {
    setRows((prev) => prev.filter((_, idx) => idx !== i));
  }

  function addEmptyRow() {
    setRows((prev) => [
      ...prev,
      {
        date: todayISO(),
        capper: capperOptions[0] || "Personal",
        league: "",
        market: "",
        play: "",
        selection: "",
        line: "",
        odds: "",
        units: "1",
        opponent: "",
        notes: "",
      },
    ]);
  }

  function normalizeExtracted(extracted: any): ProposedBet[] {
    const bets = Array.isArray(extracted?.bets) ? extracted.bets : [];
    return bets.map((b: any) => ({
      date: b?.date ? asStr(b.date) : todayISO(),
      capper: b?.capper ? asStr(b.capper) : capperOptions[0] || "Personal",
      league: b?.league ? asStr(b.league) : "",
      market: b?.market ? asStr(b.market) : "",
      play: b?.play ? asStr(b.play) : "",

      selection: b?.selection ? asStr(b.selection) : "",
      line: b?.line === null || b?.line === undefined ? "" : asStr(b.line),
      odds: b?.odds === null || b?.odds === undefined ? "" : asStr(b.odds),
      units: b?.units === null || b?.units === undefined ? "1" : asStr(b.units),

      opponent: b?.opponent ? asStr(b.opponent) : "",
      notes: b?.notes ? asStr(b.notes) : "",
    }));
  }

  function validateRows(rs: ProposedBet[]) {
    const problems: string[] = [];
    rs.forEach((r, idx) => {
      const missing: string[] = [];
      if (!r.date) missing.push("date");
      if (!r.capper.trim()) missing.push("capper");
      if (!r.league.trim()) missing.push("league");
      if (!r.market.trim()) missing.push("market");
      if (!r.play.trim()) missing.push("play");

      if (missing.length) problems.push(`Row ${idx + 1}: missing ${missing.join(", ")}`);
    });
    return problems;
  }

  async function scan() {
    setErr("");
    setIssues([]);
    setRows([]);

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

      setIssues(out?.issues ?? []);
      setRows(normalizeExtracted(out?.extracted));
    } finally {
      setBusy(false);
    }
  }

  async function addToLedger() {
    setErr("");

    const problems = validateRows(rows);
    if (problems.length) {
      setErr(problems.join(" | "));
      return;
    }

    const payload = rows.map((r) => {
      const lineNum = r.line.trim() ? Number(r.line) : null;
      const oddsNum = r.odds.trim() ? Number(r.odds) : null;
      const unitsNum = r.units.trim() ? Number(r.units) : 1;

      return {
        date: r.date || todayISO(),
        capper: r.capper.trim(),
        league: r.league.trim(),
        market: r.market.trim(),
        play: r.play.trim(),
        selection: r.selection.trim() || null,
        line: Number.isFinite(lineNum as any) ? lineNum : null,
        odds: Number.isFinite(oddsNum as any) ? oddsNum : null,
        units: Number.isFinite(unitsNum as any) ? unitsNum : 1,
        opponent: r.opponent.trim() || null,
        notes: r.notes.trim() || null,
        book: book.trim() || null,
        slip_ref: slipRef.trim() || null,
        status: "OPEN",
        result: "OPEN",
        ai_meta: { source: "slip_scan" },
      };
    });

    setBusy(true);
    try {
      const { error } = await supabase.from("bets").insert(payload as any);
      if (error) {
        setErr(error.message);
        return;
      }

      setFile(null);
      setIssues([]);
      setRows([]);
      await onAdded();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="border rounded p-4 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="font-semibold">Slip Scanner</h2>
        <div className="text-xs text-gray-600">AI proposes → you edit → you confirm</div>
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
          <div className="text-sm font-medium">Upload slip image</div>
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
          disabled={busy || rows.length === 0}
          className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:bg-gray-400"
        >
          Add to ledger
        </button>

        <button
          onClick={addEmptyRow}
          disabled={busy}
          className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300 disabled:bg-gray-400"
        >
          Add row manually
        </button>
      </div>

      {err ? <div className="border border-red-300 bg-red-50 text-red-800 rounded p-3">{err}</div> : null}

      {issues.length ? (
        <div className="border rounded p-3 bg-yellow-50 space-y-1">
          <div className="font-semibold text-sm">Checks / warnings</div>
          <ul className="list-disc ml-5 text-sm">
            {issues.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {rows.length ? (
        <div className="space-y-2">
          <div className="font-semibold text-sm">Review & Edit extracted rows</div>

          <div className="overflow-auto border rounded">
            <table className="min-w-[1100px] w-full border-collapse text-sm">
              <thead className="border-b bg-gray-50">
                <tr>
                  <th className="p-2 text-left">Date</th>
                  <th className="p-2 text-left">Capper</th>
                  <th className="p-2 text-left">League</th>
                  <th className="p-2 text-left">Market</th>
                  <th className="p-2 text-left">Play</th>
                  <th className="p-2 text-left">Odds</th>
                  <th className="p-2 text-left">Units</th>
                  <th className="p-2 text-left">Opponent</th>
                  <th className="p-2 text-left">Selection</th>
                  <th className="p-2 text-left">Line</th>
                  <th className="p-2 text-left">Notes</th>
                  <th className="p-2 text-left">Actions</th>
                </tr>
              </thead>

              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b align-top">
                    <td className="p-2">
                      <input
                        type="date"
                        className="border rounded px-2 py-1 w-[150px]"
                        value={r.date}
                        onChange={(e) => updateRow(i, "date", e.target.value)}
                      />
                    </td>

                    <td className="p-2">
                      <input
                        className="border rounded px-2 py-1 w-[180px]"
                        list="capper-list"
                        value={r.capper}
                        onChange={(e) => updateRow(i, "capper", e.target.value)}
                        placeholder="Select or type"
                      />
                    </td>

                    <td className="p-2">
                      <input
                        className="border rounded px-2 py-1 w-[120px]"
                        value={r.league}
                        onChange={(e) => updateRow(i, "league", e.target.value)}
                        placeholder="NBA"
                      />
                    </td>

                    <td className="p-2">
                      <input
                        className="border rounded px-2 py-1 w-[120px]"
                        value={r.market}
                        onChange={(e) => updateRow(i, "market", e.target.value)}
                        placeholder="Spread"
                      />
                    </td>

                    <td className="p-2">
                      <input
                        className="border rounded px-2 py-1 w-[320px]"
                        value={r.play}
                        onChange={(e) => updateRow(i, "play", e.target.value)}
                        placeholder="Team -3.5"
                      />
                    </td>

                    <td className="p-2">
                      <input
                        className="border rounded px-2 py-1 w-[90px]"
                        value={r.odds}
                        onChange={(e) => updateRow(i, "odds", e.target.value)}
                        placeholder="-110"
                      />
                    </td>

                    <td className="p-2">
                      <input
                        className="border rounded px-2 py-1 w-[70px]"
                        value={r.units}
                        onChange={(e) => updateRow(i, "units", e.target.value)}
                        placeholder="1"
                      />
                    </td>

                    <td className="p-2">
                      <input
                        className="border rounded px-2 py-1 w-[180px]"
                        value={r.opponent}
                        onChange={(e) => updateRow(i, "opponent", e.target.value)}
                        placeholder="Opponent"
                      />
                    </td>

                    <td className="p-2">
                      <input
                        className="border rounded px-2 py-1 w-[180px]"
                        value={r.selection}
                        onChange={(e) => updateRow(i, "selection", e.target.value)}
                        placeholder="Over / Team"
                      />
                    </td>

                    <td className="p-2">
                      <input
                        className="border rounded px-2 py-1 w-[90px]"
                        value={r.line}
                        onChange={(e) => updateRow(i, "line", e.target.value)}
                        placeholder="157.5"
                      />
                    </td>

                    <td className="p-2">
                      <input
                        className="border rounded px-2 py-1 w-[220px]"
                        value={r.notes}
                        onChange={(e) => updateRow(i, "notes", e.target.value)}
                        placeholder="Any notes"
                      />
                    </td>

                    <td className="p-2">
                      <button
                        onClick={() => removeRow(i)}
                        className="px-3 py-1 bg-red-600 text-white rounded hover:bg-red-700"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <datalist id="capper-list">
            {capperOptions.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>

          <div className="text-xs text-gray-600">
            Required before insert: date, capper, league, market, play.
          </div>
        </div>
      ) : null}
    </section>
  );
}
