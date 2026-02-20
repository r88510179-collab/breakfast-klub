"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";

type Bet = {
  id: string;
  date: string;
  capper: string;
  league: string;
  market: string;
  play: string;
  odds: number | null;
  units: number;
  status: string;
  result: string;
};

export default function BetsPage() {
  const [bets, setBets] = useState<Bet[]>([]);
  const [date, setDate] = useState("");
  const [capper, setCapper] = useState("Breakfast Klub");
  const [league, setLeague] = useState("NCAAM");
  const [market, setMarket] = useState("Spread");
  const [play, setPlay] = useState("");
  const [odds, setOdds] = useState<string>("-110");
  const [units, setUnits] = useState<string>("1");
  const [msg, setMsg] = useState("");

  async function load() {
    setMsg("");
    const { data, error } = await supabase
      .from("bets")
      .select(
        "id, date, capper, league, market, play, odds, units, status, result"
      )
      .order("date", { ascending: false });

    if (error) setMsg(error.message);
    else setBets((data ?? []) as any);
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) window.location.href = "/";
      else load();
    });
  }, []);

  async function addBet() {
    setMsg("");
    const payload = {
      date: date || new Date().toISOString().slice(0, 10),
      capper,
      league,
      market,
      play,
      odds: odds ? Number(odds) : null,
      units: units ? Number(units) : 1,
      status: "OPEN",
      result: "OPEN",
    };

    const { error } = await supabase.from("bets").insert(payload);
    if (error) setMsg(error.message);
    else {
      setPlay("");
      await load();
    }
  }

  return (
    <main className="p-6 max-w-3xl">
      <h2 className="text-xl font-semibold">Bets Ledger</h2>
      <p className="mb-4">
        <a className="text-blue-600 underline" href="/">
          ← Back
        </a>
      </p>

      <div className="grid gap-2 max-w-md">
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="border rounded px-2 py-1"
        />
        <input
          value={capper}
          onChange={(e) => setCapper(e.target.value)}
          placeholder="Capper"
          className="border rounded px-2 py-1"
        />
        <input
          value={league}
          onChange={(e) => setLeague(e.target.value)}
          placeholder="League"
          className="border rounded px-2 py-1"
        />
        <input
          value={market}
          onChange={(e) => setMarket(e.target.value)}
          placeholder="Market"
          className="border rounded px-2 py-1"
        />
        <input
          value={play}
          onChange={(e) => setPlay(e.target.value)}
          placeholder="Play"
          className="border rounded px-2 py-1"
        />
        <input
          value={odds}
          onChange={(e) => setOdds(e.target.value)}
          placeholder="Odds e.g. -110"
          className="border rounded px-2 py-1"
        />
        <input
          value={units}
          onChange={(e) => setUnits(e.target.value)}
          placeholder="Units e.g. 1"
          className="border rounded px-2 py-1"
        />
        <button
          onClick={addBet}
          disabled={!play.trim()}
          className="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-gray-400"
        >
          Add Bet
        </button>
        {msg && <p className="text-red-600">{msg}</p>}
      </div>

      <hr className="my-4" />

      <ul className="grid gap-4">
        {bets.map((b) => (
          <li key={b.id} className="border border-gray-300 rounded p-3">
            <div>
              <b>{b.date}</b> — {b.capper} — {b.league} — {b.market}
            </div>
            <div>{b.play}</div>
            <div>
              Odds: {b.odds ?? ""} | Units: {b.units} | {b.status}/{b.result}
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}