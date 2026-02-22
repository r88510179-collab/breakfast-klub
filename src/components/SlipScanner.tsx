// src/components/SlipGrader.tsx
"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type Proposal = {
  bet_id: string;
  match_reason: string;
  confidence: number;
  before: {
    status: string;
    result: string;
    final_score: string | null;
    notes: string | null;
  };
  after: {
    status: string;
    result: string;
    final_score: string | null;
    notes_append: string | null;
  };
};

export default function SlipGrader({
  onUpdated,
}: {
  onUpdated: () => void | Promise<void>;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [book, setBook] = useState("");
  const [slipRef, setSlipRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [preview, setPreview] = useState<any | null>(null);

  async function callGrade(commit: boolean) {
    setErr("");
    if (!file) {
      setErr("Upload a settled/won/lost slip image first.");
      return;
    }

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
      fd.append("commit", String(commit));

      const res = await fetch("/api/slips/grade", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });

      const out = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(out?.error ?? "Grading failed");
        return;
      }

      setPreview(out);

      if (commit) {
        await onUpdated();
      }
    } finally {
      setBusy(false);
    }
  }

  const proposals: Proposal[] = Array.isArray(preview?.proposals) ? preview.proposals : [];
  const canCommit = Boolean(preview?.summary?.can_commit);

  return (
    <section className="border rounded p-4 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="font-semibold">Slip Grader (Settled / WON / LOST Slips)</h2>
        <div className="text-xs text-gray-600">AI reads settlement proof → preview updates → confirm</div>
      </div>

      <div className="grid gap-2 md:grid-cols-3">
        <div className="space-y-1">
          <div className="text-sm font-medium">Book (optional)</div>
          <input
            className="border rounded px-2 py-2 w-full"
            value={book}
            onChange={(e) => setBook(e.target.value)}
            placeholder="Hard Rock / FanDuel / DraftKings..."
          />
        </div>

        <div className="space-y-1">
          <div className="text-sm font-medium">Slip Ref (recommended)</div>
          <input
            className="border rounded px-2 py-2 w-full"
            value={slipRef}
            onChange={(e) => setSlipRef(e.target.value)}
            placeholder="Paste ticket/slip number to improve match"
          />
        </div>

        <div className="space-y-1">
          <div className="text-sm font-medium">Upload settled slip image</div>
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
          onClick={() => callGrade(false)}
          disabled={busy || !file}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400"
        >
          {busy ? "Working…" : "Preview grade updates"}
        </button>

        <button
          onClick={() => callGrade(true)}
          disabled={busy || !file || !preview || !canCommit}
          className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:bg-gray-400"
          title={!canCommit && preview ? "Preview first and resolve blocked reasons" : undefined}
        >
          {busy ? "Working…" : "Apply grade updates"}
        </button>
      </div>

      {err ? (
        <div className="border border-red-300 bg-red-50 text-red-800 rounded p-3">{err}</div>
      ) : null}

      {preview ? (
        <div className="space-y-3">
          <div className="border rounded p-3 bg-gray-50 text-sm">
            <div><span className="font-medium">Provider model:</span> {preview.provider_model || "unknown"}</div>
            <div><span className="font-medium">Mode:</span> {preview.mode}</div>
            <div>
              <span className="font-medium">Ticket:</span>{" "}
              {preview?.extracted?.ticket?.ticket_status || "?"} / {preview?.extracted?.ticket?.ticket_result || "?"}
            </div>
            <div>
              <span className="font-medium">Can commit:</span>{" "}
              {preview?.summary?.can_commit ? "Yes" : "No"}
            </div>
          </div>

          {Array.isArray(preview?.summary?.commit_blocked_reasons) &&
          preview.summary.commit_blocked_reasons.length ? (
            <div className="border rounded p-3 bg-yellow-50">
              <div className="font-semibold text-sm">Commit blocked</div>
              <ul className="list-disc ml-5 text-sm">
                {preview.summary.commit_blocked_reasons.map((x: string, i: number) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {Array.isArray(preview?.issues) && preview.issues.length ? (
            <div className="border rounded p-3 bg-yellow-50">
              <div className="font-semibold text-sm">Checks / warnings</div>
              <ul className="list-disc ml-5 text-sm">
                {preview.issues.map((x: string, i: number) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="space-y-2">
            <div className="font-semibold text-sm">Proposed updates ({proposals.length})</div>

            {proposals.length ? (
              <div className="overflow-auto border rounded">
                <table className="min-w-[980px] w-full border-collapse text-sm">
                  <thead className="border-b bg-gray-50">
                    <tr>
                      <th className="p-2 text-left">Bet ID</th>
                      <th className="p-2 text-left">Match</th>
                      <th className="p-2 text-left">Confidence</th>
                      <th className="p-2 text-left">Before</th>
                      <th className="p-2 text-left">After</th>
                    </tr>
                  </thead>
                  <tbody>
                    {proposals.map((p) => (
                      <tr key={p.bet_id} className="border-b align-top">
                        <td className="p-2 font-mono text-xs">{p.bet_id}</td>
                        <td className="p-2">{p.match_reason}</td>
                        <td className="p-2">{(p.confidence * 100).toFixed(0)}%</td>
                        <td className="p-2 text-xs">
                          <div>Status: {p.before.status}</div>
                          <div>Result: {p.before.result}</div>
                          <div>Final: {p.before.final_score || "—"}</div>
                        </td>
                        <td className="p-2 text-xs">
                          <div>Status: {p.after.status}</div>
                          <div>Result: {p.after.result}</div>
                          <div>Final: {p.after.final_score || "—"}</div>
                          <div className="text-gray-600">Notes+: {p.after.notes_append || "—"}</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-sm text-gray-600">No proposals yet.</div>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
