import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";

import { assertSourceArtifactDescriptor } from "../assertions.ts";
import type { ContentIdentity, SourceArtifactDescriptor } from "../model.ts";

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const item = value as Record<string, unknown>;
  return `{${Object.keys(item)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(item[key])}`)
    .join(",")}}`;
}

export function canonicalSha256(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

/** Content identity produced by storeJson's canonical JSON plus its terminal newline. */
export function canonicalJsonContentId(value: unknown): string {
  const digest = createHash("sha256").update(`${canonicalJson(value)}\n`).digest("hex");
  return `sha256:${digest}`;
}

export async function identifyFile(path: string): Promise<ContentIdentity> {
  const [digest, details] = await Promise.all([
    new Promise<string>((resolveDigest, reject) => {
      const hash = createHash("sha256");
      const stream = createReadStream(path);
      stream.on("error", reject);
      stream.on("data", (chunk) => hash.update(chunk));
      stream.on("end", () => resolveDigest(hash.digest("hex")));
    }),
    stat(path),
  ]);
  if (!details.isFile() || details.size <= 0) throw new Error(`Artifact source ${path} must be a non-empty regular file`);
  return { algorithm: "sha256", digest, contentId: `sha256:${digest}`, bytes: details.size };
}

/**
 * The runtime source-artifact identity is derivable before bytes are copied into the run store.
 * This lets the host produce the exact pre-start forecast without creating a runtime directory.
 */
export function createSourceArtifactId(runId: string, descriptor: SourceArtifactDescriptor): string {
  assertSourceArtifactDescriptor(descriptor);
  return `artifact:${canonicalSha256({
    runId,
    contentId: descriptor.content.contentId,
    adapterId: descriptor.adapterId,
    sourceReceiptRef: descriptor.sourceReceiptRef,
  })}`;
}

export function createCaptionArtifactId(
  runId: string,
  jobId: string,
  contentId: string,
): string {
  return `artifact:${canonicalSha256({
    runId,
    jobId,
    kind: "caption-production-output",
    contentId,
  })}`;
}
