import type { RuntimeLedger } from "../journal.ts";
import type { AgentRecoveryTerminalReceipt, LaunchPermit } from "../model.ts";
import {
  BoundedRuntimeScheduler,
  type AgentRecoveryDecision,
} from "../scheduler.ts";

interface ChildLauncher {
  launch(permit: LaunchPermit): Promise<unknown>;
}

export interface InitialCoverageRecoveryResult {
  decisions: AgentRecoveryDecision[];
  terminals: AgentRecoveryTerminalReceipt[];
  replacementTaskIds: string[];
}

/** Same-process host continuation for required generalized initial coverage only. */
export class InitialCoverageRecoveryHost {
  private readonly ledger: RuntimeLedger;
  private readonly scheduler: BoundedRuntimeScheduler;
  private readonly childLauncher: ChildLauncher;

  constructor(
    ledger: RuntimeLedger,
    scheduler: BoundedRuntimeScheduler,
    childLauncher: ChildLauncher,
  ) {
    this.ledger = ledger;
    this.scheduler = scheduler;
    this.childLauncher = childLauncher;
  }

  async recover(rootExecutionId: string, failedTaskIds: readonly string[]): Promise<InitialCoverageRecoveryResult> {
    const decisions: AgentRecoveryDecision[] = [];
    const terminals: AgentRecoveryTerminalReceipt[] = [];
    const replacementTaskIds: string[] = [];
    for (const failedTaskId of [...new Set(failedTaskIds)].sort()) {
      const decision = await this.scheduler.authorizeInitialCoverageRecovery(rootExecutionId, failedTaskId);
      decisions.push(decision);
      if (decision.decision !== "authorized" || !decision.permit || !decision.workId) continue;
      replacementTaskIds.push(decision.permit.taskId);
      try {
        await this.childLauncher.launch(decision.permit);
      } catch (error) {
        if (error instanceof Error && error.name === "RuntimeApplicationInterrupted") throw error;
        const child = this.ledger.state().tasks[decision.permit.taskId];
        if (child && (child.status === "working" || child.status === "scheduled") && child.ownerAgentId === decision.permit.agentId) {
          await this.scheduler.transitionTask(
            child.id,
            child.assignedAgentId,
            "failed",
            "The authorized replacement failed before one terminal report became available.",
          ).catch(() => undefined);
        }
      }
      terminals.push(await this.scheduler.finalizeInitialCoverageRecovery(decision.workId));
    }
    return { decisions, terminals, replacementTaskIds };
  }
}
