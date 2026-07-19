import type { TaskRecord } from "../model.ts";
import { GENERALIZED_INITIAL_COVERAGE_BUDGET_JSON } from "./generalizedBudgetContract.ts";
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
  const generalized = task.requiredOutputs.some((output) => output.required && (output.artifactKind === "studio.owned-media-study.v2" || output.artifactKind === "studio.owned-media-study.v3"));
  const restudied = task.requiredOutputs.some((output) => output.required && output.artifactKind === "studio.owned-media-study.v3");
  const separationEnabled = restudied && task.grants.some((grant) => grant.capability === "study.separate");
  const researchEnabled = restudied && task.grants.some((grant) => grant.capability === "study.research");
  const computerUseEnabled = restudied && task.grants.some((grant) => grant.capability === "study.computer-use");
  const exactTools = restudied
    ? ["task_spawn_request", "task_reports_wait", "report_disposition", "artifact_read", "study_restudy_request", ...(separationEnabled ? ["study_separation_request"] : []), ...(researchEnabled ? ["study_research_request"] : []), ...(computerUseEnabled ? ["study_computer_use_request"] : []), "study_synthesize"]
    : generalized
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
    ...(task.jobContext.reviewedMemory
      ? [
        "jobContext.reviewedMemory is host-injected from one durable consumption receipt over a reviewed materialization. It is the only cross-run memory authority for this run. Legacy unreviewed glossary is excluded. Do not invent terms, promote memory, treat it as gold, or claim quality improvement from its presence.",
      ]
      : []),
    "Choose whether and how to decompose the objective. You may issue multiple spawn requests before the first wait. The host validates and launches accepted contracts but does not choose the decomposition for you.",
    requiresDelegation
      ? "This task contract explicitly requires delegation. You must call task_spawn_request at least once with a child contract you author, and if one is accepted you must call task_reports_wait. Returning completed or no_request without a spawn call violates the contract."
      : "When the task contract does not require delegation, a deliberate no-request decision remains available.",
    ...(requiresCoverageStudyDelegation ? [
      generalized
        ? `This owned-study task requires at least two accepted child contracts. Every initial coverage child must use budget exactly ${GENERALIZED_INITIAL_COVERAGE_BUDGET_JSON}, require exactly one studio.study-report.v2 output, and request both speech.transcribe and report.submit. The launcher verifies these model-authored contracts; a rejected request does not count. Never retry an equivalent rejected range under another workload key.`
        : "This owned-study task requires at least two accepted child contracts. Every initial coverage child must use a bounded budget inside the scheduler ceiling, require exactly one studio.study-report.v1 output, and request both speech.transcribe and report.submit. The launcher verifies the typed outputs and capabilities; a rejected request does not count. Never retry an equivalent rejected range under another workload key.",
    ] : []),
    ...(requiresStudySynthesis && !generalized ? [
      "After the first wait, use report_disposition for every returned typed study report. Accept or reject each one yourself with a reason. The host validates structural lineage but does not choose the disposition. At least two accepted reports are required by this task.",
      "For each accepted disposition, use its returned admission grant and exact admitted content id with artifact_read. Read at least two admitted structured reports. Paths and prose identifiers are never authority. After the second read, artifact_read returns the deterministic planningInput containing the exact current coverage, gap, and conflict identities.",
      "Call study_planning_decision with every planningInput coverageId, gapId, and conflictId exactly as returned. You choose request_follow_up, synthesize_with_gaps, or withhold. If you request follow-up, cite at least one exact gap/conflict, then call task_spawn_request with followUpCause naming that planning decision and cause. The scheduler applies the same scope, depth, capability, dependency, concurrency, and run-budget policy. Wait, disposition/read any accepted follow-up report, and make a new decision over the new planningInput.",
      "This root contract requires eventual synthesize_with_gaps and one study_synthesize call. The synthesis must copy every exact coverage identity/range, keep gaps and conflicts non-supported, keep every conflict unresolved, and author range-bound claims only when exact child-report claims and their semantic observation citations support the same range. The host injects immutable job context, accepted/rejected/failed dispositions, and exact follow-up history; you author coverage states, synthesis prose, claims, conflict descriptions, and limitations.",
      "Do not infer that citation closure, coverage, agreement, or readiness proves truth, semantic correctness, transcription quality, or translation quality. The deterministic readiness audit runs only after your executor receipt closes; you do not choose readiness.",
    ] : []),
    ...(generalized ? [
      "After the first wait, use report_disposition for every returned studio.study-report.v2 artifact. A v2 wait may also show immutable failed attempt 0 plus one host-authorized replacement attempt 1. Continue only when its recovery terminal says replacement_reported; never manually respawn equivalent failed work. On exhausted recovery, preserve the failure and return withheld. Accept or reject each actual report yourself with a reason. The host then cold-audits every typed citation and deterministically preserves acoustic dialogue scope and all weak/conflicting states; at least two accepted reports are required.",
      `For each accepted result, call artifact_read with its returned admission grant id and exact report content id. After at least two reads, the result includes synthesisInput${restudied ? `, restudyInput${researchEnabled ? ", and researchInput" : ""}` : ""}. The synthesisInput contains one opaque inputId over the complete host-derived coverage and claim projection. Call study_synthesize with exactly {"inputId": synthesisInput.inputId}; the host cold-recomputes every state, citation, and pass and rejects stale or forged ids before mutation.`,
      "U3 current-run speech is the only claim-support kind. Acoustic and anonymous speaker/overlap evidence can qualify coverage, and frames are cite-only media context; none may authorize dialogue text. Unknown, withheld, unavailable, truncated, conflicting, failed, and not-in-scope states must survive synthesis.",
      ...(restudied ? [
        "restudyInput contains only exact current weak ranges, prior evidence, and evidence-tied causes. For a speaker_overlap cause, copy cause.range exactly as the attenuated_subrange executionRange; the host derived it from one audited U6 overlap cell and requires prior broader current-run speech work. For every other cause, choose one strict contained subrange. Copy inputId, coverageId, and causeId exactly. The host fixes pass number, producer/configuration scope, budget, and child contract.",
        "If a range pass is accepted, call task_reports_wait, disposition its v2 report, and artifact_read any accepted admission before synthesis. The next synthesisInput retains every pass, prior weak state, new citations, residual weak cells, and disagreement. A pass without a required delta, identical work/config, scope broadening, unlimited retry, or best-of-K selection is rejected.",
        ...(separationEnabled ? ["study_separation_request is available only for an exact host-derived U6.1 conflicting overlap cell. Copy its inputId and triggerId exactly. The host grants only that raw range, runs a pinned local separator, stores anonymous private estimates, and compares raw versus stems with the same recognizer. Agreement or disagreement proves comparability only: never promote a stem hypothesis into claim support, caption text, semantic preference, quality, or truth."] : []),
        ...(researchEnabled ? ["researchInput is a durable pre-synthesis inspection result. Only its conflicting v3 coverage entries appear as triggers; an empty trigger list grants no research. When both researchInput.triggers and restudyInput.candidates are empty, the same artifact_read result sets requiredNextAction to study_synthesize and the host closes every other root tool. Call study_synthesize immediately with only synthesisInput.inputId; do not deliberate, retry, or make another tool call. When an exact restudy candidate remains, synthesis is still the default; you may instead request one single bounded pass before synthesis. Each admission has exactly one read authority, so never repeat artifact_read. study_research_request is optional and available only by copying one exact non-empty researchInput inputId and triggerId. The host mints the research grant, fixes the gap binding, domain allowlist, budgets, and child contract. Search snippets are routing hints and never citations; receipted document spans stay cite-only external context. Research never becomes claim support, caption text, transcript authority, truth, or a quality claim."] : []),
        ...(computerUseEnabled ? ["study_computer_use_request is available only after R1 records a typed empty-query exhaustion cause for the same current conflict. Echo only the returned inputId and candidateId. The host fixes one sealed offline fixture, read-only transitions, child contract, grant, and limits. A selected screen region is cite-only media context. It is not live state, truth, speech evidence, claim support, coverage support, caption text, or quality authority."] : []),
        "More passes, tokens, agents, or a role label do not imply understanding. Support can arise only from pass-new range-closing current-run speech citations. Exhausted evidence remains unknown, withheld, or unavailable for that range while unrelated ranges continue. The deterministic readiness v4 audit runs only after the executor receipt closes.",
      ] : [
        "This root does not have study_planning_decision or study_restudy_request. The deterministic readiness v3 audit runs only after the executor receipt closes; you do not choose readiness or caption authority.",
      ]),
    ] : []),
    "If any spawn is accepted, call task_reports_wait before returning. Do not treat scheduler acceptance, worker count, signal, VAD, language ID, or a report identity as semantic understanding, transcription, translation, or quality.",
    "Only when requiresDelegation is false and no child request is warranted, make no spawn call and return outcome no_request with a deliberate reason. If a child fails or is interrupted without a reported host-authorized replacement, preserve that state and return withheld.",
    requiresStudySynthesis
      ? "Return only the JSON required by the supplied output schema after the study_synthesize call. No captions, publication, quality score, truth arbitration, or UI action is authorized."
      : "Return only the JSON required by the supplied output schema. No synthesis, captions, publication, or UI action is authorized.",
    JSON.stringify(contract),
  ].join("\n\n");
}
