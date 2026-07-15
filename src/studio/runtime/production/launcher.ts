import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { canonicalSha256, ContentAddressedArtifactStore } from "./artifactStore.ts";
import type { RuntimeLedger } from "./journal.ts";
import type {
  ExecutorSpanReceipt,
  LaunchPermit,
  ModelUsageReceipt,
  ReportRecord,
  RuntimeArtifact,
  TaskRecord,
  WorkerOutputEnvelope,
} from "./model.ts";
import type { PendingRuntimeEvent } from "./protocol.ts";
import { BoundedReportHost } from "./reportHost.ts";
import { BoundedRuntimeScheduler } from "./scheduler.ts";
import { FfmpegCapabilityHost } from "./mediaHost.ts";
import {
  BoundedChildMediaBridge,
  openChildMediaBridge,
  type ChildMediaCapabilityHost,
  type OpenChildMediaBridge,
} from "./executor/childMediaBridge.ts";
import {
  parseCodexEvents,
  type CodexUsageEvent,
} from "./executor/codexEvents.ts";
import { LauncherFailure } from "./executor/launcherFailure.ts";
import {
  validateWorkerResult,
  workerOutputSchema,
  workerPrompt,
} from "./executor/workerContract.ts";
import {
  runBoundedProcess as runProcess,
  type ProcessResult,
} from "./executor/processRunner.ts";

export interface CodexWorkerLaunchResult {
  execution: ExecutorSpanReceipt;
  usage: ModelUsageReceipt;
  artifacts: RuntimeArtifact[];
  report: ReportRecord;
}

export interface CodexWorkerLauncherOptions {
  executable?: string;
  /** Trusted host-only prefix used by exact launcher tests; worker input never reaches argv. */
  executableArgsPrefix?: string[];
  model?: string | null;
  temporaryRoot?: string;
  maxStdoutBytes?: number;
  maxStderrBytes?: number;
  maximumWallMs?: number;
  now?: () => Date;
  monotonicNow?: () => number;
  nextExecutionId?: () => string;
  nextMediaOperationId?: (capability: "media.extract" | "media.seek") => string;
  mediaHost?: ChildMediaCapabilityHost;
  mediaMcpServerPath?: string;
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function tomlStrings(values: readonly string[]): string {
  return `[${values.map(tomlString).join(",")}]`;
}

export class CodexExecWorkerLauncher {
  private readonly ledger: RuntimeLedger;
  private readonly scheduler: BoundedRuntimeScheduler;
  private readonly artifacts: ContentAddressedArtifactStore;
  private readonly reports: BoundedReportHost;
  private readonly options: Required<
    Pick<
      CodexWorkerLauncherOptions,
      "executable" | "maxStdoutBytes" | "maxStderrBytes" | "maximumWallMs" | "now" | "monotonicNow" | "nextExecutionId"
    >
  > &
    Pick<
      CodexWorkerLauncherOptions,
      "executableArgsPrefix" | "model" | "temporaryRoot" | "nextMediaOperationId" | "mediaMcpServerPath"
    >;
  private versionPromise: Promise<string> | null = null;
  private readonly mediaHost: ChildMediaCapabilityHost;

  constructor(
    ledger: RuntimeLedger,
    scheduler: BoundedRuntimeScheduler,
    artifacts: ContentAddressedArtifactStore,
    reports: BoundedReportHost,
    options: CodexWorkerLauncherOptions = {},
  ) {
    this.ledger = ledger;
    this.scheduler = scheduler;
    this.artifacts = artifacts;
    this.reports = reports;
    this.mediaHost = options.mediaHost ?? new FfmpegCapabilityHost(ledger, artifacts);
    this.options = {
      executable: options.executable ?? "codex",
      executableArgsPrefix: options.executableArgsPrefix,
      model: options.model ?? null,
      temporaryRoot: options.temporaryRoot,
      maxStdoutBytes: options.maxStdoutBytes ?? 2 * 1024 * 1024,
      maxStderrBytes: options.maxStderrBytes ?? 256 * 1024,
      maximumWallMs: options.maximumWallMs ?? 120_000,
      now: options.now ?? (() => new Date()),
      monotonicNow: options.monotonicNow ?? (() => performance.now()),
      nextExecutionId: options.nextExecutionId ?? (() => `execution:${randomUUID()}`),
      nextMediaOperationId: options.nextMediaOperationId,
      mediaMcpServerPath: options.mediaMcpServerPath,
    };
  }

  private commandArgs(args: string[]): string[] {
    return [...(this.options.executableArgsPrefix ?? []), ...args];
  }

  private async version(): Promise<string> {
    if (!this.versionPromise) {
      this.versionPromise = mkdtemp(join(this.options.temporaryRoot ?? tmpdir(), "studio-codex-version-")).then(
        async (directory) => {
          try {
            const result = await runProcess({
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
        },
      );
    }
    return this.versionPromise;
  }

  private async recordUsage(
    executionId: string,
    task: TaskRecord,
    version: string,
    usageEvent: CodexUsageEvent,
    rawUsageEvent: Record<string, unknown>,
  ): Promise<ModelUsageReceipt> {
    const raw = await this.artifacts.storeJson(rawUsageEvent);
    const body = {
      executionId,
      taskId: task.id,
      agentId: task.assignedAgentId,
      producer: { id: "codex.exec" as const, version },
      model: this.options.model ?? null,
      measured: {
        inputTokens: usageEvent.usage.input_tokens,
        cachedInputTokens: usageEvent.usage.cached_input_tokens,
        outputTokens: usageEvent.usage.output_tokens,
        reasoningOutputTokens: usageEvent.usage.reasoning_output_tokens,
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
      { producer: { kind: "launcher", id: "codex-exec-worker-launcher" }, causationId: executionId },
      () => ({
        pending: [{ type: "model.usage_recorded", data: { receipt } }] satisfies PendingRuntimeEvent[],
        result: undefined,
      }),
    );
    return receipt;
  }

  private spanReceipt(input: {
    executionId: string;
    task: TaskRecord;
    version: string;
    startedAt: string;
    endedAt: string;
    durationMs: number;
    outcome: ExecutorSpanReceipt["outcome"];
    process: Pick<ProcessResult, "exitCode" | "signal">;
    outputArtifactIds: string[];
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
      endedAt: input.endedAt,
      monotonicDurationMs: input.durationMs,
      outcome: input.outcome,
      process: { exitCode: input.process.exitCode, signal: input.process.signal },
      outputArtifactIds: input.outputArtifactIds,
      modelUsageReceiptId: input.usageReceiptId,
      failure: input.failure,
    };
    return {
      schema: "studio.executor-span.receipt.v1",
      receiptId: `span:${canonicalSha256(body)}`,
      ...body,
    };
  }

  async launch(permit: LaunchPermit): Promise<CodexWorkerLaunchResult> {
    const scheduled = this.ledger.state().tasks[permit.taskId];
    if (
      !scheduled ||
      scheduled.assignedAgentId !== permit.agentId ||
      scheduled.status !== "scheduled" ||
      scheduled.ownerAgentId !== null
    ) {
      throw new Error("Launch permit does not reference one unowned scheduled task");
    }
    if (
      !scheduled.grants.some((grant) => grant.capability === "report.submit") ||
      scheduled.grants.some((grant) => !["report.submit", "media.extract", "media.seek"].includes(grant.capability))
    ) {
      throw new Error("Codex executor supports only report.submit plus scheduler-granted media.extract/media.seek");
    }

    const version = await this.version();
    await this.scheduler.registerAgent(permit);
    await this.scheduler.transitionTask(permit.taskId, permit.agentId, "working");
    const task = this.ledger.state().tasks[permit.taskId];
    const executionId = this.options.nextExecutionId();
    const directory = await mkdtemp(join(this.options.temporaryRoot ?? tmpdir(), "studio-codex-worker-"));
    const schemaPath = join(directory, "worker-output.schema.json");
    await writeFile(schemaPath, `${JSON.stringify(workerOutputSchema(task))}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    const startedAt = this.options.now().toISOString();
    const monotonicStart = this.options.monotonicNow();
    await this.ledger.transact(
      { producer: { kind: "launcher", id: "codex-exec-worker-launcher" }, causationId: permit.requestId },
      () => ({
        pending: [
          { type: "executor.started", data: { executionId, taskId: task.id, agentId: task.assignedAgentId, startedAt } },
        ] satisfies PendingRuntimeEvent[],
        result: undefined,
      }),
    );

    let processResult: ProcessResult | null = null;
    let usage: ModelUsageReceipt | null = null;
    let executorFinished = false;
    let mediaBridge: OpenChildMediaBridge | null = null;
    try {
      const mediaCapabilities = task.grants
        .map((grant) => grant.capability)
        .filter((capability): capability is "media.extract" | "media.seek" =>
          capability === "media.extract" || capability === "media.seek");
      if (mediaCapabilities.length > 0) {
        mediaBridge = await openChildMediaBridge(new BoundedChildMediaBridge(task, this.mediaHost, {
          nextOperationId: this.options.nextMediaOperationId,
        }));
      }
      const args = [
        "exec",
        "--json",
        "--ephemeral",
        "--ignore-user-config",
        "--ignore-rules",
        "--sandbox",
        "read-only",
        "--skip-git-repo-check",
        "-c",
        "shell_environment_policy.inherit=none",
      ];
      if (mediaBridge) {
        const toolNames = mediaBridge.manifest.tools.map((tool) => tool.name);
        const serverPath = this.options.mediaMcpServerPath ?? fileURLToPath(
          new URL("./executor/mediaMcpServer.ts", import.meta.url),
        );
        args.push(
          "-c",
          `mcp_servers.studio_media.command=${tomlString(process.execPath)}`,
          "-c",
          `mcp_servers.studio_media.args=${tomlStrings([serverPath])}`,
          "-c",
          "mcp_servers.studio_media.required=true",
          "-c",
          `mcp_servers.studio_media.enabled_tools=${tomlStrings(toolNames)}`,
          "-c",
          "mcp_servers.studio_media.startup_timeout_sec=5",
          "-c",
          `mcp_servers.studio_media.tool_timeout_sec=${Math.max(1, Math.ceil(Math.min(task.budget.wallMs, this.options.maximumWallMs) / 1_000))}`,
          "-c",
          `mcp_servers.studio_media.env_vars=${tomlStrings([
            "STUDIO_CHILD_MEDIA_BRIDGE_URL",
            "STUDIO_CHILD_MEDIA_BRIDGE_TOKEN",
          ])}`,
        );
      }
      args.push("--output-schema", schemaPath);
      if (this.options.model) args.push("--model", this.options.model);
      args.push("-");
      processResult = await runProcess({
        executable: this.options.executable,
        args: this.commandArgs(args),
        cwd: directory,
        stdin: workerPrompt(task),
        env: mediaBridge ? {
          ...process.env,
          STUDIO_CHILD_MEDIA_BRIDGE_URL: mediaBridge.endpoint,
          STUDIO_CHILD_MEDIA_BRIDGE_TOKEN: mediaBridge.token,
        } : process.env,
        timeoutMs: Math.min(task.budget.wallMs, this.options.maximumWallMs),
        maxStdoutBytes: this.options.maxStdoutBytes,
        maxStderrBytes: this.options.maxStderrBytes,
      });
      if (processResult.timedOut) {
        throw new LauncherFailure("Codex worker timed out", "Codex executor exceeded its active wall-time limit.");
      }
      if (processResult.outputOverflow) {
        throw new LauncherFailure("Codex worker exceeded output bounds", "Codex executor exceeded its output limit.");
      }
      if (processResult.exitCode !== 0) {
        throw new LauncherFailure(
          `Codex worker exited ${processResult.exitCode ?? processResult.signal ?? "without status"}`,
          "Codex executor exited without a completed turn.",
        );
      }
      const parsed = parseCodexEvents(processResult.stdout);
      usage = await this.recordUsage(executionId, task, version, parsed.usageEvent, parsed.rawUsageEvent);
      if (mediaCapabilities.some((capability) =>
        !Object.values(this.ledger.state().operations).some((operation) =>
          operation.taskId === task.id && operation.capability === capability && operation.status === "completed"))) {
        throw new LauncherFailure(
          "Codex child did not complete every granted media capability",
          "Codex child did not complete its required receipted media operation.",
        );
      }
      let workerValue: unknown;
      try {
        workerValue = JSON.parse(parsed.finalMessage);
      } catch (error) {
        throw new LauncherFailure(
          `Codex final response is not JSON: ${error instanceof Error ? error.message : "invalid JSON"}`,
          "Codex worker response failed its output contract.",
        );
      }
      const worker = validateWorkerResult(workerValue, task);
      const prepared = await Promise.all(
        worker.outputs.map((output) => {
          const envelope: WorkerOutputEnvelope = {
            schema: "studio.worker-output.v1",
            executionId,
            taskId: task.id,
            agentId: task.assignedAgentId,
            output,
          };
          return this.artifacts.prepareWorkerOutput(this.ledger.runId, envelope);
        }),
      );
      const endedAt = this.options.now().toISOString();
      const durationMs = Math.max(0, Math.round(this.options.monotonicNow() - monotonicStart));
      const span = this.spanReceipt({
        executionId,
        task,
        version,
        startedAt,
        endedAt,
        durationMs,
        outcome: "completed",
        process: processResult,
        outputArtifactIds: prepared.map((output) => output.artifactId),
        usageReceiptId: usage.receiptId,
        failure: null,
      });
      const storedSpan = await this.artifacts.storeJson(span);
      const outputArtifacts = prepared.map((output) =>
        this.artifacts.buildWorkerOutputArtifact({
          runId: this.ledger.runId,
          receipt: span,
          receiptContentId: storedSpan.content.contentId,
          prepared: output,
        }),
      );
      for (const artifact of outputArtifacts) await this.artifacts.record(this.ledger, artifact, executionId);
      await this.ledger.transact(
        { producer: { kind: "launcher", id: "codex-exec-worker-launcher" }, causationId: executionId },
        () => ({
          pending: [{ type: "executor.finished", data: { receipt: span } }] satisfies PendingRuntimeEvent[],
          result: undefined,
        }),
      );
      executorFinished = true;
      let report: ReportRecord;
      try {
        report = await this.reports.submit({
          taskId: task.id,
          agentId: task.assignedAgentId,
          outputArtifactIds: outputArtifacts.map((artifact) => artifact.id),
          summary: worker.summary,
        });
      } catch (error) {
        await this.scheduler.transitionTask(
          task.id,
          task.assignedAgentId,
          "failed",
          "The executor completed but its structured report-up was rejected by the handoff host.",
        );
        throw error;
      }
      return { execution: span, usage, artifacts: outputArtifacts, report };
    } catch (error) {
      if (!executorFinished && this.ledger.state().executions[executionId]?.status === "active") {
        const endedAt = this.options.now().toISOString();
        const durationMs = Math.max(0, Math.round(this.options.monotonicNow() - monotonicStart));
        const failure = error instanceof LauncherFailure ? error.safeReason : "Codex executor could not be started.";
        const span = this.spanReceipt({
          executionId,
          task,
          version,
          startedAt,
          endedAt,
          durationMs,
          outcome: processResult?.timedOut ? "timed_out" : "failed",
          process: processResult ?? { exitCode: null, signal: null },
          outputArtifactIds: [],
          usageReceiptId: usage?.receiptId ?? null,
          failure,
        });
        await this.artifacts.storeJson(span);
        await this.ledger.transact(
          { producer: { kind: "launcher", id: "codex-exec-worker-launcher" }, causationId: executionId },
          () => ({
            pending: [{ type: "executor.finished", data: { receipt: span } }] satisfies PendingRuntimeEvent[],
            result: undefined,
          }),
        );
        await this.scheduler.transitionTask(task.id, task.assignedAgentId, "failed", failure);
      }
      throw error;
    } finally {
      if (mediaBridge) await mediaBridge.close();
      await rm(directory, { recursive: true, force: true });
    }
  }
}
