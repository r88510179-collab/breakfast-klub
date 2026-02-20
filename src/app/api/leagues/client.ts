import { supabase } from "@/lib/supabaseClient";

export type ResolveItem = {
  league_text?: string;
  sport_key?: string;
  league_key?: string;
  scoreboard_url?: string;
};

export type ResolveResult = {
  input: ResolveItem;
  resolved: null | {
    sport_key: string;
    league_key: string;
    league_abbrev: string | null;
    league_name: string | null;
    source: "registry" | "espn";
    scoreboard_url: string;
  };
  candidates: Array<{
    sport_key: string;
    league_key: string;
    league_abbrev: string | null;
    league_name: string | null;
    scoreboard_url: string;
    source: "candidate";
  }>;
};

export async function resolveLeagues(items: ResolveItem[]): Promise<ResolveResult[]> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");

  const res = await fetch("/api/leagues/resolve", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ items }),
  });

  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out?.error ?? "Resolve failed");
  return Array.isArray(out?.results) ? out.results : [];
}
