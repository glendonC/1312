// The en dash is the studio's one empty-value placeholder glyph; prose never uses dashes.
export function clock(t: number, tenths = false): string {
  if (!Number.isFinite(t)) return "–";
  const safe = Math.max(0, t);
  const m = Math.floor(safe / 60);
  const s = Math.floor(safe % 60);
  const base = `${m}:${String(s).padStart(2, "0")}`;
  return tenths ? `${base}.${Math.floor((safe % 1) * 10)}` : base;
}

export function pct(n: number): string {
  return Number.isFinite(n) ? `${Math.round(n * 100)}%` : "–";
}

export function rate(n: number | null): string {
  return n === null ? "–" : n.toFixed(2);
}

export function signed(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}`;
}
