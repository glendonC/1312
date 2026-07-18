import type { ContentAddressedArtifactStore } from "../artifactStore.ts";
import type { RuntimeLedger } from "../journal.ts";
import {
  COMPUTER_USE_LIMITS,
  type ComputerUseRequestCandidate,
  type ComputerUseRequestInput,
} from "../model.ts";
import { auditResearchExhaustion } from "../research/researchAudit.ts";
import { currentRestudiedResearchBasis } from "../research/restudiedResearchBasis.ts";
import type { BoundedRuntimeScheduler, SpawnDecision } from "../scheduler.ts";
import { canonicalJson } from "../artifactStore/contentIdentity.ts";
import { computerUseCandidateId, computerUseRequestInputId } from "../validation/computerUse.ts";

function same(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function requestEcho(value: unknown): { inputId: string; candidateId: string } {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Computer-use request must echo one exact input and candidate identity");
  }
  const item = value as Record<string, unknown>;
  if (Object.keys(item).length !== 2 || typeof item.inputId !== "string" || !item.inputId ||
      typeof item.candidateId !== "string" || !item.candidateId) {
    throw new Error("Computer-use request accepts only inputId and candidateId");
  }
  return { inputId: item.inputId, candidateId: item.candidateId };
}

/** Root-authorized R2 candidate derivation. The model can only echo a cold-audited candidate. */
export class ComputerUseRequestExecutionHost {
  private readonly ledger: RuntimeLedger;
  private readonly artifacts: ContentAddressedArtifactStore;
  private readonly scheduler: BoundedRuntimeScheduler;

  constructor(
    ledger: RuntimeLedger,
    artifacts: ContentAddressedArtifactStore,
    scheduler: BoundedRuntimeScheduler,
  ) {
    this.ledger = ledger;
    this.artifacts = artifacts;
    this.scheduler = scheduler;
  }

  private authorized(executionId: string) {
    const state = this.ledger.state();
    const execution = state.executions[executionId];
    const root = execution ? state.tasks[execution.taskId] : undefined;
    if (!execution || execution.status !== "active" || !root || root.parentTaskId !== null ||
        root.ownerAgentId !== execution.agentId || !root.grants.some((grant) => grant.capability === "study.computer-use")) {
      throw new Error("Computer-use inspection requires one active owned root request grant");
    }
    return { state, root, execution };
  }

  async inspect(executionId: string): Promise<ComputerUseRequestInput> {
    const { state, root, execution } = this.authorized(executionId);
    const candidates: ComputerUseRequestCandidate[] = [];
    for (const exhaustion of Object.values(state.researchExhaustions).sort((left, right) => left.id.localeCompare(right.id))) {
      const researchTask = state.tasks[exhaustion.taskId];
      const input = state.researchRequestInputs[exhaustion.gap.inputId];
      if (researchTask?.parentTaskId !== root.id || !input || input.basis.root.taskId !== root.id ||
          input.basis.root.agentId !== root.ownerAgentId || input.basis.root.executionId !== execution.id) continue;
      let current;
      try { current = currentRestudiedResearchBasis(state, input.basis.root); }
      catch { continue; }
      const trigger = input.triggers.find((entry) => entry.triggerId === exhaustion.gap.triggerId);
      if (!same(current, input.basis) || !trigger || !same(trigger.source, exhaustion.gap.media) ||
          trigger.gap.detail !== exhaustion.gap.hypothesis) continue;
      const projectedArtifact = state.artifacts[exhaustion.outputArtifactId];
      if (projectedArtifact?.origin.kind !== "research_exhaustion_receipt" ||
          projectedArtifact.content.contentId !== exhaustion.receiptContentId) continue;
      const audited = await auditResearchExhaustion(this.artifacts, state.runId, exhaustion.receiptContentId);
      if (audited.receipt.receiptId !== exhaustion.id || audited.receiptArtifactId !== exhaustion.outputArtifactId ||
          audited.receipt.authorization.taskId !== researchTask.id ||
          audited.receipt.authorization.agentId !== researchTask.assignedAgentId ||
          audited.receipt.authorization.executionId !== exhaustion.executionId ||
          audited.receipt.authorization.launchClaimId !== exhaustion.launchClaimId ||
          !same(audited.receipt.gap, exhaustion.gap) || audited.receipt.reason !== exhaustion.reason) continue;
      const body = {
        exhaustionReceiptId: exhaustion.id,
        gap: structuredClone(exhaustion.gap),
        source: structuredClone(exhaustion.gap.media),
      };
      candidates.push({ candidateId: computerUseCandidateId(body), ...body });
    }
    const body: Omit<ComputerUseRequestInput, "inputId"> = {
      schema: "studio.computer-use-request-input.v1",
      runId: state.runId,
      candidates,
      nonClaims: { r1CauseIsAuthority: "not_claimed", liveExternalState: "not_available" },
    };
    return { inputId: computerUseRequestInputId(body), ...body };
  }

  async request(executionId: string, toolCallId: string, value: unknown): Promise<SpawnDecision> {
    const { root, execution } = this.authorized(executionId);
    const echo = requestEcho(value);
    const input = await this.inspect(executionId);
    const matches = input.candidates.filter((candidate) => candidate.candidateId === echo.candidateId);
    if (echo.inputId !== input.inputId || matches.length !== 1) {
      throw new Error("Computer-use request does not name one current cold-audited R1 cause");
    }
    const candidate = matches[0];
    return this.scheduler.requestComputerUse({
      inputId: input.inputId,
      candidate,
      authorship: { executionId, toolCallId, taskId: root.id, agentId: execution.agentId },
      child: {
        workloadKey: `computer-use:${candidate.candidateId}`,
        objective: "Inspect one sealed offline external-screen fixture for the exact unresolved gap. Return only cite-only screen context. It is not live state, truth, speech evidence, claim support, coverage support, caption text, or quality authority.",
        workerKind: "analysis",
        workerLabel: "gap-external-screen-context",
        mediaScope: [{
          artifactId: candidate.source.artifactId,
          trackId: candidate.source.trackId,
          startMs: candidate.source.startMs,
          endMs: candidate.source.endMs,
        }],
        inputArtifactIds: [candidate.source.artifactId],
        requiredOutputs: [{ name: "external screen context note", artifactKind: "studio.study-report.v2", required: true }],
        requiredCapabilities: ["computer.use.readonly", "report.submit"],
        dependencies: [],
        budget: { wallMs: COMPUTER_USE_LIMITS.maxWallMs, toolCalls: COMPUTER_USE_LIMITS.maxCalls },
      },
    });
  }
}
