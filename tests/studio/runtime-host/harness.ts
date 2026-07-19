import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  DurableRuntimeCommandStore,
  DeterministicExecutionControl,
  DeterministicRuntimeExecutor,
  RuntimeSourceRegistry,
  RuntimeStartService,
  deterministicOrchestratorLauncherFactory,
} from "../../../src/studio/runtime/production/runtimeHost/index.ts";
import type { DeterministicOrchestratorMode } from "../../../src/studio/runtime/production/runtimeHost/deterministicOrchestrator.ts";
import type { RuntimeHostStartRequest } from "../../../src/studio/runtime/production/runtimeHost/model.ts";

export const FIXTURE = resolve("public/demo/runs/run-005");

export interface HostHarness {
  directory: string;
  store: DurableRuntimeCommandStore;
  sources: RuntimeSourceRegistry;
  executor: DeterministicRuntimeExecutor;
  service: RuntimeStartService;
  request: RuntimeHostStartRequest;
}

export function runtimeIds(): (commandId: string) => string {
  let count = 0;
  const identities = new Map<string, string>();
  return (commandId) => {
    const existing = identities.get(commandId);
    if (existing) return existing;
    count += 1;
    const identity = `runtime:00000000-0000-4000-8000-${count.toString().padStart(12, "0")}`;
    identities.set(commandId, identity);
    return identity;
  };
}

export async function hostHarness(options: {
  control?: DeterministicExecutionControl;
  mode?: "completed" | "failed" | "timed_out" | "interrupted";
  sourceDirectory?: string;
  recoverOnOpen?: boolean;
  reviewedMemoryStore?: string;
  orchestratorMode?: DeterministicOrchestratorMode;
} = {}): Promise<HostHarness> {
  const directory = await mkdtemp(join(tmpdir(), "studio-runtime-host-test-"));
  const sources = await RuntimeSourceRegistry.open({
    sourceDirectories: [options.sourceDirectory ?? FIXTURE],
  });
  const store = await DurableRuntimeCommandStore.open(join(directory, "host"));
  const executor = new DeterministicRuntimeExecutor({ mode: options.mode, control: options.control });
  const service = await RuntimeStartService.open({
    store,
    sources,
    launcherFactory: executor.factory(),
    orchestratorLauncherFactory: options.orchestratorMode
      ? deterministicOrchestratorLauncherFactory({ mode: options.orchestratorMode })
      : undefined,
    runtimeIdForCommand: runtimeIds(),
    recoverOnOpen: options.recoverOnOpen ?? false,
    ...(options.reviewedMemoryStore === undefined
      ? {}
      : { reviewedMemoryStore: options.reviewedMemoryStore }),
  });
  const source = sources.list()[0];
  return {
    directory,
    store,
    sources,
    executor,
    service,
    request: {
      sourceSessionId: source.sourceSessionId,
      sourceRevisionId: source.sourceRevisionId,
      range: { startMs: 0, endMs: 1_000 },
      requestedSourceLanguage: { mode: "declared", languages: ["ko"], reason: null },
      targetLanguage: "en",
      selectedLanguagePackId: "ko-v3",
      outputDepth: "evidence",
    },
  };
}

export async function cleanup(harness: HostHarness): Promise<void> {
  await rm(harness.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
}

export async function waitForLifecycle(
  service: RuntimeStartService,
  commandId: string,
  expected: "terminal" | "failed" | "interrupted" | "running",
): Promise<Awaited<ReturnType<RuntimeStartService["statusByCommand"]>>> {
  // The default owned path now closes four content-addressed U3 stages after its children.
  // Keep the polling bound finite while allowing concurrent integration cases to finish under load.
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const status = await service.statusByCommand(commandId);
    if (status.lifecycle === expected) return status;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`runtime did not reach ${expected}`);
}
