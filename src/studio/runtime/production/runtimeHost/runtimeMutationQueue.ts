/** One mutation tail per runtime prevents independent host capabilities from racing journal heads. */
export class RuntimeMutationQueue {
  private readonly tails = new Map<string, Promise<unknown>>();

  async run<T>(runtimeId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(runtimeId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(operation);
    this.tails.set(runtimeId, next);
    try {
      return await next;
    } finally {
      if (this.tails.get(runtimeId) === next) this.tails.delete(runtimeId);
    }
  }
}
