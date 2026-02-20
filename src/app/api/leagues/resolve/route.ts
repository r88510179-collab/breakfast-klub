import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type ResolveItem = {
  league_text?: string;      // "EPL", "NBA", "College Baseball", etc
  sport_key?: string;        // "soccer", "basketball", "baseball", "tennis", ...
  league_key?: string;       // "eng.1", "nba", "college-baseball", "atp", ...
  scoreboard_url?: string;   // optional: paste full ESPN scoreboard URL
};

type Resolved = {
  sport_key: string;
  league_key: string;
  league_abbrev: string | null;
  league_name: string | null;
  source: "registry" | "espn";
  scoreboard_url: string;
};

type Candidate = Omit<Resolved, "source"> & { source: "candidate" };

function getBearerToken(req: Request): string {
  const h = req.headers.get("authorization") || "";
  if (h.toLowerCase().startsWith("bearer ")) return h.slice(7).trim();
  return "";
}

function norm(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9.]+/g, " ").trim();
}

function parseESPNScoreboardUrl(u: string): { sport_key: string; league_key: string } | null {
  try {
    const url = new URL(u);
    const m = url.pathname.match(/\/sports\/([^/]+)\/([^/]+)\/scoreboard\/?$/i);
    if (!m) return null;
    return { sport_key: m[1], league_key: m[2] };
  } catch {
    return null;
  }
}

async function fetchJson(url: string) {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`Fetch failed ${res.status} for ${url}`);
  return await res.json();
}

function scoreboardUrl(sport_key: string, league_key: string) {
  // ESPN pattern used broadly for scoreboards :contentReference[oaicite:1]{index=1}
  return `https://site.api.espn.com/apis/site/v2/sports/${sport_key}/${league_key}/scoreboard`;
}

async function getLeagueMetaFromScoreboard(sport_key: string, league_key: string) {
  const url = scoreboardUrl(sport_key, league_key);
  const j = await fetchJson(url);
  const lg = Array.isArray(j?.leagues) ? j.leagues[0] : null;

  return {
    scoreboard_url: url,
    league_abbrev: lg?.abbreviation ?? null,
    league_name: lg?.name ?? null,
  };
}

async function fetchESPNLeagueIndex(): Promise<Array<{ sport_key: string; league_key: string; name?: string; abbrev?: string }>> {
  // This endpoint returns the sport tree (sports -> leagues). It’s large but stable enough for lookups.
  const url = "https://site.api.espn.com/apis/site/v2/sports";
  const j = await fetchJson(url);

  const out: Array<{ sport_key: string; league_key: string; name?: string; abbrev?: string }> = [];

  // Walk possible structures
  const sports = j?.sports ?? j?.leagues ?? j?.items ?? [];
  const stack: any[] = Array.isArray(sports) ? [...sports] : [];

  while (stack.length) {
    const node = stack.pop();

    // Sport nodes often have "slug" and "leagues"
    const sport_slug = node?.slug;
    const leagues = node?.leagues;

    if (sport_slug && Array.isArray(leagues)) {
      for (const l of leagues) {
        const league_slug = l?.slug;
        if (league_slug) {
          out.push({
            sport_key: sport_slug,
            league_key: league_slug,
            name: l?.name,
            abbrev: l?.abbreviation,
          });
        }
      }
    }

    // Recurse
    for (const k of ["children", "sports", "items"]) {
      if (Array.isArray(node?.[k])) stack.push(...node[k]);
    }
  }

  return out;
}

function scoreMatch(q: string, name?: string, abbrev?: string, league_key?: string) {
  const nq = norm(q);
  const nname = norm(name ?? "");
  const nabbr = norm(abbrev ?? "");
  const nkey = norm(league_key ?? "");

  let score = 0;
  if (nabbr && nabbr === nq) score += 100;
  if (nkey && nkey === nq) score += 90;

  if (nname && nname.includes(nq)) score += 60;
  if (nkey && nkey.includes(nq)) score += 55;
  if (nabbr && nabbr.includes(nq)) score += 50;

  return score;
}

export async function POST(req: Request) {
  const token = getBearerToken(req);
  if (!token) return NextResponse.json({ error: "Missing Authorization Bearer token" }, { status: 401 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  const supabase = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const items: ResolveItem[] = Array.isArray(body?.items) ? body.items : [body];

  // Load user registry for alias matching
  const { data: registry, error: regErr } = await supabase
    .from("league_registry")
    .select("sport_key, league_key, league_abbrev, league_name, aliases");

  if (regErr) return NextResponse.json({ error: regErr.message }, { status: 500 });

  const reg = registry ?? [];

  // Cache the ESPN index in-memory (per server instance)
  const g: any = globalThis as any;
  if (!g.__espnLeagueIndex || (Date.now() - g.__espnLeagueIndex.ts) > 6 * 60 * 60 * 1000) {
    g.__espnLeagueIndex = { ts: Date.now(), data: await fetchESPNLeagueIndex().catch(() => []) };
  }
  const espnIndex: any[] = g.__espnLeagueIndex.data ?? [];

  const results = [];
  for (const it of items) {
    // Normalize input into sport/league keys if possible
    let sport_key = (it.sport_key ?? "").trim();
    let league_key = (it.league_key ?? "").trim();
    const league_text = (it.league_text ?? "").trim();

    if ((!sport_key || !league_key) && it.scoreboard_url) {
      const p = parseESPNScoreboardUrl(it.scoreboard_url);
      if (p) {
        sport_key = p.sport_key;
        league_key = p.league_key;
      }
    }

    // 1) If keys provided, resolve directly via ESPN scoreboard meta
    if (sport_key && league_key) {
      const meta = await getLeagueMetaFromScoreboard(sport_key, league_key).catch(() => null);
      if (meta) {
        results.push({
          input: it,
          resolved: {
            sport_key,
            league_key,
            league_abbrev: meta.league_abbrev,
            league_name: meta.league_name,
            source: "espn",
            scoreboard_url: meta.scoreboard_url,
          } satisfies Resolved,
          candidates: [],
        });
        continue;
      }
    }

    // 2) Try registry alias match (fast)
    if (league_text) {
      const q = norm(league_text);
      const hit = reg.find((r: any) => {
        const aliases: string[] = Array.isArray(r.aliases) ? r.aliases : [];
        const pool = [r.league_abbrev, r.league_name, r.league_key, r.sport_key, ...aliases].filter(Boolean).map(norm);
        return pool.includes(q);
      });

      if (hit) {
        const meta = await getLeagueMetaFromScoreboard(hit.sport_key, hit.league_key).catch(() => null);
        results.push({
          input: it,
          resolved: {
            sport_key: hit.sport_key,
            league_key: hit.league_key,
            league_abbrev: meta?.league_abbrev ?? hit.league_abbrev ?? null,
            league_name: meta?.league_name ?? hit.league_name ?? null,
            source: "registry",
            scoreboard_url: meta?.scoreboard_url ?? scoreboardUrl(hit.sport_key, hit.league_key),
          } satisfies Resolved,
          candidates: [],
        });
        continue;
      }
    }

    // 3) ESPN candidates (wide coverage)
    const candidates: Candidate[] = [];
    if (league_text) {
      const scored = espnIndex
        .map((x: any) => ({
          ...x,
          score: scoreMatch(league_text, x.name, x.abbrev, x.league_key),
        }))
        .filter((x: any) => x.score > 0)
        .sort((a: any, b: any) => b.score - a.score)
        .slice(0, 10);

      for (const c of scored) {
        const meta = await getLeagueMetaFromScoreboard(c.sport_key, c.league_key).catch(() => null);
        candidates.push({
          sport_key: c.sport_key,
          league_key: c.league_key,
          league_abbrev: meta?.league_abbrev ?? c.abbrev ?? null,
          league_name: meta?.league_name ?? c.name ?? null,
          scoreboard_url: meta?.scoreboard_url ?? scoreboardUrl(c.sport_key, c.league_key),
          source: "candidate",
        });
      }
    }

    results.push({
      input: it,
      resolved: null,
      candidates,
    });
  }

  return NextResponse.json({ results });
}
