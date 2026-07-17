import { randomUUID } from "node:crypto";

import type { RuntimeLedger } from "../journal.ts";
import type {
  LaunchPermit,
  OrchestratorSpawnContract,
  TaskRecord,
  TerminalChildIdentity,
  StudyPlanningInput,
  StudyPlanningDecisionReceipt,
  ParentArtifactDispositionReceipt,
  ParentArtifactAdmissionReceipt,
  ParentArtifactReadReceipt,
  OwnedMediaStudyExecutorReceipt,
} from "../model.ts";
import { canonicalSha256 } from "../artifactStore.ts";
import type { ParentArtifactAdmissionHost } from "../parentArtifactAdmissionHost.ts";
import type { ParentArtifactReadHost } from "../parentArtifactReadHost.ts";
import type { StudyPlanningHost } from "../studyPlanningHost.ts";
import type { OwnedMediaStudySynthesisHost } from "../studySynthesisHost.ts";
import { BoundedParentArtifactReadBridge } from "./parentArtifactReadBridge.ts";
import type { PendingRuntimeEvent } from "../protocol.ts";
import { BoundedRuntimeScheduler, type SpawnDecision } from "../scheduler.ts";
import { assertOrchestratorSpawnContract } from "../validation/scheduling.ts";

export const ORCHESTRATOR_SPAWN_TOOL = "task_spawn_request" as const;
export const ORCHESTRATOR_WAIT_TOOL = "task_reports_wait" as const;
export const ORCHESTRATOR_DISPOSITION_TOOL = "report_disposition" as const;
export const ORCHESTRATOR_READ_TOOL = "artifact_read" as const;
export const ORCHESTRATOR_PLAN_TOOL = "study_planning_decision" as const;
export const ORCHESTRATOR_SYNTHESIZE_TOOL = "study_synthesize" as const;

export type OrchestratorToolName =
  | typeof ORCHESTRATOR_SPAWN_TOOL
  | typeof ORCHESTRATOR_WAIT_TOOL
  | typeof ORCHESTRATOR_DISPOSITION_TOOL
  | typeof ORCHESTRATOR_READ_TOOL
  | typeof ORCHESTRATOR_PLAN_TOOL
  | typeof ORCHESTRATOR_SYNTHESIZE_TOOL;

export interface OrchestratorToolManifest {
  schema: "studio.orchestrator-tools.v1";
  tools: Array<{ name: OrchestratorToolName; capability: "task.spawn.request" | "task.reports.wait" | "report.disposition" | "artifact.read" | "study.plan" | "study.synthesize" }>;
}

export interface SpawnToolResult {
  schema: "studio.orchestrator-spawn-result.v1";
  requestId: string;
  decision: "accepted" | "rejected";
  rejection: SpawnDecision["rejection"];
  followUpId: string | null;
}

export interface ReportDispositionToolResult {
  schema: "studio.orchestrator-report-disposition-result.v1";
  disposition: ParentArtifactDispositionReceipt;
  admission: ParentArtifactAdmissionReceipt | null;
}

export interface AdmittedArtifactReadToolResult {
  schema: "studio.orchestrator-admitted-artifact-read-result.v1";
  receipt: ParentArtifactReadReceipt;
  artifacts: Array<{ artifactId: string; contentId: string; schema: "studio.study-report.v1"; content: unknown }>;
  planningInput: StudyPlanningInput | null;
}

export interface StudyPlanningToolResult {
  schema: "studio.orchestrator-study-planning-result.v1";
  artifactId: string;
  receiptContentId: string;
  receipt: StudyPlanningDecisionReceipt;
}

export interface StudySynthesisToolResult {
  schema: "studio.orchestrator-study-synthesis-result.v1";
  studyId: string;
  artifactId: string;
  contentId: string;
  executorReceiptContentId: string;
  executorReceipt: OwnedMediaStudyExecutorReceipt;
}

export interface ReportsWaitToolResult {
  schema: "studio.orchestrator-reports-wait-result.v1";
  result: "all_terminal" | "closed_failure";
  failure: "no_children" | "child_interrupted" | "child_failed" | null;
  children: TerminalChildIdentity[];
}

interface ChildLauncher {
  launch(permit: LaunchPermit): Promise<unknown>;
}

type ErrorCode = "invalid_request" | "capability_not_granted" | "operation_rejected" | "bridge_unavailable";

export class OrchestratorBridgeError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "OrchestratorBridgeError";
    this.code = code;
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function exact(item: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(item).length === keys.length && keys.every((key) => key in item);
}

function terminalIdentity(ledger: RuntimeLedger, taskId: string): TerminalChildIdentity {
  const state = ledger.state();
  const task = state.tasks[taskId];
  if (!task || !new Set(["reported", "completed", "failed", "withheld", "interrupted"]).has(task.status)) {
    throw new OrchestratorBridgeError("operation_rejected", "A child did not reach a closed report or failure state.");
  }
  const report = Object.values(state.reports).find((candidate) => candidate.taskId === task.id) ?? null;
  const failed = task.status === "failed" || task.status === "withheld" || task.status === "interrupted";
  if (failed && !task.terminalReason) {
    throw new OrchestratorBridgeError("operation_rejected", "A terminal child failure has no closed reason.");
  }
  return {
    taskId: task.id,
    status: task.status as TerminalChildIdentity["status"],
    reportId: report?.id ?? null,
    artifactIds: report ? [...report.outputArtifactIds] : [],
    failure: failed
      ? { state: task.status as "failed" | "withheld" | "interrupted", reason: task.terminalReason! }
      : null,
  };
}

/** Model bridge: injects all authority and starts accepted children without awaiting them. */
export class BoundedOrchestratorBridge {
  private readonly task: TaskRecord;
  private readonly executionId: string;
  private readonly ledger: RuntimeLedger;
  private readonly scheduler: BoundedRuntimeScheduler;
  private readonly childLauncher: ChildLauncher;
  private readonly launches = new Map<string, Promise<void>>();
  private readonly nextCallId: (tool: OrchestratorToolName) => string;
  private readonly admissionHost: ParentArtifactAdmissionHost | null;
  private readonly readHost: ParentArtifactReadHost | null;
  private readonly planningHost: StudyPlanningHost | null;
  private readonly synthesisHost: OwnedMediaStudySynthesisHost | null;

  constructor(input: {
    task: TaskRecord;
    executionId: string;
    ledger: RuntimeLedger;
    scheduler: BoundedRuntimeScheduler;
    childLauncher: ChildLauncher;
    admissionHost?: ParentArtifactAdmissionHost;
    readHost?: ParentArtifactReadHost;
    planningHost?: StudyPlanningHost;
    synthesisHost?: OwnedMediaStudySynthesisHost;
    nextCallId?: (tool: OrchestratorToolName) => string;
  }) {
    this.task = structuredClone(input.task);
    this.executionId = input.executionId;
    this.ledger = input.ledger;
    this.scheduler = input.scheduler;
    this.childLauncher = input.childLauncher;
    this.admissionHost = input.admissionHost ?? null;
    this.readHost = input.readHost ?? null;
    this.planningHost = input.planningHost ?? null;
    this.synthesisHost = input.synthesisHost ?? null;
    this.nextCallId = input.nextCallId ?? ((tool) => `tool-call:${tool}:${randomUUID()}`);
  }

  manifest(): OrchestratorToolManifest {
    const capabilities = new Set(this.task.grants.map((grant) => grant.capability));
    if (this.task.workerKind !== "orchestrator" || !capabilities.has("task.spawn.request") || !capabilities.has("task.reports.wait")) {
      throw new OrchestratorBridgeError(
        "capability_not_granted",
        "The root orchestrator requires closed spawn and report-wait authority.",
      );
    }
    const planningCapabilities = ["report.disposition", "artifact.read", "study.plan", "study.synthesize"] as const;
    const planningEnabled = planningCapabilities.every((capability) => capabilities.has(capability));
    if (planningEnabled !== Boolean(this.admissionHost && this.readHost && this.planningHost && this.synthesisHost) ||
        (!planningEnabled && capabilities.size !== 2) || (planningEnabled && capabilities.size !== 6)) {
      throw new OrchestratorBridgeError("capability_not_granted", "The root orchestrator planning tool surface is incomplete or broader than its exact grants.");
    }
    return {
      schema: "studio.orchestrator-tools.v1",
      tools: [
        { name: ORCHESTRATOR_SPAWN_TOOL, capability: "task.spawn.request" },
        { name: ORCHESTRATOR_WAIT_TOOL, capability: "task.reports.wait" },
        ...(planningEnabled ? [
          { name: ORCHESTRATOR_DISPOSITION_TOOL, capability: "report.disposition" as const },
          { name: ORCHESTRATOR_READ_TOOL, capability: "artifact.read" as const },
          { name: ORCHESTRATOR_PLAN_TOOL, capability: "study.plan" as const },
          { name: ORCHESTRATOR_SYNTHESIZE_TOOL, capability: "study.synthesize" as const },
        ] : []),
      ],
    };
  }

  private async recordCall(
    callId: string,
    tool: OrchestratorToolName,
  ): Promise<void> {
    await this.ledger.transact(
      { producer: { kind: "launcher", id: "model-orchestrator-bridge" }, causationId: this.executionId },
      ({ state }) => {
        const task = state.tasks[this.task.id];
        const execution = state.executions[this.executionId];
        const calls = Object.values(state.orchestratorToolCalls).filter((call) => call.taskId === this.task.id).length;
        if (
          task?.ownerAgentId !== this.task.assignedAgentId ||
          execution?.status !== "active" ||
          execution.taskId !== task.id ||
          calls >= task.budget.toolCalls
        ) throw new OrchestratorBridgeError("capability_not_granted", "The orchestrator tool-call grant or budget is unavailable.");
        return {
          pending: [{
            type: "orchestrator.tool_called",
            data: { callId, executionId: this.executionId, taskId: task.id, tool },
          }] satisfies PendingRuntimeEvent[],
          result: undefined,
        };
      },
    );
  }

  async spawn(value: unknown): Promise<SpawnToolResult> {
    this.manifest();
    try {
      assertOrchestratorSpawnContract(value);
    } catch {
      throw new OrchestratorBridgeError(
        "invalid_request",
        "task_spawn_request accepts only the closed child contract; task, agent, grant, and dependency task ids are unavailable.",
      );
    }
    const contract: OrchestratorSpawnContract = structuredClone(value);
    const planningDecisions = Object.values(this.ledger.state().studyPlanningDecisions)
      .filter((decision) => decision.executionId === this.executionId)
      .sort((left, right) => left.id.localeCompare(right.id));
    if (planningDecisions.length > 0 && !contract.followUpCause) {
      throw new OrchestratorBridgeError("invalid_request", "Post-report child requests require one exact cited planning gap or conflict cause.");
    }
    if (contract.followUpCause) {
      const planning = this.ledger.state().studyPlanningDecisions[contract.followUpCause.planningDecisionId];
      const cited = contract.followUpCause.kind === "gap" ? planning?.citedGapIds : planning?.citedConflictIds;
      if (planning?.executionId !== this.executionId || planning.outcome !== "request_follow_up" || !cited?.includes(contract.followUpCause.causeId)) {
        throw new OrchestratorBridgeError("invalid_request", "Follow-up causation is not an exact cited gap or conflict from this root executor.");
      }
      if (Object.values(this.ledger.state().studyFollowUps).some((followUp) =>
        followUp.planningDecisionId === planning.id && followUp.cause.kind === contract.followUpCause!.kind && followUp.cause.id === contract.followUpCause!.causeId)) {
        throw new OrchestratorBridgeError("operation_rejected", "This exact planning cause already has a follow-up request.");
      }
    }
    const callId = this.nextCallId(ORCHESTRATOR_SPAWN_TOOL);
    await this.recordCall(callId, ORCHESTRATOR_SPAWN_TOOL);
    let decision: SpawnDecision;
    try {
      decision = await this.scheduler.requestModelSpawn(
        this.task.id,
        this.task.assignedAgentId,
        this.executionId,
        callId,
        contract,
      );
    } catch {
      throw new OrchestratorBridgeError("operation_rejected", "The scheduler rejected the model-authored spawn operation.");
    }
    if (decision.permit) {
      const permit = decision.permit;
      const launch = this.childLauncher.launch(permit).then(() => undefined).catch(async (error: unknown) => {
        if (error instanceof Error && error.name === "RuntimeApplicationInterrupted") throw error;
        const child = this.ledger.state().tasks[permit.taskId];
        if (child && (child.status === "scheduled" || child.status === "working")) {
          if (child.ownerAgentId === permit.agentId) {
            await this.scheduler.transitionTask(
              child.id,
              permit.agentId,
              "failed",
              "The accepted child executor failed before making a terminal report available.",
            ).catch(() => undefined);
          }
        }
      });
      // The model may do work between spawn and wait. Attach a handler immediately so an
      // interrupted child remains a closed wait result instead of becoming a process-level
      // unhandled rejection before task_reports_wait observes every launch.
      void launch.catch(() => undefined);
      this.launches.set(permit.taskId, launch);
    }
    let followUpId: string | null = null;
    if (contract.followUpCause) {
      const cause = contract.followUpCause;
      followUpId = `study-follow-up:${canonicalSha256({ runId: this.ledger.runId, planningDecisionId: cause.planningDecisionId, cause, spawnRequestId: decision.requestId })}`;
      await this.ledger.transact(
        { producer: { kind: "study_planning_host", id: "model-root-study-follow-up-host" }, causationId: cause.planningDecisionId },
        () => ({
          pending: [{ type: "study.follow_up_linked", data: { followUp: {
            id: followUpId!,
            planningDecisionId: cause.planningDecisionId,
            cause: { kind: cause.kind, id: cause.causeId },
            spawnRequestId: decision.requestId,
            accepted: decision.accepted,
            rejection: decision.rejection,
            taskId: decision.permit?.taskId ?? null,
            agentId: decision.permit?.agentId ?? null,
          } } }] satisfies PendingRuntimeEvent[],
          result: undefined,
        }),
      );
    }
    return {
      schema: "studio.orchestrator-spawn-result.v1",
      requestId: decision.requestId,
      decision: decision.accepted ? "accepted" : "rejected",
      rejection: decision.rejection,
      followUpId,
    };
  }

  async disposition(value: unknown): Promise<ReportDispositionToolResult> {
    this.manifest();
    if (!this.admissionHost) throw new OrchestratorBridgeError("capability_not_granted", "Report disposition is unavailable.");
    const item = record(value);
    if (!item || !exact(item, ["reportId", "outputArtifactId", "outcome", "reason"]) ||
        typeof item.reportId !== "string" || typeof item.outputArtifactId !== "string" ||
        !new Set(["accepted", "rejected"]).has(item.outcome as string) || typeof item.reason !== "string") {
      throw new OrchestratorBridgeError("invalid_request", "report_disposition accepts only one exact child report, output, outcome, and reason.");
    }
    await this.recordCall(this.nextCallId(ORCHESTRATOR_DISPOSITION_TOOL), ORCHESTRATOR_DISPOSITION_TOOL);
    const result = await this.admissionHost.record({
      reportId: item.reportId,
      parentTaskId: this.task.id,
      parentAgentId: this.task.assignedAgentId,
      outputArtifactId: item.outputArtifactId,
      outcome: item.outcome,
      reason: item.reason,
    });
    const child = this.ledger.state().tasks[result.dispositionReceipt.child.taskId];
    if (child?.status === "reported") {
      await this.scheduler.transitionTask(child.id, child.assignedAgentId, "completed");
    }
    return { schema: "studio.orchestrator-report-disposition-result.v1", disposition: result.dispositionReceipt, admission: result.admissionReceipt };
  }

  async readAdmitted(value: unknown): Promise<AdmittedArtifactReadToolResult> {
    this.manifest();
    if (!this.readHost || !this.planningHost) throw new OrchestratorBridgeError("capability_not_granted", "Admitted artifact read is unavailable.");
    const item = record(value);
    if (!item || !exact(item, ["grantId", "contentIds"]) || typeof item.grantId !== "string" || !Array.isArray(item.contentIds)) {
      throw new OrchestratorBridgeError("invalid_request", "artifact_read accepts only an exact admission grant and content id list.");
    }
    const grant = this.ledger.state().parentArtifactReadGrants[item.grantId];
    if (!grant) throw new OrchestratorBridgeError("capability_not_granted", "The exact admitted artifact read grant is unavailable.");
    const callId = this.nextCallId(ORCHESTRATOR_READ_TOOL);
    await this.recordCall(callId, ORCHESTRATOR_READ_TOOL);
    const bridge = new BoundedParentArtifactReadBridge(this.task, grant, this.readHost, () => `operation:parent-artifact-read:${canonicalSha256({ executionId: this.executionId, callId })}`);
    const result = await bridge.call({ contentIds: item.contentIds });
    let planningInput: StudyPlanningInput | null = null;
    try {
      planningInput = await this.planningHost.inspect(this.executionId);
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("at least two admitted")) throw error;
    }
    return { schema: "studio.orchestrator-admitted-artifact-read-result.v1", receipt: result.receipt, artifacts: result.artifacts, planningInput };
  }

  async plan(value: unknown): Promise<StudyPlanningToolResult> {
    this.manifest();
    if (!this.planningHost) throw new OrchestratorBridgeError("capability_not_granted", "Study planning is unavailable.");
    await this.recordCall(this.nextCallId(ORCHESTRATOR_PLAN_TOOL), ORCHESTRATOR_PLAN_TOOL);
    const result = await this.planningHost.record(this.executionId, value);
    return { schema: "studio.orchestrator-study-planning-result.v1", artifactId: result.artifactId, receiptContentId: result.receiptContentId, receipt: result.receipt };
  }

  async synthesize(value: unknown): Promise<StudySynthesisToolResult> {
    this.manifest();
    if (!this.synthesisHost) throw new OrchestratorBridgeError("capability_not_granted", "Study synthesis is unavailable.");
    await this.recordCall(this.nextCallId(ORCHESTRATOR_SYNTHESIZE_TOOL), ORCHESTRATOR_SYNTHESIZE_TOOL);
    const result = await this.synthesisHost.synthesize(this.executionId, value);
    return {
      schema: "studio.orchestrator-study-synthesis-result.v1",
      studyId: result.studyId,
      artifactId: result.artifactId,
      contentId: result.contentId,
      executorReceiptContentId: result.executorReceiptContentId,
      executorReceipt: result.executorReceipt,
    };
  }

  synthesizedArtifactIds(): string[] {
    return Object.values(this.ledger.state().ownedMediaStudies)
      .filter((study) => study.executionId === this.executionId)
      .map((study) => study.artifactId)
      .sort();
  }

  async wait(value: unknown): Promise<ReportsWaitToolResult> {
    this.manifest();
    const item = record(value);
    if (!item || !exact(item, [])) {
      throw new OrchestratorBridgeError("invalid_request", "task_reports_wait accepts only an empty object.");
    }
    const waitId = this.nextCallId(ORCHESTRATOR_WAIT_TOOL);
    await this.recordCall(waitId, ORCHESTRATOR_WAIT_TOOL);
    await this.scheduler.transitionTask(this.task.id, this.task.assignedAgentId, "waiting_for_children");
    await this.ledger.transact(
      { producer: { kind: "launcher", id: "model-orchestrator-bridge" }, causationId: waitId },
      () => ({
        pending: [{
          type: "reports.wait_started",
          data: { waitId, executionId: this.executionId, parentTaskId: this.task.id },
        }] satisfies PendingRuntimeEvent[],
        result: undefined,
      }),
    );
    const settled = await Promise.allSettled(this.launches.values());
    const interrupted = settled.find((result): result is PromiseRejectedResult =>
      result.status === "rejected" && result.reason instanceof Error && result.reason.name === "RuntimeApplicationInterrupted");
    if (interrupted) throw interrupted.reason;
    const state = this.ledger.state();
    const taskIds = Object.values(state.spawnRequests)
      .filter((request) => request.authoredByExecutionId === this.executionId && request.accepted === true && request.taskId)
      .map((request) => request.taskId!)
      .sort();
    const children = taskIds.map((taskId) => terminalIdentity(this.ledger, taskId));
    const failure = children.length === 0
      ? "no_children" as const
      : children.some((child) => child.status === "interrupted")
        ? "child_interrupted" as const
        : children.some((child) => child.status === "failed" || child.status === "withheld")
          ? "child_failed" as const
          : null;
    const result = failure === null ? "all_terminal" as const : "closed_failure" as const;
    await this.ledger.transact(
      { producer: { kind: "launcher", id: "model-orchestrator-bridge" }, causationId: waitId },
      () => ({
        pending: [{ type: "reports.wait_returned", data: { waitId, result, failure, children } }] satisfies PendingRuntimeEvent[],
        result: undefined,
      }),
    );
    await this.scheduler.transitionTask(this.task.id, this.task.assignedAgentId, "working");
    return { schema: "studio.orchestrator-reports-wait-result.v1", result, failure, children };
  }
}
