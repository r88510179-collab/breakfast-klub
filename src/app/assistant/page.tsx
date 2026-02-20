"use client";

import { useState } from "react";
import { supabase } from "../../lib/supabaseClient";

type Strategy = "fast" | "balanced" | "consensus";

export default function AssistantPage() {
  const [prompt, setPrompt] = useState("");
  const [strategy, setStrategy] = useState<Strategy>("balanced");
  const [answer, setAnswer] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function run() {
    setErr("");
    setAnswer("");
    const p = prompt.trim();
    if (!p) return;

    setBusy(true);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        window.location.href = "/";
        return;
      }

      const res = await fetch("/api/ai", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({ prompt: p, strategy }),
      });

      const out = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(out?.error ? `${out.error}${out.details ? " — " + JSON.stringify(out.details) : ""}` : "Request failed");
        return;
      }

      setAnswer(out.answer_markdown ?? "");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">Assistant</h1>

      <section className="border rounded p-4 space-y-3">
        <div className="text-sm font-medium">Prompt</div>
        <textarea
          className="border rounded w-full min-h-[90px] px-2 py-2"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder='Try: "what’s open" or "summary" or "export open"'
        />

        <div className="flex flex-wrap gap-3 items-center">
          <div className="text-sm font-medium">Strategy</div>
          <select
            className="border rounded px-2 py-2"
            value={strategy}
            onChange={(e) => setStrategy(e.target.value as Strategy)}
          >
            <option value="fast">fast (single model + fallback)</option>
            <option value="balanced">balanced (primary + verifier)</option>
            <option value="consensus">consensus (2 primaries + verifier)</option>
          </select>

          <button
            onClick={run}
            disabled={busy}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400"
          >
            {busy ? "Running…" : "Run"}
          </button>
        </div>

        {err ? <div className="border border-red-300 bg-red-50 text-red-800 rounded p-3">{err}</div> : null}
      </section>

      <section className="border rounded p-4 space-y-2">
        <h2 className="font-semibold">Answer</h2>
        <textarea
          className="border rounded w-full min-h-[360px] px-2 py-2 font-mono text-xs"
          value={answer}
          readOnly
          placeholder="Answer will appear here…"
        />
      </section>
    </main>
  );
}
