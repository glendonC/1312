import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { dirname } from "node:path";

import { assertRuntimeEvent } from "./assertions.ts";
import type { RuntimeProjection } from "./model.ts";
import type { PendingRuntimeEvent, RuntimeEvent, RuntimeProducerKind } from "./protocol.ts";
import { applyRuntimeEvent, projectRuntimeEvents } from "./projection.ts";

export interface EventJournal {
  readAll(): Promise<RuntimeEvent[]>;
  appendBatch(events: readonly RuntimeEvent[]): Promise<void>;
}

export class RuntimeJournalConflict extends Error {
  constructor(message = "The runtime journal advanced before this transaction acquired its append claim.") {
    super(message);
    this.name = "RuntimeJournalConflict";
  }
}

export class MemoryEventJournal implements EventJournal {
  private readonly events: RuntimeEvent[] = [];

  async readAll(): Promise<RuntimeEvent[]> {
    return structuredClone(this.events);
  }

  async appendBatch(events: readonly RuntimeEvent[]): Promise<void> {
    this.events.push(...structuredClone(events));
  }
}

/** Newline-delimited, append-only runtime evidence journal. */
export class FileEventJournal implements EventJournal {
  private readonly path: string;

  constructor(path: string) {
    this.path = path;
  }

  async readAll(): Promise<RuntimeEvent[]> {
    let raw: string;
    try {
      raw = await readFile(this.path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    if (!raw.trim()) return [];
    return raw
      .trimEnd()
      .split("\n")
      .map((line, index) => {
        let value: unknown;
        try {
          value = JSON.parse(line);
        } catch (error) {
          throw new Error(`Runtime journal ${this.path}:${index + 1} is not valid JSON`, { cause: error });
        }
        assertRuntimeEvent(value, `Runtime journal ${this.path}:${index + 1}`);
        return value;
      });
  }

  async appendBatch(events: readonly RuntimeEvent[]): Promise<void> {
    if (events.length === 0) return;
    events.forEach((event, index) => assertRuntimeEvent(event, `Runtime journal append[${index}]`));
    await mkdir(dirname(this.path), { recursive: true });
    const lockPath = `${this.path}.append.lock`;
    let lock;
    for (let attempt = 0; attempt < 200; attempt += 1) {
      try {
        lock = await open(lockPath, "wx", 0o600);
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    }
    if (!lock) throw new RuntimeJournalConflict("The runtime journal append claim remained unavailable.");
    try {
      const current = await this.readAll();
      const expectedSeq = (current.at(-1)?.seq ?? 0) + 1;
      if (events[0].seq !== expectedSeq) throw new RuntimeJournalConflict();
      for (let index = 1; index < events.length; index += 1) {
        if (events[index].seq !== events[index - 1].seq + 1) {
          throw new RuntimeJournalConflict("The runtime journal append batch is not contiguous.");
        }
      }
      const handle = await open(this.path, "a", 0o600);
      try {
        await handle.writeFile(`${events.map((event) => JSON.stringify(event)).join("\n")}\n`, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
    } finally {
      await lock.close();
      await unlink(lockPath).catch(() => undefined);
    }
  }
}

export interface TransactionContext {
  state: RuntimeProjection;
  nextSeq: number;
}

export interface TransactionOptions {
  producer: { kind: RuntimeProducerKind; id: string };
  causationId?: string | null;
  correlationId?: string | null;
}

export class RuntimeLedger {
  private projection: RuntimeProjection;
  private tail: Promise<void> = Promise.resolve();
  readonly runId: string;
  private readonly journal: EventJournal;
  private readonly now: () => Date;

  private constructor(
    runId: string,
    journal: EventJournal,
    initial: RuntimeProjection,
    now: () => Date,
  ) {
    this.runId = runId;
    this.journal = journal;
    this.projection = initial;
    this.now = now;
  }

  static async open(
    runId: string,
    journal: EventJournal,
    options: { now?: () => Date } = {},
  ): Promise<RuntimeLedger> {
    const events = await journal.readAll();
    return new RuntimeLedger(runId, journal, projectRuntimeEvents(runId, events), options.now ?? (() => new Date()));
  }

  state(): RuntimeProjection {
    return structuredClone(this.projection);
  }

  async events(): Promise<RuntimeEvent[]> {
    return this.journal.readAll();
  }

  transact<T>(
    options: TransactionOptions,
    build: (context: TransactionContext) => { pending: PendingRuntimeEvent[]; result: T },
  ): Promise<{ events: RuntimeEvent[]; result: T }> {
    let resolveResult: (value: { events: RuntimeEvent[]; result: T }) => void;
    let rejectResult: (reason: unknown) => void;
    const result = new Promise<{ events: RuntimeEvent[]; result: T }>((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });

    const execute = async (): Promise<void> => {
      try {
        const built = build({ state: structuredClone(this.projection), nextSeq: this.projection.lastSeq + 1 });
        let next = this.projection;
        const events = built.pending.map((pending, index) => {
          const seq = this.projection.lastSeq + index + 1;
          const event = {
            schema: "studio.runtime.event.v1",
            runId: this.runId,
            seq,
            eventId: `event:${this.runId}:${seq}`,
            recordedAt: this.now().toISOString(),
            producer: options.producer,
            causationId: options.causationId ?? null,
            correlationId: options.correlationId ?? null,
            ...pending,
          } as RuntimeEvent;
          assertRuntimeEvent(event);
          next = applyRuntimeEvent(next, event);
          return event;
        });
        await this.journal.appendBatch(events);
        this.projection = next;
        resolveResult({ events, result: built.result });
      } catch (error) {
        rejectResult(error);
      }
    };

    this.tail = this.tail.then(execute, execute);
    return result;
  }
}
