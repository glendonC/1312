export function clock(t: number, tenths = false): string {
  const safe = Math.max(0, t);
  const m = Math.floor(safe / 60);
  const s = Math.floor(safe % 60);
  const base = `${m}:${String(s).padStart(2, "0")}`;
  return tenths ? `${base}.${Math.floor((safe % 1) * 10)}` : base;
}

export function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

export function rate(n: number | null): string {
  return n === null ? "—" : n.toFixed(2);
}

export function signed(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}`;
}
