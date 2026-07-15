function identityFailure(path: string, message: string): never {
  throw new Error(`memory inspection: ${path} ${message}`);
}

export function canonicalMemoryJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) identityFailure("canonical content", "contains a non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalMemoryJson).join(",")}]`;
  if (typeof value === "object") {
    const item = value as Record<string, unknown>;
    return `{${Object.keys(item)
      .sort((left, right) => left.localeCompare(right))
      .map((key) => `${JSON.stringify(key)}:${canonicalMemoryJson(item[key])}`)
      .join(",")}}`;
  }
  identityFailure("canonical content", `contains unsupported ${typeof value}`);
}

export async function memoryContentId(value: unknown): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) identityFailure("content identity", "requires Web Crypto SHA-256 support");
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(canonicalMemoryJson(value)));
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `sha256:${hex}`;
}
