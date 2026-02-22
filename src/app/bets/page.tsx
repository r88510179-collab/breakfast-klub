"use client";

import SlipScanner from "@/components/SlipScanner";
import { resolveLeagues } from "@/lib/leagues/client";
import { supabase } from "@/lib/supabaseClient";
import {
  BetRow,
  betsToCSV,
  downloadText,
  netUnits,
  toNumber,
  getUnitSize,
} from "@/lib/ledger";
import { useEffect, useMemo, useState } from "react";

const todayISO = () => new Date().toISOString().slice(0, 10);

export default function BetsPage() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const [bets, setBets] = useState<BetRow[]>([]);
  const [unitSize, setUnitSize] = useState(16);

  // Filters
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "OPEN" | "FINAL">("ALL");
  const [resultFilter, setResultFilter] = useState<
    "ALL" | "OPEN" | "WIN" | "LOSS" | "PUSH" | "VOID" | "CASHOUT"
  >("ALL");
  const [capperFilter, setCapperFilter] = useState("ALL");
  const [leagueFilter, setLeagueFilter] = useState("ALL");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // Form (create/edit)
  const [editingId, setEditingId] = useState<string | null>(null);
  const [date, setDate] = useState(todayISO());
  const [capper, setCapper] = useState("Breakfast Klub");
  const [league, setLeague] = useState("NCAAM");
  const [market, setMarket] = useState("Spread");
  const [play, setPlay] = useState("");
  const [odds, setOdds] = useState<string>("-110");
  const [units, setUnits] = useState<string>("1");
  const [opponent, setOpponent] = useState("");
  const [finalScore, setFinalScore] = useState("");
  const [status, setStatus] = useState<"OPEN" | "FINAL">("OPEN");
  const [result, setResult] = useState<"OPEN" | "WIN" | "LOSS" | "PUSH" | "VOID" | "CASHOUT">(
    "OPEN"
  );
  const [notes, setNotes] = useState("");

  async function fetchAllBets() {
    setErr("");
    setLoading(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        window.location.href = "/";
        return;
      }

      const { data, error } = await supabase
        .from("bets")
        .select("*")
        .order("date", { ascending: false })
        .order("created_at", { ascending: false });

      if (error) {
        setErr(error.message);
        setBets([]);
      } else {
        setBets((data ?? []) as any);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setUnitSize(getUnitSize());
    fetchAllBets();
  }, []);

  const cappers = useMemo(() => {
    return Array.from(new Set(bets.map((b) => b.capper).filter(Boolean))).sort((a, b) =>
      String(a).localeCompare(String(b))
    ) as string[];
  }, [bets]);

  const leagues = useMemo(() => {
    return Array.from(new Set(bets.map((b) => b.league).filter(Boolean))).sort((a, b) =>
      String(a).localeCompare(String(b))
    ) as string[];
  }, [bets]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();

    return bets.filter((b) => {
      if (statusFilter !== "ALL" && String(b.status).toUpperCase() !== statusFilter) return false;
      if (resultFilter !== "ALL" && String(b.result).toUpperCase() !== resultFilter) return false;
      if (capperFilter !== "ALL" && b.capper !== capperFilter) return false;
      if (leagueFilter !== "ALL" && b.league !== leagueFilter) return false;

      if (dateFrom && b.date < dateFrom) return false;
      if (dateTo && b.date > dateTo) return false;

      if (s) {
        const hay = [
          b.id,
          b.date,
          b.capper,
          (b as any).league_name,
          b.league,
          b.market,
          (b as any).selection,
          (b as any).line,
          b.play,
          (b as any).book,
          (b as any).slip_ref,
          (b as any).opponent,
          (b as any).final_score,
          (b as any).notes,
        ]
          .filter(Boolean)
          .join(" | ")
          .toLowerCase();

        if (!hay.includes(s)) return false;
      }

      return true;
    });
  }, [
    bets,
    q,
    statusFilter,
    resultFilter,
    capperFilter,
    leagueFilter,
    dateFrom,
    dateTo,
  ]);

  const totals = useMemo(() => {
    const finals = filtered.filter((b) => String(b.status).toUpperCase() === "FINAL");
    const risk = finals.reduce((a, b) => a + toNumber((b as any).units, 0), 0);
    const net = finals.reduce((a, b) => a + netUnits(b), 0);
    const openCount = filtered.filter((b) => String(b.status).toUpperCase() === "OPEN").length;

    const wins = finals.filter((b) => String(b.result).toUpperCase() === "WIN").length;
    const losses = finals.filter((b) => String(b.result).toUpperCase() === "LOSS").length;
    const pushes = finals.filter((b) => String(b.result).toUpperCase() === "PUSH").length;

    return {
      openCount,
      finalsCount: finals.length,
      wlp: `${wins}-${losses}-${pushes}`,
      risk,
      net,
      roi: risk > 0 ? net / risk : 0,
      netUsd: net * unitSize,
    };
  }, [filtered, unitSize]);

  function resetForm() {
    setEditingId(null);
    setDate(todayISO());
    setCapper("Breakfast Klub");
    setLeague("NCAAM");
    setMarket("Spread");
    setPlay("");
    setOdds("-110");
    setUnits("1");
    setOpponent("");
    setFinalScore("");
    setStatus("OPEN");
    setResult("OPEN");
    setNotes("");
  }

  function startEdit(b: BetRow) {
    setEditingId((b as any).id);
    setDate((b as any).date);
    setCapper((b as any).capper || "");
    setLeague((b as any).league || "");
    setMarket((b as any).market || "");
    setPlay((b as any).play || "");
    setOdds((b as any).odds === null || (b as any).odds === undefined ? "" : String((b as any).odds));
    setUnits((b as any).units === null || (b as any).units === undefined ? "1" : String((b as any).units));
    setOpponent((b as any).opponent ?? "");
    setFinalScore((b as any).final_score ?? "");
    setStatus(String((b as any).status).toUpperCase() === "FINAL" ? "FINAL" : "OPEN");

    const r = String((b as any).result).toUpperCase();
    setResult((["OPEN", "WIN", "LOSS", "PUSH", "VOID", "CASHOUT"].includes(r) ? r : "OPEN") as any);

    setNotes((b as any).notes ?? "");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function save() {
    setErr("");

    if (!date || !capper.trim() || !league.trim() || !market.trim() || !play.trim()) {
      setErr("Missing required fields: date, capper, league, market, play.");
      return;
    }

    const payload: any = {
      date,
      capper: capper.trim(),
      league: league.trim(),
      market: market.trim(),
      play: play.trim(),
      odds: odds.trim() ? Number(odds) : null,
      units: units.trim() ? Number(units) : 1,
      opponent: opponent.trim() ? opponent.trim() : null,
      final_score: finalScore.trim() ? finalScore.trim() : null,
      status,
      result,
      notes: notes.trim() ? notes.trim() : null,
    };

    // Standardize league before saving
    try {
      const rr = await resolveLeagues([{ league_text: league.trim() }]);
      const resolved = rr?.[0]?.resolved;

      if (!resolved) {
        setErr(
          `League "${league}" is not standardized yet. Go to Settings → Leagues and register it (paste ESPN scoreboard URL + aliases).`
        );
        return;
      }

      payload.sport_key = resolved.sport_key;
      payload.league_key = resolved.league_key;
      payload.league_abbrev = resolved.league_abbrev;
      payload.league_name = resolved.league_name;
      payload.league = resolved.league_abbrev ?? league.trim();
    } catch (e: any) {
      setErr(e?.message ?? String(e));
      return;
    }

    // Guard: if FINAL, result cannot be OPEN
    if (status === "FINAL" && result === "OPEN") {
      setErr("If Status is FINAL, Result must be WIN/LOSS/PUSH/VOID/CASHOUT.");
      return;
    }

    setLoading(true);
    try {
      if (editingId) {
        const { error } = await supabase.from("bets").update(payload).eq("id", editingId);
        if (error) {
          setErr(error.message);
        } else {
          await fetchAllBets();
          resetForm();
        }
      } else {
        // Force default on create (new rows should start open)
        payload.status = "OPEN";
        payload.result = "OPEN";

        const { error } = await supabase.from("bets").insert(payload);
        if (error) {
          setErr(error.message);
        } else {
          await fetchAllBets();
          resetForm();
        }
      }
    } finally {
      setLoading(false);
    }
  }

  async function remove(id: string) {
    setErr("");
    setLoading(true);
    try {
      const { error } = await supabase.from("bets").delete().eq("id", id);
      if (error) setErr(error.message);
      else await fetchAllBets();
    } finally {
      setLoading(false);
    }
  }

  function exportFiltered() {
    const csv = betsToCSV(filtered);
    downloadText(`bk_bets_filtered_${todayISO()}.csv`, csv);
  }

  return (
    <main className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Bets</h1>
          <p className="text-sm text-gray-600">
            AI scan slips/graphics, review extracted rows, then confirm insert.
          </p>
        </div>
        <button
          onClick={fetchAllBets}
          className="px-3 py-2 bg-gray-200 rounded hover:bg-gray-300"
        >
          Refresh
        </button>
      </div>

      {/* Slip Scanner (AI proposes -> you edit -> you confirm) */}
      <SlipScanner cappers={cappers} onAdded={fetchAllBets} />

      {/* Summary */}
      <section className="grid gap-3 md:grid-cols-5">
        <div className="border rounded p-3">
          <div className="text-xs text-gray-600">Filtered W-L-P</div>
          <div className="text-lg font-semibold">{totals.wlp}</div>
        </div>
        <div className="border rounded p-3">
          <div className="text-xs text-gray-600">Filtered Net</div>
          <div className="text-lg font-semibold">{totals.net.toFixed(2)}u</div>
        </div>
        <div className="border rounded p-3">
          <div className="text-xs text-gray-600">Filtered ROI</div>
          <div className="text-lg font-semibold">{(totals.roi * 100).toFixed(1)}%</div>
        </div>
        <div className="border rounded p-3">
          <div className="text-xs text-gray-600">Open (filtered)</div>
          <div className="text-lg font-semibold">{totals.openCount}</div>
        </div>
        <div className="border rounded p-3">
          <div className="text-xs text-gray-600">Net $ (unit={unitSize})</div>
          <div className="text-lg font-semibold">${totals.netUsd.toFixed(2)}</div>
        </div>
      </section>

      {err ? (
        <div className="border border-red-300 bg-red-50 text-red-800 rounded p-3">{err}</div>
      ) : null}

      {/* Add/Edit */}
      <section className="border rounded p-4 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="font-semibold">{editingId ? "Edit / Grade Bet" : "Add Bet (Manual)"}</h2>
          <div className="flex gap-2">
            {editingId ? (
              <button
                onClick={resetForm}
                className="px-3 py-1 bg-gray-200 rounded hover:bg-gray-300"
              >
                Cancel edit
              </button>
            ) : null}
            <button
              onClick={exportFiltered}
              className="px-3 py-1 bg-gray-200 rounded hover:bg-gray-300"
            >
              Export filtered CSV
            </button>
          </div>
        </div>

        <div className="grid gap-2 md:grid-cols-2">
          <div className="space-y-1">
            <div className="text-sm font-medium">Date</div>
            <input
              className="border rounded px-2 py-2 w-full"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <div className="text-sm font-medium">Capper</div>
            <input
              className="border rounded px-2 py-2 w-full"
              list="capper-list-manual"
              value={capper}
              onChange={(e) => setCapper(e.target.value)}
              placeholder="Select or type capper"
            />
          </div>

          <div className="space-y-1">
            <div className="text-sm font-medium">League</div>
            <input
              className="border rounded px-2 py-2 w-full"
              list="league-list-manual"
              value={league}
              onChange={(e) => setLeague(e.target.value)}
              placeholder="NBA / NCAAM / ATP / EPL ..."
            />
          </div>

          <div className="space-y-1">
            <div className="text-sm font-medium">Market</div>
            <input
              className="border rounded px-2 py-2 w-full"
              value={market}
              onChange={(e) => setMarket(e.target.value)}
              placeholder="Spread / Total / Moneyline / Prop / Parlay"
            />
          </div>

          <div className="space-y-1 md:col-span-2">
            <div className="text-sm font-medium">Play</div>
            <input
              className="border rounded px-2 py-2 w-full"
              value={play}
              onChange={(e) => setPlay(e.target.value)}
              placeholder="Team -3.5 / Over 2.5 / Player assists over ..."
            />
          </div>

          <div className="space-y-1">
            <div className="text-sm font-medium">Odds (American)</div>
            <input
              className="border rounded px-2 py-2 w-full"
              value={odds}
              onChange={(e) => setOdds(e.target.value)}
              placeholder="-110 or +150"
            />
          </div>

          <div className="space-y-1">
            <div className="text-sm font-medium">Units risked</div>
            <input
              className="border rounded px-2 py-2 w-full"
              value={units}
              onChange={(e) => setUnits(e.target.value)}
              placeholder="1"
            />
          </div>

          <div className="space-y-1">
            <div className="text-sm font-medium">Opponent / Matchup</div>
            <input
              className="border rounded px-2 py-2 w-full"
              value={opponent}
              onChange={(e) => setOpponent(e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <div className="text-sm font-medium">Final score</div>
            <input
              className="border rounded px-2 py-2 w-full"
              value={finalScore}
              onChange={(e) => setFinalScore(e.target.value)}
              placeholder="Only if FINAL"
            />
          </div>

          <div className="space-y-1">
            <div className="text-sm font-medium">Status</div>
            <select
              className="border rounded px-2 py-2 w-full"
              value={status}
              onChange={(e) => setStatus(e.target.value as any)}
            >
              <option value="OPEN">OPEN</option>
              <option value="FINAL">FINAL</option>
            </select>
          </div>

          <div className="space-y-1">
            <div className="text-sm font-medium">Result</div>
            <select
              className="border rounded px-2 py-2 w-full"
              value={result}
              onChange={(e) => setResult(e.target.value as any)}
            >
              <option value="OPEN">OPEN</option>
              <option value="WIN">WIN</option>
              <option value="LOSS">LOSS</option>
              <option value="PUSH">PUSH</option>
              <option value="VOID">VOID</option>
              <option value="CASHOUT">CASHOUT</option>
            </select>
          </div>

          <div className="space-y-1 md:col-span-2">
            <div className="text-sm font-medium">Notes</div>
            <textarea
              className="border rounded px-2 py-2 w-full min-h-[80px]"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={save}
            disabled={loading}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400"
          >
            {editingId ? "Save changes" : "Add bet"}
          </button>
        </div>

        <datalist id="capper-list-manual">
          {cappers.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>

        <datalist id="league-list-manual">
          {leagues.map((l) => (
            <option key={l} value={l} />
          ))}
          {/* common starters if registry is still growing */}
          {["NBA", "NCAAM", "NCAAW", "NFL", "MLB", "NHL", "ATP", "WTA", "EPL", "UCL", "MLS", "NCAABASE", "CBB"].map(
            (l) => (
              <option key={`seed-${l}`} value={l} />
            )
          )}
        </datalist>
      </section>

      {/* Filters */}
      <section className="border rounded p-4 space-y-3">
        <h2 className="font-semibold">Filters</h2>

        <div className="grid gap-2 md:grid-cols-3">
          <div className="space-y-1">
            <div className="text-sm font-medium">Search</div>
            <input
              className="border rounded px-2 py-2 w-full"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="team, capper, book, slip ref, notes…"
            />
          </div>

          <div className="space-y-1">
            <div className="text-sm font-medium">Status</div>
            <select
              className="border rounded px-2 py-2 w-full"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
            >
              <option value="ALL">All</option>
              <option value="OPEN">OPEN</option>
              <option value="FINAL">FINAL</option>
            </select>
          </div>

          <div className="space-y-1">
            <div className="text-sm font-medium">Result</div>
            <select
              className="border rounded px-2 py-2 w-full"
              value={resultFilter}
              onChange={(e) => setResultFilter(e.target.value as any)}
            >
              <option value="ALL">All</option>
              <option value="OPEN">OPEN</option>
              <option value="WIN">WIN</option>
              <option value="LOSS">LOSS</option>
              <option value="PUSH">PUSH</option>
              <option value="VOID">VOID</option>
              <option value="CASHOUT">CASHOUT</option>
            </select>
          </div>

          <div className="space-y-1">
            <div className="text-sm font-medium">Capper</div>
            <select
              className="border rounded px-2 py-2 w-full"
              value={capperFilter}
              onChange={(e) => setCapperFilter(e.target.value)}
            >
              <option value="ALL">All</option>
              {cappers.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <div className="text-sm font-medium">League</div>
            <select
              className="border rounded px-2 py-2 w-full"
              value={leagueFilter}
              onChange={(e) => setLeagueFilter(e.target.value)}
            >
              <option value="ALL">All</option>
              {leagues.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <div className="text-sm font-medium">Date range</div>
            <div className="grid grid-cols-2 gap-2">
              <input
                className="border rounded px-2 py-2 w-full"
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
              <input
                className="border rounded px-2 py-2 w-full"
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => {
              setQ("");
              setStatusFilter("ALL");
              setResultFilter("ALL");
              setCapperFilter("ALL");
              setLeagueFilter("ALL");
              setDateFrom("");
              setDateTo("");
            }}
            className="px-3 py-1 bg-gray-200 rounded hover:bg-gray-300"
          >
            Clear filters
          </button>
        </div>
      </section>

      {/* List */}
      <section className="space-y-2">
        <div className="flex items-end justify-between gap-3 flex-wrap">
          <h2 className="font-semibold">Ledger ({filtered.length})</h2>
          <button
            onClick={fetchAllBets}
            className="px-3 py-1 bg-gray-200 rounded hover:bg-gray-300"
          >
            Refresh
          </button>
        </div>

        {loading ? <div className="text-sm text-gray-600">Loading…</div> : null}

        <div className="grid gap-3">
          {filtered.map((b) => {
            const st = String((b as any).status).toUpperCase();
            const rs = String((b as any).result).toUpperCase();
            const nu = netUnits(b);

            return (
              <div key={(b as any).id} className="border rounded p-3">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="font-semibold">
                      {(b as any).date} — {(b as any).capper} — {(b as any).league} — {(b as any).market}
                    </div>

                    {(b as any).league_name ? (
                      <div className="text-xs text-gray-500">
                        {(b as any).league_name}
                        {(b as any).sport_key ? ` • ${(b as any).sport_key}` : ""}
                      </div>
                    ) : null}

                    <div className="text-sm">{(b as any).play}</div>

                    <div className="text-xs text-gray-600">
                      Odds: {(b as any).odds ?? ""} | Units: {(b as any).units ?? ""} | Status: {st}/{rs}
                      {(b as any).selection ? ` | Selection: ${(b as any).selection}` : ""}
                      {(b as any).line !== null && (b as any).line !== undefined && (b as any).line !== ""
                        ? ` | Line: ${(b as any).line}`
                        : ""}
                      {(b as any).opponent ? ` | Opponent: ${(b as any).opponent}` : ""}
                      {(b as any).book ? ` | Book: ${(b as any).book}` : ""}
                      {(b as any).slip_ref ? ` | SlipRef: ${(b as any).slip_ref}` : ""}
                    </div>

                    {(b as any).final_score ? (
                      <div className="text-xs text-gray-600">Final: {(b as any).final_score}</div>
                    ) : null}

                    <div className="text-xs text-gray-600">Net: {nu.toFixed(2)}u</div>

                    {(b as any).notes ? (
                      <div className="text-xs text-gray-500 mt-1 whitespace-pre-wrap">
                        Notes: {(b as any).notes}
                      </div>
                    ) : null}

                    <div className="text-xs text-gray-400 break-all mt-1">ID: {(b as any).id}</div>
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={() => startEdit(b)}
                      className="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700"
                    >
                      Edit/Grade
                    </button>
                    <button
                      onClick={() => remove((b as any).id)}
                      className="px-3 py-1 bg-red-600 text-white rounded hover:bg-red-700"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            );
          })}

          {filtered.length === 0 ? (
            <div className="text-sm text-gray-600">No bets match the current filters.</div>
          ) : null}
        </div>
      </section>
    </main>
  );
}
