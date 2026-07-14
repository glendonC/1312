import type { Sha256Identity } from "./model.ts";

/** Stable JSON used for content identities; object key order never changes the digest. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const item = value as Record<string, unknown>;
  return `{${Object.keys(item)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(item[key])}`)
    .join(",")}}`;
}

function hexadecimal(bytes: Uint8Array): string {
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export async function identifyUtf8(value: string): Promise<Sha256Identity> {
  const bytes = new TextEncoder().encode(value);
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("Observability indexing requires SHA-256 support");
  const digest = hexadecimal(new Uint8Array(await subtle.digest("SHA-256", bytes)));
  return {
    algorithm: "sha256",
    digest,
    contentId: `sha256:${digest}`,
    bytes: bytes.byteLength,
  };
}

export function canonicalJsonLine(value: unknown): string {
  return `${canonicalJson(value)}\n`;
}
