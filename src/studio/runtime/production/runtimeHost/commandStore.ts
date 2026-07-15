import { randomUUID } from "node:crypto";
import {
  chmod,
  link,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
} from "node:fs/promises";
import { join, resolve } from "node:path";

import type { RuntimeHostCommandRecord } from "./model.ts";
import { assertRuntimeHostCommandRecord } from "./validation.ts";
import { RuntimeHostError } from "./errors.ts";

export interface RuntimeHostPaths {
  runtimeRoot: string;
  journalPath: string;
  artifactStoreRoot: string;
  runStartPath: string;
}

export interface CommandClaimResult {
  won: boolean;
  record: RuntimeHostCommandRecord;
}

function commandDigest(commandId: string): string {
  const match = /^runtime-start:([a-f0-9]{64})$/.exec(commandId);
  if (!match) throw new RuntimeHostError("invalid_command_id", "The command identity is malformed.");
  return match[1];
}

function runtimeName(runtimeId: string): string {
  if (!/^runtime:[a-f0-9-]{36}$/.test(runtimeId)) {
    throw new RuntimeHostError("invalid_runtime_id", "The runtime identity is malformed.");
  }
  return runtimeId;
}

async function writeSynced(path: string, value: unknown): Promise<void> {
  const handle = await open(path, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/** Filesystem-backed command registry. Identity and launch claims are atomic across processes. */
export class DurableRuntimeCommandStore {
  readonly root: string;
  private readonly commandsRoot: string;
  private readonly runtimesRoot: string;

  private constructor(root: string) {
    this.root = root;
    this.commandsRoot = join(root, "commands");
    this.runtimesRoot = join(root, "runtimes");
  }

  static async open(rootValue: string): Promise<DurableRuntimeCommandStore> {
    const root = resolve(rootValue);
    await mkdir(root, { recursive: true, mode: 0o700 });
    await chmod(root, 0o700);
    const store = new DurableRuntimeCommandStore(root);
    await mkdir(store.commandsRoot, { recursive: true, mode: 0o700 });
    await mkdir(store.runtimesRoot, { recursive: true, mode: 0o700 });
    return store;
  }

  private commandPath(commandId: string): string {
    return join(this.commandsRoot, `${commandDigest(commandId)}.json`);
  }

  private launchPath(commandId: string): string {
    return join(this.commandsRoot, `${commandDigest(commandId)}.launch.json`);
  }

  paths(runtimeId: string): RuntimeHostPaths {
    const runtimeRoot = join(this.runtimesRoot, runtimeName(runtimeId));
    return {
      runtimeRoot,
      journalPath: join(runtimeRoot, "events.ndjson"),
      artifactStoreRoot: join(runtimeRoot, "artifact-store"),
      runStartPath: join(runtimeRoot, "run-start.json"),
    };
  }

  private async readPath(path: string): Promise<RuntimeHostCommandRecord> {
    let value: unknown;
    try {
      value = JSON.parse(await readFile(path, "utf8")) as unknown;
      assertRuntimeHostCommandRecord(value);
      return value;
    } catch (error) {
      if (error instanceof RuntimeHostError) throw error;
      throw new RuntimeHostError(
        "stored_content_inconsistent",
        "A durable runtime command record is missing, malformed, or inconsistent.",
        409,
        { cause: error },
      );
    }
  }

  async read(commandId: string): Promise<RuntimeHostCommandRecord | null> {
    try {
      return await this.readPath(this.commandPath(commandId));
    } catch (error) {
      const cause = error as RuntimeHostError & { cause?: NodeJS.ErrnoException };
      if (cause.cause?.code === "ENOENT") return null;
      throw error;
    }
  }

  async claim(recordValue: RuntimeHostCommandRecord): Promise<CommandClaimResult> {
    assertRuntimeHostCommandRecord(recordValue);
    const record = structuredClone(recordValue);
    const destination = this.commandPath(record.commandId);
    const temporary = join(this.commandsRoot, `.claim-${randomUUID()}`);
    await writeSynced(temporary, record);
    try {
      try {
        await link(temporary, destination);
        return { won: true, record };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        return { won: false, record: await this.readPath(destination) };
      }
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }

  async replace(recordValue: RuntimeHostCommandRecord): Promise<RuntimeHostCommandRecord> {
    assertRuntimeHostCommandRecord(recordValue);
    const record = structuredClone(recordValue);
    const destination = this.commandPath(record.commandId);
    const temporary = join(this.commandsRoot, `.replace-${randomUUID()}`);
    await writeSynced(temporary, record);
    try {
      const current = await this.readPath(destination);
      if (
        current.commandId !== record.commandId ||
        current.requestContentId !== record.requestContentId ||
        current.runtimeId !== record.runtimeId ||
        current.journalId !== record.journalId ||
        current.acceptedAt !== record.acceptedAt
      ) {
        throw new RuntimeHostError(
          "stored_content_inconsistent",
          "A durable command transition attempted to change immutable accepted content.",
          409,
        );
      }
      await rename(temporary, destination);
      return record;
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }

  async claimLaunch(
    commandId: string,
    claim: { schema: "studio.local-runtime-launch-claim.v1"; hostInstanceId: string; processId: number; claimedAt: string },
  ): Promise<boolean> {
    const destination = this.launchPath(commandId);
    const temporary = join(this.commandsRoot, `.launch-${randomUUID()}`);
    await writeSynced(temporary, claim);
    try {
      try {
        await link(temporary, destination);
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
        throw error;
      }
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }

  async hasLaunchClaim(commandId: string): Promise<boolean> {
    try {
      const details = await stat(this.launchPath(commandId));
      return details.isFile() && details.size > 0;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }

  async createRuntimeDirectory(runtimeId: string): Promise<RuntimeHostPaths> {
    const paths = this.paths(runtimeId);
    try {
      await mkdir(paths.runtimeRoot, { recursive: false, mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new RuntimeHostError(
          "duplicate_runtime_directory",
          "The allocated runtime directory already exists; initialization stopped safely.",
          409,
          { cause: error },
        );
      }
      throw error;
    }
    return paths;
  }

  async list(): Promise<RuntimeHostCommandRecord[]> {
    const names = (await readdir(this.commandsRoot))
      .filter((name) => /^[a-f0-9]{64}\.json$/.test(name))
      .sort();
    const records: RuntimeHostCommandRecord[] = [];
    for (const name of names) records.push(await this.readPath(join(this.commandsRoot, name)));
    return records;
  }

  async findByRuntimeId(runtimeId: string): Promise<RuntimeHostCommandRecord | null> {
    const matches = (await this.list()).filter((record) => record.runtimeId === runtimeId);
    if (matches.length > 1) {
      throw new RuntimeHostError(
        "stored_content_inconsistent",
        "More than one command record claims the runtime identity.",
        409,
      );
    }
    return matches[0] ?? null;
  }

}
