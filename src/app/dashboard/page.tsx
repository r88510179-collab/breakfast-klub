"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { BetRow, getUnitSize, netUnits, roi, wlp, toNumber } from "../../lib/ledger";

export default function DashboardPage() {
  const [bets, setBets] = useState<BetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [unitSize, setUnitSize] = useState(16);

  useEffect(() => {
    setUnitSize(getUnitSize());
    (async () => {
      setErr("");
      setLoading(true);
      try {
        const { data: sess } = await supabase.auth.getSession();
        if (!sess.session) {
          window.location.href = "/";
          return;
        }

        const { data, error } = await supabase.from("bets").select("*").order("date", { ascending: false });
        if (error) setErr(error.message);
        setBets((data ?? []) as any);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const finals = useMemo(() => bets.filter((b) => String(b.status).toUpperCase() === "FINAL"), [bets]);
  const open = useMemo(() => bets.filter((b) => String(b.status).toUpperCase() === "OPEN"), [bets]);

  const summary = useMemo(() => {
    const { wins, losses, pushes } = wlp(finals);
    const { risk, net, roi: r } = roi(finals);
    return {
      wins,
      losses,
      pushes,
      risk,
      net,
      roi: r,
      netUsd: net * unitSize,
      riskUsd: risk * unitSize,
    };
  }, [finals, unitSize]);

  const byCapper = useMemo(() => {
    const map = new Map<string, { wins: number; losses: number; pushes: number; risk: number; net: number }>();

    for (const b of finals) {
      const c = b.capper || "Unknown";
      const cur = map.get(c) ?? { wins: 0, losses: 0, pushes: 0, risk: 0, net: 0 };

      const r = String(b.result).toUpperCase();
      if (r === "WIN") cur.wins += 1;
      else if (r === "LOSS") cur.losses += 1;
      else if (r === "PUSH") cur.pushes += 1;

      cur.risk += toNumber(b.units, 0);
      cur.net += netUnits(b);

      map.set(c, cur);
    }

    return Array.from(map.entries())
      .map(([capper, s]) => ({
        capper,
        ...s,
        roi: s.risk > 0 ? s.net / s.risk : 0,
        netUsd: s.net * unitSize,
      }))
      .sort((a, b) => b.net - a.net);
  }, [finals, unitSize]);

  return (
    <main className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Dashboard</h1>

      {loading ? <div className="text-sm text-gray-600">Loading…</div> : null}
      {err ? <div className="border border-red-300 bg-red-50 text-red-800 rounded p-3">{err}</div> : null}

      <section className="grid gap-3 md:grid-cols-4">
        <div className="border rounded p-3">
          <div className="text-xs text-gray-600">Overall W-L-P (FINAL)</div>
          <div className="text-lg font-semibold">
            {summary.wins}-{summary.losses}-{summary.pushes}
          </div>
        </div>

        <div className="border rounded p-3">
          <div className="text-xs text-gray-600">Net Units (FINAL)</div>
          <div className="text-lg font-semibold">{summary.net.toFixed(2)}u</div>
        </div>

        <div className="border rounded p-3">
          <div className="text-xs text-gray-600">ROI (FINAL)</div>
          <div className="text-lg font-semibold">{(summary.roi * 100).toFixed(1)}%</div>
        </div>

        <div className="border rounded p-3">
          <div className="text-xs text-gray-600">Open Bets</div>
          <div className="text-lg font-semibold">{open.length}</div>
        </div>
      </section>

      <section className="border rounded p-4 space-y-2">
        <h2 className="font-semibold">Totals</h2>
        <div className="text-sm text-gray-700">
          Risk: {summary.risk.toFixed(2)}u (${summary.riskUsd.toFixed(2)}) — Net: {summary.net.toFixed(2)}u (${summary.netUsd.toFixed(2)})
        </div>
      </section>

      <section className="border rounded p-4 space-y-3">
        <h2 className="font-semibold">By Capper (FINAL)</h2>

        {byCapper.length === 0 ? (
          <div className="text-sm text-gray-600">No FINAL bets yet.</div>
        ) : (
          <div className="overflow-auto">
            <table className="min-w-[720px] w-full border-collapse">
              <thead>
                <tr className="text-left text-sm border-b">
                  <th className="py-2 pr-3">Capper</th>
                  <th className="py-2 pr-3">W-L-P</th>
                  <th className="py-2 pr-3">Risk</th>
                  <th className="py-2 pr-3">Net</th>
                  <th className="py-2 pr-3">ROI</th>
                  <th className="py-2 pr-3">Net $</th>
                </tr>
              </thead>
              <tbody>
                {byCapper.map((r) => (
                  <tr key={r.capper} className="text-sm border-b">
                    <td className="py-2 pr-3 font-medium">{r.capper}</td>
                    <td className="py-2 pr-3">{r.wins}-{r.losses}-{r.pushes}</td>
                    <td className="py-2 pr-3">{r.risk.toFixed(2)}u</td>
                    <td className="py-2 pr-3">{r.net.toFixed(2)}u</td>
                    <td className="py-2 pr-3">{(r.roi * 100).toFixed(1)}%</td>
                    <td className="py-2 pr-3">${r.netUsd.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
