"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { BetRow, betsToCSV, downloadText } from "../../lib/ledger";

const todayISO = () => new Date().toISOString().slice(0, 10);

export default function ReportsPage() {
  const [bets, setBets] = useState<BetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const [preview, setPreview] = useState("");

  useEffect(() => {
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

  const open = useMemo(() => bets.filter((b) => String(b.status).toUpperCase() === "OPEN"), [bets]);
  const final = useMemo(() => bets.filter((b) => String(b.status).toUpperCase() === "FINAL"), [bets]);

  function exportSet(label: string, rows: BetRow[]) {
    const csv = betsToCSV(rows);
    downloadText(`bk_${label}_${todayISO()}.csv`, csv);
    setPreview(csv.slice(0, 20000)); // preview cap
  }

  return (
    <main className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Reports</h1>

      {loading ? <div className="text-sm text-gray-600">Loading…</div> : null}
      {err ? <div className="border border-red-300 bg-red-50 text-red-800 rounded p-3">{err}</div> : null}

      <section className="border rounded p-4 space-y-3">
        <h2 className="font-semibold">Exports</h2>

        <div className="flex flex-wrap gap-2">
          <button onClick={() => exportSet("all", bets)} className="px-3 py-2 bg-gray-200 rounded hover:bg-gray-300">
            Export ALL (CSV)
          </button>
          <button onClick={() => exportSet("open", open)} className="px-3 py-2 bg-gray-200 rounded hover:bg-gray-300">
            Export OPEN (CSV)
          </button>
          <button onClick={() => exportSet("final", final)} className="px-3 py-2 bg-gray-200 rounded hover:bg-gray-300">
            Export FINAL (CSV)
          </button>
        </div>

        <div className="text-sm text-gray-600">
          OPEN export is your “needs grading” list.
        </div>
      </section>

      <section className="border rounded p-4 space-y-2">
        <h2 className="font-semibold">CSV Preview</h2>
        <textarea
          className="border rounded w-full min-h-[260px] px-2 py-2 font-mono text-xs"
          value={preview}
          readOnly
          placeholder="Click an export button to generate a preview…"
        />
      </section>
    </main>
  );
}
