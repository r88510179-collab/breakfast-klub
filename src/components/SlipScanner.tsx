"use client";

import { useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { resolveLeagues } from "@/lib/leagues/client";

type ProposedBetMeta = {
  ticket_type?: "SINGLE" | "PARLAY";
  parlay_group_id?: string;
  parlay_leg_index?: number;
  parlay_total_legs?: number;
  parlay_label?: string | null;
  parlay_odds?: string | number | null;
  original_market?: string | null;
};

type ProposedBet = {
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

  _meta?: ProposedBetMeta;
};

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function asStr(v: any) {
  if (v === null || v === undefined) return "";
  return String(v);
}

function safeNum(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function makeParlayGroupId() {
  return `PARLAY-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function isLikelyParlay(extracted: any, bets: any[]) {
  const ticketType = String(extracted?.ticket_type ?? "").toUpperCase();
  if (ticketType === "PARLAY") return true;

  // If provider doesn't return ticket_type yet, use a fallback heuristic:
  // multiple rows from one uploaded slip usually means parlay/SGP/builder.
  // (You can refine later when you add "multi-slip image" support.)
  if (bets.length > 1) return true;

  return false;
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
        _meta: { ticket_type: "SINGLE" },
      },
    ]);
  }

  function normalizeExtracted(extracted: any): ProposedBet[] {
    const bets = Array.isArray(extracted?.bets) ? extracted.bets : [];

    if (!bets.length) return [];

    const detectedParlay = isLikelyParlay(extracted, bets);

    // Try to use model-provided group id if present, otherwise create one
    const groupId =
      asStr(extracted?.parlay_group_id || extracted?.group_id || "").trim() || makeParlayGroupId();

    const parlayLabel =
      asStr(extracted?.parlay_label || extracted?.ticket_label || extracted?.bet_type || "").trim() ||
      null;

    const parlayOddsRaw = extracted?.parlay_odds ?? extracted?.combined_odds ?? null;
    const parlayOdds =
      parlayOddsRaw === null || parlayOddsRaw === undefined ? null : asStr(parlayOddsRaw);

    const totalLegs = detectedParlay ? bets.length : 1;

    return bets.map((b: any, idx: number) => {
      const originalMarket = b?.market ? asStr(b.market) : "";

      // If parlay, make it visibly show as PARLAY in the ledger, while keeping leg market in metadata
      const displayMarket = detectedParlay ? "Parlay" : originalMarket;

      const rowNotesFromModel = b?.notes ? asStr(b.notes) : "";

      const autoParlayNote = detectedParlay
        ? [
            parlayLabel ? `Parlay=${parlayLabel}` : "Parlay",
            `Leg ${idx + 1}/${totalLegs}`,
            originalMarket ? `LegMarket=${originalMarket}` : null,
            parlayOdds ? `ParlayOdds=${parlayOdds}` : null,
          ]
            .filter(Boolean)
            .join(" | ")
        : "";

      const mergedNotes = [rowNotesFromModel, autoParlayNote].filter(Boolean).join(" | ");

      return {
        date: b?.date ? asStr(b.date) : todayISO(),
        capper: b?.capper ? asStr(b.capper) : capperOptions[0] || "Personal",
        league: b?.league ? asStr(b.league) : "",
        market: displayMarket,
        play: b?.play ? asStr(b.play) : "",

        selection: b?.selection ? asStr(b.selection) : "",
        line: b?.line === null || b?.line === undefined ? "" : asStr(b.line),
        odds: b?.odds === null || b?.odds === undefined ? "" : asStr(b.odds),
        units: b?.units === null || b?.units === undefined ? "1" : asStr(b.units),

        opponent: b?.opponent ? asStr(b.opponent) : "",
        notes: mergedNotes,

        _meta: detectedParlay
          ? {
              ticket_type: "PARLAY",
              parlay_group_id: groupId,
              parlay_leg_index: idx + 1,
              parlay_total_legs: totalLegs,
              parlay_label: parlayLabel,
              parlay_odds,
              original_market: originalMarket || null,
            }
          : {
              ticket_type: "SINGLE",
              original_market: originalMarket || null,
            },
      };
    });
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

    setBusy(true);
    try {
      // Resolve leagues before insert
      const resolveResults = await resolveLeagues(rows.map((r) => ({ league_text: r.league })));
      const resolvedByIndex = resolveResults.map((rr) => rr.resolved);

      const unresolved = resolvedByIndex
        .map((r, i) => ({ r, i }))
        .filter((x) => !x.r);

      if (unresolved.length) {
        setErr(
          `Unrecognized leagues in rows: ${unresolved.map((x) => x.i + 1).join(", ")}. ` +
            `Go to Settings → Leagues and register them (paste ESPN scoreboard URL + aliases).`
        );
        return;
      }

      const payload = rows.map((r, idx) => {
        const resolved = resolvedByIndex[idx]!;
        const lineNum = r.line.trim() ? Number(r.line) : null;
        const oddsNum = r.odds.trim() ? Number(r.odds) : null;
        const unitsNum = r.units.trim() ? Number(r.units) : 1;

        const isParlay = r._meta?.ticket_type === "PARLAY";

        const extraNotes: string[] = [];
        if (isParlay && r._meta?.original_market) {
          extraNotes.push(`Original leg market=${r._meta.original_market}`);
        }

        const finalNotes = [r.notes.trim(), ...extraNotes].filter(Boolean).join(" | ");

        return {
          date: r.date || todayISO(),
          capper: r.capper.trim(),

          // Standardized league fields
          sport_key: resolved.sport_key,
          league_key: resolved.league_key,
          league_abbrev: resolved.league_abbrev,
          league_name: resolved.league_name,
          league: resolved.league_abbrev ?? r.league.trim(),

          // Important: visible classification fix
          market: isParlay ? "Parlay" : r.market.trim(),

          play: r.play.trim(),
          selection: r.selection.trim() || null,
          line: Number.isFinite(lineNum as any) ? lineNum : null,
          odds: Number.isFinite(oddsNum as any) ? oddsNum : null,
          units: Number.isFinite(unitsNum as any) ? unitsNum : 1,
          opponent: r.opponent.trim() || null,
          notes: finalNotes || null,
          book: book.trim() || null,
          slip_ref: slipRef.trim() || null,
          status: "OPEN",
          result: "OPEN",

          ai_meta: {
            source: "slip_scan",
            ticket_type: r._meta?.ticket_type || "SINGLE",
            parlay: isParlay
              ? {
                  group_id: r._meta?.parlay_group_id || null,
                  leg_index: r._meta?.parlay_leg_index || null,
                  total_legs: r._meta?.parlay_total_legs || null,
                  label: r._meta?.parlay_label || null,
                  parlay_odds: r._meta?.parlay_odds ?? null,
                  original_market: r._meta?.original_market || null,
                }
              : null,
          },
        };
      });

      const { error } = await supabase.from("bets").insert(payload as any);
      if (error) {
        setErr(error.message);
        return;
      }

      setFile(null);
      setIssues([]);
      setRows([]);
      await onAdded();
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  const parlayPreview = useMemo(() => {
    const parlayRows = rows.filter((r) => r._meta?.ticket_type === "PARLAY");
    if (!parlayRows.length) return null;

    const groups = new Map<string, number>();
    for (const r of parlayRows) {
      const gid = r._meta?.parlay_group_id || "unknown";
      groups.set(gid, (groups.get(gid) || 0) + 1);
    }

    return Array.from(groups.entries());
  }, [rows]);

  return (
    <section className="border rounded p-4 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="font-semibold">Slip Scanner</h2>
        <div className="text-xs text-gray-600">AI proposes → you edit → you confirm</div>
      </div>

      <div className="grid gap-2 md:grid-cols-3">
        <div className="space-y-1">
          <div className="text-sm font-medium">Book (optional)</div>
          <input
            className="border rounded px-2 py-2 w-full"
            value={book}
            onChange={(e) => setBook(e.target.value)}
          />
        </div>

        <div className="space-y-1">
          <div className="text-sm font-medium">Slip Ref (optional)</div>
          <input
            className="border rounded px-2 py-2 w-full"
            value={slipRef}
            onChange={(e) => setSlipRef(e.target.value)}
          />
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
          {busy ? "Working…" : "Scan slip"}
        </button>

        <button
          onClick={addToLedger}
          disabled={busy || rows.length === 0}
          className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:bg-gray-400"
        >
          {busy ? "Working…" : "Add to ledger"}
        </button>

        <button
          onClick={addEmptyRow}
          disabled={busy}
          className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300 disabled:bg-gray-400"
        >
          Add row manually
        </button>
      </div>

      {err ? (
        <div className="border border-red-300 bg-red-50 text-red-800 rounded p-3">{err}</div>
      ) : null}

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

      {parlayPreview?.length ? (
        <div className="border rounded p-3 bg-blue-50 text-sm">
          <div className="font-semibold mb-1">Detected parlay grouping</div>
          <ul className="list-disc ml-5">
            {parlayPreview.map(([gid, count]) => (
              <li key={gid}>
                {gid}: {count} leg{count === 1 ? "" : "s"}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {rows.length ? (
        <div className="space-y-2">
          <div className="font-semibold text-sm">Review & Edit extracted rows</div>

          <div className="overflow-auto border rounded">
            <table className="min-w-[1200px] w-full border-collapse text-sm">
              <thead className="border-b bg-gray-50">
                <tr>
                  <th className="p-2 text-left">Type</th>
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
                {rows.map((r, i) => {
                  const isParlay = r._meta?.ticket_type === "PARLAY";
                  const legLabel = isParlay
                    ? `PARLAY ${r._meta?.parlay_leg_index}/${r._meta?.parlay_total_legs}`
                    : "SINGLE";

                  return (
                    <tr key={i} className="border-b align-top">
                      <td className="p-2">
                        <span
                          className={`inline-block rounded px-2 py-1 text-xs font-semibold ${
                            isParlay
                              ? "bg-purple-100 text-purple-800"
                              : "bg-gray-100 text-gray-700"
                          }`}
                        >
                          {legLabel}
                        </span>
                      </td>

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
                          className="border rounded px-2 py-1 w-[140px]"
                          value={r.league}
                          onChange={(e) => updateRow(i, "league", e.target.value)}
                          placeholder="NBA / EPL / ATP / CBASE …"
                        />
                      </td>

                      <td className="p-2">
                        <input
                          className="border rounded px-2 py-1 w-[120px]"
                          value={r.market}
                          onChange={(e) => updateRow(i, "market", e.target.value)}
                          placeholder="Parlay / Spread / Total / ML"
                        />
                      </td>

                      <td className="p-2">
                        <input
                          className="border rounded px-2 py-1 w-[320px]"
                          value={r.play}
                          onChange={(e) => updateRow(i, "play", e.target.value)}
                          placeholder="Team -3.5 / Over 2.5"
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
                          placeholder="Over / Under / Team"
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
                          className="border rounded px-2 py-1 w-[260px]"
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
                  );
                })}
              </tbody>
            </table>
          </div>

          <datalist id="capper-list">
            {capperOptions.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>

          <div className="text-xs text-gray-600">
            Required before insert: date, capper, league, market, play. If a league isn’t registered
            yet, the insert will be blocked.
          </div>
        </div>
      ) : null}
    </section>
  );
}
