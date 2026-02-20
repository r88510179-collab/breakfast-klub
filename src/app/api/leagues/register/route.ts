import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getBearerToken(req: Request): string {
  const h = req.headers.get("authorization") || "";
  if (h.toLowerCase().startsWith("bearer ")) return h.slice(7).trim();
  return "";
}

async function fetchJson(url: string) {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`Fetch failed ${res.status} for ${url}`);
  return await res.json();
}

function scoreboardUrl(sport_key: string, league_key: string) {
  return `https://site.api.espn.com/apis/site/v2/sports/${sport_key}/${league_key}/scoreboard`;
}

export async function POST(req: Request) {
  const token = getBearerToken(req);
  if (!token) return NextResponse.json({ error: "Missing Authorization Bearer token" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const sport_key = String(body?.sport_key ?? "").trim();
  const league_key = String(body?.league_key ?? "").trim();
  const aliases: string[] = Array.isArray(body?.aliases) ? body.aliases.map(String).map((s: string) => s.trim()).filter(Boolean) : [];

  if (!sport_key || !league_key) return NextResponse.json({ error: "Missing sport_key or league_key" }, { status: 400 });

  // Pull canonical meta from ESPN scoreboard
  const sb = scoreboardUrl(sport_key, league_key);
  const j = await fetchJson(sb).catch(() => null);
  const lg = Array.isArray(j?.leagues) ? j.leagues[0] : null;

  const league_abbrev = lg?.abbreviation ?? null;
  const league_name = lg?.name ?? null;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const supabase = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Upsert (merge aliases)
  const { data: existing } = await supabase
    .from("league_registry")
    .select("aliases")
    .eq("sport_key", sport_key)
    .eq("league_key", league_key)
    .maybeSingle();

  const merged = Array.from(new Set([...(existing?.aliases ?? []), ...aliases]));

  const { data, error } = await supabase
    .from("league_registry")
    .upsert(
      {
        user_id: userData.user.id,
        sport_key,
        league_key,
        league_abbrev,
        league_name,
        aliases: merged,
      },
      { onConflict: "user_id,sport_key,league_key" }
    )
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, league: data, scoreboard_url: sb });
}
