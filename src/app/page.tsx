"use client";

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

export default function HomePage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const [msg, setMsg] = useState<string>("");

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

  function validateInputs(): { ok: boolean; email: string; password: string } {
    const e = email.trim();
    const p = password;

    if (!e || !p) {
      setMsg("Enter an email and password (password must be 6+ characters).");
      return { ok: false, email: e, password: p };
    }
    if (p.length < 6) {
      setMsg("Password must be at least 6 characters.");
      return { ok: false, email: e, password: p };
    }
    return { ok: true, email: e, password: p };
  }

  async function signUp() {
    setMsg("");
    const v = validateInputs();
    if (!v.ok) return;

    const { error } = await supabase.auth.signUp({
      email: v.email,
      password: v.password,
    });

    if (error) {
      if (error.message.includes("Anonymous sign-ins are disabled")) {
        setMsg(
          "Email/password were not sent. Type them manually (avoid autofill), then try again."
        );
      } else {
        setMsg(error.message);
      }
      return;
    }

    setMsg(
      "Sign-up submitted. If email confirmation is enabled in Supabase, check your inbox, then sign in."
    );
  }

  async function signIn() {
    setMsg("");
    const v = validateInputs();
    if (!v.ok) return;

    const { error } = await supabase.auth.signInWithPassword({
      email: v.email,
      password: v.password,
    });

    if (error) {
      if (error.message.includes("Anonymous sign-ins are disabled")) {
        setMsg(
          "Email/password were not sent. Type them manually (avoid autofill), then try again."
        );
      } else {
        setMsg(error.message);
      }
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  return (
    <main className="p-6 max-w-xl">
      <h1 className="text-2xl font-bold mb-4">Breakfast Klub Tracker</h1>

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
        <div className="space-y-4">
          <p className="text-lg">Sign in / Sign up</p>

          <div className="grid gap-2">
            <input
              type="email"
              name="email"
              autoComplete="email"
              placeholder="email"
              className="border rounded px-2 py-1"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
            />

            <input
              type="password"
              name="password"
              autoComplete="new-password"
              placeholder="password (6+ chars)"
              className="border rounded px-2 py-1"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onInput={(e) =>
                setPassword((e.target as HTMLInputElement).value)
              }
            />

            <div className="flex gap-2">
              <button
                onClick={signIn}
                className="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600"
              >
                Sign in
              </button>
              <button
                onClick={signUp}
                className="px-3 py-1 bg-green-500 text-white rounded hover:bg-green-600"
              >
                Sign up
              </button>
            </div>

            {msg && <p className="text-red-600">{msg}</p>}
          </div>
        </div>
      )}
    </main>
  );
}
