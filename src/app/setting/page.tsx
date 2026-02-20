"use client";

import { useEffect, useState } from "react";

export default function SettingsPage() {
  const [unitSize, setUnitSize] = useState("16");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    const raw = window.localStorage.getItem("bk_unit_size") ?? "16";
    setUnitSize(raw);
  }, []);

  function save() {
    setMsg("");
    const n = Number(unitSize);
    if (!Number.isFinite(n) || n <= 0) {
      setMsg("Unit size must be a positive number.");
      return;
    }
    window.localStorage.setItem("bk_unit_size", String(n));
    setMsg("Saved.");
  }

  return (
    <main className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">Settings</h1>

      <section className="border rounded p-4 space-y-2">
        <h2 className="font-semibold">Units</h2>
        <div className="text-sm text-gray-600">
          This is used only to display Net $ equivalents in the UI.
        </div>

        <div className="max-w-sm space-y-2">
          <div className="text-sm font-medium">1 unit equals ($)</div>
          <input
            className="border rounded px-2 py-2 w-full"
            value={unitSize}
            onChange={(e) => setUnitSize(e.target.value)}
            placeholder="16"
          />

          <button onClick={save} className="px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
            Save
          </button>

          {msg ? <div className="text-sm text-gray-700">{msg}</div> : null}
        </div>
      </section>

      <section className="border rounded p-4 space-y-2 bg-gray-50">
        <h2 className="font-semibold">AI note</h2>
        <div className="text-sm text-gray-700">
          The Assistant page is currently “AI-lite” (no external API). If you want real AI later, we’ll add a server route and a BYO-key model option.
        </div>
      </section>
    </main>
  );
}
