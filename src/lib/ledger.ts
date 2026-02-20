export type BetResult = "OPEN" | "WIN" | "LOSS" | "PUSH" | "VOID" | "CASHOUT";
export type BetStatus = "OPEN" | "FINAL";

export type BetRow = {
  id: string;
  date: string; // YYYY-MM-DD
  capper: string;
  league: string;
  market: string;
  play: string;

  odds: number | string | null;
  units: number | string;

  is_fade?: boolean | null;
  source_capper?: string | null;
  opponent?: string | null;
  final_score?: string | null;

  result: BetResult | string;
  status: BetStatus | string;

  notes?: string | null;

  created_at?: string;
  updated_at?: string;
};

export function toNumber(v: unknown, fallback = 0): number {
  const n = typeof v === "number" ? v : Number(String(v ?? "").trim());
  return Number.isFinite(n) ? n : fallback;
}

export function profitIfWinUnits(odds: number, units: number): number {
  if (!Number.isFinite(odds) || odds === 0) return 0;
  if (!Number.isFinite(units) || units <= 0) return 0;
  if (odds > 0) return units * (odds / 100);
  return units * (100 / Math.abs(odds));
}

export function netUnits(b: BetRow): number {
  const status = String(b.status).toUpperCase();
  const result = String(b.result).toUpperCase();
  if (status !== "FINAL") return 0;

  const odds = toNumber(b.odds, 0);
  const units = toNumber(b.units, 0);

  if (result === "WIN") return profitIfWinUnits(odds, units);
  if (result === "LOSS") return -units;
  if (result === "PUSH" || result === "VOID") return 0;

  // CASHOUT (unknown) => keep conservative at 0 unless you later add a cashout amount field
  return 0;
}

export function wlp(finalBets: BetRow[]) {
  const wins = finalBets.filter((b) => String(b.result).toUpperCase() === "WIN").length;
  const losses = finalBets.filter((b) => String(b.result).toUpperCase() === "LOSS").length;
  const pushes = finalBets.filter((b) => String(b.result).toUpperCase() === "PUSH").length;
  return { wins, losses, pushes };
}

export function roi(finalBets: BetRow[]) {
  const risk = finalBets.reduce((a, b) => a + toNumber(b.units, 0), 0);
  const net = finalBets.reduce((a, b) => a + netUnits(b), 0);
  return { risk, net, roi: risk > 0 ? net / risk : 0 };
}

export function getUnitSize(): number {
  if (typeof window === "undefined") return 16;
  const raw = window.localStorage.getItem("bk_unit_size") ?? "16";
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 16;
}

export function betsToCSV(bets: BetRow[]): string {
  const headers = [
    "id",
    "date",
    "capper",
    "league",
    "market",
    "play",
    "odds",
    "units",
    "status",
    "result",
    "opponent",
    "final_score",
    "is_fade",
    "source_capper",
    "notes",
    "created_at",
    "updated_at",
  ];

  const esc = (v: any) => {
    const s = v === null || v === undefined ? "" : String(v);
    if (/[,\n\r"]/g.test(s)) return `"${s.replaceAll('"', '""')}"`;
    return s;
  };

  const lines = [headers.join(",")];
  for (const b of bets) {
    const row: Record<string, any> = {
      id: b.id,
      date: b.date,
      capper: b.capper,
      league: b.league,
      market: b.market,
      play: b.play,
      odds: b.odds ?? "",
      units: b.units ?? "",
      status: b.status ?? "",
      result: b.result ?? "",
      opponent: b.opponent ?? "",
      final_score: b.final_score ?? "",
      is_fade: b.is_fade ?? "",
      source_capper: b.source_capper ?? "",
      notes: b.notes ?? "",
      created_at: b.created_at ?? "",
      updated_at: b.updated_at ?? "",
    };

    lines.push(headers.map((h) => esc(row[h])).join(","));
  }

  return lines.join("\n");
}

export function downloadText(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
