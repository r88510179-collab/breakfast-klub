"use client";

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

type Banner = { kind: "success" | "error" | "info"; text: string } | null;

export default function HomePage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [sessionEmail, setSessionEmail] = useState<string | null>(null);

  const [banner, setBanner] = useState<Banner>(null);
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSessionEmail(data.session?.user?.email ?? null);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSessionEmail(session?.user?.email ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  function validateInputs(): { ok: boolean; e: string; p: string } {
    const e = email.trim();
    const p = password;

    if (!e || !p) {
      setBanner({
        kind: "error",
        text: "Enter an email and password (password must be 6+ characters).",
      });
      return { ok: false, e, p };
    }
    if (p.length < 6) {
      setBanner({ kind: "error", text: "Password must be at least 6 characters." });
      return { ok: false, e, p };
    }
    return { ok: true, e, p };
  }

  async function signUp() {
    setBanner(null);
    const v = validateInputs();
    if (!v.ok) return;

    setIsBusy(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email: v.e,
        password: v.p,
      });

      if (error) {
        if (error.message.includes("Anonymous sign-ins are disabled")) {
          setBanner({
            kind: "error",
            text: "Email/password were not sent. Type them manually (avoid autofill), then try again.",
          });
        } else {
          setBanner({ kind: "error", text: error.message });
        }
        return;
      }

      // If email confirmation is ON, session is usually null after signUp.
      if (!data.session) {
        setBanner({
          kind: "success",
          text: `Account created. Check your email (${v.e}) to confirm, then come back and sign in.`,
        });
        return;
      }

      // If confirmation is OFF, you’ll often be signed in immediately.
      setBanner({ kind: "success", text: "Account created — you’re signed in." });
      window.location.href = "/bets";
    } finally {
      setIsBusy(false);
    }
  }

  async function signIn() {
    setBanner(null);
    const v = validateInputs();
    if (!v.ok) return;

    setIsBusy(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: v.e,
        password: v.p,
      });

      if (error) {
        setBanner({ kind: "error", text: error.message });
        return;
      }

      setBanner({ kind: "success", text: "Signed in successfully." });
      window.location.href = "/bets";
    } finally {
      setIsBusy(false);
    }
  }

  async function resendConfirmation() {
    setBanner(null);
    const e = email.trim();
    if (!e) {
      setBanner({ kind: "error", text: "Enter your email above first." });
      return;
    }

    setIsBusy(true);
    try {
      const { error } = await supabase.auth.resend({ type: "signup", email: e });
      if (error) {
        setBanner({ kind: "error", text: error.message });
        return;
      }
      setBanner({
        kind: "success",
        text: `Confirmation email re-sent to ${e}. Check spam/junk too.`,
      });
    } finally {
      setIsBusy(false);
    }
  }

  async function signOut() {
    setBanner(null);
    await supabase.auth.signOut();
  }

  function BannerView() {
    if (!banner) return null;

    const cls =
      banner.kind === "success"
        ? "border-green-300 bg-green-50 text-green-800"
        : banner.kind === "error"
        ? "border-red-300 bg-red-50 text-red-800"
        : "border-gray-300 bg-gray-50 text-gray-800";

    return (
      <div className={`border rounded p-3 ${cls}`}>
        <div className="text-sm">{banner.text}</div>
      </div>
    );
  }

  return (
    <main className="p-6 max-w-xl space-y-4">
      <h1 className="text-2xl font-bold">Breakfast Klub Tracker</h1>

      <BannerView />

      {sessionEmail ? (
        <div className="space-y-4">
          <p>Signed in as: {sessionEmail}</p>
          <p>
            <a className="text-blue-600 underline" href="/bets">
              Go to Bets Ledger →
            </a>
          </p>
          <button
            onClick={signOut}
            className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300"
          >
            Sign out
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-lg">Sign in / Sign up</p>

          <div className="grid gap-2">
            <input
              type="email"
              name="email"
              autoComplete="email"
              placeholder="email"
              className="border rounded px-2 py-2"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
              disabled={isBusy}
            />

            <input
              type="password"
              name="password"
              autoComplete="new-password"
              placeholder="password (6+ chars)"
              className="border rounded px-2 py-2"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
              disabled={isBusy}
            />

            <div className="flex gap-2">
              <button
                onClick={signIn}
                disabled={isBusy}
                className="px-3 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-gray-400"
              >
                {isBusy ? "Working…" : "Sign in"}
              </button>

              <button
                onClick={signUp}
                disabled={isBusy}
                className="px-3 py-2 bg-green-500 text-white rounded hover:bg-green-600 disabled:bg-gray-400"
              >
                {isBusy ? "Working…" : "Sign up"}
              </button>
            </div>

            <button
              onClick={resendConfirmation}
              disabled={isBusy}
              className="text-left text-sm text-blue-600 underline disabled:text-gray-400"
            >
              Resend confirmation email
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
