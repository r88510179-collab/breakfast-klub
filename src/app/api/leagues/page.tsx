"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type LeagueRow = {
  id: string;
  sport_key: string;
  league_key: string;
  league_abbrev: string | null;
  league_name: string | null;
  aliases: string[] | null;
};

export default function LeagueSettingsPage() {
  const [rows, setRows] = useState<LeagueRow[]>([]);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const [scoreboardUrl, setScoreboardUrl] = useState("");
  const [aliases, setAliases] = useState(""); // comma-separated
  const [preview, setPreview] = useState<any>(null);

  async function authToken() {
    const { data } = await supabase.auth.getSession();
    const t = data.session?.access_token;
    if (!t) throw new Error("Not signed in");
    return t;
  }

  async function load() {
    setMsg("");
    const token = await authToken();

    const res = await fetch("/api/leagues/list", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out?.error ?? "List failed");

    setRows(out.leagues ?? []);
  }

  useEffect(() => {
    load().catch((e) => setMsg(String(e?.message ?? e)));
  }, []);

  const aliasCsv = useMemo(() => {
    return aliases
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }, [aliases]);

  async function previewResolve() {
    setMsg("");
    setPreview(null);
    setBusy(true);
    try {
      const token = await authToken();
      const res = await fetch("/api/leagues/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ items: [{ scoreboard_url: scoreboardUrl }] }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out?.error ?? "Resolve failed");
      setPreview(out?.results?.[0] ?? null);
    } catch (e: any) {
      setMsg(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  async function registerResolved() {
    setMsg("");
    if (!preview?.resolved) {
      setMsg("Nothing resolved yet. Click Preview first.");
      return;
    }

    setBusy(true);
    try {
      const token = await authToken();
      const res = await fetch("/api/leagues/register", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          sport_key: preview.resolved.sport_key,
          league_key: preview.resolved.league_key,
          aliases: aliasCsv,
        }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out?.error ?? "Register failed");

      setScoreboardUrl("");
      setAliases("");
      setPreview(null);
      await load();
      setMsg("Registered.");
    } catch (e: any) {
      setMsg(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">Settings — Leagues</h1>

      <div className="border rounded p-4 space-y-3 bg-gray-50">
        <div className="font-semibold">Register a league (paste ESPN scoreboard URL)</div>

        <input
          className="border rounded px-2 py-2 w-full"
          value={scoreboardUrl}
          onChange={(e) => setScoreboardUrl(e.target.value)}
          placeholder="https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard"
          disabled={busy}
        />

        <input
          className="border rounded px-2 py-2 w-full"
          value={aliases}
          onChange={(e) => setAliases(e.target.value)}
          placeholder="Aliases (comma-separated): EPL, Premier League"
          disabled={busy}
        />

        <div className="flex gap-2 flex-wrap">
          <button
            onClick={previewResolve}
            disabled={busy || !scoreboardUrl.trim()}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400"
          >
            Preview
          </button>
          <button
            onClick={registerResolved}
            disabled={busy || !preview?.resolved}
            className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:bg-gray-400"
          >
            Register
          </button>
        </div>

        {preview ? (
          <pre className="border rounded p-3 text-xs overflow-auto bg-white">
            {JSON.stringify(preview, null, 2)}
          </pre>
        ) : null}
      </div>

      {msg ? <div className="border rounded p-3">{msg}</div> : null}

      <section className="border rounded p-4 space-y-2">
        <h2 className="font-semibold">Your League Registry</h2>

        <div className="overflow-auto">
          <table className="min-w-[900px] w-full border-collapse text-sm">
            <thead className="border-b bg-gray-50">
              <tr>
                <th className="p-2 text-left">Sport Key</th>
                <th className="p-2 text-left">League Key</th>
                <th className="p-2 text-left">Abbrev</th>
                <th className="p-2 text-left">Name</th>
                <th className="p-2 text-left">Aliases</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b">
                  <td className="p-2">{r.sport_key}</td>
                  <td className="p-2">{r.league_key}</td>
                  <td className="p-2">{r.league_abbrev ?? ""}</td>
                  <td className="p-2">{r.league_name ?? ""}</td>
                  <td className="p-2">{(r.aliases ?? []).join(", ")}</td>
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr>
                  <td className="p-2 text-gray-600" colSpan={5}>
                    No leagues registered yet. Paste a scoreboard URL above and register.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
