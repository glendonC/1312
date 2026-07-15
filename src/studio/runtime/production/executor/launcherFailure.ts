export class LauncherFailure extends Error {
  readonly safeReason: string;

  constructor(message: string, safeReason: string) {
    super(message);
    this.safeReason = safeReason;
  }
}
