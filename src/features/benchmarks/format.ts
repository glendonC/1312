export function displayNumber(value: number | null, options?: Intl.NumberFormatOptions): string {
  if (value === null) return "Not measured";
  return new Intl.NumberFormat("en-US", options).format(value);
}

export function displayRate(value: number | null): string {
  if (value === null) return "Not measured";
  return new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 }).format(value);
}
