import type {
  MediaExtractRequest,
  MediaOperationReceipt,
  MediaSeekRequest,
} from "../model.ts";
import {
  contentId,
  exact,
  fail,
  integer,
  literal,
  object,
  oneOf,
  string,
  uniqueStrings,
} from "./primitives.ts";

function mediaRangeRequest(value: unknown, context: string): void {
  const item = object(value, context, "request");
  exact(
    item,
    ["operationId", "taskId", "agentId", "artifactId", "trackId", "startMs", "endMs"],
    context,
    "request",
  );
  string(item.operationId, context, "request.operationId");
  string(item.taskId, context, "request.taskId");
  string(item.agentId, context, "request.agentId");
  string(item.artifactId, context, "request.artifactId");
  string(item.trackId, context, "request.trackId");
  const start = integer(item.startMs, context, "request.startMs");
  const end = integer(item.endMs, context, "request.endMs", 1);
  if (end <= start) fail(context, "request", "must be a non-empty half-open range");
}

export function assertMediaExtractRequest(
  value: unknown,
  context = "Media extract request",
): asserts value is MediaExtractRequest {
  mediaRangeRequest(value, context);
}

export function assertMediaSeekRequest(
  value: unknown,
  context = "Media seek request",
): asserts value is MediaSeekRequest {
  mediaRangeRequest(value, context);
}

export function validateMediaOperationReceipt(
  value: unknown,
  context: string,
  path: string,
): asserts value is MediaOperationReceipt {
  const item = object(value, context, path);
  const capability = oneOf<"media.extract" | "media.seek">(
    item.capability,
    new Set(["media.extract", "media.seek"]),
    context,
    `${path}.capability`,
  );
  exact(
    item,
    capability === "media.extract"
      ? [
          "schema",
          "receiptId",
          "operationId",
          "capability",
          "authorization",
          "request",
          "producer",
          "input",
          "output",
          "sourceArtifactIds",
        ]
      : [
          "schema",
          "receiptId",
          "operationId",
          "capability",
          "authorization",
          "request",
          "producer",
          "input",
          "observation",
          "sourceArtifactIds",
        ],
    context,
    path,
  );
  literal(item.schema, "studio.media-operation.receipt.v1", context, `${path}.schema`);
  string(item.receiptId, context, `${path}.receiptId`);
  string(item.operationId, context, `${path}.operationId`);
  const authorization = object(item.authorization, context, `${path}.authorization`);
  exact(authorization, ["grantId", "taskId", "agentId"], context, `${path}.authorization`);
  string(authorization.grantId, context, `${path}.authorization.grantId`);
  string(authorization.taskId, context, `${path}.authorization.taskId`);
  string(authorization.agentId, context, `${path}.authorization.agentId`);
  const request = object(item.request, context, `${path}.request`);
  exact(request, ["artifactId", "trackId", "startMs", "endMs"], context, `${path}.request`);
  string(request.artifactId, context, `${path}.request.artifactId`);
  string(request.trackId, context, `${path}.request.trackId`);
  const start = integer(request.startMs, context, `${path}.request.startMs`);
  const end = integer(request.endMs, context, `${path}.request.endMs`, 1);
  if (end <= start) fail(context, `${path}.request`, "must be a non-empty range");
  const producer = object(item.producer, context, `${path}.producer`);
  exact(producer, ["id", "version"], context, `${path}.producer`);
  literal(
    producer.id,
    capability === "media.extract"
      ? "ffmpeg.audio-range-extract"
      : "ffmpeg.bounded-seek-observation",
    context,
    `${path}.producer.id`,
  );
  string(producer.version, context, `${path}.producer.version`);
  const input = object(item.input, context, `${path}.input`);
  exact(input, ["artifactId", "contentId"], context, `${path}.input`);
  string(input.artifactId, context, `${path}.input.artifactId`);
  contentId(input.contentId, context, `${path}.input.contentId`);
  if (capability === "media.extract") {
    const output = object(item.output, context, `${path}.output`);
    exact(
      output,
      ["artifactId", "contentId", "bytes", "durationMs", "trackId"],
      context,
      `${path}.output`,
    );
    string(output.artifactId, context, `${path}.output.artifactId`);
    contentId(output.contentId, context, `${path}.output.contentId`);
    integer(output.bytes, context, `${path}.output.bytes`, 1);
    integer(output.durationMs, context, `${path}.output.durationMs`, 1);
    string(output.trackId, context, `${path}.output.trackId`);
  } else {
    const observation = object(item.observation, context, `${path}.observation`);
    exact(observation, ["status", "decodedDurationUs"], context, `${path}.observation`);
    literal(observation.status, "decoded", context, `${path}.observation.status`);
    const decodedDurationUs = integer(
      observation.decodedDurationUs,
      context,
      `${path}.observation.decodedDurationUs`,
      1,
    );
    if (decodedDurationUs > (end - start) * 1_000) {
      fail(
        context,
        `${path}.observation.decodedDurationUs`,
        "exceeds the authorized range duration",
      );
    }
  }
  const sources = uniqueStrings(item.sourceArtifactIds, context, `${path}.sourceArtifactIds`);
  if (sources.length === 0) fail(context, `${path}.sourceArtifactIds`, "must retain lineage");
}
