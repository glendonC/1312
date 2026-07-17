import type { RuntimeArtifact } from "../model.ts";
import {
  exact,
  fail,
  hash,
  integer,
  literal,
  nullableString,
  object,
  oneOf,
  string,
  uniqueStrings,
} from "./primitives.ts";
import { validateTracks } from "./scheduling.ts";
import { validateArtifactOrigin } from "./artifactOrigin.ts";

export {
  assertPreflightEvidenceArtifactDescriptor,
  assertSourceArtifactDescriptor,
} from "./artifactDescriptors.ts";
export { assertWorkerOutputEnvelope } from "./workerOutputEnvelope.ts";

export function validateRuntimeArtifact(
  value: unknown,
  context: string,
  path: string,
): asserts value is RuntimeArtifact {
  const item = object(value, context, path);
  exact(
    item,
    [
      "schema",
      "id",
      "runId",
      "kind",
      "mediaClass",
      "publication",
      "content",
      "storageKey",
      "durationMs",
      "tracks",
      "sourceArtifactIds",
      "producerTaskId",
      "producerAgentId",
      "origin",
    ],
    context,
    path,
  );
  literal(item.schema, "studio.runtime.artifact.v1", context, `${path}.schema`);
  string(item.id, context, `${path}.id`);
  string(item.runId, context, `${path}.runId`);
  string(item.kind, context, `${path}.kind`);
  const mediaClass = oneOf<string>(
    item.mediaClass,
    new Set(["raw", "derived", "non_media"]),
    context,
    `${path}.mediaClass`,
  );
  oneOf(item.publication, new Set(["private", "public"]), context, `${path}.publication`);
  hash(item.content, context, `${path}.content`);
  const storageKey = string(item.storageKey, context, `${path}.storageKey`);
  if (storageKey.startsWith("/") || storageKey.split("/").includes("..")) {
    fail(context, `${path}.storageKey`, "must be a relative contained key");
  }
  if (item.durationMs !== null) integer(item.durationMs, context, `${path}.durationMs`, 1);
  validateTracks(item.tracks, context, `${path}.tracks`);
  const sources = uniqueStrings(item.sourceArtifactIds, context, `${path}.sourceArtifactIds`);
  const task = nullableString(item.producerTaskId, context, `${path}.producerTaskId`);
  const agent = nullableString(item.producerAgentId, context, `${path}.producerAgentId`);
  const origin = object(item.origin, context, `${path}.origin`);
  const kind = string(origin.kind, context, `${path}.origin.kind`);
  validateArtifactOrigin(kind, { item, origin, mediaClass, sources, task, agent, context, path });
}

export function assertRuntimeArtifact(
  value: unknown,
  context = "Runtime artifact",
): asserts value is RuntimeArtifact {
  validateRuntimeArtifact(value, context, "artifact");
}
