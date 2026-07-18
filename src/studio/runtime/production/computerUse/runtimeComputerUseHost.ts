import { buildComputerUseRuntimeArtifacts } from "../artifactStore/computerUseArtifacts.ts";
import type { ContentAddressedArtifactStore } from "../artifactStore.ts";
import type { RuntimeLedger } from "../journal.ts";
import type { CapabilityGrant, ComputerUseRequest, TaskRecord } from "../model.ts";
import type { PendingRuntimeEvent } from "../protocol.ts";
import { computerUseRequestFingerprint, computerUseSessionId } from "../validation/computerUse.ts";
import { BoundedComputerUseHost } from "./computerUseHost.ts";
import type { ReadOnlyExternalScreenDriver } from "./driver.ts";

/** Journal/executor binding around the unchanged S1 producer receipt. */
export class RuntimeComputerUseHost {
  private readonly ledger: RuntimeLedger;
  private readonly artifacts: ContentAddressedArtifactStore;
  private readonly task: TaskRecord;
  private readonly grant: Extract<CapabilityGrant, { capability: "computer.use.readonly" }>;
  private readonly execution: { executionId: string; launchClaimId: string };
  private readonly driver: ReadOnlyExternalScreenDriver;
  private readonly options: { temporaryRoot?: string; maximumWallMs?: number };

  constructor(
    ledger: RuntimeLedger,
    artifacts: ContentAddressedArtifactStore,
    task: TaskRecord,
    grant: Extract<CapabilityGrant, { capability: "computer.use.readonly" }>,
    execution: { executionId: string; launchClaimId: string },
    driver: ReadOnlyExternalScreenDriver,
    options: { temporaryRoot?: string; maximumWallMs?: number } = {},
  ) {
    this.ledger = ledger;
    this.artifacts = artifacts;
    this.task = structuredClone(task);
    this.grant = structuredClone(grant);
    this.execution = { ...execution };
    this.driver = driver;
    this.options = { ...options };
  }

  async inspect(requestValue: unknown) {
    const request = requestValue as ComputerUseRequest;
    const operationId = typeof request?.operationId === "string" ? request.operationId : "computer-use:invalid";
    let started = false;
    try {
      const sessionId = computerUseSessionId({ runId: this.ledger.runId, operationId, grantId: this.grant.id });
      await this.ledger.transact(
        { producer: { kind: "computer_use_host", id: "runtime-computer-use-host" }, causationId: operationId },
        () => ({
          pending: [{ type: "computer_use.operation_started", data: {
            request: structuredClone(requestValue) as ComputerUseRequest,
            scope: structuredClone(this.grant.computerUseScope),
            executionId: this.execution.executionId,
            launchClaimId: this.execution.launchClaimId,
            requestFingerprint: computerUseRequestFingerprint({ grantId: this.grant.id }),
            sessionId,
          } }] satisfies PendingRuntimeEvent[],
          result: undefined,
        }),
      );
      started = true;
      const producer = new BoundedComputerUseHost(
        this.ledger.runId,
        { taskId: this.task.id, agentId: this.task.assignedAgentId, grants: [{ id: this.grant.id, capability: "computer.use.readonly", computerUseScope: this.grant.computerUseScope }] },
        this.artifacts,
        { driver: this.driver, temporaryRoot: this.options.temporaryRoot, maximumWallMs: this.options.maximumWallMs },
      );
      const verified = await producer.inspect(requestValue);
      const sessionBytes = await this.artifacts.receiptBytes(verified.receiptContentId);
      const digest = verified.receiptContentId.replace(/^sha256:/, "");
      const built = buildComputerUseRuntimeArtifacts({
        runId: this.ledger.runId,
        taskId: this.task.id,
        agentId: this.task.assignedAgentId,
        mediaSourceArtifactId: this.grant.computerUseScope.gap.media.artifactId,
        r1CauseArtifactId: this.grant.computerUseScope.r1Cause.receiptArtifactId,
        verified,
        sessionContent: { algorithm: "sha256", digest, contentId: verified.receiptContentId, bytes: sessionBytes.length },
      });
      for (const artifact of built.artifacts) await this.artifacts.resolveVerified(artifact);
      await this.ledger.transact(
        { producer: { kind: "computer_use_host", id: "runtime-computer-use-host" }, causationId: operationId },
        () => ({
          pending: [
            ...built.artifacts.map((artifact) => ({ type: "artifact.recorded" as const, data: { artifact } })),
            { type: "computer_use.operation_completed", data: {
              operationId,
              fixtureArtifactId: built.fixtureArtifactId,
              screenshotArtifactIds: built.screenshotArtifactIds,
              visibleContentArtifactIds: built.visibleContentArtifactIds,
              actionArtifactIds: built.actionArtifactIds,
              sessionArtifactId: built.sessionArtifactId,
              sessionReceiptContentId: verified.receiptContentId,
              receipt: verified.receipt,
            } },
          ] satisfies PendingRuntimeEvent[],
          result: undefined,
        }),
      );
      return verified;
    } catch (error) {
      if (started && this.ledger.state().computerUseOperations[operationId]?.status === "started") {
        await this.ledger.transact(
          { producer: { kind: "computer_use_host", id: "runtime-computer-use-host" }, causationId: operationId },
          () => ({ pending: [{ type: "computer_use.operation_failed", data: { operationId, reason: "producer_failed" } }] satisfies PendingRuntimeEvent[], result: undefined }),
        ).catch(() => undefined);
      }
      throw error;
    }
  }
}
