"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export default function GradingPage() {
  const [open, setOpen] = useState<any[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string>("");

  async function load() {
    setMsg("");
    const { data, error } = await supabase
      .from("bets")
      .select("*")
      .eq("status", "OPEN")
      .order("date", { ascending: false });

    if (error) setMsg(error.message);
    setOpen(data ?? []);
  }

  useEffect(() => {
    load();
  }, []);

  async function suggest(bet_id: string) {
    setMsg("");
    setBusyId(bet_id);

    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return (window.location.href = "/");

      const res = await fetch("/api/grade/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ bet_id }),
      });

      const out = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(out?.error ?? "Suggest failed");
        return;
      }

      // attach suggestion to row in-memory (manual apply)
      setOpen((prev) =>
        prev.map((b) => (b.id === bet_id ? { ...b, _suggestion: out } : b))
      );
    } finally {
      setBusyId(null);
    }
  }

  async function apply(b: any) {
    const s = b._suggestion;
    if (!s?.ok || !s?.final) return;

    const result = s.grade?.result;
    if (!result || result === "OPEN") return;

    const finalScore = `${s.final.away} ${s.final.awayScore} - ${s.final.home} ${s.final.homeScore}`;

    const { error } = await supabase
      .from("bets")
      .update({
        status: "FINAL",
        result,
        final_score: finalScore,
        graded_at: new Date().toISOString(),
        grade_sources: s.final.sources ?? [],
        selection: s.parsed?.selection ?? b.selection ?? null,
        line: typeof s.parsed?.line === "number" ? s.parsed.line : b.line ?? null,
      })
      .eq("id", b.id);

    if (error) {
      setMsg(error.message);
      return;
    }

    await load();
  }

  return (
    <main className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">Grading</h1>
      <div className="text-sm text-gray-600">Open bets only. AI suggests; you apply.</div>

      {msg ? <div className="border rounded p-3 bg-red-50 text-red-800">{msg}</div> : null}

      <div className="grid gap-3">
        {open.map((b) => {
          const s = b._suggestion;
          return (
            <div key={b.id} className="border rounded p-3 space-y-2">
              <div className="text-sm font-semibold">
                {b.date} — {b.capper} — {b.league} — {b.market}
              </div>
              <div className="text-sm">{b.play}</div>
              <div className="text-xs text-gray-600">Opponent: {b.opponent ?? "—"} | ID: {b.id}</div>

              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={() => suggest(b.id)}
                  disabled={busyId === b.id}
                  className="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400"
                >
                  {busyId === b.id ? "Checking…" : "Suggest grade"}
                </button>

                <button
                  onClick={() => apply(b)}
                  disabled={!s?.ok || !s?.grade?.result || s?.grade?.result === "OPEN"}
                  className="px-3 py-1 bg-green-600 text-white rounded hover:bg-green-700 disabled:bg-gray-400"
                >
                  Apply
                </button>
              </div>

              {s ? (
                <div className="border rounded p-3 bg-gray-50 text-xs space-y-1">
                  <div><b>Final:</b> {s.final ? `${s.final.away} ${s.final.awayScore} - ${s.final.home} ${s.final.homeScore}` : "not found"}</div>
                  <div><b>Parsed:</b> selection={String(s.parsed?.selection ?? "null")} line={String(s.parsed?.line ?? "null")}</div>
                  <div><b>Suggested result:</b> {String(s.grade?.result ?? "OPEN")} {s.grade?.needs_manual ? "(needs manual)" : ""}</div>
                  {Array.isArray(s.final?.sources) ? (
                    <div><b>Sources:</b> {s.final.sources.join(" | ")}</div>
                  ) : null}
                  {s.message ? <div><b>Note:</b> {s.message}</div> : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </main>
  );
}
