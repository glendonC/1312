import { createHash } from "node:crypto";

import {
  canonicalJsonContentId,
  canonicalSha256,
  ContentAddressedArtifactStore,
} from "./artifactStore.ts";
import type {
  ExecutorSpanReceipt,
  RootOutputDispositionReceipt,
  RuntimeProjection,
  WorkerOutputEnvelope,
} from "./model.ts";
import { assertWorkerOutputEnvelope } from "./validation/artifacts.ts";
import { validateExecutorSpanReceipt } from "./validation/execution.ts";
import { validateRootOutputDispositionReceipt } from "./validation/rootHandoff.ts";

export interface VerifiedPromotedRootOutput {
  receipt: RootOutputDispositionReceipt;
  receiptArtifactId: string;
  receiptContentId: string;
  childOutput: WorkerOutputEnvelope;
  executorReceipt: ExecutorSpanReceipt;
  evidence: {
    mediaOperationIds: string[];
    evidenceReadOperationIds: string[];
    assessmentOperationIds: string[];
    decisionOperationIds: string[];
  };
}

async function storedJson(
  artifacts: ContentAddressedArtifactStore,
  contentId: string,
  context: string,
): Promise<unknown> {
  const bytes = await artifacts.receiptBytes(contentId);
  if (bytes.byteLength <= 0 || bytes.byteLength > 128 * 1024) {
    throw new Error(`${context} exceeds its bounded JSON contract`);
  }
  const measured = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  if (measured !== contentId) throw new Error(`${context} changed content identity`);
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    throw new Error(`${context} is invalid JSON`);
  }
  if (canonicalJsonContentId(value) !== contentId) throw new Error(`${context} is not canonical JSON`);
  return value;
}

function receiptIdentity(receipt: RootOutputDispositionReceipt): string {
  const body = structuredClone(receipt) as unknown as Record<string, unknown>;
  delete body.schema;
  delete body.receiptId;
  return `root-output-disposition-receipt:${canonicalSha256(body)}`;
}

/** Reopens the promoted child output, root receipt, and executor receipt before downstream use. */
export async function reopenPromotedRootOutputs(
  state: RuntimeProjection,
  artifacts: ContentAddressedArtifactStore,
): Promise<VerifiedPromotedRootOutput[]> {
  const verified: VerifiedPromotedRootOutput[] = [];
  const records = Object.values(state.rootOutputDispositions)
    .filter((record) => record.outcome === "promoted_to_root")
    .sort((left, right) => left.id.localeCompare(right.id));

  for (const record of records) {
    const receiptArtifact = state.artifacts[record.outputArtifactId];
    const childArtifact = state.artifacts[record.inputArtifactId];
    const report = state.reports[record.reportId];
    const spawn = state.spawnRequests[record.spawnRequestId];
    const child = state.tasks[record.childTaskId];
    const root = state.tasks[record.rootTaskId];
    if (
      !receiptArtifact || receiptArtifact.origin.kind !== "root_output_disposition" ||
      !childArtifact || childArtifact.origin.kind !== "worker_output" ||
      report?.status !== "accepted" || spawn?.accepted !== true ||
      child?.status !== "completed" || root?.depth !== 0
    ) throw new Error(`Promoted root output ${record.id} lost its accepted runtime lineage`);
    await Promise.all([
      artifacts.resolveVerified(receiptArtifact),
      artifacts.resolveVerified(childArtifact),
    ]);
    const receiptValue = await storedJson(artifacts, record.receiptContentId, "Stored root promotion receipt");
    validateRootOutputDispositionReceipt(receiptValue);
    const receipt = receiptValue;
    if (
      receipt.receiptId !== receiptIdentity(receipt) || receipt.receiptId !== record.receiptId ||
      receipt.dispositionId !== record.id || receipt.decision.outcome !== "promoted_to_root" ||
      receiptArtifact.content.contentId !== record.receiptContentId ||
      receiptArtifact.origin.dispositionId !== record.id ||
      receiptArtifact.origin.receiptId !== record.receiptId ||
      receiptArtifact.origin.receiptContentId !== record.receiptContentId ||
      receiptArtifact.origin.inputArtifactId !== childArtifact.id ||
      receipt.input.artifactId !== childArtifact.id ||
      receipt.input.contentId !== childArtifact.content.contentId ||
      receipt.input.executionId !== childArtifact.origin.executionId ||
      receipt.input.executorReceiptId !== childArtifact.origin.receiptId ||
      receipt.input.executorReceiptContentId !== childArtifact.origin.receiptContentId ||
      receipt.report.reportId !== report.id || receipt.report.decisionReason !== report.decisionReason ||
      receipt.delegation.spawnRequestId !== spawn.id ||
      receipt.delegation.childTaskId !== child.id || receipt.delegation.childAgentId !== child.assignedAgentId ||
      receipt.authority.rootTaskId !== root.id || receipt.authority.rootAgentId !== root.ownerAgentId
    ) throw new Error(`Promoted root output ${record.id} changed its receipt or handoff lineage`);

    const childValue = await storedJson(artifacts, childArtifact.content.contentId, "Stored accepted child output");
    assertWorkerOutputEnvelope(childValue);
    const childOutput = childValue;
    if (
      childOutput.executionId !== receipt.input.executionId ||
      childOutput.taskId !== receipt.delegation.childTaskId ||
      childOutput.agentId !== receipt.delegation.childAgentId ||
      childOutput.output.kind !== receipt.input.kind
    ) throw new Error(`Promoted root output ${record.id} changed its accepted child envelope`);

    const executorValue = await storedJson(
      artifacts,
      receipt.input.executorReceiptContentId,
      "Stored accepted child executor receipt",
    );
    validateExecutorSpanReceipt(executorValue, "Promoted root output verification", "executorReceipt");
    const executorReceipt = executorValue;
    if (
      executorReceipt.receiptId !== receipt.input.executorReceiptId ||
      executorReceipt.executionId !== receipt.input.executionId ||
      executorReceipt.taskId !== receipt.delegation.childTaskId ||
      executorReceipt.agentId !== receipt.delegation.childAgentId ||
      executorReceipt.outcome !== "completed" ||
      !executorReceipt.outputArtifactIds.includes(receipt.input.artifactId)
    ) throw new Error(`Promoted root output ${record.id} lost its completed executor lineage`);

    const mediaOperationIds: string[] = [];
    const evidenceReadOperationIds: string[] = [];
    const assessmentOperationIds: string[] = [];
    const decisionOperationIds: string[] = [];
    for (const grant of child.grants) {
      if (grant.capability === "media.extract" || grant.capability === "media.seek") {
        const operations = Object.values(state.operations).filter((operation) =>
          operation.taskId === child.id &&
          operation.agentId === child.assignedAgentId &&
          operation.grantId === grant.id &&
          operation.capability === grant.capability &&
          operation.status === "completed" &&
          grant.mediaScope.some((scope) =>
            scope.artifactId === operation.artifactId &&
            scope.trackId === operation.trackId &&
            scope.startMs === operation.startMs &&
            scope.endMs === operation.endMs
          )
        );
        if (operations.length !== grant.mediaScope.length) {
          throw new Error(`Promoted root output ${record.id} lacks its completed granted media evidence`);
        }
        mediaOperationIds.push(...operations.map((operation) => operation.id));
      } else if (grant.capability === "evidence.read") {
        const reads = Object.values(state.evidenceReads).filter((read) =>
          read.taskId === child.id &&
          read.agentId === child.assignedAgentId &&
          read.grantId === grant.id &&
          read.status === "completed" &&
          grant.evidenceScope.some((scope) =>
            scope.artifactId === read.artifactId &&
            scope.sourceArtifactId === read.sourceArtifactId &&
            scope.startMs === read.startMs &&
            scope.endMs === read.endMs
          )
        );
        if (reads.length !== grant.evidenceScope.length) {
          throw new Error(`Promoted root output ${record.id} lacks its completed granted evidence reads`);
        }
        evidenceReadOperationIds.push(...reads.map((read) => read.id));
      } else if (grant.capability === "analysis.evidence.assess") {
        const assessments = Object.values(state.evidenceAssessments).filter((assessment) =>
          assessment.taskId === child.id && assessment.agentId === child.assignedAgentId &&
          assessment.grantId === grant.id && assessment.status === "completed"
        );
        if (assessments.length !== 1) {
          throw new Error(`Promoted root output ${record.id} lacks its completed granted assessment`);
        }
        assessmentOperationIds.push(assessments[0].id);
      } else if (grant.capability === "analysis.evidence.decide") {
        const decisions = Object.values(state.evidenceDecisions).filter((decision) =>
          decision.taskId === child.id && decision.agentId === child.assignedAgentId &&
          decision.grantId === grant.id && decision.status === "completed"
        );
        if (decisions.length !== 1) {
          throw new Error(`Promoted root output ${record.id} lacks its completed granted evidence decision`);
        }
        decisionOperationIds.push(decisions[0].id);
      }
    }

    verified.push({
      receipt: structuredClone(receipt),
      receiptArtifactId: receiptArtifact.id,
      receiptContentId: receiptArtifact.content.contentId,
      childOutput: structuredClone(childOutput),
      executorReceipt: structuredClone(executorReceipt),
      evidence: {
        mediaOperationIds: mediaOperationIds.sort(),
        evidenceReadOperationIds: evidenceReadOperationIds.sort(),
        assessmentOperationIds: assessmentOperationIds.sort(),
        decisionOperationIds: decisionOperationIds.sort(),
      },
    });
  }
  return verified;
}
