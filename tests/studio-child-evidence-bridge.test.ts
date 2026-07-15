import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { ContentAddressedArtifactStore } from "../src/studio/runtime/production/artifactStore.ts";
import { BoundedEvidenceReadHost } from "../src/studio/runtime/production/evidenceHost.ts";
import {
  BoundedChildEvidenceBridge,
  callChildEvidenceBridge,
  fetchChildEvidenceManifest,
  openChildEvidenceBridge,
} from "../src/studio/runtime/production/executor/childEvidenceBridge.ts";
import { MemoryEventJournal, RuntimeLedger } from "../src/studio/runtime/production/journal.ts";
import { CodexExecWorkerLauncher } from "../src/studio/runtime/production/launcher.ts";
import type { SpawnRequestInput } from "../src/studio/runtime/production/model.ts";
import { BoundedReportHost } from "../src/studio/runtime/production/reportHost.ts";
import { loadOwnedSourceSession } from "../src/studio/runtime/production/runStart/sourceSessionLoader.ts";
import { BoundedRuntimeScheduler, type RuntimeIdentityFactory } from "../src/studio/runtime/production/scheduler.ts";
import { projectProductionRuntimeJournal } from "../src/studio/runtime/production/studioProjection.ts";

const FIXTURE = resolve("public/demo/runs/run-005");
const MCP_SERVER = resolve("src/studio/runtime/production/executor/evidenceMcpServer.ts");

class SequenceIdentities implements RuntimeIdentityFactory {
  private value = 0;

  next(kind: "request" | "task" | "agent" | "grant"): string {
    this.value += 1;
    return `${kind}:evidence-bridge-${this.value}`;
  }

  secret(): string {
    this.value += 1;
    return `secret-${this.value}`;
  }
}

async function evidenceHarness(registerChild = true) {
  const directory = await mkdtemp(join(tmpdir(), "studio-child-evidence-bridge-"));
  const loaded = await loadOwnedSourceSession(FIXTURE);
  const artifacts = new ContentAddressedArtifactStore(join(directory, "artifacts"));
  const source = await artifacts.registerSource("runtime:child-evidence-bridge", loaded.descriptor);
  const evidence = await Promise.all(loaded.evidenceDescriptors.map((descriptor) =>
    artifacts.registerPreflightEvidence("runtime:child-evidence-bridge", source.id, descriptor)));
  assert.equal(evidence.length, 2);
  const ledger = await RuntimeLedger.open("runtime:child-evidence-bridge", new MemoryEventJournal(), {
    now: () => new Date("2026-07-15T12:00:00.000Z"),
  });
  await artifacts.record(ledger, source);
  for (const artifact of evidence) await artifacts.record(ledger, artifact);
  const scheduler = new BoundedRuntimeScheduler(ledger, {
    maxDepth: 1,
    maxActiveWorkers: 2,
    runBudget: { wallMs: 30_000, toolCalls: 4 },
    grantableCapabilities: ["task.spawn.request", "report.submit", "evidence.read"],
  }, new SequenceIdentities());
  const inputArtifactIds = evidence.map((artifact) => artifact.id);
  const root = await scheduler.createRoot({
    workloadKey: "root:child-evidence-bridge",
    objective: "Authorize one bounded child evidence bridge test.",
    workerKind: "orchestrator",
    workerLabel: "evidence-bridge-root",
    mediaScope: [],
    inputArtifactIds,
    requiredOutputs: [{ name: "run report", artifactKind: "run-report", required: true }],
    requiredCapabilities: ["task.spawn.request"],
    dependencies: [],
    budget: { wallMs: 10_000, toolCalls: 1 },
  });
  await scheduler.registerAgent(root);
  await scheduler.transitionTask(root.taskId, root.agentId, "working");
  const child: SpawnRequestInput = {
    workloadKey: "child:evidence-read",
    objective: "Read each granted, pre-existing speech/language receipt without adding findings.",
    workerKind: "analysis",
    workerLabel: "evidence-reader",
    mediaScope: [],
    inputArtifactIds,
    requiredOutputs: [{ name: "evidence report", artifactKind: "worker-execution-report", required: true }],
    requiredCapabilities: ["evidence.read", "report.submit"],
    dependencies: [],
    budget: { wallMs: 20_000, toolCalls: 2 },
  };
  const decision = await scheduler.requestSpawn(root.taskId, root.agentId, child);
  assert.ok(decision.permit);
  if (registerChild) {
    await scheduler.registerAgent(decision.permit);
    await scheduler.transitionTask(decision.permit.taskId, decision.permit.agentId, "working");
  }
  const task = ledger.state().tasks[decision.permit.taskId];
  let operation = 0;
  const bridge = new BoundedChildEvidenceBridge(task, new BoundedEvidenceReadHost(ledger, artifacts), {
    nextOperationId: () => `operation:child-evidence-bridge:${++operation}`,
  });
  const opened = registerChild ? await openChildEvidenceBridge(bridge) : null;
  return { directory, artifacts, ledger, scheduler, source, evidence, task, permit: decision.permit, bridge, opened };
}

async function fakeEvidenceCodex(
  directory: string,
  mode: "read" | "skip",
): Promise<{ executable: string; prefix: string[] }> {
  const path = join(directory, `fake-evidence-codex-${mode}.mjs`);
  await writeFile(path, `
import { readFile } from "node:fs/promises";

const mode = ${JSON.stringify(mode)};
const args = process.argv.slice(2);
if (args[0] === "--version") {
  process.stdout.write("codex-cli fake-evidence-1.0.0\\n");
  process.exit(0);
}
let prompt = "";
for await (const chunk of process.stdin) prompt += chunk;
if (!prompt.includes("Invoke it exactly once for every granted artifactId")) {
  throw new Error("bounded evidence prompt was not supplied");
}
const configs = args.flatMap((value, index) => value === "-c" ? [args[index + 1]] : []);
for (const expected of [
  "mcp_servers.studio_evidence.command=",
  "mcp_servers.studio_evidence.args=",
  "mcp_servers.studio_evidence.required=true",
  "mcp_servers.studio_evidence.enabled_tools=[\\\"evidence_read\\\"]",
  "mcp_servers.studio_evidence.env_vars=",
]) {
  if (!configs.some((value) => value.startsWith(expected))) throw new Error("missing evidence MCP config " + expected);
}
if (!process.env.STUDIO_CHILD_EVIDENCE_BRIDGE_URL || !process.env.STUDIO_CHILD_EVIDENCE_BRIDGE_TOKEN) {
  throw new Error("missing evidence bridge environment");
}
const contract = JSON.parse(prompt.split("\\n\\n").at(-1));
const results = [];
if (mode === "read") {
  for (const scope of contract.grantedEvidence) {
    const response = await fetch(process.env.STUDIO_CHILD_EVIDENCE_BRIDGE_URL + "/v1/call", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + process.env.STUDIO_CHILD_EVIDENCE_BRIDGE_TOKEN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "evidence_read", arguments: { artifactId: scope.artifactId } }),
    });
    const body = await response.json();
    if (!response.ok || body.ok !== true) throw new Error("evidence bridge call failed");
    results.push(body.result);
  }
}
const schemaPath = args[args.indexOf("--output-schema") + 1];
const schema = JSON.parse(await readFile(schemaPath, "utf8"));
const output = {
  summary: results.length > 0
    ? "Read the granted pre-existing evidence receipts without adding findings."
    : "Returned without reading the granted evidence.",
  outputs: [{
    name: schema.properties.outputs.items.properties.name.enum[0],
    kind: schema.properties.outputs.items.properties.kind.enum[0],
    content: results.length > 0
      ? results.map((result) => result.operationId + "; " + result.inputArtifactId + "; " + result.receiptId + "; " + result.receiptContentId).join("\\n")
      : "No evidence read completed.",
  }],
};
const events = [
  { type: "thread.started", thread_id: "thread:fake-evidence" },
  { type: "turn.started" },
  { type: "item.completed", item: { id: "item:fake-evidence", type: "agent_message", text: JSON.stringify(output) } },
  { type: "turn.completed", provider_request_id: "fake-evidence-provider-receipt", usage: {
    input_tokens: 80, cached_input_tokens: 10, output_tokens: 30, reasoning_output_tokens: 5,
  } },
];
process.stdout.write(events.map((event) => JSON.stringify(event)).join("\\n") + "\\n");
`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  return { executable: process.execPath, prefix: [path] };
}

test("stdio MCP reads real pinned VAD/language evidence under grant, item, byte, and call bounds", async () => {
  const runtime = await evidenceHarness();
  const client = new Client({ name: "studio-child-evidence-bridge-test", version: "1" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [MCP_SERVER],
    env: {
      STUDIO_CHILD_EVIDENCE_BRIDGE_URL: runtime.opened!.endpoint,
      STUDIO_CHILD_EVIDENCE_BRIDGE_TOKEN: runtime.opened!.token,
    },
    stderr: "pipe",
  });
  try {
    await assert.rejects(
      fetchChildEvidenceManifest(runtime.opened!.endpoint, "wrong-token"),
      /credential is invalid/,
    );
    await client.connect(transport);
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map((tool) => tool.name), ["evidence_read"]);
    assert.deepEqual(
      runtime.opened!.manifest.tool.evidenceScope.map((scope) => scope.evidenceKind).sort(),
      ["language_ranges", "speech_activity"],
    );

    for (const artifact of runtime.evidence) {
      const called = await client.callTool({ name: "evidence_read", arguments: { artifactId: artifact.id } });
      assert.equal(called.isError, undefined);
      if (!Array.isArray(called.content)) assert.fail("MCP evidence result must be an array");
      const content = called.content[0] as { type: string; text?: string };
      const result = JSON.parse(content.text ?? "{}") as Awaited<ReturnType<typeof callChildEvidenceBridge>>;
      assert.equal(result.schema, "studio.child-evidence-tool-result.v1");
      assert.equal(result.inputArtifactId, artifact.id);
      assert.equal(result.receipt.input.contentId, artifact.content.contentId);
      assert.ok(result.receipt.result.returnedItems <= result.receipt.authorization.maxItems);
      assert.ok(result.receipt.result.returnedFactBytes <= result.receipt.authorization.maxBytes);
      assert.match(result.receiptContentId, /^sha256:/);
      assert.equal("path" in result, false);
      assert.equal(JSON.stringify(result).includes(runtime.directory), false);
    }

    const events = await runtime.ledger.events();
    assert.equal(events.filter((event) => event.type === "evidence.read_started").length, 2);
    assert.equal(events.filter((event) => event.type === "evidence.read_completed").length, 2);
    const product = projectProductionRuntimeJournal(events);
    assert.equal(product.evidenceArtifacts.length, 2);
    assert.equal(product.evidenceReads.length, 2);
    assert.ok(product.evidenceReads.every((read) => read.status === "completed"));

    const beforeRejected = events.length;
    await assert.rejects(
      callChildEvidenceBridge(runtime.opened!.endpoint, runtime.opened!.token, runtime.evidence[0].id),
      /rejected or failed/,
    );
    assert.equal((await runtime.ledger.events()).length, beforeRejected);
  } finally {
    await client.close().catch(() => undefined);
    await runtime.opened!.close();
    await rm(runtime.directory, { recursive: true, force: true });
  }
});

test("evidence bridge rejects open arguments, ungranted artifacts, and content drift fail-closed", async () => {
  const runtime = await evidenceHarness();
  try {
    const before = (await runtime.ledger.events()).length;
    await assert.rejects(
      runtime.bridge.call({ artifactId: runtime.evidence[0].id, path: "/tmp/open.json" }),
      /accepts only one granted artifactId/,
    );
    await assert.rejects(runtime.bridge.call({ artifactId: runtime.source.id }), /outside the child evidence grant/);
    assert.equal((await runtime.ledger.events()).length, before);

    const corrupted = runtime.evidence[0];
    await writeFile(join(runtime.directory, "artifacts", corrupted.storageKey), "{}\n");
    await assert.rejects(runtime.bridge.call({ artifactId: corrupted.id }), /rejected or failed/);
    const events = await runtime.ledger.events();
    assert.equal(events.filter((event) => event.type === "evidence.read_started").length, 1);
    assert.equal(events.filter((event) => event.type === "evidence.read_failed").length, 1);
    assert.equal(events.some((event) => event.type === "evidence.read_completed"), false);
    const product = projectProductionRuntimeJournal(events);
    assert.equal(product.evidenceReads[0].status, "failed");
    assert.equal(product.evidenceReads[0].receiptId, null);
  } finally {
    await runtime.opened!.close();
    await rm(runtime.directory, { recursive: true, force: true });
  }
});

test("fake Codex launcher requires every granted evidence read before accepting child output", async (suite) => {
  await suite.test("all granted evidence reads complete", async () => {
    const runtime = await evidenceHarness(false);
    try {
      const fake = await fakeEvidenceCodex(runtime.directory, "read");
      let operation = 0;
      const launcher = new CodexExecWorkerLauncher(
        runtime.ledger,
        runtime.scheduler,
        runtime.artifacts,
        new BoundedReportHost(runtime.ledger),
        {
          executable: fake.executable,
          executableArgsPrefix: fake.prefix,
          nextExecutionId: () => "execution:fake-evidence-read",
          nextEvidenceOperationId: () => `operation:fake-evidence-read:${++operation}`,
          maximumWallMs: 5_000,
        },
      );
      const result = await launcher.launch(runtime.permit);
      assert.equal(result.execution.outcome, "completed");
      assert.equal(result.report.status, "submitted");
      const reads = Object.values(runtime.ledger.state().evidenceReads);
      assert.equal(reads.length, 2);
      assert.ok(reads.every((read) => read.status === "completed"));
    } finally {
      await rm(runtime.directory, { recursive: true, force: true });
    }
  });

  await suite.test("skipped granted evidence reads fail closed", async () => {
    const runtime = await evidenceHarness(false);
    try {
      const fake = await fakeEvidenceCodex(runtime.directory, "skip");
      const launcher = new CodexExecWorkerLauncher(
        runtime.ledger,
        runtime.scheduler,
        runtime.artifacts,
        new BoundedReportHost(runtime.ledger),
        {
          executable: fake.executable,
          executableArgsPrefix: fake.prefix,
          nextExecutionId: () => "execution:fake-evidence-skip",
          maximumWallMs: 5_000,
        },
      );
      await assert.rejects(
        launcher.launch(runtime.permit),
        /did not read every granted evidence artifact/,
      );
      assert.equal(runtime.ledger.state().tasks[runtime.permit.taskId].status, "failed");
      assert.equal(Object.keys(runtime.ledger.state().evidenceReads).length, 0);
    } finally {
      await rm(runtime.directory, { recursive: true, force: true });
    }
  });
});
