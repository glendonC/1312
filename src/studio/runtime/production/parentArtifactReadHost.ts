import { canonicalSha256, ContentAddressedArtifactStore } from "./artifactStore.ts";
import type { RuntimeLedger } from "./journal.ts";
import type {
  ParentArtifactReadReceipt,
  ParentArtifactReadRequest,
  RuntimeProjection,
  StudyReportArtifact,
} from "./model.ts";
import { reopenParentArtifactDisposition } from "./parentArtifactAdmissionAudit.ts";
import type { PendingRuntimeEvent } from "./protocol.ts";
import {
  assertParentArtifactReadRequest,
  validateParentArtifactReadReceipt,
} from "./validation/studyReports.ts";

function authorize(state: RuntimeProjection, requestValue: unknown) {
  assertParentArtifactReadRequest(requestValue);
  const request: ParentArtifactReadRequest = structuredClone(requestValue);
  const parent = state.tasks[request.parentTaskId];
  const grant = state.parentArtifactReadGrants[request.grantId];
  if (
    !parent || parent.ownerAgentId !== request.parentAgentId ||
    (parent.status !== "working" && parent.status !== "waiting_for_children")
  ) throw new Error("Artifact read requires the exact active parent task owner");
  if (
    !grant || grant.capability !== "artifact.read" || grant.parentTaskId !== parent.id ||
    grant.parentAgentId !== parent.ownerAgentId || grant.runId !== state.runId ||
    request.contentIds.some((contentId) => !grant.contentScope.some((scope) => scope.contentId === contentId))
  ) throw new Error("Artifact read lacks a least-privilege grant for every exact content id");
  if (state.parentArtifactReads[request.operationId]) throw new Error(`Artifact read operation ${request.operationId} already exists`);
  const prior = Object.values(state.parentArtifactReads).filter((read) => read.grantId === grant.id && read.status === "completed");
  const usedBytes = prior.reduce((sum, read) => sum + (read.returnedBytes ?? 0), 0);
  const usedItems = prior.reduce((sum, read) => sum + (read.returnedItems ?? 0), 0);
  const scopes = request.contentIds.map((contentId) => grant.contentScope.find((scope) => scope.contentId === contentId)!);
  const requestedBytes = scopes.reduce((sum, scope) => sum + (state.artifacts[scope.artifactId]?.content.bytes ?? 0), 0);
  if (usedBytes + requestedBytes > grant.maxBytes || usedItems + scopes.length > grant.maxItems) {
    throw new Error("Artifact read exceeds the grant's hard byte or item ceiling");
  }
  return { request, grant, scopes };
}

export interface ParentArtifactReadResult {
  schema: "studio.parent-artifact-read-result.v1";
  operationId: string;
  grantId: string;
  artifacts: Array<{
    artifactId: string;
    contentId: string;
    schema: "studio.study-report.v1";
    content: StudyReportArtifact;
  }>;
  receipt: ParentArtifactReadReceipt;
}

/** Path-free structured read. Caller supplies no path or artifact id; prose mention grants no authority. */
export class ParentArtifactReadHost {
  private readonly ledger: RuntimeLedger;
  private readonly artifacts: ContentAddressedArtifactStore;
  constructor(
    ledger: RuntimeLedger,
    artifacts: ContentAddressedArtifactStore,
  ) {
    this.ledger = ledger;
    this.artifacts = artifacts;
  }

  async read(requestValue: unknown): Promise<ParentArtifactReadResult> {
    const authorized = authorize(this.ledger.state(), requestValue);
    await this.ledger.transact(
      { producer: { kind: "artifact_read_host", id: "parent-artifact-read-host" }, causationId: authorized.request.operationId },
      ({ state }) => {
        authorize(state, authorized.request);
        return {
          pending: [{ type: "parent.artifact_read_started", data: { request: authorized.request } }] satisfies PendingRuntimeEvent[],
          result: undefined,
        };
      },
    );
    try {
      const verified = await reopenParentArtifactDisposition(
        this.ledger.state(),
        this.artifacts,
        authorized.grant.dispositionId,
      );
      if (!verified.admission || verified.admission.grant.id !== authorized.grant.id) {
        throw new Error("Artifact read admission is absent or invalid");
      }
      const results = authorized.request.contentIds.map((contentId) => {
        if (verified.study.artifact.content.contentId !== contentId) throw new Error("Artifact read content escaped its admitted disposition");
        return {
          artifactId: verified.study.artifact.id,
          contentId,
          schema: "studio.study-report.v1" as const,
          content: structuredClone(verified.study.envelope),
        };
      });
      const returned = results.map((result) => ({
        artifactId: result.artifactId,
        contentId: result.contentId,
        schema: result.schema,
        bytes: this.ledger.state().artifacts[result.artifactId].content.bytes,
      }));
      const receiptBody = {
        operationId: authorized.request.operationId,
        runId: this.ledger.runId,
        authorization: {
          grantId: authorized.grant.id,
          parentTaskId: authorized.grant.parentTaskId,
          parentAgentId: authorized.grant.parentAgentId,
          dispositionId: authorized.grant.dispositionId,
        },
        requestedContentIds: [...authorized.request.contentIds],
        returned,
        consumed: {
          bytes: returned.reduce((sum, item) => sum + item.bytes, 0),
          items: returned.length,
        },
        ceilings: { maxBytes: authorized.grant.maxBytes, maxItems: authorized.grant.maxItems },
      };
      const receipt: ParentArtifactReadReceipt = {
        schema: "studio.parent-artifact-read.receipt.v1",
        receiptId: `parent-artifact-read-receipt:${canonicalSha256(receiptBody)}`,
        ...receiptBody,
      };
      validateParentArtifactReadReceipt(receipt, "Parent artifact read", "receipt");
      await this.ledger.transact(
        { producer: { kind: "artifact_read_host", id: "parent-artifact-read-host" }, causationId: authorized.request.operationId },
        () => ({
          pending: [{ type: "parent.artifact_read_completed", data: { operationId: authorized.request.operationId, receipt } }] satisfies PendingRuntimeEvent[],
          result: undefined,
        }),
      );
      return {
        schema: "studio.parent-artifact-read-result.v1",
        operationId: authorized.request.operationId,
        grantId: authorized.grant.id,
        artifacts: results,
        receipt,
      };
    } catch (error) {
      await this.ledger.transact(
        { producer: { kind: "artifact_read_host", id: "parent-artifact-read-host" }, causationId: authorized.request.operationId },
        () => ({
          pending: [{
            type: "parent.artifact_read_failed",
            data: { operationId: authorized.request.operationId, reason: "Admitted structured artifact bytes or lineage were absent or invalid." },
          }] satisfies PendingRuntimeEvent[],
          result: undefined,
        }),
      );
      throw error;
    }
  }
}
