import type {
  AgentRecoveryAuthorizationReceipt,
  AgentRecoveryTerminalReceipt,
  ExecutorFailureClassificationReceipt,
} from "../model.ts";
import type { RuntimeEventBase } from "./base.ts";

export interface ExecutorFailureClassifiedEvent extends RuntimeEventBase {
  type: "executor.failure_classified";
  data: { receipt: ExecutorFailureClassificationReceipt };
}

export interface AgentRecoveryAuthorizedEvent extends RuntimeEventBase {
  type: "agent.recovery_authorized";
  data: { receipt: AgentRecoveryAuthorizationReceipt };
}

export interface AgentRecoveryTerminalRecordedEvent extends RuntimeEventBase {
  type: "agent.recovery_terminal_recorded";
  data: { receipt: AgentRecoveryTerminalReceipt };
}
