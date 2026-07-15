import type { TaskRecord } from "../model.ts";
import { LauncherFailure } from "./launcherFailure.ts";

export interface WorkerResult {
  summary: string;
  outputs: Array<{ name: string; kind: string; content: string }>;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function validateWorkerResult(value: unknown, task: TaskRecord): WorkerResult {
  const item = record(value);
  if (!item || Object.keys(item).some((key) => key !== "summary" && key !== "outputs")) {
    throw new LauncherFailure(
      "Worker result must contain only summary and outputs",
      "Codex worker response failed its output contract.",
    );
  }
  if (
    typeof item.summary !== "string" ||
    item.summary.trim().length === 0 ||
    item.summary.length > 2_000
  ) {
    throw new LauncherFailure(
      "Worker summary is missing or too long",
      "Codex worker response failed its output contract.",
    );
  }
  if (!Array.isArray(item.outputs)) {
    throw new LauncherFailure(
      "Worker outputs must be an array",
      "Codex worker response failed its output contract.",
    );
  }
  const required = task.requiredOutputs.filter((output) => output.required);
  if (item.outputs.length !== required.length) {
    throw new LauncherFailure(
      "Worker output count does not match the required contract",
      "Codex worker response failed its output contract.",
    );
  }

  const outputs = item.outputs.map((candidate, index) => {
    const output = record(candidate);
    if (!output || Object.keys(output).some((key) => !["name", "kind", "content"].includes(key))) {
      throw new LauncherFailure(
        `Worker output ${index + 1} has an open shape`,
        "Codex worker response failed its output contract.",
      );
    }
    if (
      typeof output.name !== "string" ||
      typeof output.kind !== "string" ||
      typeof output.content !== "string" ||
      output.content.trim().length === 0 ||
      output.content.length > 8_000
    ) {
      throw new LauncherFailure(
        `Worker output ${index + 1} is invalid`,
        "Codex worker response failed its output contract.",
      );
    }
    return { name: output.name, kind: output.kind, content: output.content };
  });

  const byName = new Map(outputs.map((output) => [output.name, output]));
  if (
    byName.size !== outputs.length ||
    required.some((contract) => byName.get(contract.name)?.kind !== contract.artifactKind)
  ) {
    throw new LauncherFailure(
      "Worker outputs do not match their named artifact contracts",
      "Codex worker response failed its output contract.",
    );
  }
  return { summary: item.summary, outputs };
}

export function workerOutputSchema(task: TaskRecord): Record<string, unknown> {
  const required = task.requiredOutputs.filter((output) => output.required);
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      summary: { type: "string", minLength: 1, maxLength: 2_000 },
      outputs: {
        type: "array",
        minItems: required.length,
        maxItems: required.length,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string", enum: required.map((output) => output.name) },
            kind: { type: "string", enum: required.map((output) => output.artifactKind) },
            content: { type: "string", minLength: 1, maxLength: 8_000 },
          },
          required: ["name", "kind", "content"],
        },
      },
    },
    required: ["summary", "outputs"],
  };
}

export function workerPrompt(task: TaskRecord): string {
  const mediaTools = task.grants.flatMap((grant) =>
    grant.capability === "media.extract"
      ? ["media_extract"]
      : grant.capability === "media.seek"
        ? ["media_seek"]
        : []);
  const contract = {
    taskId: task.id,
    objective: task.objective,
    workerKind: task.workerKind,
    requiredOutputs: task.requiredOutputs.filter((output) => output.required),
    inputArtifactIds: task.inputArtifactIds,
    mediaScope: task.mediaScope,
    budget: task.budget,
    grantedMediaTools: mediaTools,
    grantedEvidence: task.grants
      .filter((grant) => grant.capability === "evidence.read")
      .flatMap((grant) => grant.evidenceScope),
    grantedAssessment: task.grants
      .find((grant) => grant.capability === "analysis.evidence.assess")?.assessmentScope ?? null,
  };
  const mediaBoundary = mediaTools.length === 0
    ? "This executor exposes no media bytes and no media tools. Do not claim that you inspected, heard, translated, or measured media."
    : [
        `This executor exposes only these scheduler-granted media tools: ${mediaTools.join(", ")}.`,
        "Invoke only the tool and exact artifact, track, and half-open millisecond range named by the contract.",
        "A media operation occurred only when the tool returns a studio.child-media-tool-result.v1 receipt.",
        "The tools return receipt and artifact identities, not media bytes or semantic findings; do not claim what the media contains, sounds like, says, or means.",
        "Include the returned operation, artifact, receipt, and receipt-content identities in the required worker output.",
      ].join(" ");
  const evidenceScope = task.grants
    .filter((grant) => grant.capability === "evidence.read")
    .flatMap((grant) => grant.evidenceScope);
  const evidenceBoundary = evidenceScope.length === 0
    ? "This executor exposes no evidence-read tool. Existing detector findings are unavailable to this child."
    : [
        "This executor exposes evidence_read for each scheduler-granted evidence artifact in the contract.",
        "Invoke it exactly once for every granted artifactId and use only the bounded facts returned in studio.child-evidence-tool-result.v1.",
        "The evidence existed before this read; the read creates no new detector finding and does not expose paths or raw media bytes.",
        "Preserve operation, input-artifact, receipt, receipt-content, producer, decision, and preflight-lineage identities in the required worker output.",
        "Do not infer claims beyond the returned facts; unknown, withheld, empty, and truncated remain explicit.",
      ].join(" ");
  const assessmentScope = task.grants
    .find((grant) => grant.capability === "analysis.evidence.assess")?.assessmentScope ?? null;
  const assessmentBoundary = assessmentScope === null
    ? "This executor exposes no evidence_assess tool. Do not turn evidence reads into findings or conclusions."
    : [
        "After every required evidence_read completes, invoke evidence_assess exactly once over only those returned read receipt and receipt-content identities.",
        "Submit only the closed speech_activity or language_identity claims, each with its exact bounding millisecond range and exact returned fact indexes.",
        "The host rejects raw producer artifact identities, paths, open queries, captions, translations, out-of-range indexes, unsupported values, and budget overflow.",
        "Unknown, withheld, and truncated upstream states remain explicit in the receipted assessment; never upgrade them to supported.",
        "Include the returned assessment operation, output-artifact, receipt, and receipt-content identities in the required worker output.",
      ].join(" ");
  return [
    "You are one isolated child in the 1321 Studio production runtime.",
    "Complete only the bounded task contract below and return the JSON required by the supplied output schema.",
    mediaBoundary,
    evidenceBoundary,
    assessmentBoundary,
    "Output content is a worker-authored artifact proposal; the parent decides whether to accept it.",
    JSON.stringify(contract),
  ].join("\n\n");
}
