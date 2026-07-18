import { canonicalSha256, type ContentAddressedArtifactStore } from "../artifactStore.ts";
import type { RuntimeLedger } from "../journal.ts";
import type {
  ResearchGapBinding,
  RestudiedResearchRequestInput,
  RestudiedResearchTriggerOption,
} from "../model.ts";
import type { PendingRuntimeEvent } from "../protocol.ts";
import type { BoundedRuntimeScheduler } from "../scheduler.ts";
import { inspectRestudiedStudy } from "../study/restudiedStudyRuntime.ts";
import type { RestudiedStudyInspection } from "../study/restudiedStudySynthesisHost.ts";
import { exact, object, string } from "../validation/primitives.ts";
import {
  restudiedResearchRequestInputId,
  restudiedResearchTriggerId,
  validateRestudiedResearchRequestInput,
} from "../validation/research.ts";
import { currentRestudiedResearchBasis } from "./restudiedResearchBasis.ts";

function same(left: unknown, right: unknown): boolean {
  return canonicalSha256(left) === canonicalSha256(right);
}

export interface VerifiedRestudiedResearchRequest {
  input: RestudiedResearchRequestInput;
  trigger: RestudiedResearchTriggerOption;
  gap: ResearchGapBinding;
}

/**
 * Cold-reopens the current v3 synthesis inputs and records a content-addressed, no-authority
 * research candidate. Only exact conflicting coverage yields a trigger; empty inputs remain a
 * durable proof that inspection happened but do not make research invokable.
 */
export class RestudiedResearchRequestHost {
  private readonly ledger: RuntimeLedger;
  private readonly artifacts: ContentAddressedArtifactStore;
  private readonly scheduler: BoundedRuntimeScheduler;

  constructor(ledger: RuntimeLedger, artifacts: ContentAddressedArtifactStore, scheduler: BoundedRuntimeScheduler) {
    this.ledger = ledger;
    this.artifacts = artifacts;
    this.scheduler = scheduler;
  }

  private derive(inspection: RestudiedStudyInspection): RestudiedResearchRequestInput {
    const state = this.ledger.state();
    const root = {
      taskId: inspection.root.taskId,
      agentId: inspection.root.agentId,
      executionId: inspection.root.executionId,
    };
    const basis = currentRestudiedResearchBasis(state, root);
    const inspectedReports = inspection.reports.map((entry) => ({
      admissionId: entry.admission.admissionId,
      reportArtifactId: entry.report.artifactId,
      reportContentId: entry.report.contentId,
    })).sort((left, right) => left.admissionId.localeCompare(right.admissionId));
    const basisReports = basis.reports.map((entry) => ({
      admissionId: entry.admissionId,
      reportArtifactId: entry.reportArtifactId,
      reportContentId: entry.reportContentId,
    }));
    if (!same(inspectedReports, basisReports)) throw new Error("Restudied research inspection changed its admitted report basis");
    const inspectedPasses = inspection.passes.map((entry) => entry.id).sort();
    if (!same(inspectedPasses, basis.passes.map((entry) => entry.passId))) {
      throw new Error("Restudied research inspection changed its terminal pass basis");
    }

    const triggers: RestudiedResearchTriggerOption[] = [];
    for (const coverage of inspection.coverage.filter((entry) => entry.state === "conflicting")) {
      const sourceArtifact = state.artifacts[coverage.artifactId];
      if (!sourceArtifact) throw new Error(`Restudied research coverage ${coverage.coverageId} lost its source artifact`);
      const body: Omit<RestudiedResearchTriggerOption, "triggerId"> = {
        basisId: basis.basisId,
        source: {
          artifactId: coverage.artifactId,
          contentId: sourceArtifact.content.contentId,
          trackId: coverage.trackId,
          startMs: coverage.startMs,
          endMs: coverage.endMs,
        },
        gap: {
          kind: "unresolved_restudy_conflict",
          coverageId: coverage.coverageId,
          detail: coverage.reason?.detail ?? "Cold-reopened v3 coverage preserves unresolved conflicting evidence.",
        },
        evidence: {
          state: "conflicting",
          preservedStates: [...coverage.preservedStates].sort(),
          rawStates: [...coverage.rawStates].sort(),
          claimIds: [...coverage.claimIds].sort(),
          citationIds: [...coverage.citationIds].sort(),
          passIds: [...coverage.passIds].sort(),
        },
      };
      triggers.push({ triggerId: restudiedResearchTriggerId(body), ...body });
    }
    triggers.sort((left, right) => left.triggerId.localeCompare(right.triggerId));
    const body: Omit<RestudiedResearchRequestInput, "inputId"> = {
      schema: "studio.research-request-input.v2",
      runId: state.runId,
      basis,
      triggers,
    };
    return validateRestudiedResearchRequestInput({ ...body, inputId: restudiedResearchRequestInputId(body) });
  }

  async inspect(root: { taskId: string; agentId: string; executionId: string }): Promise<RestudiedResearchRequestInput> {
    const { inspected } = await inspectRestudiedStudy(this.ledger, this.scheduler, this.artifacts, root.taskId);
    if (inspected.root.taskId !== root.taskId || inspected.root.agentId !== root.agentId || inspected.root.executionId !== root.executionId) {
      throw new Error("Restudied research inspection escaped its active root executor");
    }
    const input = this.derive(inspected);
    const transaction = await this.ledger.transact<RestudiedResearchRequestInput>(
      { producer: { kind: "research_host", id: "restudied-research-request-host" }, causationId: root.executionId },
      ({ state }) => {
        const existing = state.researchRequestInputs[input.inputId];
        if (existing) {
          if (!same(existing, input)) throw new Error(`Restudied research input ${input.inputId} changed projected content`);
          return { pending: [], result: existing };
        }
        return {
          pending: [{ type: "research.request_input_recorded", data: { input } }] satisfies PendingRuntimeEvent[],
          result: input,
        };
      },
    );
    return transaction.result;
  }

  async request(root: { taskId: string; agentId: string; executionId: string }, value: unknown): Promise<VerifiedRestudiedResearchRequest> {
    const item = object(value, "Restudied research model request", "request");
    exact(item, ["inputId", "triggerId"], "Restudied research model request", "request");
    const inputId = string(item.inputId, "Restudied research model request", "request.inputId");
    const triggerId = string(item.triggerId, "Restudied research model request", "request.triggerId");
    const input = await this.inspect(root);
    if (input.inputId !== inputId) throw new Error("Restudied research request used stale or forged host input");
    const matches = input.triggers.filter((entry) => entry.triggerId === triggerId);
    if (matches.length !== 1) throw new Error("Restudied research request requires one exact conflicting trigger");
    const trigger = matches[0];
    return {
      input,
      trigger,
      gap: {
        inputId: input.inputId,
        triggerId: trigger.triggerId,
        hypothesis: trigger.gap.detail,
        media: structuredClone(trigger.source),
      },
    };
  }
}
