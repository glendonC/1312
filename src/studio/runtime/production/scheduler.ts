import { randomBytes, randomUUID } from "node:crypto";

import { assertRuntimeLimits, assertSpawnRequestInput } from "./assertions.ts";
import { attenuateTaskJobContext } from "./jobContext.ts";
import { COMPUTER_USE_LIMITS, CONDITIONAL_SEPARATION_LIMITS, FRAME_SAMPLING_LIMITS, OCR_LIMITS, RESEARCH_LIMITS, SEPARATION_METHOD, SPEAKER_OVERLAP_LIMITS } from "./model.ts";
import type {
  AnyResearchTriggerOption,
  ResearchGrantScope,
  ResearchTriggerOption,
  AgentRecord,
  CapabilityGrant,
  LaunchPermit,
  MediaScope,
  OrchestratorSpawnContract,
  RuntimeLimits,
  RuntimeProjection,
  SpawnRejection,
  SpawnRequestInput,
  TaskRecord,
  TaskJobContext,
  TaskLaunchRecord,
  TaskStatus,
  RangePassRequestReceipt,
  ConditionalSeparationGrantScope,
  ConditionalSeparationTrigger,
  RuntimeArtifact,
  ComputerUseDriverIdentity,
  ComputerUseGrantScope,
  ComputerUseRequestCandidate,
  ComputerUseSurface,
} from "./model.ts";
import type { RuntimeLedger } from "./journal.ts";
import { currentRestudiedResearchBasis } from "./research/restudiedResearchBasis.ts";
import { u1AcousticTriggerLineageMatches } from "./separation/acousticSeparationTrigger.ts";
import type { PendingRuntimeEvent } from "./protocol.ts";
import {
  MAX_EVIDENCE_ASSESSMENTS,
  MAX_EVIDENCE_ASSESS_CITATIONS,
  MAX_EVIDENCE_ASSESS_CLAIMS,
  MAX_EVIDENCE_ASSESS_READ_RECEIPTS,
  MAX_EVIDENCE_ASSESS_TOKENS,
  MAX_EVIDENCE_DECISIONS,
  MAX_EVIDENCE_DECISION_AUDITED_ASSESSMENTS,
  MAX_EVIDENCE_READ_BYTES,
  MAX_EVIDENCE_READ_ITEMS,
  roleAllowsCapabilities,
  assertOrchestratorSpawnContract,
  assertTaskJobContext,
} from "./validation/scheduling.ts";
import { validateRangePassRequestReceipt } from "./validation/studiesV3.ts";
import {
  researchRequestInputId,
  researchTriggerId,
  validateResearchAllowedDomains,
  validateResearchTriggerOption,
  validateRestudiedResearchTriggerOption,
} from "./validation/research.ts";
import { computerUseCandidateId, validateComputerUseDriver, validateComputerUseSurface } from "./validation/computerUse.ts";
import { VISUAL_TRANSITION_LIMITS } from "./model/visualTransitions.ts";

export interface RuntimeIdentityFactory {
  next(kind: "request" | "task" | "agent" | "grant"): string;
  secret(): string;
}

export class RandomRuntimeIdentityFactory implements RuntimeIdentityFactory {
  next(kind: "request" | "task" | "agent" | "grant"): string {
    return `${kind}:${randomUUID()}`;
  }

  secret(): string {
    return randomBytes(32).toString("hex");
  }
}

function active(status: TaskStatus): boolean {
  return status === "scheduled" || status === "working" || status === "waiting_for_children" || status === "reported";
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function scopeContains(parent: MediaScope, child: MediaScope): boolean {
  return (
    parent.artifactId === child.artifactId &&
    parent.trackId === child.trackId &&
    child.startMs >= parent.startMs &&
    child.endMs <= parent.endMs
  );
}

function allocated(state: RuntimeProjection): { wallMs: number; toolCalls: number } {
  return Object.values(state.tasks).reduce(
    (total, task) => ({
      wallMs: total.wallMs + task.budget.wallMs,
      toolCalls: total.toolCalls + task.budget.toolCalls,
    }),
    { wallMs: 0, toolCalls: 0 },
  );
}

function evidenceWindow(
  state: RuntimeProjection,
  input: SpawnRequestInput,
  evidenceArtifactId: string,
): { sourceArtifactId: string; startMs: number; endMs: number } | null {
  const artifact = state.artifacts[evidenceArtifactId];
  if (artifact?.origin.kind !== "preflight_evidence" || artifact.sourceArtifactIds.length !== 1) return null;
  const sourceArtifactId = artifact.sourceArtifactIds[0];
  const windows = new Map(
    input.mediaScope
      .filter((scope) => scope.artifactId === sourceArtifactId)
      .map((scope) => [`${scope.startMs}:${scope.endMs}`, scope] as const),
  );
  if (windows.size !== 1) return null;
  const window = [...windows.values()][0];
  return { sourceArtifactId, startMs: window.startMs, endMs: window.endMs };
}

export interface SpawnDecision {
  requestId: string;
  accepted: boolean;
  rejection: SpawnRejection | null;
  permit: LaunchPermit | null;
}

export interface TaskLaunchClaimResult {
  won: boolean;
  claim: TaskLaunchRecord;
}

export class BoundedRuntimeScheduler {
  private readonly permits = new Map<string, LaunchPermit>();
  private readonly ledger: RuntimeLedger;
  private readonly limits: RuntimeLimits;
  private readonly identities: RuntimeIdentityFactory;
  /** Host-policy egress allowlist for minted research grants. Never model-authored; empty means no egress. */
  private readonly researchAllowedDomains: string[];
  private readonly computerUsePolicy: { surface: ComputerUseSurface; driver: ComputerUseDriverIdentity } | null;

  constructor(
    ledger: RuntimeLedger,
    limits: RuntimeLimits,
    identities: RuntimeIdentityFactory = new RandomRuntimeIdentityFactory(),
    policies: {
      researchAllowedDomains?: readonly string[];
      computerUse?: { surface: ComputerUseSurface; driver: ComputerUseDriverIdentity };
    } = {},
  ) {
    this.ledger = ledger;
    this.limits = limits;
    this.identities = identities;
    assertRuntimeLimits(limits);
    this.researchAllowedDomains = policies.researchAllowedDomains === undefined
      ? []
      : validateResearchAllowedDomains([...policies.researchAllowedDomains], "Scheduler research policy", "researchAllowedDomains");
    this.computerUsePolicy = policies.computerUse === undefined ? null : {
      surface: validateComputerUseSurface(policies.computerUse.surface, "Scheduler computer-use policy", "surface"),
      driver: validateComputerUseDriver(policies.computerUse.driver, "Scheduler computer-use policy", "driver"),
    };
  }

  private grants(
    state: RuntimeProjection,
    taskId: string,
    agentId: string,
    input: SpawnRequestInput,
    conditionalSeparationScope: ConditionalSeparationGrantScope | null = null,
    researchScope: ResearchGrantScope | null = null,
    computerUseScope: ComputerUseGrantScope | null = null,
  ): CapabilityGrant[] {
    return [...input.requiredCapabilities]
      .sort()
      .map((capability): CapabilityGrant => {
        const common = {
          id: this.identities.next("grant"),
          taskId,
          agentId,
          mediaScope: capability.startsWith("media.") || capability === "speech.transcribe"
            ? structuredClone(input.mediaScope)
            : [],
          evidenceScope: capability === "evidence.read"
            ? input.inputArtifactIds
                .map((artifactId) => state.artifacts[artifactId])
                .filter((artifact) => artifact?.origin.kind === "preflight_evidence")
                .map((artifact) => {
                  if (artifact.origin.kind !== "preflight_evidence") {
                    throw new Error("Scheduler evidence scope changed during grant construction");
                  }
                  const window = evidenceWindow(state, input, artifact.id);
                  if (!window) throw new Error("Scheduler evidence scope lost its exact source window");
                  return {
                    artifactId: artifact.id,
                    evidenceKind: artifact.origin.evidenceKind,
                    ...window,
                    maxBytes: MAX_EVIDENCE_READ_BYTES,
                    maxItems: MAX_EVIDENCE_READ_ITEMS,
                  };
                })
                .sort((left, right) => left.artifactId.localeCompare(right.artifactId))
            : [],
          assessmentScope: capability === "analysis.evidence.assess"
            ? {
                evidenceArtifactIds: input.inputArtifactIds
                  .filter((artifactId) => {
                    const artifact = state.artifacts[artifactId];
                    return artifact?.origin.kind === "preflight_evidence" && artifact.origin.evidenceKind !== "acoustic_ranges";
                  })
                  .sort(),
                maxAssessments: MAX_EVIDENCE_ASSESSMENTS,
                maxReadReceipts: MAX_EVIDENCE_ASSESS_READ_RECEIPTS,
                maxClaims: MAX_EVIDENCE_ASSESS_CLAIMS,
                maxCitations: MAX_EVIDENCE_ASSESS_CITATIONS,
                maxTokens: MAX_EVIDENCE_ASSESS_TOKENS,
              }
            : null,
          decisionScope: capability === "analysis.evidence.decide"
            ? {
                maxDecisions: MAX_EVIDENCE_DECISIONS,
                maxAuditedAssessments: MAX_EVIDENCE_DECISION_AUDITED_ASSESSMENTS,
              }
            : null,
        };
        if (capability === "media.frames.sample") return {
          ...common,
          capability,
          frameScope: {
            schema: "studio.frame-sampling-grant.v1" as const,
            limits: structuredClone(FRAME_SAMPLING_LIMITS),
          },
        };
        if (capability === "media.frames.ocr") return {
          ...common,
          capability,
          ocrScope: {
            schema: "studio.ocr-grant.v1" as const,
            limits: structuredClone(OCR_LIMITS),
          },
        };
        if (capability === "media.visual-transitions.analyze") return {
          ...common,
          capability,
          visualTransitionScope: {
            schema: "studio.visual-transition-grant.v1" as const,
            limits: structuredClone(VISUAL_TRANSITION_LIMITS),
          },
        };
        if (capability === "media.speakers.analyze") return {
          ...common,
          capability,
          speakerScope: {
            schema: "studio.speaker-overlap-grant.v1" as const,
            limits: structuredClone(SPEAKER_OVERLAP_LIMITS),
          },
        };
        if (capability === "media.audio.separate") {
          if (!conditionalSeparationScope) throw new Error("Conditional separation grants require an audited exact-range scope");
          return { ...common, capability, separationScope: structuredClone(conditionalSeparationScope) };
        }
        if (capability === "research.investigate") {
          if (!researchScope) throw new Error("Research grants require an audited gap-bound scope");
          return { ...common, capability, researchScope: structuredClone(researchScope) };
        }
        if (capability === "computer.use.readonly") {
          if (!computerUseScope) throw new Error("Computer-use grants require an audited cause-bound scope");
          return { ...common, capability, computerUseScope: structuredClone(computerUseScope) };
        }
        return { ...common, capability };
      });
  }

  private scopeValid(state: RuntimeProjection, input: SpawnRequestInput): boolean {
    if (!input.mediaScope.every((scope) => input.inputArtifactIds.includes(scope.artifactId))) return false;
    return input.mediaScope.every((scope) => {
      const artifact = state.artifacts[scope.artifactId];
      return (
        artifact &&
        artifact.tracks.some((track) => track.id === scope.trackId) &&
        scope.endMs <= (artifact.durationMs ?? 0)
      );
    });
  }

  private capabilityValid(state: RuntimeProjection, input: SpawnRequestInput, allowConditionalSeparation = false, allowResearch = false, allowComputerUse = false): boolean {
    const evidenceArtifacts = input.inputArtifactIds.filter(
      (artifactId) => state.artifacts[artifactId]?.origin.kind === "preflight_evidence",
    );
    const frameScope = input.requiredCapabilities.includes("media.frames.sample")
      ? input.mediaScope.length === 1 ? input.mediaScope[0] : null
      : undefined;
    const frameArtifact = frameScope ? state.artifacts[frameScope.artifactId] : null;
    const frameTrack = frameArtifact?.tracks.find((track) => track.id === frameScope?.trackId);
    const speakerScope = input.requiredCapabilities.includes("media.speakers.analyze")
      ? input.mediaScope.length === 1 ? input.mediaScope[0] : null
      : undefined;
    const speakerArtifact = speakerScope ? state.artifacts[speakerScope.artifactId] : null;
    const speakerTrack = speakerArtifact?.tracks.find((track) => track.id === speakerScope?.trackId);
    const separationScope = input.requiredCapabilities.includes("media.audio.separate")
      ? input.mediaScope.length === 1 ? input.mediaScope[0] : null
      : undefined;
    const separationArtifact = separationScope ? state.artifacts[separationScope.artifactId] : null;
    const separationTrack = separationArtifact?.tracks.find((track) => track.id === separationScope?.trackId);
    return (
      input.requiredCapabilities.length > 0 &&
      input.requiredCapabilities.every((capability) => this.limits.grantableCapabilities.includes(capability)) &&
      roleAllowsCapabilities(input.workerKind, input.requiredCapabilities) &&
      (!input.requiredCapabilities.includes("media.audio.separate") || allowConditionalSeparation) &&
      (!input.requiredCapabilities.includes("research.investigate") || allowResearch) &&
      (!input.requiredCapabilities.includes("computer.use.readonly") || allowComputerUse) &&
      (!input.requiredCapabilities.some((capability) => capability.startsWith("media.") || capability === "speech.transcribe") || input.mediaScope.length > 0) &&
      (!input.requiredCapabilities.includes("evidence.read") ||
        (evidenceArtifacts.length > 0 &&
          evidenceArtifacts.every((artifactId) => evidenceWindow(state, input, artifactId) !== null))) &&
      (!input.requiredCapabilities.includes("analysis.evidence.assess") ||
        (input.requiredCapabilities.includes("evidence.read") &&
          input.inputArtifactIds.some((artifactId) => state.artifacts[artifactId]?.origin.kind === "preflight_evidence"))) &&
      (!input.requiredCapabilities.includes("analysis.evidence.decide") ||
        input.requiredCapabilities.includes("analysis.evidence.assess")) &&
      (!input.requiredCapabilities.includes("media.frames.ocr") ||
        input.requiredCapabilities.includes("media.frames.sample")) &&
      (!input.requiredCapabilities.includes("media.visual-transitions.analyze") ||
        (input.requiredCapabilities.includes("media.frames.sample") && input.requiredCapabilities.includes("media.frames.ocr"))) &&
      (frameScope === undefined || (
        frameScope !== null &&
        frameArtifact?.origin.kind === "ingest" &&
        frameTrack?.kind === "video" &&
        frameScope.endMs - frameScope.startMs <= FRAME_SAMPLING_LIMITS.maxDurationMs
      )) &&
      (speakerScope === undefined || (
        speakerScope !== null &&
        speakerArtifact?.origin.kind === "ingest" &&
        speakerTrack?.kind === "audio" &&
        speakerScope.endMs - speakerScope.startMs <= SPEAKER_OVERLAP_LIMITS.maxRangeMs
      )) &&
      (separationScope === undefined || (
        separationScope !== null &&
        separationArtifact?.origin.kind === "ingest" &&
        separationTrack?.kind === "audio" &&
        separationScope.endMs - separationScope.startMs <= CONDITIONAL_SEPARATION_LIMITS.maxRangeMs
      ))
    );
  }

  private contextValid(
    state: RuntimeProjection,
    input: SpawnRequestInput,
    context: TaskJobContext,
  ): boolean {
    const source = state.artifacts[context.source.artifactId];
    if (
      !source ||
      source.origin.kind !== "ingest" ||
      source.content.contentId !== context.source.contentId ||
      !input.inputArtifactIds.includes(source.id)
    ) return false;
    if ((input.requiredCapabilities.includes("media.frames.sample") || input.requiredCapabilities.includes("media.frames.ocr") || input.requiredCapabilities.includes("media.visual-transitions.analyze") || input.requiredCapabilities.includes("media.speakers.analyze") || input.requiredCapabilities.includes("media.audio.separate")) && (
      input.mediaScope.length !== 1 || input.mediaScope[0].artifactId !== source.id
    )) return false;
    if (!input.mediaScope.every((scope) =>
      scope.artifactId !== source.id ||
      (scope.startMs >= context.analysisRequest.taskRange.startMs &&
        scope.endMs <= context.analysisRequest.taskRange.endMs))) return false;
    return context.detectorEvidence.every((evidence) => {
      const artifact = state.artifacts[evidence.artifactId];
      return input.inputArtifactIds.includes(evidence.artifactId) &&
        artifact?.origin.kind === "preflight_evidence" &&
        artifact.content.contentId === evidence.contentId &&
        artifact.origin.evidenceKind === evidence.evidenceKind &&
        artifact.sourceArtifactIds.length === 1 &&
        artifact.sourceArtifactIds[0] === source.id;
    });
  }

  async createRoot(inputValue: unknown, jobContextValue: unknown): Promise<LaunchPermit> {
    assertSpawnRequestInput(inputValue, "Root task");
    assertTaskJobContext(jobContextValue, "Root task job context");
    const input = inputValue;
    const jobContext = structuredClone(jobContextValue);
    const result = await this.ledger.transact(
      { producer: { kind: "scheduler", id: "bounded-scheduler" }, causationId: "root-task" },
      ({ state }) => {
        if (Object.values(state.tasks).some((task) => task.parentTaskId === null)) {
          throw new Error("Runtime already has a root task");
        }
        if (input.requiredOutputs.length === 0 || !input.requiredOutputs.some((output) => output.required)) {
          throw new Error("Root task requires at least one required output");
        }
        if (!this.scopeValid(state, input)) throw new Error("Root task media scope is not backed by registered artifacts");
        if (!this.capabilityValid(state, input)) throw new Error("Root task requests an unavailable capability");
        if (!this.contextValid(state, input, jobContext)) throw new Error("Root task job context does not bind its registered inputs");
        if (input.dependencies.length !== 0) throw new Error("Root task cannot have dependencies");
        if (
          input.budget.wallMs > this.limits.runBudget.wallMs ||
          input.budget.toolCalls > this.limits.runBudget.toolCalls
        ) {
          throw new Error("Root task exceeds the run budget");
        }
        const taskId = this.identities.next("task");
        const agentId = this.identities.next("agent");
        const permit: LaunchPermit = {
          requestId: "root-task",
          taskId,
          agentId,
          registrationSecret: this.identities.secret(),
        };
        const task: TaskRecord = {
          id: taskId,
          runId: state.runId,
          workloadKey: input.workloadKey,
          objective: input.objective,
          workerKind: input.workerKind,
          workerLabel: input.workerLabel,
          parentTaskId: null,
          parentAgentId: null,
          depth: 0,
          assignedAgentId: agentId,
          ownerAgentId: null,
          jobContext,
          mediaScope: structuredClone(input.mediaScope),
          inputArtifactIds: [...input.inputArtifactIds],
          requiredOutputs: structuredClone(input.requiredOutputs),
          dependencies: [],
          budget: { ...input.budget },
          grants: this.grants(state, taskId, agentId, input),
          status: "scheduled",
          terminalReason: null,
        };
        return {
          pending: [{ type: "task.created", data: { task } }] satisfies PendingRuntimeEvent[],
          result: permit,
        };
      },
    );
    this.permits.set(result.result.requestId, result.result);
    return result.result;
  }

  private violation(
    state: RuntimeProjection,
    requestedByTaskId: string,
    requestedByAgentId: string,
    input: SpawnRequestInput,
    allowConditionalSeparation = false,
    allowResearch = false,
    allowComputerUse = false,
  ): SpawnRejection | null {
    const parent = state.tasks[requestedByTaskId];
    if (
      !parent ||
      parent.ownerAgentId !== requestedByAgentId ||
      !active(parent.status) ||
      !parent.grants.some((grant) => grant.capability === "task.spawn.request")
    ) {
      return "requester_not_authorized";
    }
    if (parent.depth + 1 > this.limits.maxDepth) return "max_depth";
    if (Object.values(state.tasks).filter((task) => active(task.status)).length >= this.limits.maxActiveWorkers) {
      return "max_active_workers";
    }
    if (Object.values(state.tasks).some((task) => active(task.status) && task.workloadKey === input.workloadKey)) {
      return "duplicate_owner";
    }
    if (input.requiredOutputs.length === 0 || !input.requiredOutputs.some((output) => output.required)) {
      return "missing_output_contract";
    }
    if (!input.dependencies.every((id) => state.tasks[id]?.status === "completed")) {
      return "dependency_unavailable";
    }
    if (
      !input.inputArtifactIds.every((id) => Boolean(state.artifacts[id])) ||
      !input.inputArtifactIds.every((id) => parent.inputArtifactIds.includes(id)) ||
      !this.scopeValid(state, input) ||
      !input.mediaScope.every((child) => parent.mediaScope.some((allowed) => scopeContains(allowed, child))) ||
      (input.requiredCapabilities.includes("media.frames.sample") && (
        input.mediaScope.length !== 1 ||
        input.mediaScope[0].artifactId !== parent.jobContext.source.artifactId ||
        state.artifacts[input.mediaScope[0].artifactId]?.content.contentId !== parent.jobContext.source.contentId
      ))
    ) {
      return "scope_violation";
    }
    if (!this.capabilityValid(state, input, allowConditionalSeparation, allowResearch, allowComputerUse)) return "capability_not_grantable";
    const total = allocated(state);
    if (
      total.wallMs + input.budget.wallMs > this.limits.runBudget.wallMs ||
      total.toolCalls + input.budget.toolCalls > this.limits.runBudget.toolCalls
    ) {
      return "run_budget";
    }
    return null;
  }

  async requestSpawn(
    requestedByTaskId: string,
    requestedByAgentId: string,
    inputValue: unknown,
    authorship: { executionId: string; toolCallId: string } | null = null,
  ): Promise<SpawnDecision> {
    assertSpawnRequestInput(inputValue);
    const input = structuredClone(inputValue);
    const requestId = this.identities.next("request");
    const transaction = await this.ledger.transact<SpawnDecision>(
      {
        producer: { kind: "scheduler", id: "bounded-scheduler" },
        causationId: requestId,
        correlationId: requestId,
      },
      ({ state }) => {
        const requestEvent = {
          type: "spawn.requested" as const,
          data: {
            requestId,
            requestedByTaskId,
            requestedByAgentId,
            authoredByExecutionId: authorship?.executionId ?? null,
            toolCallId: authorship?.toolCallId ?? null,
            input,
          },
        };
        const rejection = this.violation(state, requestedByTaskId, requestedByAgentId, input);
        if (rejection) {
          return {
            pending: [
              requestEvent,
              {
                type: "spawn.decided",
                data: { requestId, accepted: false, rejection, taskId: null, agentId: null, grants: [] },
              },
            ] satisfies PendingRuntimeEvent[],
            result: { requestId, accepted: false, rejection, permit: null },
          };
        }

        const parent = state.tasks[requestedByTaskId];
        const taskId = this.identities.next("task");
        const agentId = this.identities.next("agent");
        const grants = this.grants(state, taskId, agentId, input);
        const permit: LaunchPermit = {
          requestId,
          taskId,
          agentId,
          registrationSecret: this.identities.secret(),
        };
        const task: TaskRecord = {
          id: taskId,
          runId: state.runId,
          workloadKey: input.workloadKey,
          objective: input.objective,
          workerKind: input.workerKind,
          workerLabel: input.workerLabel,
          parentTaskId: parent.id,
          parentAgentId: parent.ownerAgentId,
          depth: parent.depth + 1,
          assignedAgentId: agentId,
          ownerAgentId: null,
          jobContext: attenuateTaskJobContext(parent.jobContext, input.mediaScope, input.inputArtifactIds),
          mediaScope: structuredClone(input.mediaScope),
          inputArtifactIds: [...input.inputArtifactIds],
          requiredOutputs: structuredClone(input.requiredOutputs),
          dependencies: [...input.dependencies],
          budget: { ...input.budget },
          grants,
          status: "scheduled",
          terminalReason: null,
        };
        return {
          pending: [
            requestEvent,
            {
              type: "spawn.decided",
              data: { requestId, accepted: true, rejection: null, taskId, agentId, grants },
            },
            { type: "task.created", data: { task } },
          ] satisfies PendingRuntimeEvent[],
          result: { requestId, accepted: true, rejection: null, permit },
        };
      },
    );
    if (transaction.result.permit) this.permits.set(requestId, transaction.result.permit);
    return transaction.result;
  }

  /** Atomic scheduler admission for one host-normalized registered current-run speech range pass. */
  async requestSpeechRangePass(inputValue: {
    receipt: RangePassRequestReceipt;
    receiptContentId: string;
    child: SpawnRequestInput;
    authorship: { executionId: string; toolCallId: string };
  }): Promise<SpawnDecision> {
    assertSpawnRequestInput(inputValue.child, "Speech range-pass child");
    validateRangePassRequestReceipt(inputValue.receipt);
    const input = structuredClone(inputValue.child);
    const receipt = structuredClone(inputValue.receipt);
    const requestId = this.identities.next("request");
    const transaction = await this.ledger.transact<SpawnDecision>(
      { producer: { kind: "scheduler", id: "bounded-scheduler" }, causationId: receipt.passId, correlationId: requestId },
      ({ state }) => {
        const requestEvent = {
          type: "spawn.requested" as const,
          data: {
            requestId,
            requestedByTaskId: receipt.root.taskId,
            requestedByAgentId: receipt.root.agentId,
            authoredByExecutionId: inputValue.authorship.executionId,
            toolCallId: inputValue.authorship.toolCallId,
            input,
          },
        };
        const requestedEvent = {
          type: "study.restudy_pass_requested" as const,
          data: { receiptContentId: inputValue.receiptContentId, receipt },
        };
        const priorPasses = Object.values(state.rangePasses);
        const duplicatePassIdentity = state.rangePasses[receipt.passId] !== undefined;
        const sameRange = priorPasses.filter((entry) =>
          entry.request.weakRange.artifactId === receipt.weakRange.artifactId &&
          entry.request.weakRange.trackId === receipt.weakRange.trackId &&
          entry.request.weakRange.startMs === receipt.weakRange.startMs &&
          entry.request.weakRange.endMs === receipt.weakRange.endMs);
        let rejection: SpawnRejection | null = duplicatePassIdentity || priorPasses.some((entry) => entry.accepted && entry.request.workFingerprint === receipt.workFingerprint)
          ? "restudy_duplicate_work"
          : sameRange.filter((entry) => entry.accepted).length >= receipt.limits.maxAcceptedPassesPerRange
            ? "restudy_range_pass_cap"
            : priorPasses.filter((entry) => entry.accepted && entry.request.producer.kind === receipt.producer.kind).length >= receipt.limits.maxAcceptedPassesPerProducer
              ? "restudy_producer_pass_cap"
              : this.violation(state, receipt.root.taskId, receipt.root.agentId, input);
        const root = state.tasks[receipt.root.taskId];
        const execution = state.executions[receipt.root.executionId];
        const authoredCall = state.orchestratorToolCalls[inputValue.authorship.toolCallId];
        const executionRange = receipt.delta.executionRange;
        const padded = receipt.delta.kind === "padded_audio_window";
        const childMatchesReceipt =
          input.workloadKey === `restudy:${receipt.workFingerprint}` &&
          input.workerKind === "analysis" &&
          input.workerLabel === (padded ? "padded-current-run-speech-pass-2" : "attenuated-current-run-speech-pass-2") &&
          input.mediaScope.length === 1 &&
          input.mediaScope[0].artifactId === executionRange.artifactId &&
          input.mediaScope[0].trackId === executionRange.trackId &&
          input.mediaScope[0].startMs === executionRange.startMs &&
          input.mediaScope[0].endMs === executionRange.endMs &&
          input.inputArtifactIds.length === 1 &&
          input.inputArtifactIds[0] === root?.jobContext.source.artifactId &&
          input.requiredOutputs.length === 1 &&
          input.requiredOutputs[0].name === (padded ? "padded audio speech re-study" : "attenuated speech re-study") &&
          input.requiredOutputs[0].artifactKind === "studio.study-report.v2" &&
          input.requiredOutputs[0].required === true &&
          input.requiredCapabilities.length === 2 &&
          input.requiredCapabilities[0] === "speech.transcribe" &&
          input.requiredCapabilities[1] === "report.submit" &&
          input.dependencies.length === 0 &&
          input.budget.wallMs === receipt.reservedSpend.wallMs &&
          input.budget.toolCalls === receipt.reservedSpend.toolCalls;
        if (!root || root.parentTaskId !== null || root.ownerAgentId !== receipt.root.agentId ||
            execution?.status !== "active" || execution.taskId !== root.id || execution.agentId !== root.ownerAgentId ||
            inputValue.authorship.executionId !== execution.id ||
            !root.grants.some((grant) => grant.capability === "study.restudy") ||
            authoredCall?.tool !== "study_restudy_request" || authoredCall.executionId !== execution.id || authoredCall.taskId !== root.id ||
            !childMatchesReceipt) rejection = "requester_not_authorized";
        if (rejection) {
          return {
            pending: duplicatePassIdentity
              ? [
                  requestEvent,
                  { type: "spawn.decided", data: { requestId, accepted: false, rejection, taskId: null, agentId: null, grants: [] } },
                ] satisfies PendingRuntimeEvent[]
              : [
                  requestedEvent,
                  requestEvent,
                  { type: "spawn.decided", data: { requestId, accepted: false, rejection, taskId: null, agentId: null, grants: [] } },
                  { type: "study.restudy_pass_decided", data: { passId: receipt.passId, spawnRequestId: requestId, accepted: false, rejection, taskId: null, agentId: null } },
                ] satisfies PendingRuntimeEvent[],
            result: { requestId, accepted: false, rejection, permit: null },
          };
        }
        const taskId = this.identities.next("task");
        const agentId = this.identities.next("agent");
        const grants = this.grants(state, taskId, agentId, input);
        const permit: LaunchPermit = { requestId, taskId, agentId, registrationSecret: this.identities.secret() };
        const task: TaskRecord = {
          id: taskId,
          runId: state.runId,
          workloadKey: input.workloadKey,
          objective: input.objective,
          workerKind: input.workerKind,
          workerLabel: input.workerLabel,
          parentTaskId: root.id,
          parentAgentId: root.ownerAgentId,
          depth: root.depth + 1,
          assignedAgentId: agentId,
          ownerAgentId: null,
          jobContext: attenuateTaskJobContext(root.jobContext, input.mediaScope, input.inputArtifactIds),
          mediaScope: structuredClone(input.mediaScope),
          inputArtifactIds: [...input.inputArtifactIds],
          requiredOutputs: structuredClone(input.requiredOutputs),
          dependencies: [...input.dependencies],
          budget: { ...input.budget },
          grants,
          status: "scheduled",
          terminalReason: null,
        };
        return {
          pending: [
            requestedEvent,
            requestEvent,
            { type: "spawn.decided", data: { requestId, accepted: true, rejection: null, taskId, agentId, grants } },
            { type: "task.created", data: { task } },
            { type: "study.restudy_pass_decided", data: { passId: receipt.passId, spawnRequestId: requestId, accepted: true, rejection: null, taskId, agentId } },
          ] satisfies PendingRuntimeEvent[],
          result: { requestId, accepted: true, rejection: null, permit },
        };
      },
    );
    if (transaction.result.permit) this.permits.set(requestId, transaction.result.permit);
    return transaction.result;
  }

  /** Atomic admission for one exact U6.1-triggered separation grant. Not reachable through ordinary spawn. */
  async requestConditionalSeparation(inputValue: {
    trigger: ConditionalSeparationTrigger;
    child: SpawnRequestInput;
    authorship: { executionId: string; toolCallId: string; taskId: string; agentId: string };
  }): Promise<SpawnDecision> {
    assertSpawnRequestInput(inputValue.child, "Conditional separation child");
    const input = structuredClone(inputValue.child);
    const trigger = structuredClone(inputValue.trigger);
    const requestId = this.identities.next("request");
    const transaction = await this.ledger.transact<SpawnDecision>(
      { producer: { kind: "scheduler", id: "bounded-scheduler" }, causationId: trigger.observationId, correlationId: requestId },
      ({ state }) => {
        const requestEvent = {
          type: "spawn.requested" as const,
          data: {
            requestId,
            requestedByTaskId: inputValue.authorship.taskId,
            requestedByAgentId: inputValue.authorship.agentId,
            authoredByExecutionId: inputValue.authorship.executionId,
            toolCallId: inputValue.authorship.toolCallId,
            input,
          },
        };
        const root = state.tasks[inputValue.authorship.taskId];
        const execution = state.executions[inputValue.authorship.executionId];
        const call = state.orchestratorToolCalls[inputValue.authorship.toolCallId];
        // Per-kind lineage resolution against live ledger state (sync). The deep byte/cell audit
        // ran in the host inspect and re-ran in request(); here we confirm the grant still binds to
        // the exact owned source, track, range, and unchanged evidence identity for this kind.
        let separationSource: RuntimeArtifact | undefined;
        let resolvedTrackId: string | undefined;
        let exactRange = false;
        let lineageValid = false;
        if (trigger.kind === "u6_speaker_overlap") {
          const speaker = state.speakerOverlapOperations[trigger.operationId];
          separationSource = speaker ? state.artifacts[speaker.sourceArtifactId] : undefined;
          const observations = state.artifacts[trigger.observationsArtifactId];
          const speakerReceipt = state.artifacts[trigger.receiptArtifactId];
          resolvedTrackId = speaker?.trackId;
          exactRange = trigger.range.endMs > trigger.range.startMs &&
            trigger.range.startMs >= (speaker?.startMs ?? Number.MAX_SAFE_INTEGER) && trigger.range.endMs <= (speaker?.endMs ?? -1);
          lineageValid = speaker?.status === "completed" && separationSource?.origin.kind === "ingest" &&
            observations?.origin.kind === "speaker_overlap_observations" && observations.content.contentId === trigger.observationsContentId &&
            speaker.outputArtifactId === observations.id && speaker.receiptArtifactId === trigger.receiptArtifactId &&
            speaker.receiptId === trigger.receiptId && speaker.receiptContentId === trigger.receiptContentId &&
            speakerReceipt?.origin.kind === "speaker_overlap_receipt" && speakerReceipt.content.contentId === trigger.receiptContentId;
        } else if (trigger.kind === "u1_acoustic_mixed") {
          const acoustic = state.artifacts[trigger.observationsArtifactId];
          separationSource = acoustic && acoustic.sourceArtifactIds.length === 1 ? state.artifacts[acoustic.sourceArtifactIds[0]] : undefined;
          const track = separationSource?.tracks.find((candidate) => candidate.id === trigger.trackId && candidate.kind === "audio");
          resolvedTrackId = trigger.trackId;
          exactRange = trigger.range.endMs > trigger.range.startMs &&
            trigger.range.endMs - trigger.range.startMs <= CONDITIONAL_SEPARATION_LIMITS.maxRangeMs;
          lineageValid = separationSource?.origin.kind === "ingest" && Boolean(track) &&
            u1AcousticTriggerLineageMatches(state.artifacts, trigger, separationSource.id, trigger.trackId);
        }
        const scope: ConditionalSeparationGrantScope | null = separationSource && resolvedTrackId !== undefined && lineageValid ? {
          schema: "studio.conditional-separation-grant.v1",
          source: {
            artifactId: separationSource.id,
            contentId: separationSource.content.contentId,
            trackId: resolvedTrackId,
            range: structuredClone(trigger.range),
          },
          trigger,
          producerPolicy: {
            methodId: SEPARATION_METHOD.id,
            methodVersion: SEPARATION_METHOD.version,
            modelId: SEPARATION_METHOD.modelId,
            modelRevision: SEPARATION_METHOD.modelRevision,
            modelContentIds: [...SEPARATION_METHOD.modelContentIds],
            configurationContentId: SEPARATION_METHOD.configurationContentId,
            stemRoles: ["source_estimate_1", "source_estimate_2"],
          },
          limits: structuredClone(CONDITIONAL_SEPARATION_LIMITS),
        } : null;
        const childMatches = Boolean(scope) &&
          input.workloadKey === `separation:${trigger.observationId}` && input.workerKind === "analysis" &&
          input.mediaScope.length === 1 && input.mediaScope[0].artifactId === scope!.source.artifactId &&
          input.mediaScope[0].trackId === scope!.source.trackId && input.mediaScope[0].startMs === scope!.source.range.startMs &&
          input.mediaScope[0].endMs === scope!.source.range.endMs && input.inputArtifactIds.length === 1 &&
          input.inputArtifactIds[0] === scope!.source.artifactId && input.requiredOutputs.length === 1 &&
          input.requiredOutputs[0].artifactKind === "studio.study-report.v2" && input.requiredOutputs[0].required === true &&
          input.requiredCapabilities.length === 2 && input.requiredCapabilities[0] === "media.audio.separate" &&
          input.requiredCapabilities[1] === "report.submit" && input.dependencies.length === 0 &&
          input.budget.wallMs === CONDITIONAL_SEPARATION_LIMITS.maxWallMs && input.budget.toolCalls === 1;
        // Duplicate-work: same content-addressed observation OR the same exact (source, track,
        // range). The second clause is kind-agnostic, so a U1 and a U6 trigger for the identical
        // range collapse to one work item.
        let rejection: SpawnRejection | null = Object.values(state.conditionalSeparationOperations).some((operation) =>
          operation.trigger.observationId === trigger.observationId ||
          (operation.sourceArtifactId === separationSource?.id && operation.trackId === resolvedTrackId && operation.startMs === trigger.range.startMs && operation.endMs === trigger.range.endMs))
          ? "separation_duplicate_work"
          : this.violation(state, inputValue.authorship.taskId, inputValue.authorship.agentId, input, true);
        if (
          !root || root.parentTaskId !== null || root.ownerAgentId !== inputValue.authorship.agentId ||
          execution?.status !== "active" || execution.taskId !== root.id || execution.agentId !== root.ownerAgentId ||
          !root.grants.some((grant) => grant.capability === "study.separate") ||
          call?.tool !== "study_separation_request" || call.executionId !== execution.id || call.taskId !== root.id ||
          !exactRange || !lineageValid || !childMatches
        ) rejection = "requester_not_authorized";
        if (rejection || !scope || !root) {
          return {
            pending: [requestEvent, { type: "spawn.decided", data: { requestId, accepted: false, rejection: rejection ?? "requester_not_authorized", taskId: null, agentId: null, grants: [] } }] satisfies PendingRuntimeEvent[],
            result: { requestId, accepted: false, rejection: rejection ?? "requester_not_authorized", permit: null },
          };
        }
        const taskId = this.identities.next("task");
        const agentId = this.identities.next("agent");
        const grants = this.grants(state, taskId, agentId, input, scope);
        const permit: LaunchPermit = { requestId, taskId, agentId, registrationSecret: this.identities.secret() };
        const task: TaskRecord = {
          id: taskId, runId: state.runId, workloadKey: input.workloadKey, objective: input.objective,
          workerKind: input.workerKind, workerLabel: input.workerLabel, parentTaskId: root.id, parentAgentId: root.ownerAgentId,
          depth: root.depth + 1, assignedAgentId: agentId, ownerAgentId: null,
          jobContext: attenuateTaskJobContext(root.jobContext, input.mediaScope, input.inputArtifactIds),
          mediaScope: structuredClone(input.mediaScope), inputArtifactIds: [...input.inputArtifactIds],
          requiredOutputs: structuredClone(input.requiredOutputs), dependencies: [], budget: { ...input.budget }, grants,
          status: "scheduled", terminalReason: null,
        };
        return {
          pending: [requestEvent, { type: "spawn.decided", data: { requestId, accepted: true, rejection: null, taskId, agentId, grants } }, { type: "task.created", data: { task } }] satisfies PendingRuntimeEvent[],
          result: { requestId, accepted: true, rejection: null, permit },
        };
      },
    );
    if (transaction.result.permit) this.permits.set(requestId, transaction.result.permit);
    return transaction.result;
  }

  /**
   * Atomic admission for one exact gap-triggered research grant. Not reachable through ordinary
   * spawn. The deep byte audit ran in ResearchRequestHost.request(); here the whole trigger list
   * is re-derived synchronously from live projection state, so a stale or forged echo cannot
   * mint a grant, and the scope is built from the re-derived trigger plus host policy only.
   */
  async requestResearch(inputValue: {
    inputId: string;
    trigger: AnyResearchTriggerOption;
    child: SpawnRequestInput;
    authorship: { executionId: string; toolCallId: string; taskId: string; agentId: string };
  }): Promise<SpawnDecision> {
    assertSpawnRequestInput(inputValue.child, "Research child");
    const input = structuredClone(inputValue.child);
    const triggerValue = structuredClone(inputValue.trigger);
    const trigger = triggerValue.gap.kind === "unresolved_restudy_conflict"
      ? validateRestudiedResearchTriggerOption(triggerValue, "Research admission", "trigger")
      : validateResearchTriggerOption(triggerValue, "Research admission", "trigger");
    if (typeof inputValue.inputId !== "string" || inputValue.inputId.length === 0) {
      throw new Error("Research admission requires the host-derived input identity");
    }
    const requestId = this.identities.next("request");
    const transaction = await this.ledger.transact<SpawnDecision>(
      { producer: { kind: "scheduler", id: "bounded-scheduler" }, causationId: trigger.triggerId, correlationId: requestId },
      ({ state }) => {
        const requestEvent = {
          type: "spawn.requested" as const,
          data: {
            requestId,
            requestedByTaskId: inputValue.authorship.taskId,
            requestedByAgentId: inputValue.authorship.agentId,
            authoredByExecutionId: inputValue.authorship.executionId,
            toolCallId: inputValue.authorship.toolCallId,
            input,
          },
        };
        const root = state.tasks[inputValue.authorship.taskId];
        const execution = state.executions[inputValue.authorship.executionId];
        const call = state.orchestratorToolCalls[inputValue.authorship.toolCallId];
        // V1 remains synchronously derived from the completed study projection. V2 admits only
        // a journal-projected candidate whose admission/read/pass identities still equal the
        // current root basis; the scheduler never repeats the asynchronous stored-byte audit.
        let authoritative: AnyResearchTriggerOption | null = null;
        let triggerValid = false;
        if (trigger.gap.kind === "unresolved_restudy_conflict") {
          const candidate = state.researchRequestInputs[inputValue.inputId];
          if (candidate) {
            try {
              const currentBasis = currentRestudiedResearchBasis(state, candidate.basis.root);
              const matches = candidate.triggers.filter((entry) => entry.triggerId === trigger.triggerId);
              authoritative = matches.length === 1 ? matches[0] : null;
              triggerValid = candidate.inputId === inputValue.inputId &&
                candidate.basis.root.taskId === inputValue.authorship.taskId &&
                candidate.basis.root.agentId === inputValue.authorship.agentId &&
                candidate.basis.root.executionId === inputValue.authorship.executionId &&
                same(candidate.basis, currentBasis) &&
                authoritative !== null && same(authoritative, trigger);
            } catch {
              authoritative = null;
              triggerValid = false;
            }
          }
        } else {
          let derived: ResearchTriggerOption[] | null = [];
          for (const record of Object.values(state.ownedMediaStudies).sort((left, right) => left.id.localeCompare(right.id))) {
            if (derived === null) break;
            const studyArtifact = state.artifacts[record.artifactId];
            if (!studyArtifact || studyArtifact.origin.kind !== "owned_media_study" || studyArtifact.origin.studyId !== record.id || studyArtifact.content.contentId !== record.contentId) {
              derived = null;
              break;
            }
            for (const conflict of record.conflicts) {
              const coverage = record.coverage.find((candidate) => candidate.coverageId === conflict.coverageId);
              const source = coverage ? state.artifacts[coverage.artifactId] : undefined;
              if (!coverage || !source) {
                derived = null;
                break;
              }
              const body: Omit<ResearchTriggerOption, "triggerId"> = {
                source: {
                  artifactId: coverage.artifactId,
                  contentId: source.content.contentId,
                  trackId: coverage.trackId,
                  startMs: coverage.startMs,
                  endMs: coverage.endMs,
                },
                gap: {
                  kind: "unresolved_study_conflict",
                  studyId: record.id,
                  studyArtifactId: studyArtifact.id,
                  studyContentId: record.contentId,
                  conflictId: conflict.conflictId,
                  coverageId: conflict.coverageId,
                  detail: conflict.detail,
                },
              };
              derived.push({ triggerId: researchTriggerId(body), ...body });
            }
          }
          const expectedInputId = derived === null
            ? null
            : researchRequestInputId({ schema: "studio.research-request-input.v1", runId: state.runId, triggers: derived });
          const matches = derived === null ? [] : derived.filter((candidate) => candidate.triggerId === trigger.triggerId);
          authoritative = matches.length === 1 ? matches[0] : null;
          triggerValid = expectedInputId === inputValue.inputId && authoritative !== null && same(authoritative, trigger);
        }
        const scope: ResearchGrantScope | null = authoritative ? {
          schema: "studio.research-grant.v1",
          limits: structuredClone(RESEARCH_LIMITS),
          allowedDomains: [...this.researchAllowedDomains],
          gap: {
            inputId: inputValue.inputId,
            triggerId: authoritative.triggerId,
            hypothesis: authoritative.gap.detail,
            media: structuredClone(authoritative.source),
          },
        } : null;
        const childMatches = Boolean(scope) && authoritative !== null &&
          input.workloadKey === `research:${authoritative.triggerId}` && input.workerKind === "analysis" &&
          input.mediaScope.length === 1 && input.mediaScope[0].artifactId === authoritative.source.artifactId &&
          input.mediaScope[0].trackId === authoritative.source.trackId && input.mediaScope[0].startMs === authoritative.source.startMs &&
          input.mediaScope[0].endMs === authoritative.source.endMs && input.inputArtifactIds.length === 1 &&
          input.inputArtifactIds[0] === authoritative.source.artifactId && input.requiredOutputs.length === 1 &&
          input.requiredOutputs[0].artifactKind === "studio.study-report.v2" && input.requiredOutputs[0].required === true &&
          input.requiredCapabilities.length === 2 && input.requiredCapabilities[0] === "research.investigate" &&
          input.requiredCapabilities[1] === "report.submit" && input.dependencies.length === 0 &&
          input.budget.wallMs === RESEARCH_LIMITS.maxWallMs && input.budget.toolCalls === RESEARCH_LIMITS.maxCalls;
        // Duplicate-work: v2 closes at the first accepted child; retained v1 semantics close once
        // an operation consumes the trigger and otherwise defer to the ordinary owner check.
        let rejection: SpawnRejection | null = Object.values(state.researchOperations).some((operation) =>
          operation.gap.triggerId === trigger.triggerId) || (trigger.gap.kind === "unresolved_restudy_conflict" &&
            Object.values(state.spawnRequests).some((request) =>
              request.accepted && request.input.workloadKey === `research:${trigger.triggerId}`))
          ? "research_duplicate_work"
          : this.violation(state, inputValue.authorship.taskId, inputValue.authorship.agentId, input, false, true);
        if (
          !root || root.parentTaskId !== null || root.ownerAgentId !== inputValue.authorship.agentId ||
          execution?.status !== "active" || execution.taskId !== root.id || execution.agentId !== root.ownerAgentId ||
          !root.grants.some((grant) => grant.capability === "study.research") ||
          call?.tool !== "study_research_request" || call.executionId !== execution.id || call.taskId !== root.id ||
          !triggerValid || !childMatches
        ) rejection = "requester_not_authorized";
        if (rejection || !scope || !root) {
          return {
            pending: [requestEvent, { type: "spawn.decided", data: { requestId, accepted: false, rejection: rejection ?? "requester_not_authorized", taskId: null, agentId: null, grants: [] } }] satisfies PendingRuntimeEvent[],
            result: { requestId, accepted: false, rejection: rejection ?? "requester_not_authorized", permit: null },
          };
        }
        const taskId = this.identities.next("task");
        const agentId = this.identities.next("agent");
        const grants = this.grants(state, taskId, agentId, input, null, scope);
        const permit: LaunchPermit = { requestId, taskId, agentId, registrationSecret: this.identities.secret() };
        const task: TaskRecord = {
          id: taskId, runId: state.runId, workloadKey: input.workloadKey, objective: input.objective,
          workerKind: input.workerKind, workerLabel: input.workerLabel, parentTaskId: root.id, parentAgentId: root.ownerAgentId,
          depth: root.depth + 1, assignedAgentId: agentId, ownerAgentId: null,
          jobContext: attenuateTaskJobContext(root.jobContext, input.mediaScope, input.inputArtifactIds),
          mediaScope: structuredClone(input.mediaScope), inputArtifactIds: [...input.inputArtifactIds],
          requiredOutputs: structuredClone(input.requiredOutputs), dependencies: [], budget: { ...input.budget }, grants,
          status: "scheduled", terminalReason: null,
        };
        return {
          pending: [requestEvent, { type: "spawn.decided", data: { requestId, accepted: true, rejection: null, taskId, agentId, grants } }, { type: "task.created", data: { task } }] satisfies PendingRuntimeEvent[],
          result: { requestId, accepted: true, rejection: null, permit },
        };
      },
    );
    if (transaction.result.permit) this.permits.set(requestId, transaction.result.permit);
    return transaction.result;
  }

  /** Dedicated R2 admission. Ordinary spawn never receives the allowComputerUse gate. */
  async requestComputerUse(inputValue: {
    inputId: string;
    candidate: ComputerUseRequestCandidate;
    child: SpawnRequestInput;
    authorship: { executionId: string; toolCallId: string; taskId: string; agentId: string };
  }): Promise<SpawnDecision> {
    assertSpawnRequestInput(inputValue.child, "Computer-use child");
    const input = structuredClone(inputValue.child);
    const candidate = structuredClone(inputValue.candidate);
    if (!inputValue.inputId || !candidate.candidateId || !candidate.exhaustionReceiptId) {
      throw new Error("Computer-use admission requires exact host-derived input, candidate, and cause identities");
    }
    const requestId = this.identities.next("request");
    const transaction = await this.ledger.transact<SpawnDecision>(
      { producer: { kind: "scheduler", id: "bounded-scheduler" }, causationId: candidate.candidateId, correlationId: requestId },
      ({ state }) => {
        const requestEvent = {
          type: "spawn.requested" as const,
          data: {
            requestId,
            requestedByTaskId: inputValue.authorship.taskId,
            requestedByAgentId: inputValue.authorship.agentId,
            authoredByExecutionId: inputValue.authorship.executionId,
            toolCallId: inputValue.authorship.toolCallId,
            input,
          },
        };
        const root = state.tasks[inputValue.authorship.taskId];
        const execution = state.executions[inputValue.authorship.executionId];
        const call = state.orchestratorToolCalls[inputValue.authorship.toolCallId];
        const exhaustion = state.researchExhaustions[candidate.exhaustionReceiptId];
        const researchTask = exhaustion ? state.tasks[exhaustion.taskId] : undefined;
        const researchInput = exhaustion ? state.researchRequestInputs[exhaustion.gap.inputId] : undefined;
        let authoritative: ComputerUseRequestCandidate | null = null;
        if (root && exhaustion && researchTask?.parentTaskId === root.id && researchInput) {
          try {
            const currentBasis = currentRestudiedResearchBasis(state, researchInput.basis.root);
            const trigger = researchInput.triggers.find((entry) => entry.triggerId === exhaustion.gap.triggerId);
            if (
              trigger && researchInput.basis.root.taskId === root.id &&
              researchInput.basis.root.agentId === inputValue.authorship.agentId &&
              researchInput.basis.root.executionId === inputValue.authorship.executionId &&
              same(researchInput.basis, currentBasis) && same(trigger.source, exhaustion.gap.media) &&
              trigger.gap.detail === exhaustion.gap.hypothesis
            ) {
              const body = {
                exhaustionReceiptId: exhaustion.id,
                gap: structuredClone(exhaustion.gap),
                source: structuredClone(exhaustion.gap.media),
              };
              authoritative = { candidateId: computerUseCandidateId(body), ...body };
            }
          } catch {
            authoritative = null;
          }
        }
        const policy = this.computerUsePolicy;
        const candidateValid = authoritative !== null && same(authoritative, candidate);
        const scope: ComputerUseGrantScope | null = policy && authoritative && exhaustion ? {
          schema: "studio.computer-use-grant.v1",
          limits: structuredClone(COMPUTER_USE_LIMITS),
          gap: structuredClone(authoritative.gap),
          r1Cause: {
            receiptId: exhaustion.id,
            receiptArtifactId: exhaustion.outputArtifactId,
            receiptContentId: exhaustion.receiptContentId,
            reason: exhaustion.reason,
          },
          surface: structuredClone(policy.surface),
          driver: structuredClone(policy.driver),
          policy: {
            actions: "host_declared_readonly_transitions_only",
            egress: "disabled",
            downloads: "disabled",
            cookies: "disabled",
            credentials: "disabled",
            uploads: "disabled",
            mutations: "disabled",
          },
        } : null;
        const childMatches = Boolean(scope && authoritative) &&
          input.workloadKey === `computer-use:${authoritative!.candidateId}` && input.workerKind === "analysis" &&
          input.workerLabel === "gap-external-screen-context" && input.mediaScope.length === 1 &&
          input.mediaScope[0].artifactId === authoritative!.source.artifactId &&
          input.mediaScope[0].trackId === authoritative!.source.trackId &&
          input.mediaScope[0].startMs === authoritative!.source.startMs &&
          input.mediaScope[0].endMs === authoritative!.source.endMs && input.inputArtifactIds.length === 1 &&
          input.inputArtifactIds[0] === authoritative!.source.artifactId && input.requiredOutputs.length === 1 &&
          input.requiredOutputs[0].name === "external screen context note" &&
          input.requiredOutputs[0].artifactKind === "studio.study-report.v2" && input.requiredOutputs[0].required === true &&
          input.requiredCapabilities.length === 2 && input.requiredCapabilities[0] === "computer.use.readonly" &&
          input.requiredCapabilities[1] === "report.submit" && input.dependencies.length === 0 &&
          input.budget.wallMs === COMPUTER_USE_LIMITS.maxWallMs && input.budget.toolCalls === COMPUTER_USE_LIMITS.maxCalls;
        let rejection: SpawnRejection | null = Object.values(state.computerUseOperations).some((operation) =>
          operation.r1Cause.receiptId === candidate.exhaustionReceiptId || operation.gap.triggerId === candidate.gap.triggerId) ||
          Object.values(state.spawnRequests).some((request) => request.accepted && request.input.workloadKey === `computer-use:${candidate.candidateId}`)
          ? "computer_use_duplicate_work"
          : this.violation(state, inputValue.authorship.taskId, inputValue.authorship.agentId, input, false, false, true);
        if (
          !root || root.parentTaskId !== null || root.ownerAgentId !== inputValue.authorship.agentId ||
          execution?.status !== "active" || execution.taskId !== root.id || execution.agentId !== root.ownerAgentId ||
          !root.grants.some((grant) => grant.capability === "study.computer-use") ||
          call?.tool !== "study_computer_use_request" || call.executionId !== execution.id || call.taskId !== root.id ||
          !policy || !candidateValid || !childMatches
        ) rejection = "requester_not_authorized";
        if (rejection || !scope || !root) {
          return {
            pending: [requestEvent, { type: "spawn.decided", data: { requestId, accepted: false, rejection: rejection ?? "requester_not_authorized", taskId: null, agentId: null, grants: [] } }] satisfies PendingRuntimeEvent[],
            result: { requestId, accepted: false, rejection: rejection ?? "requester_not_authorized", permit: null },
          };
        }
        const taskId = this.identities.next("task");
        const agentId = this.identities.next("agent");
        const grants = this.grants(state, taskId, agentId, input, null, null, scope);
        const permit: LaunchPermit = { requestId, taskId, agentId, registrationSecret: this.identities.secret() };
        const task: TaskRecord = {
          id: taskId, runId: state.runId, workloadKey: input.workloadKey, objective: input.objective,
          workerKind: input.workerKind, workerLabel: input.workerLabel, parentTaskId: root.id, parentAgentId: root.ownerAgentId,
          depth: root.depth + 1, assignedAgentId: agentId, ownerAgentId: null,
          jobContext: attenuateTaskJobContext(root.jobContext, input.mediaScope, input.inputArtifactIds),
          mediaScope: structuredClone(input.mediaScope), inputArtifactIds: [...input.inputArtifactIds],
          requiredOutputs: structuredClone(input.requiredOutputs), dependencies: [], budget: { ...input.budget }, grants,
          status: "scheduled", terminalReason: null,
        };
        return {
          pending: [requestEvent, { type: "spawn.decided", data: { requestId, accepted: true, rejection: null, taskId, agentId, grants } }, { type: "task.created", data: { task } }] satisfies PendingRuntimeEvent[],
          result: { requestId, accepted: true, rejection: null, permit },
        };
      },
    );
    if (transaction.result.permit) this.permits.set(requestId, transaction.result.permit);
    return transaction.result;
  }

  async requestModelSpawn(
    requestedByTaskId: string,
    requestedByAgentId: string,
    executionId: string,
    toolCallId: string,
    contractValue: unknown,
  ): Promise<SpawnDecision> {
    assertOrchestratorSpawnContract(contractValue);
    const contract: OrchestratorSpawnContract = structuredClone(contractValue);
    const state = this.ledger.state();
    const dependencies = contract.dependencyWorkloadKeys.map((workloadKey) => {
      const matches = Object.values(state.tasks).filter((task) => task.workloadKey === workloadKey);
      return matches.length === 1 ? matches[0].id : `unresolved-workload:${workloadKey}`;
    });
    const { dependencyWorkloadKeys: _dependencyWorkloadKeys, followUpCause: _followUpCause, ...input } = contract;
    return this.requestSpawn(
      requestedByTaskId,
      requestedByAgentId,
      { ...input, dependencies },
      { executionId, toolCallId },
    );
  }

  async claimTaskLaunch(
    permitValue: LaunchPermit,
    executorKind: TaskLaunchRecord["executorKind"],
    claimedAt: string,
  ): Promise<TaskLaunchClaimResult> {
    const expected = this.permits.get(permitValue.requestId);
    if (
      !expected || expected.taskId !== permitValue.taskId || expected.agentId !== permitValue.agentId ||
      expected.registrationSecret !== permitValue.registrationSecret
    ) throw new Error("Task launch permit is missing or invalid");
    const transaction = await this.ledger.transact<TaskLaunchClaimResult>(
      { producer: { kind: "launcher", id: "durable-task-launcher" }, causationId: permitValue.requestId },
      ({ state }) => {
        const existing = state.taskLaunches[permitValue.taskId];
        if (existing) return { pending: [], result: { won: false, claim: existing } };
        const task = state.tasks[permitValue.taskId];
        if (!task || task.status !== "scheduled" || task.ownerAgentId !== null || task.assignedAgentId !== permitValue.agentId) {
          throw new Error("Task launch claim requires one unowned scheduled task");
        }
        const claim: TaskLaunchRecord = {
          id: `launch:${task.id}`,
          requestId: permitValue.requestId,
          taskId: task.id,
          agentId: task.assignedAgentId,
          executorKind,
          claimedAt,
          executionId: null,
        };
        return {
          pending: [{ type: "task.launch_claimed", data: { claim } }] satisfies PendingRuntimeEvent[],
          result: { won: true, claim },
        };
      },
    );
    return transaction.result;
  }

  /** Registration is explicit. A worker launcher must call this only after its executor exists. */
  async registerAgent(permitValue: LaunchPermit): Promise<AgentRecord> {
    const expected = this.permits.get(permitValue.requestId);
    if (
      !expected ||
      expected.taskId !== permitValue.taskId ||
      expected.agentId !== permitValue.agentId ||
      expected.registrationSecret !== permitValue.registrationSecret
    ) {
      throw new Error("Agent registration permit is missing or invalid");
    }
    const transaction = await this.ledger.transact(
      { producer: { kind: "registry", id: "dynamic-agent-registry" }, causationId: permitValue.requestId },
      ({ state }) => {
        const task = state.tasks[permitValue.taskId];
        const launch = state.taskLaunches[permitValue.taskId];
        if (!task || task.assignedAgentId !== permitValue.agentId || task.ownerAgentId !== null) {
          throw new Error("Agent registration task is not available");
        }
        if (!launch || launch.agentId !== permitValue.agentId || launch.requestId !== permitValue.requestId) {
          throw new Error("Agent registration requires the task's durable launch claim");
        }
        const agent: AgentRecord = {
          id: permitValue.agentId,
          taskId: task.id,
          parentTaskId: task.parentTaskId,
          parentAgentId: task.parentAgentId,
          kind: task.workerKind,
          label: task.workerLabel,
          grants: structuredClone(task.grants),
          status: "registered",
        };
        return {
          pending: [{ type: "agent.registered", data: { agent } }] satisfies PendingRuntimeEvent[],
          result: agent,
        };
      },
    );
    this.permits.delete(permitValue.requestId);
    return transaction.result;
  }

  async transitionTask(taskId: string, agentId: string, status: TaskStatus, reason: string | null = null): Promise<void> {
    if ((status === "failed" || status === "withheld" || status === "interrupted") && !reason?.trim()) {
      throw new Error(`${status} transitions require a reason`);
    }
    await this.ledger.transact(
      { producer: { kind: "scheduler", id: "bounded-scheduler" }, causationId: taskId },
      () => ({
        pending: [{ type: "task.transitioned", data: { taskId, agentId, status, reason } }] satisfies PendingRuntimeEvent[],
        result: undefined,
      }),
    );
  }
}
