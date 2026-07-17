import type { TaskRecord } from "../model.ts";
import { LauncherFailure } from "./launcherFailure.ts";

export interface OrchestratorResult {
  outcome: "completed" | "no_request" | "withheld";
  reason: string;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function validateOrchestratorResult(value: unknown): OrchestratorResult {
  const item = record(value);
  if (!item || Object.keys(item).length !== 2 || !("outcome" in item) || !("reason" in item)) {
    throw new LauncherFailure(
      "Orchestrator result must contain only outcome and reason",
      "Codex orchestrator response failed its closed output contract.",
    );
  }
  if (!new Set(["completed", "no_request", "withheld"]).has(item.outcome as string)) {
    throw new LauncherFailure(
      "Orchestrator outcome is invalid",
      "Codex orchestrator response failed its closed output contract.",
    );
  }
  if (typeof item.reason !== "string" || item.reason.trim().length === 0 || item.reason.length > 2_000) {
    throw new LauncherFailure(
      "Orchestrator reason is missing or too long",
      "Codex orchestrator response failed its closed output contract.",
    );
  }
  return { outcome: item.outcome as OrchestratorResult["outcome"], reason: item.reason };
}

export const orchestratorOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    outcome: { type: "string", enum: ["completed", "no_request", "withheld"] },
    reason: { type: "string", minLength: 1, maxLength: 2_000 },
  },
  required: ["outcome", "reason"],
} as const;

export function orchestratorPrompt(task: TaskRecord): string {
  const requiresDelegation = task.objective.startsWith("Delegate at least");
  const requiresCoverageStudyDelegation = task.objective.startsWith("Delegate at least two bounded coverage-study tasks");
  const requiresStudySynthesis = task.grants.some((grant) => grant.capability === "study.synthesize");
  const generalized = task.requiredOutputs.some((output) => output.required && output.artifactKind === "studio.owned-media-study.v2");
  const exactTools = generalized
    ? ["task_spawn_request", "task_reports_wait", "report_disposition", "artifact_read", "study_synthesize"]
    : requiresStudySynthesis
    ? ["task_spawn_request", "task_reports_wait", "report_disposition", "artifact_read", "study_planning_decision", "study_synthesize"]
    : ["task_spawn_request", "task_reports_wait"];
  const contract = {
    objective: task.objective,
    jobContext: task.jobContext,
    mediaScope: task.mediaScope,
    inputArtifactIds: task.inputArtifactIds,
    budget: task.budget,
    exactTools,
    requiresDelegation,
    requiresCoverageStudyDelegation,
    requiresStudySynthesis,
  };
  return [
    "You are the model-executed root orchestrator in the 1321 Studio durable runtime.",
    `You receive exactly ${exactTools.length} closed, path-free tools. task_spawn_request accepts a bounded child contract and the host derives every request, task, agent, grant, dependency-task, context, and launch identity. task_reports_wait accepts an empty object and returns only terminal direct-child task/report/artifact identities or closed failure states.`,
    "Choose whether and how to decompose the objective. You may issue multiple spawn requests before the first wait. The host validates and launches accepted contracts but does not choose the decomposition for you.",
    requiresDelegation
      ? "This task contract explicitly requires delegation. You must call task_spawn_request at least once with a child contract you author, and if one is accepted you must call task_reports_wait. Returning completed or no_request without a spawn call violates the contract."
      : "When the task contract does not require delegation, a deliberate no-request decision remains available.",
    ...(requiresCoverageStudyDelegation ? [
      `This owned-study task requires at least two accepted child contracts. Every accepted contract must require exactly one ${generalized ? "studio.study-report.v2" : "studio.study-report.v1"} output and must request both speech.transcribe and report.submit. The launcher verifies these model-authored contracts; a rejected request does not count.`,
    ] : []),
    ...(requiresStudySynthesis && !generalized ? [
      "After the first wait, use report_disposition for every returned typed study report. Accept or reject each one yourself with a reason. The host validates structural lineage but does not choose the disposition. At least two accepted reports are required by this task.",
      "For each accepted disposition, use its returned admission grant and exact admitted content id with artifact_read. Read at least two admitted structured reports. Paths and prose identifiers are never authority. After the second read, artifact_read returns the deterministic planningInput containing the exact current coverage, gap, and conflict identities.",
      "Call study_planning_decision with every planningInput coverageId, gapId, and conflictId exactly as returned. You choose request_follow_up, synthesize_with_gaps, or withhold. If you request follow-up, cite at least one exact gap/conflict, then call task_spawn_request with followUpCause naming that planning decision and cause. The scheduler applies the same scope, depth, capability, dependency, concurrency, and run-budget policy. Wait, disposition/read any accepted follow-up report, and make a new decision over the new planningInput.",
      "This root contract requires eventual synthesize_with_gaps and one study_synthesize call. The synthesis must copy every exact coverage identity/range, keep gaps and conflicts non-supported, keep every conflict unresolved, and author range-bound claims only when exact child-report claims and their semantic observation citations support the same range. The host injects immutable job context, accepted/rejected/failed dispositions, and exact follow-up history; you author coverage states, synthesis prose, claims, conflict descriptions, and limitations.",
      "Do not infer that citation closure, coverage, agreement, or readiness proves truth, semantic correctness, transcription quality, or translation quality. The deterministic readiness audit runs only after your executor receipt closes; you do not choose readiness.",
    ] : []),
    ...(generalized ? [
      "After the first wait, use report_disposition for every returned studio.study-report.v2 artifact. Accept or reject each one yourself with a reason. The host then cold-audits every typed citation and deterministically preserves acoustic dialogue scope and all weak/conflicting states; at least two accepted reports are required.",
      "For each accepted result, call artifact_read with its returned admission grant id and exact report content id. After at least two reads, the result includes synthesisInput. This is the complete host-derived coverage and claim projection; copy its coverage and claims exactly into study_synthesize. Any rewrite, state upgrade, hidden range, changed citation, or prose substitution fails closed.",
      "U3 current-run speech is the only claim-support kind. Acoustic evidence can qualify coverage, and frames are cite-only media context; neither may authorize dialogue text. Unknown, withheld, unavailable, truncated, conflicting, failed, and not-in-scope states must survive synthesis.",
      "This root does not have study_planning_decision and must not request a U4 follow-up. The deterministic readiness v3 audit runs only after the executor receipt closes; you do not choose readiness or caption authority.",
    ] : []),
    "If any spawn is accepted, call task_reports_wait before returning. Do not treat scheduler acceptance, worker count, signal, VAD, language ID, or a report identity as semantic understanding, transcription, translation, or quality.",
    "Only when requiresDelegation is false and no child request is warranted, make no spawn call and return outcome no_request with a deliberate reason. If a child fails or is interrupted, preserve that state and normally return withheld.",
    requiresStudySynthesis
      ? "Return only the JSON required by the supplied output schema after the study_synthesize call. No captions, publication, quality score, truth arbitration, or UI action is authorized."
      : "Return only the JSON required by the supplied output schema. No synthesis, captions, publication, or UI action is authorized.",
    JSON.stringify(contract),
  ].join("\n\n");
}
