export function formatInteger(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

export function formatDuration(milliseconds: number | null): string {
  return milliseconds === null ? "unavailable" : `${(milliseconds / 1_000).toFixed(2)} s active`;
}

export function formatMeasuredInteger(value: number | null): string {
  return value === null ? "unavailable" : formatInteger(value);
}

export function runtimeSourceDomId(kind: "event" | "receipt" | "artifact", id: string): string {
  return `runtime-source-${kind}-${id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

export function compactRuntimeIdentity(value: string): string {
  if (value.length <= 28) return value;
  return `${value.slice(0, 14)}…${value.slice(-10)}`;
}
