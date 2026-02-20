"use client";

import { ReactNode, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { supabase } from "../lib/supabaseClient";

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);

  const isPublicRoute = pathname === "/";

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const email = data.session?.user?.email ?? null;
      setSessionEmail(email);
      setChecking(false);

      // Gate private routes
      if (!email && !isPublicRoute) {
        window.location.href = "/";
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const email = session?.user?.email ?? null;
      setSessionEmail(email);

      // If they sign out on a private route, send them to login
      if (!email && !isPublicRoute) {
        window.location.href = "/";
      }
    });

    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPublicRoute]);

  async function signOut() {
    await supabase.auth.signOut();
  }

  return (
    <div className="min-h-screen">
      {/* Header/Nav */}
      {!isPublicRoute && (
        <header className="border-b bg-white">
          <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <span className="font-semibold">Breakfast Klub Tracker</span>

              <nav className="flex items-center gap-3 text-sm">
                <Link className="text-blue-600 underline" href="/dashboard">
                  Dashboard
                </Link>
                <Link className="text-blue-600 underline" href="/bets">
                  Bets
                </Link>
                <Link className="text-blue-600 underline" href="/reports">
                  Reports
                </Link>
                <Link className="text-blue-600 underline" href="/help">
                  Help
                </Link>
                <Link className="text-blue-600 underline" href="/settings">
                  Settings
                </Link>
              </nav>
            </div>

            <div className="flex items-center gap-3 text-sm">
              <span className="text-gray-600">
                {checking ? "…" : sessionEmail ? sessionEmail : ""}
              </span>
              <button
                onClick={signOut}
                className="px-3 py-1 bg-gray-200 rounded hover:bg-gray-300"
              >
                Sign out
              </button>
            </div>
          </div>
        </header>
      )}

      {/* Page content */}
      <div className="max-w-5xl mx-auto">{children}</div>
    </div>
  );
}
