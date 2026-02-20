"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { BetRow, betsToCSV, netUnits, roi, wlp } from "../../lib/ledger";

function fmtLine(b: BetRow) {
  const st = String(b.status).toUpperCase();
  const rs = String(b.result).toUpperCase();
  return `${b.date} | ${b.capper} | ${b.league} | ${b.market} | ${b.play} | ${st}/${rs} | id=${b.id}`;
}

export default function AssistantPage() {
  const [bets, setBets] = useState<BetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const [prompt, setPrompt] = useState("");
  const [answer, setAnswer] = useState("");

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
  const finals = useMemo(() => bets.filter((b) => String(b.status).toUpperCase() === "FINAL"), [bets]);

  function runCommand(raw: string) {
    const s = raw.trim().toLowerCase();
    if (!s) return;

    // “AI-lite” command patterns
    if (s.includes("open") || s.includes("pending") || s.includes("needs grading")) {
      if (open.length === 0) {
        setAnswer("No OPEN bets.");
        return;
      }
      setAnswer(
        [
          `OPEN bets (${open.length})`,
          "",
          ...open.map(fmtLine),
          "",
          "Tip: go to Bets → filter Status=OPEN → Export filtered CSV.",
        ].join("\n")
      );
      return;
    }

    if (s.includes("summary") || s.includes("stats") || s.includes("dashboard")) {
      const { wins, losses, pushes } = wlp(finals);
      const { risk, net, roi: r } = roi(finals);
      setAnswer(
        [
          `FINAL W-L-P: ${wins}-${losses}-${pushes}`,
          `FINAL Risk: ${risk.toFixed(2)}u`,
          `FINAL Net: ${net.toFixed(2)}u`,
          `FINAL ROI: ${(r * 100).toFixed(1)}%`,
          `OPEN count: ${open.length}`,
        ].join("\n")
      );
      return;
    }

    if (s.includes("export open")) {
      const csv = betsToCSV(open);
      setAnswer(["CSV (OPEN)", "", csv].join("\n"));
      return;
    }

    if (s.includes("export all")) {
      const csv = betsToCSV(bets);
      setAnswer(["CSV (ALL)", "", csv].join("\n"));
      return;
    }

    if (s.includes("top wins")) {
      const wins = finals
        .map((b) => ({ b, net: netUnits(b) }))
        .filter((x) => x.net > 0)
        .sort((a, c) => c.net - a.net)
        .slice(0, 10);

      if (wins.length === 0) {
        setAnswer("No winning FINAL bets found.");
        return;
      }

      setAnswer(
        [
          "Top Wins (by Net Units)",
          "",
          ...wins.map((x) => `${x.net.toFixed(2)}u | ${fmtLine(x.b)}`),
        ].join("\n")
      );
      return;
    }

    setAnswer(
      [
        "I can help with:",
        "- “what’s open” / “needs grading”",
        "- “summary” / “stats”",
        "- “export open”",
        "- “export all”",
        "- “top wins”",
        "",
        "Example: type “what’s open”",
      ].join("\n")
    );
  }

  return (
    <main className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">Assistant</h1>

      <div className="text-sm text-gray-600">
        This is a local “smart assistant” over your ledger. Next step is wiring a real AI model (BYO key) once you want it.
      </div>

      {loading ? <div className="text-sm text-gray-600">Loading…</div> : null}
      {err ? <div className="border border-red-300 bg-red-50 text-red-800 rounded p-3">{err}</div> : null}

      <section className="border rounded p-4 space-y-3">
        <div className="text-sm font-medium">Ask</div>
        <div className="flex gap-2 flex-wrap">
          <input
            className="border rounded px-2 py-2 flex-1 min-w-[240px]"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder='Try: "what’s open"'
          />
          <button
            className="px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            onClick={() => runCommand(prompt)}
          >
            Run
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          <button className="px-3 py-1 bg-gray-200 rounded hover:bg-gray-300" onClick={() => runCommand("what's open")}>
            What’s open
          </button>
          <button className="px-3 py-1 bg-gray-200 rounded hover:bg-gray-300" onClick={() => runCommand("summary")}>
            Summary
          </button>
          <button className="px-3 py-1 bg-gray-200 rounded hover:bg-gray-300" onClick={() => runCommand("top wins")}>
            Top wins
          </button>
          <button className="px-3 py-1 bg-gray-200 rounded hover:bg-gray-300" onClick={() => runCommand("export open")}>
            Export open
          </button>
        </div>
      </section>

      <section className="border rounded p-4 space-y-2">
        <h2 className="font-semibold">Answer</h2>
        <textarea
          className="border rounded w-full min-h-[320px] px-2 py-2 font-mono text-xs"
          value={answer}
          readOnly
          placeholder="Results will appear here…"
        />
      </section>
    </main>
  );
}
