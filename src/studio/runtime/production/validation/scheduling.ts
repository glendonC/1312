import {
  CAPABILITIES,
  type AgentRecord,
  type Capability,
  type CapabilityGrant,
  type EvidenceAssessmentScope,
  type EvidenceDecisionScope,
  type EvidenceReadScope,
  type MediaScope,
  type OrchestratorSpawnContract,
  type RequiredOutput,
  type RuntimeBudget,
  type RuntimeLimits,
  type SpawnRequestInput,
  type TaskRecord,
  type TaskJobContext,
  type WorkerKind,
} from "../model.ts";
import {
  array,
  boolean,
  contentId,
  exact,
  fail,
  integer,
  nullableString,
  object,
  oneOf,
  string,
  uniqueStrings,
} from "./primitives.ts";
import { expectedTaskJobContextId } from "../jobContext.ts";

const CAPABILITY_SET = new Set<string>(CAPABILITIES);
export const TASK_STATUSES = new Set([
  "scheduled",
  "working",
  "waiting_for_children",
  "reported",
  "completed",
  "failed",
  "withheld",
  "interrupted",
]);
export const AGENT_STATUSES = new Set(["registered", "working", "reporting", "retired"]);
export const WORKER_KINDS = new Set([
  "orchestrator",
  "media",
  "analysis",
  "translation",
  "quality",
]);
const TRACK_KINDS = new Set(["audio", "video", "subtitle", "data", "attachment"]);
const EVIDENCE_KINDS = new Set(["speech_activity", "language_ranges"]);
export const MAX_EVIDENCE_READ_BYTES = 32 * 1024;
export const MAX_EVIDENCE_READ_ITEMS = 64;
export const MAX_EVIDENCE_ASSESSMENTS = 1;
export const MAX_EVIDENCE_ASSESS_READ_RECEIPTS = 4;
export const MAX_EVIDENCE_ASSESS_CLAIMS = 8;
export const MAX_EVIDENCE_ASSESS_CITATIONS = 32;
export const MAX_EVIDENCE_ASSESS_TOKENS = 512;
export const MAX_EVIDENCE_DECISIONS = 1;
export const MAX_EVIDENCE_DECISION_AUDITED_ASSESSMENTS = 4;

const ROLE_CAPABILITIES: Record<WorkerKind, ReadonlySet<Capability>> = {
  orchestrator: new Set(["task.spawn.request", "task.reports.wait"]),
  media: new Set(["media.extract", "media.seek", "report.submit"]),
  analysis: new Set([
    "media.seek",
    "evidence.read",
    "analysis.evidence.assess",
    "analysis.evidence.decide",
    "report.submit",
  ]),
  translation: new Set(["media.seek", "evidence.read", "report.submit"]),
  quality: new Set([
    "media.seek",
    "evidence.read",
    "analysis.evidence.assess",
    "analysis.evidence.decide",
    "report.submit",
  ]),
};

export function roleAllowsCapabilities(workerKind: WorkerKind, capabilities: readonly Capability[]): boolean {
  return capabilities.every((capability) => ROLE_CAPABILITIES[workerKind].has(capability));
}

function budget(value: unknown, context: string, path: string): asserts value is RuntimeBudget {
  const item = object(value, context, path);
  exact(item, ["wallMs", "toolCalls"], context, path);
  integer(item.wallMs, context, `${path}.wallMs`, 1);
  integer(item.toolCalls, context, `${path}.toolCalls`, 1);
}

function scope(value: unknown, context: string, path: string): asserts value is MediaScope {
  const item = object(value, context, path);
  exact(item, ["artifactId", "trackId", "startMs", "endMs"], context, path);
  string(item.artifactId, context, `${path}.artifactId`);
  string(item.trackId, context, `${path}.trackId`);
  const start = integer(item.startMs, context, `${path}.startMs`);
  const end = integer(item.endMs, context, `${path}.endMs`, 1);
  if (end <= start) fail(context, path, "must be a non-empty half-open range");
}

function scopes(value: unknown, context: string, path: string): MediaScope[] {
  const result = array(value, context, path);
  result.forEach((item, index) => scope(item, context, `${path}[${index}]`));
  const keys = result.map((item) => {
    const range = item as MediaScope;
    return `${range.artifactId}\u0000${range.trackId}\u0000${range.startMs}\u0000${range.endMs}`;
  });
  if (new Set(keys).size !== keys.length) fail(context, path, "must not repeat a scope");
  return result as MediaScope[];
}

function evidenceScope(value: unknown, context: string, path: string): asserts value is EvidenceReadScope {
  const item = object(value, context, path);
  exact(
    item,
    ["artifactId", "evidenceKind", "sourceArtifactId", "startMs", "endMs", "maxBytes", "maxItems"],
    context,
    path,
  );
  string(item.artifactId, context, `${path}.artifactId`);
  oneOf(item.evidenceKind, EVIDENCE_KINDS, context, `${path}.evidenceKind`);
  string(item.sourceArtifactId, context, `${path}.sourceArtifactId`);
  const startMs = integer(item.startMs, context, `${path}.startMs`);
  const endMs = integer(item.endMs, context, `${path}.endMs`, 1);
  if (endMs <= startMs) fail(context, path, "must contain a non-empty source window");
  const maxBytes = integer(item.maxBytes, context, `${path}.maxBytes`, 1);
  const maxItems = integer(item.maxItems, context, `${path}.maxItems`, 1);
  if (maxBytes > MAX_EVIDENCE_READ_BYTES) {
    fail(context, `${path}.maxBytes`, `must not exceed ${MAX_EVIDENCE_READ_BYTES}`);
  }
  if (maxItems > MAX_EVIDENCE_READ_ITEMS) {
    fail(context, `${path}.maxItems`, `must not exceed ${MAX_EVIDENCE_READ_ITEMS}`);
  }
}

function evidenceScopes(value: unknown, context: string, path: string): EvidenceReadScope[] {
  const result = array(value, context, path);
  result.forEach((item, index) => evidenceScope(item, context, `${path}[${index}]`));
  const ids = result.map((item) => (item as EvidenceReadScope).artifactId);
  if (new Set(ids).size !== ids.length) fail(context, path, "must not repeat an evidence artifact");
  return result as EvidenceReadScope[];
}

function assessmentScope(
  value: unknown,
  context: string,
  path: string,
): EvidenceAssessmentScope | null {
  if (value === null) return null;
  const item = object(value, context, path);
  exact(
    item,
    ["evidenceArtifactIds", "maxAssessments", "maxReadReceipts", "maxClaims", "maxCitations", "maxTokens"],
    context,
    path,
  );
  const evidenceArtifactIds = uniqueStrings(item.evidenceArtifactIds, context, `${path}.evidenceArtifactIds`);
  if (evidenceArtifactIds.length === 0) fail(context, `${path}.evidenceArtifactIds`, "must name assessment evidence");
  const maxAssessments = integer(item.maxAssessments, context, `${path}.maxAssessments`, 1);
  const maxReadReceipts = integer(item.maxReadReceipts, context, `${path}.maxReadReceipts`, 1);
  const maxClaims = integer(item.maxClaims, context, `${path}.maxClaims`, 1);
  const maxCitations = integer(item.maxCitations, context, `${path}.maxCitations`, 1);
  const maxTokens = integer(item.maxTokens, context, `${path}.maxTokens`, 1);
  if (
    maxAssessments > MAX_EVIDENCE_ASSESSMENTS ||
    maxReadReceipts > MAX_EVIDENCE_ASSESS_READ_RECEIPTS ||
    maxClaims > MAX_EVIDENCE_ASSESS_CLAIMS ||
    maxCitations > MAX_EVIDENCE_ASSESS_CITATIONS ||
    maxTokens > MAX_EVIDENCE_ASSESS_TOKENS
  ) fail(context, path, "exceeds hard evidence-assessment bounds");
  return item as unknown as EvidenceAssessmentScope;
}

function decisionScope(value: unknown, context: string, path: string): EvidenceDecisionScope | null {
  if (value === null) return null;
  const item = object(value, context, path);
  exact(item, ["maxDecisions", "maxAuditedAssessments"], context, path);
  const maxDecisions = integer(item.maxDecisions, context, `${path}.maxDecisions`, 1);
  const maxAuditedAssessments = integer(item.maxAuditedAssessments, context, `${path}.maxAuditedAssessments`, 1);
  if (
    maxDecisions > MAX_EVIDENCE_DECISIONS ||
    maxAuditedAssessments > MAX_EVIDENCE_DECISION_AUDITED_ASSESSMENTS
  ) fail(context, path, "exceeds hard evidence-decision bounds");
  return item as unknown as EvidenceDecisionScope;
}

function outputs(value: unknown, context: string, path: string): RequiredOutput[] {
  const result = array(value, context, path);
  result.forEach((entry, index) => {
    const item = object(entry, context, `${path}[${index}]`);
    exact(item, ["name", "artifactKind", "required"], context, `${path}[${index}]`);
    string(item.name, context, `${path}[${index}].name`);
    string(item.artifactKind, context, `${path}[${index}].artifactKind`);
    boolean(item.required, context, `${path}[${index}].required`);
  });
  const names = result.map((entry) => (entry as RequiredOutput).name);
  if (new Set(names).size !== names.length) fail(context, path, "must not repeat output names");
  return result as RequiredOutput[];
}

function capabilities(value: unknown, context: string, path: string): Capability[] {
  const values = uniqueStrings(value, context, path);
  values.forEach((entry, index) =>
    oneOf<Capability>(entry, CAPABILITY_SET, context, `${path}[${index}]`),
  );
  return values as Capability[];
}

function grant(value: unknown, context: string, path: string): asserts value is CapabilityGrant {
  const item = object(value, context, path);
  exact(item, ["id", "capability", "taskId", "agentId", "mediaScope", "evidenceScope", "assessmentScope", "decisionScope"], context, path);
  string(item.id, context, `${path}.id`);
  const capability = oneOf<Capability>(
    item.capability,
    CAPABILITY_SET,
    context,
    `${path}.capability`,
  );
  string(item.taskId, context, `${path}.taskId`);
  string(item.agentId, context, `${path}.agentId`);
  const mediaScope = scopes(item.mediaScope, context, `${path}.mediaScope`);
  const readScope = evidenceScopes(item.evidenceScope, context, `${path}.evidenceScope`);
  const assessScope = assessmentScope(item.assessmentScope, context, `${path}.assessmentScope`);
  const decideScope = decisionScope(item.decisionScope, context, `${path}.decisionScope`);
  if (capability.startsWith("media.") && mediaScope.length === 0) {
    fail(context, path, "media grants require scope");
  }
  if (!capability.startsWith("media.") && mediaScope.length !== 0) {
    fail(context, path, "non-media grants cannot carry scope");
  }
  if (capability === "evidence.read" && readScope.length === 0) {
    fail(context, path, "evidence.read grants require evidence scope");
  }
  if (capability !== "evidence.read" && readScope.length !== 0) {
    fail(context, path, "non-evidence grants cannot carry evidence scope");
  }
  if (capability === "analysis.evidence.assess" && assessScope === null) {
    fail(context, path, "analysis.evidence.assess grants require assessment scope");
  }
  if (capability !== "analysis.evidence.assess" && assessScope !== null) {
    fail(context, path, "non-assessment grants cannot carry assessment scope");
  }
  if (capability === "analysis.evidence.decide" && decideScope === null) {
    fail(context, path, "analysis.evidence.decide grants require decision scope");
  }
  if (capability !== "analysis.evidence.decide" && decideScope !== null) {
    fail(context, path, "non-decision grants cannot carry decision scope");
  }
}

export function validateGrants(
  value: unknown,
  context: string,
  path: string,
): CapabilityGrant[] {
  const result = array(value, context, path);
  result.forEach((entry, index) => grant(entry, context, `${path}[${index}]`));
  const ids = result.map((entry) => (entry as CapabilityGrant).id);
  const names = result.map((entry) => (entry as CapabilityGrant).capability);
  if (new Set(ids).size !== ids.length) fail(context, path, "must not repeat grant ids");
  if (new Set(names).size !== names.length) fail(context, path, "must not repeat capabilities");
  return result as CapabilityGrant[];
}

function track(value: unknown, context: string, path: string): void {
  const item = object(value, context, path);
  exact(item, ["id", "index", "kind", "codec", "durationMs"], context, path);
  string(item.id, context, `${path}.id`);
  integer(item.index, context, `${path}.index`);
  oneOf(item.kind, TRACK_KINDS, context, `${path}.kind`);
  string(item.codec, context, `${path}.codec`);
  if (item.durationMs !== null) integer(item.durationMs, context, `${path}.durationMs`, 1);
}

export function validateTracks(value: unknown, context: string, path: string): void {
  const result = array(value, context, path);
  result.forEach((entry, index) => track(entry, context, `${path}[${index}]`));
  const ids = result.map((entry) => (entry as { id: string }).id);
  const indexes = result.map((entry) => (entry as { index: number }).index);
  if (new Set(ids).size !== ids.length || new Set(indexes).size !== indexes.length) {
    fail(context, path, "must contain unique track ids and indexes");
  }
}

export function assertRuntimeLimits(
  value: unknown,
  context = "Runtime limits",
): asserts value is RuntimeLimits {
  const item = object(value, context, "limits");
  exact(
    item,
    ["maxDepth", "maxActiveWorkers", "runBudget", "grantableCapabilities"],
    context,
    "limits",
  );
  integer(item.maxDepth, context, "limits.maxDepth");
  integer(item.maxActiveWorkers, context, "limits.maxActiveWorkers", 1);
  budget(item.runBudget, context, "limits.runBudget");
  capabilities(item.grantableCapabilities, context, "limits.grantableCapabilities");
}

export function assertSpawnRequestInput(
  value: unknown,
  context = "Spawn request",
): asserts value is SpawnRequestInput {
  const item = object(value, context, "input");
  exact(
    item,
    [
      "workloadKey",
      "objective",
      "workerKind",
      "workerLabel",
      "mediaScope",
      "inputArtifactIds",
      "requiredOutputs",
      "requiredCapabilities",
      "dependencies",
      "budget",
    ],
    context,
    "input",
  );
  string(item.workloadKey, context, "input.workloadKey");
  string(item.objective, context, "input.objective");
  oneOf(item.workerKind, WORKER_KINDS, context, "input.workerKind");
  string(item.workerLabel, context, "input.workerLabel");
  scopes(item.mediaScope, context, "input.mediaScope");
  uniqueStrings(item.inputArtifactIds, context, "input.inputArtifactIds");
  outputs(item.requiredOutputs, context, "input.requiredOutputs");
  capabilities(item.requiredCapabilities, context, "input.requiredCapabilities");
  uniqueStrings(item.dependencies, context, "input.dependencies");
  budget(item.budget, context, "input.budget");
}

export function assertOrchestratorSpawnContract(
  value: unknown,
  context = "Orchestrator spawn contract",
): asserts value is OrchestratorSpawnContract {
  const item = object(value, context, "input");
  exact(
    item,
    [
      "workloadKey",
      "objective",
      "workerKind",
      "workerLabel",
      "mediaScope",
      "inputArtifactIds",
      "requiredOutputs",
      "requiredCapabilities",
      "dependencyWorkloadKeys",
      "budget",
    ],
    context,
    "input",
  );
  string(item.workloadKey, context, "input.workloadKey");
  string(item.objective, context, "input.objective");
  oneOf(item.workerKind, WORKER_KINDS, context, "input.workerKind");
  string(item.workerLabel, context, "input.workerLabel");
  scopes(item.mediaScope, context, "input.mediaScope");
  uniqueStrings(item.inputArtifactIds, context, "input.inputArtifactIds");
  outputs(item.requiredOutputs, context, "input.requiredOutputs");
  capabilities(item.requiredCapabilities, context, "input.requiredCapabilities");
  uniqueStrings(item.dependencyWorkloadKeys, context, "input.dependencyWorkloadKeys");
  budget(item.budget, context, "input.budget");
}

function languageTag(value: unknown, context: string, path: string): string {
  const result = string(value, context, path);
  if (!/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(result)) {
    fail(context, path, "must be a BCP-47 language tag");
  }
  return result;
}

function range(value: unknown, context: string, path: string): { startMs: number; endMs: number } {
  const item = object(value, context, path);
  exact(item, ["startMs", "endMs"], context, path);
  const startMs = integer(item.startMs, context, `${path}.startMs`);
  const endMs = integer(item.endMs, context, `${path}.endMs`, 1);
  if (endMs <= startMs) fail(context, path, "must be a non-empty half-open range");
  return { startMs, endMs };
}

export function assertTaskJobContext(
  value: unknown,
  context = "Task job context",
  path = "jobContext",
): asserts value is TaskJobContext {
  const item = object(value, context, path);
  exact(item, [
    "schema", "contextId", "source", "analysisRequest", "requestedSourceLanguagePolicy",
    "targetLanguage", "selectedLanguagePackId", "outputDepth", "detectorEvidence",
  ], context, path);
  if (item.schema !== "studio.task-job-context.v1") fail(context, `${path}.schema`, "is unsupported");
  const contextIdValue = string(item.contextId, context, `${path}.contextId`);
  if (!/^job-context:[a-f0-9]{64}$/.test(contextIdValue)) fail(context, `${path}.contextId`, "is malformed");
  const source = object(item.source, context, `${path}.source`);
  exact(source, ["artifactId", "contentId"], context, `${path}.source`);
  string(source.artifactId, context, `${path}.source.artifactId`);
  contentId(source.contentId, context, `${path}.source.contentId`);
  const analysis = object(item.analysisRequest, context, `${path}.analysisRequest`);
  exact(analysis, ["requestId", "requestedRange", "taskRange", "options"], context, `${path}.analysisRequest`);
  string(analysis.requestId, context, `${path}.analysisRequest.requestId`);
  const requestedRange = range(analysis.requestedRange, context, `${path}.analysisRequest.requestedRange`);
  const taskRange = range(analysis.taskRange, context, `${path}.analysisRequest.taskRange`);
  if (taskRange.startMs < requestedRange.startMs || taskRange.endMs > requestedRange.endMs) {
    fail(context, `${path}.analysisRequest.taskRange`, "cannot broaden the requested range");
  }
  const options = object(analysis.options, context, `${path}.analysisRequest.options`);
  exact(options, ["speechScope", "includeLyrics", "speaker", "honorifics", "translationStyle", "captionDensity", "slowAnalysis"], context, `${path}.analysisRequest.options`);
  oneOf(options.speechScope, new Set(["foreground", "all"]), context, `${path}.analysisRequest.options.speechScope`);
  boolean(options.includeLyrics, context, `${path}.analysisRequest.options.includeLyrics`);
  nullableString(options.speaker, context, `${path}.analysisRequest.options.speaker`);
  oneOf(options.honorifics, new Set(["preserve", "naturalize"]), context, `${path}.analysisRequest.options.honorifics`);
  oneOf(options.translationStyle, new Set(["literal", "natural"]), context, `${path}.analysisRequest.options.translationStyle`);
  oneOf(options.captionDensity, new Set(["compact", "balanced", "relaxed"]), context, `${path}.analysisRequest.options.captionDensity`);
  boolean(options.slowAnalysis, context, `${path}.analysisRequest.options.slowAnalysis`);
  const requestedSource = object(item.requestedSourceLanguagePolicy, context, `${path}.requestedSourceLanguagePolicy`);
  exact(requestedSource, ["mode", "languages", "reason"], context, `${path}.requestedSourceLanguagePolicy`);
  const mode = oneOf<string>(requestedSource.mode, new Set(["declared", "automatic", "mixed", "unknown", "withheld"]), context, `${path}.requestedSourceLanguagePolicy.mode`);
  const languages = array(requestedSource.languages, context, `${path}.requestedSourceLanguagePolicy.languages`).map((entry, index) => languageTag(entry, context, `${path}.requestedSourceLanguagePolicy.languages[${index}]`));
  if (new Set(languages).size !== languages.length) fail(context, `${path}.requestedSourceLanguagePolicy.languages`, "must not repeat languages");
  const reason = requestedSource.reason === null ? null : string(requestedSource.reason, context, `${path}.requestedSourceLanguagePolicy.reason`);
  if (mode === "declared" && (languages.length !== 1 || reason !== null)) fail(context, `${path}.requestedSourceLanguagePolicy`, "declared mode is malformed");
  if (mode === "mixed" && (languages.length < 2 || reason !== null)) fail(context, `${path}.requestedSourceLanguagePolicy`, "mixed mode is malformed");
  if ((mode === "automatic" || mode === "unknown") && (languages.length !== 0 || reason !== null)) fail(context, `${path}.requestedSourceLanguagePolicy`, `${mode} mode is malformed`);
  if (mode === "withheld" && (languages.length !== 0 || reason === null)) fail(context, `${path}.requestedSourceLanguagePolicy`, "withheld mode is malformed");
  languageTag(item.targetLanguage, context, `${path}.targetLanguage`);
  nullableString(item.selectedLanguagePackId, context, `${path}.selectedLanguagePackId`);
  oneOf(item.outputDepth, new Set(["captions", "evidence"]), context, `${path}.outputDepth`);
  const evidence = array(item.detectorEvidence, context, `${path}.detectorEvidence`);
  const evidenceIds: string[] = [];
  for (const [index, entry] of evidence.entries()) {
    const evidenceItem = object(entry, context, `${path}.detectorEvidence[${index}]`);
    exact(evidenceItem, ["artifactId", "contentId", "evidenceKind"], context, `${path}.detectorEvidence[${index}]`);
    evidenceIds.push(string(evidenceItem.artifactId, context, `${path}.detectorEvidence[${index}].artifactId`));
    contentId(evidenceItem.contentId, context, `${path}.detectorEvidence[${index}].contentId`);
    oneOf(evidenceItem.evidenceKind, EVIDENCE_KINDS, context, `${path}.detectorEvidence[${index}].evidenceKind`);
  }
  if (new Set(evidenceIds).size !== evidenceIds.length) fail(context, `${path}.detectorEvidence`, "must not repeat artifacts");
  if (contextIdValue !== expectedTaskJobContextId(item as unknown as TaskJobContext)) {
    fail(context, `${path}.contextId`, "does not match the immutable context body");
  }
}

export function assertTaskRecord(
  value: unknown,
  context: string,
  path: string,
): asserts value is TaskRecord {
  const item = object(value, context, path);
  exact(
    item,
    [
      "id",
      "runId",
      "workloadKey",
      "objective",
      "workerKind",
      "workerLabel",
      "parentTaskId",
      "parentAgentId",
      "depth",
      "assignedAgentId",
      "ownerAgentId",
      "jobContext",
      "mediaScope",
      "inputArtifactIds",
      "requiredOutputs",
      "dependencies",
      "budget",
      "grants",
      "status",
      "terminalReason",
    ],
    context,
    path,
  );
  string(item.id, context, `${path}.id`);
  string(item.runId, context, `${path}.runId`);
  string(item.workloadKey, context, `${path}.workloadKey`);
  string(item.objective, context, `${path}.objective`);
  const workerKind = oneOf<WorkerKind>(item.workerKind, WORKER_KINDS, context, `${path}.workerKind`);
  string(item.workerLabel, context, `${path}.workerLabel`);
  nullableString(item.parentTaskId, context, `${path}.parentTaskId`);
  nullableString(item.parentAgentId, context, `${path}.parentAgentId`);
  integer(item.depth, context, `${path}.depth`);
  string(item.assignedAgentId, context, `${path}.assignedAgentId`);
  nullableString(item.ownerAgentId, context, `${path}.ownerAgentId`);
  assertTaskJobContext(item.jobContext, context, `${path}.jobContext`);
  scopes(item.mediaScope, context, `${path}.mediaScope`);
  uniqueStrings(item.inputArtifactIds, context, `${path}.inputArtifactIds`);
  outputs(item.requiredOutputs, context, `${path}.requiredOutputs`);
  uniqueStrings(item.dependencies, context, `${path}.dependencies`);
  budget(item.budget, context, `${path}.budget`);
  const grants = validateGrants(item.grants, context, `${path}.grants`);
  if (!roleAllowsCapabilities(workerKind, grants.map((grant) => grant.capability))) {
    fail(context, `${path}.grants`, "contains a capability outside the worker role");
  }
  oneOf(item.status, TASK_STATUSES, context, `${path}.status`);
  nullableString(item.terminalReason, context, `${path}.terminalReason`);
}

export function assertAgentRecord(
  value: unknown,
  context: string,
  path: string,
): asserts value is AgentRecord {
  const item = object(value, context, path);
  exact(
    item,
    ["id", "taskId", "parentTaskId", "parentAgentId", "kind", "label", "grants", "status"],
    context,
    path,
  );
  string(item.id, context, `${path}.id`);
  string(item.taskId, context, `${path}.taskId`);
  nullableString(item.parentTaskId, context, `${path}.parentTaskId`);
  nullableString(item.parentAgentId, context, `${path}.parentAgentId`);
  const kind = oneOf<WorkerKind>(item.kind, WORKER_KINDS, context, `${path}.kind`);
  string(item.label, context, `${path}.label`);
  const grants = validateGrants(item.grants, context, `${path}.grants`);
  if (!roleAllowsCapabilities(kind, grants.map((grant) => grant.capability))) {
    fail(context, `${path}.grants`, "contains a capability outside the worker role");
  }
  oneOf(item.status, AGENT_STATUSES, context, `${path}.status`);
}
