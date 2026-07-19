import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { MemoryConsumptionReceipt } from "./model.ts";

const MEMORY_REVIEW_COLLECTIONS = [
  "proposals",
  "decisions",
  "legacy",
  "materializations",
  "consumptions",
] as const;

/** Load every immutable receipt in a memory/review store for consume/inspection. */
export async function loadMemoryReviewArtifacts(storeRoot: string): Promise<unknown[]> {
  const artifacts: unknown[] = [];
  for (const collection of MEMORY_REVIEW_COLLECTIONS) {
    const directory = join(storeRoot, collection);
    let names: string[];
    try {
      names = await readdir(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    for (const name of names.filter((entry) => entry.endsWith(".json")).sort()) {
      artifacts.push(JSON.parse(await readFile(join(directory, name), "utf8")));
    }
  }
  return artifacts;
}

/**
 * Persist a consumption receipt under memory/review/consumptions/. Idempotent for exact bytes;
 * different bytes at the same path fail closed.
 */
export async function recordMemoryConsumptionReceipt(
  storeRoot: string,
  receipt: MemoryConsumptionReceipt,
): Promise<"created" | "identical"> {
  const prefix = "memory-consumption:sha256:";
  if (!receipt.consumption_id.startsWith(prefix)) {
    throw new Error("memory consumption receipt identity is malformed");
  }
  const digest = receipt.consumption_id.slice(prefix.length);
  if (!/^[a-f0-9]{64}$/.test(digest)) {
    throw new Error("memory consumption receipt digest is malformed");
  }
  const path = join(storeRoot, "consumptions", `${digest}.json`);
  const rendered = `${JSON.stringify(receipt, null, 2)}\n`;
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(path, rendered, { encoding: "utf8", mode: 0o600, flag: "wx" });
    return "created";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const existing = await readFile(path, "utf8");
    if (existing !== rendered) {
      throw new Error(`immutable consumption receipt already exists with different bytes: ${path}`);
    }
    return "identical";
  }
}
