import type { ContentAddressedArtifactStore } from "../artifactStore.ts";
import type { RuntimeLedger } from "../journal.ts";
import { RESEARCH_LIMITS, type ResearchRequestInput } from "../model.ts";
import { ResearchRequestHost } from "../research/researchRequestHost.ts";
import type { BoundedRuntimeScheduler, SpawnDecision } from "../scheduler.ts";

/**
 * Executor-authorized wrapper around the R1.0 ResearchRequestHost: it gates derivation on one
 * active owned root executor holding study.research, runs the host's deep reopen audit, then
 * submits the host-fixed child contract to scheduler.requestResearch. The model only ever echoes
 * {inputId, triggerId}; the child shape, budget, and capabilities are host-authored.
 */
export class ResearchRequestExecutionHost {
  private readonly ledger: RuntimeLedger;
  private readonly scheduler: BoundedRuntimeScheduler;
  private readonly host: ResearchRequestHost;

  constructor(ledger: RuntimeLedger, artifacts: ContentAddressedArtifactStore, scheduler: BoundedRuntimeScheduler) {
    this.ledger = ledger;
    this.scheduler = scheduler;
    this.host = new ResearchRequestHost(artifacts);
  }

  private authorized(executionId: string) {
    const state = this.ledger.state();
    const execution = state.executions[executionId];
    const root = execution ? state.tasks[execution.taskId] : undefined;
    if (!execution || execution.status !== "active" || !root || root.parentTaskId !== null || root.ownerAgentId !== execution.agentId) {
      throw new Error("Research inspection requires one active owned root executor");
    }
    if (!root.grants.some((grant) => grant.capability === "study.research")) {
      throw new Error("Research inspection requires a root study.research grant");
    }
    return { state, root, execution };
  }

  async inspect(executionId: string): Promise<ResearchRequestInput> {
    const { state } = this.authorized(executionId);
    return this.host.inspect(state);
  }

  async request(executionId: string, toolCallId: string, value: unknown): Promise<SpawnDecision> {
    const { state, root, execution } = this.authorized(executionId);
    const verified = await this.host.request(state, value);
    const trigger = verified.trigger;
    return this.scheduler.requestResearch({
      inputId: verified.gap.inputId,
      trigger,
      authorship: { executionId, toolCallId, taskId: root.id, agentId: execution.agentId },
      child: {
        workloadKey: `research:${trigger.triggerId}`,
        objective: "Investigate one exact unresolved study conflict with granted bounded web research. Search snippets are routing hints, never citations; only receipted document spans become cite-only external context. Nothing here upgrades transcript, claim-support, or caption authority.",
        workerKind: "analysis",
        workerLabel: "gap-context-research",
        mediaScope: [{ artifactId: trigger.source.artifactId, trackId: trigger.source.trackId, startMs: trigger.source.startMs, endMs: trigger.source.endMs }],
        inputArtifactIds: [trigger.source.artifactId],
        requiredOutputs: [{ name: "research context note", artifactKind: "studio.study-report.v2", required: true }],
        requiredCapabilities: ["research.investigate", "report.submit"],
        dependencies: [],
        budget: { wallMs: RESEARCH_LIMITS.maxWallMs, toolCalls: RESEARCH_LIMITS.maxCalls },
      },
    });
  }
}
