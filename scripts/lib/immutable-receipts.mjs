import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { fingerprintFile } from "./content-id.mjs";

/** Stable JSON for IDs and receipt hashes. Array order remains producer-significant. */
export function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}
function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort((left, right) => left.localeCompare(right))
        .map((key) => [key, canonicalValue(value[key])]),
    );
  }
  if (value === undefined) throw new Error("receipt values cannot contain undefined");
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error("receipt numbers must be finite");
  }
  return value;
}

export function contentIdForJson(value) {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

export function digestFromContentId(contentId, context = "content id") {
  if (typeof contentId !== "string" || !/^sha256:[a-f0-9]{64}$/.test(contentId)) {
    throw new Error(`${context} must be a lowercase SHA-256 content id`);
  }
  return contentId.slice("sha256:".length);
}

export async function fileReceipt(path, recordedPath = path) {
  const identity = await fingerprintFile(path);
  return {
    path: String(recordedPath),
    content_id: identity.contentId,
    bytes: identity.bytes,
  };
}

/**
 * Receipts are immutable but idempotent: repeating the exact operation succeeds, while a
 * different payload at the same path fails instead of rewriting review history.
 */
export async function writeImmutableJson(path, value) {
  const rendered = `${JSON.stringify(value, null, 2)}\n`;
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(path, rendered, { encoding: "utf8", flag: "wx" });
    return "created";
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const existing = await readFile(path, "utf8");
    if (existing !== rendered) throw new Error(`immutable receipt already exists with different bytes: ${path}`);
    return "existing";
  }
}
