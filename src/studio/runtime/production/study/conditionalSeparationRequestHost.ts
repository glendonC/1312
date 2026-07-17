import { canonicalSha256 } from "../artifactStore.ts";
import type { ContentAddressedArtifactStore } from "../artifactStore.ts";
import type { RuntimeLedger } from "../journal.ts";
import { CONDITIONAL_SEPARATION_LIMITS, type ConditionalSeparationRequestInput, type ConditionalSeparationTriggerOption } from "../model.ts";
import type { BoundedRuntimeScheduler, SpawnDecision } from "../scheduler.ts";
import type { SpeakerDiarizer } from "../speaker/diarizer.ts";
import { auditSpeakerOverlap } from "../speakerAudit.ts";
import { exact, object, string } from "../validation/primitives.ts";

function triggerId(value: Omit<ConditionalSeparationTriggerOption, "triggerId">): string {
  return `separation-trigger:${canonicalSha256(value)}`;
}

function inputId(value: Omit<ConditionalSeparationRequestInput, "inputId">): string {
  return `separation-request-input:${canonicalSha256(value)}`;
}

/** Host-derived, cold-audited list of exact U6.1 overlap cells eligible for U7. */
export class ConditionalSeparationRequestHost {
  private readonly ledger: RuntimeLedger;
  private readonly artifacts: ContentAddressedArtifactStore;
  private readonly scheduler: BoundedRuntimeScheduler;
  private readonly options: { speakerDiarizer?: SpeakerDiarizer };
  constructor(
    ledger: RuntimeLedger,
    artifacts: ContentAddressedArtifactStore,
    scheduler: BoundedRuntimeScheduler,
    options: { speakerDiarizer?: SpeakerDiarizer } = {},
  ) {
    this.ledger = ledger;
    this.artifacts = artifacts;
    this.scheduler = scheduler;
    this.options = options;
  }

  async inspect(executionId: string): Promise<ConditionalSeparationRequestInput> {
    const state = this.ledger.state();
    const execution = state.executions[executionId];
    const root = execution ? state.tasks[execution.taskId] : undefined;
    if (!execution || execution.status !== "active" || !root || root.parentTaskId !== null || root.ownerAgentId !== execution.agentId) {
      throw new Error("Conditional separation inspection requires one active owned root executor");
    }
    if (!root.grants.some((grant) => grant.capability === "study.separate")) {
      throw new Error("Conditional separation inspection requires a root study.separate grant");
    }
    const triggers: ConditionalSeparationTriggerOption[] = [];
    for (const operation of Object.values(state.speakerOverlapOperations).sort((left, right) => left.id.localeCompare(right.id))) {
      if (operation.status !== "completed") continue;
      const verified = await auditSpeakerOverlap(state, this.artifacts, operation.id, { diarizer: this.options.speakerDiarizer });
      for (const cell of verified.observations.accounting) {
        if (cell.state !== "conflicting" || cell.kind !== "overlap" || cell.uncertainty.reason !== "overlap_hypothesis_requires_speech_restudy") continue;
        if (cell.endMs - cell.startMs > CONDITIONAL_SEPARATION_LIMITS.maxRangeMs) continue;
        const body: Omit<ConditionalSeparationTriggerOption, "triggerId"> = {
          source: {
            artifactId: verified.observations.source.artifactId,
            contentId: verified.observations.source.contentId,
            trackId: verified.observations.source.audioTrackId,
            range: { startMs: cell.startMs, endMs: cell.endMs },
          },
          trigger: {
            kind: "u6_speaker_overlap",
            operationId: operation.id,
            observationsArtifactId: verified.observationsArtifact.id,
            observationsContentId: verified.observationsArtifact.content.contentId,
            receiptArtifactId: verified.receiptArtifact.id,
            receiptId: verified.receipt.receiptId,
            receiptContentId: verified.receiptArtifact.content.contentId,
            observationId: cell.observationId,
            range: { startMs: cell.startMs, endMs: cell.endMs },
          },
        };
        triggers.push({ triggerId: triggerId(body), ...body });
      }
    }
    const body: Omit<ConditionalSeparationRequestInput, "inputId"> = {
      schema: "studio.separation-request-input.v1",
      runId: state.runId,
      root: { taskId: root.id, agentId: execution.agentId, executionId: execution.id },
      triggers,
    };
    return { ...body, inputId: inputId(body) };
  }

  async request(executionId: string, toolCallId: string, value: unknown): Promise<SpawnDecision> {
    const item = object(value, "Conditional separation model request", "request");
    exact(item, ["inputId", "triggerId"], "Conditional separation model request", "request");
    const requestedInputId = string(item.inputId, "Conditional separation model request", "request.inputId");
    const requestedTriggerId = string(item.triggerId, "Conditional separation model request", "request.triggerId");
    const inspected = await this.inspect(executionId);
    if (requestedInputId !== inspected.inputId) throw new Error("Conditional separation request used stale or forged host input");
    const matches = inspected.triggers.filter((candidate) => candidate.triggerId === requestedTriggerId);
    if (matches.length !== 1) throw new Error("Conditional separation request requires one exact audited trigger");
    const selected = matches[0];
    return this.scheduler.requestConditionalSeparation({
      trigger: selected.trigger,
      authorship: { executionId, toolCallId, taskId: inspected.root.taskId, agentId: inspected.root.agentId },
      child: {
        workloadKey: `separation:${selected.trigger.observationId}`,
        objective: "Run one exact-range local source separation and raw-versus-stem comparison. Report only comparability and abstain from semantic or caption preference.",
        workerKind: "analysis",
        workerLabel: "conditional-source-separation",
        mediaScope: [{ artifactId: selected.source.artifactId, trackId: selected.source.trackId, startMs: selected.source.range.startMs, endMs: selected.source.range.endMs }],
        inputArtifactIds: [selected.source.artifactId],
        requiredOutputs: [{ name: "conditional separation note", artifactKind: "studio.study-report.v2", required: true }],
        requiredCapabilities: ["media.audio.separate", "report.submit"],
        dependencies: [],
        budget: { wallMs: CONDITIONAL_SEPARATION_LIMITS.maxWallMs, toolCalls: 1 },
      },
    });
  }
}
