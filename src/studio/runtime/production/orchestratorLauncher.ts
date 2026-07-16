import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { canonicalSha256, ContentAddressedArtifactStore } from "./artifactStore.ts";
import {
  closedCodexExecArgs,
  tomlString,
  tomlStrings,
} from "./executor/codexInvocation.ts";
import { parseCodexEvents } from "./executor/codexEvents.ts";
import { LauncherFailure } from "./executor/launcherFailure.ts";
import {
  BoundedOrchestratorBridge,
  ORCHESTRATOR_SPAWN_TOOL,
  ORCHESTRATOR_WAIT_TOOL,
} from "./executor/orchestratorBridge.ts";
import { openOrchestratorBridge } from "./executor/orchestratorBridgeHttp.ts";
import {
  orchestratorOutputSchema,
  orchestratorPrompt,
  validateOrchestratorResult,
  type OrchestratorResult,
} from "./executor/orchestratorContract.ts";
import { runBoundedProcess, type ProcessResult } from "./executor/processRunner.ts";
import type { RuntimeLedger } from "./journal.ts";
import type {
  ExecutorSpanReceipt,
  LaunchPermit,
  ModelUsageReceipt,
  TaskRecord,
} from "./model.ts";
import type { PendingRuntimeEvent } from "./protocol.ts";
import { BoundedRuntimeScheduler } from "./scheduler.ts";

export interface OrchestratorChildLauncher {
  launch(permit: LaunchPermit): Promise<unknown>;
}

export interface CodexOrchestratorLauncherOptions {
  executable?: string;
  executableArgsPrefix?: string[];
  /** Required: the proof never accepts an ambient/default model identity. */
  model: string;
  temporaryRoot?: string;
  maximumWallMs?: number;
  maxStdoutBytes?: number;
  maxStderrBytes?: number;
  now?: () => Date;
  monotonicNow?: () => number;
  nextExecutionId?: () => string;
  orchestratorMcpServerPath?: string;
}

export interface CodexOrchestratorLaunchResult {
  execution: ExecutorSpanReceipt;
  usage: ModelUsageReceipt;
  decision: OrchestratorResult;
}

export class CodexExecOrchestratorLauncher {
  private readonly ledger: RuntimeLedger;
  private readonly scheduler: BoundedRuntimeScheduler;
  private readonly artifacts: ContentAddressedArtifactStore;
  private readonly childLauncher: OrchestratorChildLauncher;
  private readonly options: Required<Pick<CodexOrchestratorLauncherOptions,
    "executable" | "model" | "maximumWallMs" | "maxStdoutBytes" | "maxStderrBytes" | "now" | "monotonicNow" | "nextExecutionId">> &
    Pick<CodexOrchestratorLauncherOptions, "executableArgsPrefix" | "temporaryRoot" | "orchestratorMcpServerPath">;
  private versionPromise: Promise<string> | null = null;

  constructor(
    ledger: RuntimeLedger,
    scheduler: BoundedRuntimeScheduler,
    artifacts: ContentAddressedArtifactStore,
    childLauncher: OrchestratorChildLauncher,
    options: CodexOrchestratorLauncherOptions,
  ) {
    if (!options.model?.trim()) throw new Error("Codex orchestrator requires an explicitly configured model identity");
    this.ledger = ledger;
    this.scheduler = scheduler;
    this.artifacts = artifacts;
    this.childLauncher = childLauncher;
    this.options = {
      executable: options.executable ?? "codex",
      executableArgsPrefix: options.executableArgsPrefix,
      model: options.model,
      temporaryRoot: options.temporaryRoot,
      maximumWallMs: options.maximumWallMs ?? 120_000,
      maxStdoutBytes: options.maxStdoutBytes ?? 2 * 1024 * 1024,
      maxStderrBytes: options.maxStderrBytes ?? 256 * 1024,
      now: options.now ?? (() => new Date()),
      monotonicNow: options.monotonicNow ?? (() => performance.now()),
      nextExecutionId: options.nextExecutionId ?? (() => `execution:${randomUUID()}`),
      orchestratorMcpServerPath: options.orchestratorMcpServerPath,
    };
  }

  private commandArgs(args: string[]): string[] {
    return [...(this.options.executableArgsPrefix ?? []), ...args];
  }

  private async version(): Promise<string> {
    if (!this.versionPromise) {
      this.versionPromise = mkdtemp(join(this.options.temporaryRoot ?? tmpdir(), "studio-codex-root-version-")).then(async (directory) => {
        try {
          const result = await runBoundedProcess({
            executable: this.options.executable,
            args: this.commandArgs(["--version"]),
            cwd: directory,
            stdin: "",
            timeoutMs: 5_000,
            maxStdoutBytes: 32 * 1024,
            maxStderrBytes: 32 * 1024,
          });
          const version = result.stdout.trim();
          if (result.exitCode !== 0 || result.timedOut || result.outputOverflow || !version) {
            throw new Error("Codex executable did not return a bounded version");
          }
          return version;
        } finally {
          await rm(directory, { recursive: true, force: true });
        }
      });
    }
    return this.versionPromise;
  }

  private async recordUsage(
    executionId: string,
    task: TaskRecord,
    version: string,
    parsed: ReturnType<typeof parseCodexEvents>,
  ): Promise<ModelUsageReceipt> {
    const raw = await this.artifacts.storeJson(parsed.rawUsageEvent);
    const body = {
      executionId,
      taskId: task.id,
      agentId: task.assignedAgentId,
      producer: { id: "codex.exec" as const, version },
      model: this.options.model,
      measured: {
        inputTokens: parsed.usageEvent.usage.input_tokens,
        cachedInputTokens: parsed.usageEvent.usage.cached_input_tokens,
        outputTokens: parsed.usageEvent.usage.output_tokens,
        reasoningOutputTokens: parsed.usageEvent.usage.reasoning_output_tokens,
      },
      providerUnits: null,
      billing: { amount: null, currency: null },
      rawReceipt: {
        source: "codex.exec.turn.completed" as const,
        contentId: raw.content.contentId,
        storageKey: raw.storageKey,
      },
    };
    const receipt: ModelUsageReceipt = {
      schema: "studio.model-usage.receipt.v1",
      receiptId: `usage:${canonicalSha256(body)}`,
      ...body,
    };
    await this.ledger.transact(
      { producer: { kind: "launcher", id: "codex-exec-orchestrator-launcher" }, causationId: executionId },
      () => ({
        pending: [{ type: "model.usage_recorded", data: { receipt } }] satisfies PendingRuntimeEvent[],
        result: undefined,
      }),
    );
    return receipt;
  }

  private span(input: {
    executionId: string;
    task: TaskRecord;
    version: string;
    startedAt: string;
    durationMs: number;
    process: Pick<ProcessResult, "exitCode" | "signal">;
    outcome: "completed" | "failed" | "timed_out";
    usageReceiptId: string | null;
    failure: string | null;
  }): ExecutorSpanReceipt {
    const body = {
      executionId: input.executionId,
      taskId: input.task.id,
      agentId: input.task.assignedAgentId,
      phase: "active" as const,
      producer: {
        id: "codex.exec" as const,
        version: input.version,
        sandbox: "read-only" as const,
        ephemeral: true as const,
      },
      startedAt: input.startedAt,
      endedAt: this.options.now().toISOString(),
      monotonicDurationMs: input.durationMs,
      outcome: input.outcome,
      process: { exitCode: input.process.exitCode, signal: input.process.signal },
      outputArtifactIds: [],
      modelUsageReceiptId: input.usageReceiptId,
      failure: input.failure,
    };
    return { schema: "studio.executor-span.receipt.v1", receiptId: `span:${canonicalSha256(body)}`, ...body };
  }

  async launch(permit: LaunchPermit): Promise<CodexOrchestratorLaunchResult> {
    const scheduled = this.ledger.state().tasks[permit.taskId];
    if (
      !scheduled || scheduled.workerKind !== "orchestrator" || scheduled.parentTaskId !== null ||
      scheduled.status !== "scheduled" || scheduled.ownerAgentId !== null ||
      JSON.stringify(scheduled.grants.map((grant) => grant.capability).sort()) !==
        JSON.stringify(["task.reports.wait", "task.spawn.request"])
    ) throw new Error("Orchestrator permit does not reference one exact unowned root contract");

    const launchClaim = await this.scheduler.claimTaskLaunch(permit, "codex", this.options.now().toISOString());
    if (!launchClaim.won) throw new Error("Root already has a durable launch claim and cannot start another executor");
    const version = await this.version();
    await this.scheduler.registerAgent(permit);
    await this.scheduler.transitionTask(permit.taskId, permit.agentId, "working");
    const task = this.ledger.state().tasks[permit.taskId];
    const executionId = this.options.nextExecutionId();
    const startedAt = this.options.now().toISOString();
    const monotonicStart = this.options.monotonicNow();
    await this.ledger.transact(
      { producer: { kind: "launcher", id: "codex-exec-orchestrator-launcher" }, causationId: permit.requestId },
      () => ({
        pending: [{ type: "executor.started", data: {
          executionId,
          taskId: task.id,
          agentId: task.assignedAgentId,
          launchClaimId: launchClaim.claim.id,
          startedAt,
        } }] satisfies PendingRuntimeEvent[],
        result: undefined,
      }),
    );

    const directory = await mkdtemp(join(this.options.temporaryRoot ?? tmpdir(), "studio-codex-orchestrator-"));
    const schemaPath = join(directory, "orchestrator-output.schema.json");
    await writeFile(schemaPath, `${JSON.stringify(orchestratorOutputSchema)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    const bridge = await openOrchestratorBridge(new BoundedOrchestratorBridge({
      task,
      executionId,
      ledger: this.ledger,
      scheduler: this.scheduler,
      childLauncher: this.childLauncher,
    }));
    let processResult: ProcessResult | null = null;
    let usage: ModelUsageReceipt | null = null;
    let finished = false;
    try {
      const serverPath = this.options.orchestratorMcpServerPath ?? fileURLToPath(
        new URL("./executor/orchestratorMcpServer.ts", import.meta.url),
      );
      const args = closedCodexExecArgs();
      args.push(
        "-c", `mcp_servers.studio_orchestrator.command=${tomlString(process.execPath)}`,
        "-c", `mcp_servers.studio_orchestrator.args=${tomlStrings([serverPath])}`,
        "-c", "mcp_servers.studio_orchestrator.required=true",
        "-c", `mcp_servers.studio_orchestrator.enabled_tools=${tomlStrings([ORCHESTRATOR_SPAWN_TOOL, ORCHESTRATOR_WAIT_TOOL])}`,
        "-c", "mcp_servers.studio_orchestrator.startup_timeout_sec=5",
        "-c", `mcp_servers.studio_orchestrator.tool_timeout_sec=${Math.max(1, Math.ceil(Math.min(task.budget.wallMs, this.options.maximumWallMs) / 1_000))}`,
        "-c", `mcp_servers.studio_orchestrator.env_vars=${tomlStrings(["STUDIO_ORCHESTRATOR_BRIDGE_URL", "STUDIO_ORCHESTRATOR_BRIDGE_TOKEN"])}`,
        "--output-schema", schemaPath,
        "--model", this.options.model,
        "-",
      );
      processResult = await runBoundedProcess({
        executable: this.options.executable,
        args: this.commandArgs(args),
        cwd: directory,
        stdin: orchestratorPrompt(task),
        env: {
          ...process.env,
          STUDIO_ORCHESTRATOR_BRIDGE_URL: bridge.endpoint,
          STUDIO_ORCHESTRATOR_BRIDGE_TOKEN: bridge.token,
        },
        timeoutMs: Math.min(task.budget.wallMs, this.options.maximumWallMs),
        maxStdoutBytes: this.options.maxStdoutBytes,
        maxStderrBytes: this.options.maxStderrBytes,
      });
      if (processResult.timedOut) throw new LauncherFailure("Codex orchestrator timed out", "Codex orchestrator exceeded its active wall-time limit.");
      if (processResult.outputOverflow) throw new LauncherFailure("Codex orchestrator exceeded output bounds", "Codex orchestrator exceeded its output limit.");
      if (processResult.exitCode !== 0) throw new LauncherFailure("Codex orchestrator exited without completion", "Codex orchestrator exited without a completed turn.");
      const parsed = parseCodexEvents(processResult.stdout);
      usage = await this.recordUsage(executionId, task, version, parsed);
      let value: unknown;
      try {
        value = JSON.parse(parsed.finalMessage);
      } catch {
        throw new LauncherFailure("Codex orchestrator final response is not JSON", "Codex orchestrator response failed its output contract.");
      }
      const decision = validateOrchestratorResult(value);
      const state = this.ledger.state();
      const calls = Object.values(state.orchestratorToolCalls).filter((call) => call.executionId === executionId);
      const spawns = calls.filter((call) => call.tool === "task_spawn_request");
      const waits = calls.filter((call) => call.tool === "task_reports_wait");
      const requiresDelegation = task.objective.startsWith("Delegate at least");
      const requiresCoverageStudyDelegation = task.objective.startsWith("Delegate at least two bounded coverage-study tasks");
      if (requiresDelegation && spawns.length === 0) {
        throw new LauncherFailure("Orchestrator omitted required delegation", "Codex orchestrator did not issue the required spawn tool call.");
      }
      if (requiresCoverageStudyDelegation) {
        const acceptedCoverageRequests = spawns
          .map((call) => call.spawnRequestId ? state.spawnRequests[call.spawnRequestId] : null)
          .filter((request) => request?.accepted === true);
        if (acceptedCoverageRequests.length < 2) {
          throw new LauncherFailure("Orchestrator omitted required coverage-study depth", "Codex orchestrator did not produce two accepted bounded coverage-study child contracts.");
        }
        for (const request of acceptedCoverageRequests) {
          const outputs = request!.input.requiredOutputs;
          const capabilities = new Set(request!.input.requiredCapabilities);
          if (
            outputs.length !== 1 || outputs[0].required !== true || outputs[0].artifactKind !== "studio.study-report.v1" ||
            !capabilities.has("speech.transcribe") || !capabilities.has("report.submit")
          ) {
            throw new LauncherFailure("Orchestrator changed the coverage-study child contract", "Codex orchestrator returned an accepted child outside the typed coverage-study boundary.");
          }
        }
      }
      if ((decision.outcome === "no_request") !== (spawns.length === 0)) {
        throw new LauncherFailure("Orchestrator result disagrees with spawn evidence", "Codex orchestrator response disagreed with its receipted tool calls.");
      }
      if (spawns.length > 0 && (waits.length === 0 || waits.some((call) => state.reportWaits[call.id]?.status !== "returned"))) {
        throw new LauncherFailure("Orchestrator returned before closed child wait evidence", "Codex orchestrator did not finish its required report wait.");
      }
      await this.ledger.transact(
        { producer: { kind: "launcher", id: "codex-exec-orchestrator-launcher" }, causationId: executionId },
        () => ({
          pending: [{ type: "orchestrator.decision_recorded", data: {
            decision: { executionId, taskId: task.id, outcome: decision.outcome, reason: decision.reason },
          } }] satisfies PendingRuntimeEvent[],
          result: undefined,
        }),
      );
      const span = this.span({
        executionId,
        task,
        version,
        startedAt,
        durationMs: Math.max(0, Math.round(this.options.monotonicNow() - monotonicStart)),
        process: processResult,
        outcome: "completed",
        usageReceiptId: usage.receiptId,
        failure: null,
      });
      await this.artifacts.storeJson(span);
      await this.ledger.transact(
        { producer: { kind: "launcher", id: "codex-exec-orchestrator-launcher" }, causationId: executionId },
        () => ({ pending: [{ type: "executor.finished", data: { receipt: span } }] satisfies PendingRuntimeEvent[], result: undefined }),
      );
      finished = true;
      return { execution: span, usage, decision };
    } catch (error) {
      if (!finished && this.ledger.state().executions[executionId]?.status === "active") {
        const failure = error instanceof LauncherFailure ? error.safeReason : "Codex orchestrator could not complete its closed execution boundary.";
        const span = this.span({
          executionId,
          task,
          version,
          startedAt,
          durationMs: Math.max(0, Math.round(this.options.monotonicNow() - monotonicStart)),
          process: processResult ?? { exitCode: null, signal: null },
          outcome: processResult?.timedOut ? "timed_out" : "failed",
          usageReceiptId: usage?.receiptId ?? null,
          failure,
        });
        await this.artifacts.storeJson(span);
        await this.ledger.transact(
          { producer: { kind: "launcher", id: "codex-exec-orchestrator-launcher" }, causationId: executionId },
          () => ({ pending: [{ type: "executor.finished", data: { receipt: span } }] satisfies PendingRuntimeEvent[], result: undefined }),
        );
        await this.scheduler.transitionTask(task.id, task.assignedAgentId, "failed", failure);
      }
      throw error;
    } finally {
      await bridge.close();
      await rm(directory, { recursive: true, force: true });
    }
  }
}
