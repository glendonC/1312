import {
  canonicalJsonContentId,
  canonicalSha256,
  ContentAddressedArtifactStore,
} from "./artifactStore.ts";
import type { RuntimeLedger } from "./journal.ts";
import type {
  RootOutputDispositionReceipt,
  RootOutputDispositionRequest,
  RuntimeProjection,
} from "./model.ts";
import type { PendingRuntimeEvent } from "./protocol.ts";
import {
  assertRootOutputDispositionRequest,
  validateRootOutputDispositionReceipt,
} from "./validation/rootHandoff.ts";

interface AuthorizedDisposition {
  request: RootOutputDispositionRequest;
  report: RuntimeProjection["reports"][string];
  root: RuntimeProjection["tasks"][string];
  child: RuntimeProjection["tasks"][string];
  spawn: RuntimeProjection["spawnRequests"][string];
  input: RuntimeProjection["artifacts"][string] & {
    origin: Extract<RuntimeProjection["artifacts"][string]["origin"], { kind: "worker_output" }>;
  };
}

function scopeContains(
  parent: RuntimeProjection["tasks"][string]["mediaScope"][number],
  child: RuntimeProjection["tasks"][string]["mediaScope"][number],
): boolean {
  return parent.artifactId === child.artifactId &&
    parent.trackId === child.trackId &&
    child.startMs >= parent.startMs &&
    child.endMs <= parent.endMs;
}

function authorize(
  state: RuntimeProjection,
  requestValue: unknown,
): AuthorizedDisposition {
  assertRootOutputDispositionRequest(requestValue);
  const request = structuredClone(requestValue);
  const report = state.reports[request.reportId];
  const expectedStatus = request.outcome === "promoted_to_root" ? "accepted" : "rejected";
  if (!report || report.status !== expectedStatus || !report.decisionReason) {
    throw new Error("Root output disposition requires a matching decided child report");
  }
  const root = state.tasks[request.rootTaskId];
  if (
    !root ||
    root.parentTaskId !== null ||
    root.parentAgentId !== null ||
    root.depth !== 0 ||
    root.status !== "working" ||
    root.ownerAgentId !== request.rootAgentId ||
    report.parentTaskId !== root.id ||
    report.parentAgentId !== root.ownerAgentId
  ) {
    throw new Error("Root output disposition requires the working root task owner");
  }
  const child = state.tasks[report.taskId];
  if (
    !child ||
    child.parentTaskId !== root.id ||
    child.parentAgentId !== root.ownerAgentId ||
    child.assignedAgentId !== report.agentId ||
    (request.outcome === "promoted_to_root" && child.status !== "completed") ||
    (request.outcome === "rejected_by_root" && child.status !== "working") ||
    !child.mediaScope.every((scope) => root.mediaScope.some((parent) => scopeContains(parent, scope)))
  ) {
    throw new Error("Root output disposition child task or scope no longer matches the delegation");
  }
  const spawn = Object.values(state.spawnRequests).find((candidate) =>
    candidate.accepted === true &&
    candidate.requestedByTaskId === root.id &&
    candidate.requestedByAgentId === root.ownerAgentId &&
    candidate.taskId === child.id &&
    candidate.agentId === child.assignedAgentId);
  if (!spawn) throw new Error("Root output disposition has no accepted root-to-child spawn decision");
  if (!report.outputArtifactIds.includes(request.outputArtifactId)) {
    throw new Error("Root output disposition selected an artifact outside the decided report");
  }
  const inputArtifact = state.artifacts[request.outputArtifactId];
  if (
    !inputArtifact ||
    inputArtifact.origin.kind !== "worker_output" ||
    inputArtifact.producerTaskId !== child.id ||
    inputArtifact.producerAgentId !== child.assignedAgentId
  ) {
    throw new Error("Root output disposition requires one exact child worker-output artifact");
  }
  const input = inputArtifact as AuthorizedDisposition["input"];
  const execution = state.executions[input.origin.executionId];
  if (
    !execution ||
    execution.status !== "completed" ||
    execution.taskId !== child.id ||
    execution.agentId !== child.assignedAgentId ||
    !execution.outputArtifactIds.includes(input.id) ||
    execution.receipt?.receiptId !== input.origin.receiptId
  ) {
    throw new Error("Root output disposition child artifact lacks completed executor lineage");
  }
  if (
    Object.values(state.rootOutputDispositions).some((disposition) =>
      disposition.reportId === report.id || disposition.inputArtifactId === input.id)
  ) {
    throw new Error("Root output disposition already exists for this report or child output");
  }
  return { request, report, root, child, spawn, input };
}

export interface RootOutputDispositionHostResult {
  receipt: RootOutputDispositionReceipt;
  receiptContentId: string;
  outputArtifactId: string;
}

/** Records one root-owned, content-addressed disposition over one decided child report output. */
export class RootOutputDispositionHost {
  private readonly ledger: RuntimeLedger;
  private readonly artifacts: ContentAddressedArtifactStore;

  constructor(ledger: RuntimeLedger, artifacts: ContentAddressedArtifactStore) {
    this.ledger = ledger;
    this.artifacts = artifacts;
  }

  async record(requestValue: unknown): Promise<RootOutputDispositionHostResult> {
    const authorized = authorize(this.ledger.state(), requestValue);
    await this.artifacts.resolveVerified(authorized.input);
    const dispositionId = `root-output-disposition:${canonicalSha256({
      runId: this.ledger.runId,
      reportId: authorized.report.id,
      outputArtifactId: authorized.input.id,
      outcome: authorized.request.outcome,
    })}`;
    const body = {
      dispositionId,
      delegation: {
        spawnRequestId: authorized.spawn.id,
        requestedByTaskId: authorized.spawn.requestedByTaskId,
        requestedByAgentId: authorized.spawn.requestedByAgentId,
        childTaskId: authorized.child.id,
        childAgentId: authorized.child.assignedAgentId,
        workerKind: authorized.child.workerKind,
        mediaScope: structuredClone(authorized.child.mediaScope),
        grants: structuredClone(authorized.child.grants),
      },
      report: {
        reportId: authorized.report.id,
        decisionReason: authorized.report.decisionReason!,
      },
      input: {
        artifactId: authorized.input.id,
        contentId: authorized.input.content.contentId,
        kind: authorized.input.kind,
        producerTaskId: authorized.child.id,
        producerAgentId: authorized.child.assignedAgentId,
        executionId: authorized.input.origin.executionId,
        executorReceiptId: authorized.input.origin.receiptId,
        executorReceiptContentId: authorized.input.origin.receiptContentId,
      },
      authority: {
        rootTaskId: authorized.root.id,
        rootAgentId: authorized.root.ownerAgentId!,
      },
      producer: {
        id: "studio.root-output-disposition" as const,
        version: "1" as const,
        policy: "accepted_or_rejected_child_report_exact_output_only" as const,
      },
      decision: {
        outcome: authorized.request.outcome,
        reason: authorized.request.reason,
      },
    };
    const receipt: RootOutputDispositionReceipt = {
      schema: "studio.root-output-disposition.receipt.v1",
      receiptId: `root-output-disposition-receipt:${canonicalSha256(body)}`,
      ...body,
    };
    validateRootOutputDispositionReceipt(receipt);
    const stored = await this.artifacts.storeJson(receipt);
    if (stored.content.contentId !== canonicalJsonContentId(receipt)) {
      throw new Error("Stored root output disposition changed its canonical content identity");
    }
    const artifact = this.artifacts.buildRootOutputDispositionArtifact({
      runId: this.ledger.runId,
      receipt,
      storedReceipt: stored,
    });
    await this.artifacts.record(this.ledger, artifact, dispositionId);
    await this.ledger.transact(
      { producer: { kind: "handoff_host", id: "root-output-disposition-host" }, causationId: dispositionId },
      ({ state }) => {
        authorize(state, authorized.request);
        return {
          pending: [{
            type: "root.output_disposition_recorded",
            data: {
              dispositionId,
              outputArtifactId: artifact.id,
              receiptContentId: stored.content.contentId,
              receipt,
            },
          }] satisfies PendingRuntimeEvent[],
          result: undefined,
        };
      },
    );
    return { receipt, receiptContentId: stored.content.contentId, outputArtifactId: artifact.id };
  }
}
