import type { ExecutorFailureCode } from "../model.ts";

export class LauncherFailure extends Error {
  readonly safeReason: string;
  readonly code: ExecutorFailureCode;

  constructor(message: string, safeReason: string, code: ExecutorFailureCode = "unknown_failure") {
    super(message);
    this.safeReason = safeReason;
    this.code = code;
  }
}
