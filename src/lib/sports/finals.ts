type FinalResult = {
  final: boolean;
  home: string;
  away: string;
  homeScore: number;
  awayScore: number;
  sources: string[];
};

function norm(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

async function fetchJson(url: string) {
  const res = await fetch(url, { headers: { "accept": "application/json" } });
  if (!res.ok) throw new Error(`Fetch failed ${res.status} for ${url}`);
  return await res.json();
}

// ESPN fallback (unofficial; may change) :contentReference[oaicite:9]{index=9}
export async function getFinalFromESPN(args: {
  sport: string;  // e.g. "basketball", "football"
  league: string; // e.g. "nba", "nfl", "mens-college-basketball"
  yyyymmdd: string;
  teamA: string;
  teamB: string;
}): Promise<FinalResult | null> {
  // Endpoint pattern documented by community. :contentReference[oaicite:10]{index=10}
  const url = `https://site.api.espn.com/apis/site/v2/sports/${args.sport}/${args.league}/scoreboard?dates=${args.yyyymmdd}`;
  const j = await fetchJson(url);

  const a = norm(args.teamA);
  const b = norm(args.teamB);

  for (const ev of j?.events ?? []) {
    const comps = ev?.competitions ?? [];
    const c = comps[0];
    const teams = c?.competitors ?? [];
    if (teams.length !== 2) continue;

    const t0 = norm(teams[0]?.team?.displayName ?? "");
    const t1 = norm(teams[1]?.team?.displayName ?? "");
    const match =
      (t0.includes(a) && t1.includes(b)) || (t0.includes(b) && t1.includes(a));

    if (!match) continue;

    const status = c?.status?.type?.name || c?.status?.type?.state;
    const isFinal = String(status).toLowerCase().includes("final");

    const s0 = Number(teams[0]?.score ?? "NaN");
    const s1 = Number(teams[1]?.score ?? "NaN");
    if (!Number.isFinite(s0) || !Number.isFinite(s1)) continue;

    return {
      final: isFinal,
      home: teams.find((x: any) => x?.homeAway === "home")?.team?.displayName ?? teams[0]?.team?.displayName ?? "",
      away: teams.find((x: any) => x?.homeAway === "away")?.team?.displayName ?? teams[1]?.team?.displayName ?? "",
      homeScore: Number(teams.find((x: any) => x?.homeAway === "home")?.score ?? s0),
      awayScore: Number(teams.find((x: any) => x?.homeAway === "away")?.score ?? s1),
      sources: [url],
    };
  }

  return null;
}

// MLB Stats API endpoints :contentReference[oaicite:11]{index=11}
export async function getFinalFromMLB(args: {
  date: string; // YYYY-MM-DD
  teamA: string;
  teamB: string;
}): Promise<FinalResult | null> {
  const schedUrl = `https://statsapi.mlb.com/api/v1/schedule/games/?sportId=1&startDate=${args.date}&endDate=${args.date}`;
  const j = await fetchJson(schedUrl);

  const a = norm(args.teamA);
  const b = norm(args.teamB);

  const dates = j?.dates ?? [];
  for (const d of dates) {
    for (const g of d?.games ?? []) {
      const home = norm(g?.teams?.home?.team?.name ?? "");
      const away = norm(g?.teams?.away?.team?.name ?? "");
      const match = (home.includes(a) && away.includes(b)) || (home.includes(b) && away.includes(a));
      if (!match) continue;

      const homeScore = Number(g?.teams?.home?.score ?? "NaN");
      const awayScore = Number(g?.teams?.away?.score ?? "NaN");
      const state = String(g?.status?.detailedState ?? "").toLowerCase();
      const isFinal = state.includes("final") || state.includes("game over");

      return {
        final: isFinal,
        home: g?.teams?.home?.team?.name ?? "",
        away: g?.teams?.away?.team?.name ?? "",
        homeScore: Number.isFinite(homeScore) ? homeScore : 0,
        awayScore: Number.isFinite(awayScore) ? awayScore : 0,
        sources: [schedUrl],
      };
    }
  }

  return null;
}

// NHL endpoints :contentReference[oaicite:12]{index=12}
export async function getFinalFromNHL(args: {
  date: string; // YYYY-MM-DD
  teamA: string;
  teamB: string;
}): Promise<FinalResult | null> {
  const schedUrl = `https://api-web.nhle.com/v1/schedule/${args.date}`;
  const j = await fetchJson(schedUrl);

  const a = norm(args.teamA);
  const b = norm(args.teamB);

  // schedule structure varies; iterate “gameWeek” blocks
  const weeks = j?.gameWeek ?? [];
  for (const w of weeks) {
    for (const g of w?.games ?? []) {
      const home = norm(g?.homeTeam?.name?.default ?? g?.homeTeam?.placeName?.default ?? "");
      const away = norm(g?.awayTeam?.name?.default ?? g?.awayTeam?.placeName?.default ?? "");
      const match = (home.includes(a) && away.includes(b)) || (home.includes(b) && away.includes(a));
      if (!match) continue;

      const gameId = g?.id;
      if (!gameId) continue;

      const boxUrl = `https://api-web.nhle.com/v1/gamecenter/${gameId}/boxscore`;
      const box = await fetchJson(boxUrl);

      const homeScore = Number(box?.homeTeam?.score ?? "NaN");
      const awayScore = Number(box?.awayTeam?.score ?? "NaN");
      const isFinal = String(box?.gameState ?? "").toLowerCase() === "final";

      return {
        final: isFinal,
        home: box?.homeTeam?.name?.default ?? "",
        away: box?.awayTeam?.name?.default ?? "",
        homeScore: Number.isFinite(homeScore) ? homeScore : 0,
        awayScore: Number.isFinite(awayScore) ? awayScore : 0,
        sources: [schedUrl, boxUrl],
      };
    }
  }

  return null;
}
