import { isFrameHostArtifactKind, STUDY_REPORT_LIMITS } from "../model.ts";
import type {
  SemanticEvidenceCitationInput,
  StudyClaim,
  StudyCoverageRange,
  StudyReportArtifact,
  TaskRecord,
} from "../model.ts";
import { validateSemanticEvidenceCitationInput } from "../validation/semanticEvidence.ts";
import { validateCoveragePartition, validateStudyReportArtifact } from "../validation/studyReports.ts";
import { LauncherFailure } from "./launcherFailure.ts";

export interface WorkerResult {
  summary: string;
  semanticEvidenceInputs: SemanticEvidenceCitationInput[];
  outputs: WorkerResultOutput[];
}

export type WorkerResultOutput =
  | { name: string; kind: string; content: string }
  | { name: string; kind: "studio.study-report.v1"; coverage: StudyCoverageRange[]; claims: StudyClaim[] };

function studySourceArtifacts(task: TaskRecord, inputs: readonly SemanticEvidenceCitationInput[]) {
  return [
    { artifactId: task.jobContext.source.artifactId, contentId: task.jobContext.source.contentId },
    ...inputs.map((input) => ({ artifactId: input.artifactId, contentId: input.contentId }))
      .sort((left, right) => left.artifactId.localeCompare(right.artifactId)),
  ];
}

export function buildStudyReportEnvelope(
  task: TaskRecord,
  output: Extract<WorkerResultOutput, { kind: "studio.study-report.v1" }>,
  semanticEvidenceInputs: SemanticEvidenceCitationInput[],
): StudyReportArtifact {
  if (!task.parentTaskId || !task.parentAgentId) throw new Error("Root tasks cannot create child study reports");
  return validateStudyReportArtifact({
    schema: "studio.study-report.v1",
    runId: task.runId,
    task: { taskId: task.id, agentId: task.assignedAgentId, jobContextId: task.jobContext.contextId },
    parent: { taskId: task.parentTaskId, agentId: task.parentAgentId },
    outputSlot: { name: output.name, artifactKind: "studio.study-report.v1" },
    assignment: { source: structuredClone(task.jobContext.source), mediaScope: structuredClone(task.mediaScope) },
    coverage: structuredClone(output.coverage),
    claims: structuredClone(output.claims),
    semanticEvidenceInputs: structuredClone(semanticEvidenceInputs),
    sourceArtifacts: studySourceArtifacts(task, semanticEvidenceInputs),
    limits: STUDY_REPORT_LIMITS,
    nonClaims: { correctness: "not_assessed", completeness: "partition_only", semanticQuality: "not_assessed" },
  });
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function validateWorkerResult(
  value: unknown,
  task: TaskRecord,
  expectedSemanticEvidenceInputs: SemanticEvidenceCitationInput[] = [],
): WorkerResult {
  const item = record(value);
  if (task.requiredOutputs.some((output) => isFrameHostArtifactKind(output.artifactKind))) {
    throw new LauncherFailure(
      "Worker contract requests a host-only frame artifact kind",
      "Codex worker response failed its output authority contract.",
    );
  }
  const semanticGranted = task.grants.some((grant) => grant.capability === "speech.transcribe");
  const allowedKeys = semanticGranted
    ? new Set(["summary", "semanticEvidenceInputs", "outputs"])
    : new Set(["summary", "outputs"]);
  if (!item || Object.keys(item).some((key) => !allowedKeys.has(key))) {
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
  let semanticEvidenceInputs: SemanticEvidenceCitationInput[] = [];
  if (semanticGranted) {
    if (!Array.isArray(item.semanticEvidenceInputs)) {
      throw new LauncherFailure(
        "Semantic-consuming worker omitted its structured evidence input list",
        "Codex worker response failed its semantic evidence citation contract.",
      );
    }
    try {
      semanticEvidenceInputs = item.semanticEvidenceInputs.map((input, index) =>
        validateSemanticEvidenceCitationInput(input, "Worker result", `semanticEvidenceInputs[${index}]`));
    } catch (error) {
      throw new LauncherFailure(
        `Worker semantic evidence citation is invalid: ${error instanceof Error ? error.message : "invalid citation"}`,
        "Codex worker response failed its semantic evidence citation contract.",
      );
    }
    if (JSON.stringify(semanticEvidenceInputs) !== JSON.stringify(expectedSemanticEvidenceInputs)) {
      throw new LauncherFailure(
        "Worker semantic evidence citations do not equal the authenticated current-task observations",
        "Codex worker response failed its semantic evidence citation contract.",
      );
    }
  } else if (expectedSemanticEvidenceInputs.length !== 0) {
    throw new LauncherFailure(
      "Host supplied semantic evidence without a worker grant",
      "Codex worker response failed its semantic evidence citation contract.",
    );
  }
  const required = task.requiredOutputs.filter((output) => output.required);
  if (item.outputs.length !== required.length) {
    throw new LauncherFailure(
      "Worker output count does not match the required contract",
      "Codex worker response failed its output contract.",
    );
  }

  const outputs: WorkerResultOutput[] = item.outputs.map((candidate, index) => {
    const output = record(candidate);
    const isStudy = output?.kind === "studio.study-report.v1";
    const allowed = isStudy ? ["name", "kind", "coverage", "claims"] : ["name", "kind", "content"];
    if (!output || Object.keys(output).some((key) => !allowed.includes(key)) || allowed.some((key) => !(key in output))) {
      throw new LauncherFailure(
        `Worker output ${index + 1} has an open shape`,
        "Codex worker response failed its output contract.",
      );
    }
    if (isStudy) {
      if (typeof output.name !== "string") throw new LauncherFailure(`Worker study output ${index + 1} is invalid`, "Codex worker response failed its typed study-report contract.");
      let envelope: StudyReportArtifact;
      try {
        envelope = buildStudyReportEnvelope(task, {
          name: output.name,
          kind: "studio.study-report.v1",
          coverage: output.coverage as StudyCoverageRange[],
          claims: output.claims as StudyClaim[],
        }, semanticEvidenceInputs);
        validateCoveragePartition(envelope.coverage, task.mediaScope, "Worker study report coverage");
      } catch (error) {
        throw new LauncherFailure(
          `Worker study report is invalid: ${error instanceof Error ? error.message : "invalid typed report"}`,
          "Codex worker response failed its typed study-report contract.",
        );
      }
      const expectedByOperation = new Map(semanticEvidenceInputs.map((input) => [input.operationId, input]));
      for (const claim of envelope.claims) for (const citation of claim.citations) {
        const expected = expectedByOperation.get(citation.operationId);
        if (!expected || citation.artifactId !== expected.artifactId || citation.contentId !== expected.contentId ||
            citation.receiptId !== expected.receiptId || citation.receiptContentId !== expected.receiptContentId ||
            citation.observations.some((observation) => !expected.observations.some((candidate) =>
              candidate.observationId === observation.observationId && candidate.startMs === observation.startMs && candidate.endMs === observation.endMs))) {
          throw new LauncherFailure("Worker study claim contains an unsupported semantic citation", "Codex worker response failed its typed study-report citation contract.");
        }
      }
      return { name: output.name, kind: "studio.study-report.v1", coverage: envelope.coverage, claims: envelope.claims };
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
  return { summary: item.summary, semanticEvidenceInputs, outputs };
}

export function workerOutputSchema(task: TaskRecord): Record<string, unknown> {
  if (task.requiredOutputs.some((output) => isFrameHostArtifactKind(output.artifactKind))) {
    throw new LauncherFailure(
      "Worker contract requests a host-only frame artifact kind",
      "Codex worker output schema cannot impersonate a host frame artifact.",
    );
  }
  const required = task.requiredOutputs.filter((output) => output.required);
  const semanticGranted = task.grants.some((grant) => grant.capability === "speech.transcribe");
  const semanticEvidenceInputs = {
    type: "array",
    minItems: 1,
    maxItems: 16,
    items: {
      type: "object",
      additionalProperties: false,
      properties: {
        operationId: { type: "string", minLength: 1 },
        artifactId: { type: "string", minLength: 1 },
        contentId: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" },
        receiptId: { type: "string", minLength: 1 },
        receiptContentId: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" },
        observations: {
          type: "array",
          maxItems: 64,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              observationId: { type: "string", minLength: 1 },
              startMs: { type: "integer", minimum: 0 },
              endMs: { type: "integer", minimum: 1 },
            },
            required: ["observationId", "startMs", "endMs"],
          },
        },
      },
      required: ["operationId", "artifactId", "contentId", "receiptId", "receiptContentId", "observations"],
    },
  };
  const citation = (semanticEvidenceInputs.items as Record<string, unknown>);
  const coverage = {
    type: "array", minItems: 1, maxItems: STUDY_REPORT_LIMITS.maxRanges,
    items: {
      type: "object", additionalProperties: false,
      properties: {
        artifactId: { type: "string", minLength: 1 }, trackId: { type: "string", minLength: 1 },
        startMs: { type: "integer", minimum: 0 }, endMs: { type: "integer", minimum: 1 },
        state: { type: "string", enum: ["supported", "withheld", "unknown", "failed"] },
        claimIds: { type: "array", maxItems: STUDY_REPORT_LIMITS.maxClaims, items: { type: "string", minLength: 1 } },
        reason: { anyOf: [
          { type: "null" },
          { type: "object", additionalProperties: false, properties: {
            code: { type: "string", enum: ["semantic_evidence_unavailable", "semantic_evidence_empty", "insufficient_semantic_evidence", "worker_withheld", "operation_failed", "unobserved_range"] },
            detail: { type: "string", minLength: 1, maxLength: 2_000 },
          }, required: ["code", "detail"] },
        ] },
      },
      required: ["artifactId", "trackId", "startMs", "endMs", "state", "claimIds", "reason"],
    },
  };
  const claims = {
    type: "array", maxItems: STUDY_REPORT_LIMITS.maxClaims,
    items: {
      type: "object", additionalProperties: false,
      properties: {
        claimId: { type: "string", minLength: 1 }, artifactId: { type: "string", minLength: 1 },
        trackId: { type: "string", minLength: 1 }, startMs: { type: "integer", minimum: 0 },
        endMs: { type: "integer", minimum: 1 }, statement: { type: "string", minLength: 1, maxLength: 8_000 },
        citations: { type: "array", minItems: 1, maxItems: STUDY_REPORT_LIMITS.maxCitations, items: citation },
      },
      required: ["claimId", "artifactId", "trackId", "startMs", "endMs", "statement", "citations"],
    },
  };
  const requiredOutputSchemas = required.map((output) => output.artifactKind === "studio.study-report.v1"
        ? { type: "object", additionalProperties: false, properties: {
            name: { type: "string", const: output.name }, kind: { type: "string", const: "studio.study-report.v1" }, coverage, claims,
          }, required: ["name", "kind", "coverage", "claims"] }
        : { type: "object", additionalProperties: false, properties: {
            name: { type: "string", const: output.name }, kind: { type: "string", const: output.artifactKind }, content: { type: "string", minLength: 1, maxLength: 8_000 },
          }, required: ["name", "kind", "content"] });
  const outputItems = required.some((output) => output.artifactKind === "studio.study-report.v1")
    ? requiredOutputSchemas.length === 1 ? requiredOutputSchemas[0] : { anyOf: requiredOutputSchemas }
    : {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string", enum: required.map((output) => output.name) },
          kind: { type: "string", enum: required.map((output) => output.artifactKind) },
          content: { type: "string", minLength: 1, maxLength: 8_000 },
        },
        required: ["name", "kind", "content"],
      };
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      summary: { type: "string", minLength: 1, maxLength: 2_000 },
      ...(semanticGranted ? { semanticEvidenceInputs } : {}),
      outputs: {
        type: "array",
        minItems: required.length,
        maxItems: required.length,
        items: outputItems,
      },
    },
    required: semanticGranted ? ["summary", "semanticEvidenceInputs", "outputs"] : ["summary", "outputs"],
  };
}

export function workerPrompt(task: TaskRecord): string {
  const mediaTools = task.grants.flatMap((grant) =>
    grant.capability === "media.extract"
      ? ["media_extract"]
      : grant.capability === "media.seek"
        ? ["media_seek"]
        : grant.capability === "media.frames.sample"
          ? ["media_frames_sample"]
        : []);
  const frameSampling = task.grants
    .filter((grant) => grant.capability === "media.frames.sample")
    .map((grant) => ({
      mediaScope: grant.mediaScope,
      limits: grant.frameScope.limits,
    }));
  const semanticScope = task.grants
    .filter((grant) => grant.capability === "speech.transcribe")
    .flatMap((grant) => grant.mediaScope);
  const contract = {
    taskId: task.id,
    jobContext: task.jobContext,
    objective: task.objective,
    workerKind: task.workerKind,
    requiredOutputs: task.requiredOutputs.filter((output) => output.required),
    inputArtifactIds: task.inputArtifactIds,
    mediaScope: task.mediaScope,
    budget: task.budget,
    grantedMediaTools: mediaTools,
    grantedFrameSampling: frameSampling,
    grantedSemanticEvidence: semanticScope,
    grantedEvidence: task.grants
      .filter((grant) => grant.capability === "evidence.read")
      .flatMap((grant) => grant.evidenceScope),
    grantedAssessment: task.grants
      .find((grant) => grant.capability === "analysis.evidence.assess")?.assessmentScope ?? null,
    grantedDecision: task.grants
      .find((grant) => grant.capability === "analysis.evidence.decide")?.decisionScope ?? null,
  };
  const mediaBoundary = mediaTools.length === 0
    ? "This executor exposes no media bytes and no media tools. Do not claim that you inspected, heard, translated, or measured media."
    : [
        `This executor exposes only these scheduler-granted media tools: ${mediaTools.join(", ")}.`,
        "Invoke only the tool and exact artifact, track, and half-open millisecond range named by the contract.",
        ...(mediaTools.some((tool) => tool === "media_extract" || tool === "media_seek") ? [
          "An extract or seek operation occurred only when the tool returns a studio.child-media-tool-result.v1 receipt.",
          "media_seek returns one host-produced audio_activity observation: signal or digital_silence with volume measurements for the exact range. It does not identify speech, words, speakers, music, or meaning. media_extract returns no semantic finding.",
        ] : []),
        ...(mediaTools.includes("media_frames_sample") ? [
          "media_frames_sample accepts only one timestampsMs array: 1-8 unique increasing integer presentation times inside the granted half-open range. The task-private host injects source, video track, task, agent, grant, and operation scope; the child never supplies paths or those authorities.",
          "A frame operation occurred only when the tool returns actual image/png content plus a host-authored studio.frame-sampling.receipt.v1 identity. The host re-hashes the source, owns decode and transformation, and reports requested and actual presentation timestamps.",
          "That receipt proves bounded sampling and byte delivery only. It does not prove that any model saw or understood a scene, selected the right frame, performed OCR, identified a person, or produced evidence admissible to a study report.",
          "Do not label worker-authored output as studio.frame-sampling.receipt.v1; that kind belongs only to the host artifact named by the tool result.",
        ] : []),
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
        "The evidence existed before this read; facts are selected by intersection and clipped to the exact granted source window. The read creates no new detector finding and does not expose paths or raw media bytes.",
        "Preserve operation, input-artifact, receipt, receipt-content, producer, decision, and preflight-lineage identities in the required worker output.",
        "Do not infer claims beyond the returned facts; unknown, withheld, empty, and truncated remain explicit.",
      ].join(" ");
  const semanticBoundary = semanticScope.length === 0
    ? "This executor exposes no speech_transcribe tool and cannot cite current-run semantic media evidence."
    : [
        "Invoke speech_transcribe once for the exact granted artifact, track, and half-open range.",
        "Its timed text is a current-run recognizer hypothesis, not hearing, truth, understanding, agreement, or an accuracy claim.",
        "Multiple workers reading hypotheses does not establish consensus or quality.",
        "Copy the returned operation/artifact/content/receipt identities and every exact observation id/range into the top-level semanticEvidenceInputs list.",
        "A free-text mention of any identity is not a citation and the output validator will reject it.",
        "Preserve empty, unavailable, unknown, and truncated availability without upgrading it.",
      ].join(" ");
  const studyBoundary = task.requiredOutputs.some((output) => output.required && output.artifactKind === "studio.study-report.v1")
    ? [
        "Return studio.study-report.v1 as typed coverage and claims, never as a prose-only content field.",
        "Partition every assigned artifact/track range in order with no gaps or overlaps using only supported, withheld, unknown, or failed.",
        "Supported ranges require structured claims over the exact same range, and every claim must cite exact semantic artifact/content/receipt and observation identities returned by speech_transcribe.",
        "Citation observation ranges must close the entire supported claim range; use closed non-supported reasons everywhere else.",
        "Do not submit a coverage percentage. Coverage is derived from the partition and does not establish correctness or complete study.",
      ].join(" ")
    : "No typed study report is required by this task.";
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
  const decisionScope = task.grants
    .find((grant) => grant.capability === "analysis.evidence.decide")?.decisionScope ?? null;
  const decisionBoundary = decisionScope === null
    ? "This executor exposes no evidence_decide tool. Do not claim that an assessment passed a publication or publish-review gate."
    : [
        "After the required evidence_assess completes, invoke evidence_decide exactly once with only its returned assessment operation, artifact, receipt, and receipt-content identities.",
        "Do not submit raw receipt bytes, assessment claims, paths, prose, a desired outcome, caption content, or publication controls.",
        "The host reopens the stored assessment and cited reads and deterministically emits withheld or proceed_to_publish_review with closed reason codes.",
        "Proceed_to_publish_review means only that a future publish-review producer may inspect the run; it does not mean captions exist or anything was published.",
        "Include the returned decision operation, output-artifact, receipt, receipt-content, outcome, and reason codes in the required worker output.",
      ].join(" ");
  return [
    "You are one isolated child in the 1321 Studio production runtime.",
    "Complete only the bounded task contract below and return the JSON required by the supplied output schema.",
    mediaBoundary,
    semanticBoundary,
    studyBoundary,
    evidenceBoundary,
    assessmentBoundary,
    decisionBoundary,
    "Output content is a worker-authored artifact proposal; the parent decides whether to accept it.",
    JSON.stringify(contract),
  ].join("\n\n");
}
