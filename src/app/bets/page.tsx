"use client";

import SlipScanner from "@/components/SlipScanner";
import { resolveLeagues } from "@/lib/leagues/client";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { BetRow, betsToCSV, downloadText, netUnits, toNumber, getUnitSize } from "../../lib/ledger";

const todayISO = () => new Date().toISOString().slice(0, 10);

export default function BetsPage() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const [bets, setBets] = useState<BetRow[]>([]);
  const [unitSize, setUnitSize] = useState(16);

  // Filters
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "OPEN" | "FINAL">("ALL");
  const [resultFilter, setResultFilter] = useState<"ALL" | "OPEN" | "WIN" | "LOSS" | "PUSH" | "VOID" | "CASHOUT">("ALL");
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
  const [result, setResult] = useState<"OPEN" | "WIN" | "LOSS" | "PUSH" | "VOID" | "CASHOUT">("OPEN");
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
      a.localeCompare(b)
    );
  }, [bets]);

  const leagues = useMemo(() => {
    return Array.from(new Set(bets.map((b) => b.league).filter(Boolean))).sort((a, b) =>
      a.localeCompare(b)
    );
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
          b.league,
          b.market,
          b.play,
          b.opponent,
          b.final_score,
          b.notes,
        ]
          .filter(Boolean)
          .join(" | ")
          .toLowerCase();
        if (!hay.includes(s)) return false;
      }

      return true;
    });
  }, [bets, q, statusFilter, resultFilter, capperFilter, leagueFilter, dateFrom, dateTo]);

  const totals = useMemo(() => {
    const finals = filtered.filter((b) => String(b.status).toUpperCase() === "FINAL");
    const risk = finals.reduce((a, b) => a + toNumber(b.units, 0), 0);
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
    setEditingId(b.id);
    setDate(b.date);
    setCapper(b.capper);
    setLeague(b.league);
    setMarket(b.market);
    setPlay(b.play);
    setOdds(b.odds === null || b.odds === undefined ? "" : String(b.odds));
    setUnits(b.units === null || b.units === undefined ? "1" : String(b.units));
    setOpponent(b.opponent ?? "");
    setFinalScore(b.final_score ?? "");
    setStatus(String(b.status).toUpperCase() === "FINAL" ? "FINAL" : "OPEN");
    const r = String(b.result).toUpperCase();
    setResult((["OPEN", "WIN", "LOSS", "PUSH", "VOID", "CASHOUT"].includes(r) ? r : "OPEN") as any);
    setNotes(b.notes ?? "");
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

    if (status === "FINAL" && result === "OPEN") {
      setErr("If Status is FINAL, Result must be WIN/LOSS/PUSH/VOID/CASHOUT.");
      return;
    }

    setLoading(true);
    try {
      if (editingId) {
        const { error } = await supabase.from("bets").update(payload).eq("id", editingId);
        if (error) setErr(error.message);
        else {
          await fetchAllBets();
          resetForm();
        }
      } else {
        payload.status = "OPEN";
        payload.result = "OPEN";
        const { error } = await supabase.from("bets").insert(payload);
        if (error) setErr(error.message);
        else {
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
      <h1 className="text-2xl font-bold">Bets</h1>

      {/* ✅ THIS IS WHERE “2” GOES */}
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

      {err ? <div className="border border-red-300 bg-red-50 text-red-800 rounded p-3">{err}</div> : null}

      {/* Add/Edit */}
      <section className="border rounded p-4 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="font-semibold">{editingId ? "Edit / Grade Bet" : "Add Bet"}</h2>
          <div className="flex gap-2">
            {editingId ? (
              <button onClick={resetForm} className="px-3 py-1 bg-gray-200 rounded hover:bg-gray-300">
                Cancel edit
              </button>
            ) : null}
            <button onClick={exportFiltered} className="px-3 py-1 bg-gray-200 rounded hover:bg-gray-300">
              Export filtered CSV
            </button>
          </div>
        </div>

        {/* ... keep everything else exactly as you already have it ... */}
        {/* (No other changes required below this point) */}
        {/* Your existing form, filters, and list remain unchanged */}
      </section>

      {/* Keep your Filters + List sections exactly as-is */}
    </main>
  );
}
