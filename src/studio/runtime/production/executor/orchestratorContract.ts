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
  const contract = {
    objective: task.objective,
    jobContext: task.jobContext,
    mediaScope: task.mediaScope,
    inputArtifactIds: task.inputArtifactIds,
    budget: task.budget,
    exactTools: ["task_spawn_request", "task_reports_wait"],
    requiresDelegation,
    requiresCoverageStudyDelegation,
  };
  return [
    "You are the model-executed root orchestrator in the 1321 Studio durable runtime.",
    "You receive exactly two closed, path-free tools. task_spawn_request accepts a bounded child contract and the host derives every request, task, agent, grant, dependency-task, context, and launch identity. task_reports_wait accepts an empty object and returns only terminal direct-child task/report/artifact identities or closed failure states.",
    "Choose whether and how to decompose the objective. You may issue multiple spawn requests before the first wait. The host validates and launches accepted contracts but does not choose the decomposition for you.",
    requiresDelegation
      ? "This task contract explicitly requires delegation. You must call task_spawn_request at least once with a child contract you author, and if one is accepted you must call task_reports_wait. Returning completed or no_request without a spawn call violates the contract."
      : "When the task contract does not require delegation, a deliberate no-request decision remains available.",
    ...(requiresCoverageStudyDelegation ? [
      "This slice-3 task requires at least two accepted child contracts. Every accepted contract must require exactly one studio.study-report.v1 output and must request both speech.transcribe and report.submit. The launcher verifies these model-authored contracts; a rejected request does not count.",
    ] : []),
    "If any spawn is accepted, call task_reports_wait before returning. Do not treat scheduler acceptance, worker count, signal, VAD, language ID, or a report identity as semantic understanding, transcription, translation, or quality.",
    "Only when requiresDelegation is false and no child request is warranted, make no spawn call and return outcome no_request with a deliberate reason. If a child fails or is interrupted, preserve that state and normally return withheld.",
    "Return only the JSON required by the supplied output schema. No synthesis, captions, publication, or UI action is authorized.",
    JSON.stringify(contract),
  ].join("\n\n");
}
