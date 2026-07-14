import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { assertPreflightBundle } from "../src/studio/preflight/preflightBundleValidation.ts";
import { assertSpeechActivityReceipt } from "../src/studio/preflight/speechReceiptValidation.ts";

const ROOT = resolve(".");
const FIXTURE = resolve("public/demo/runs/run-005");
const DETECTOR = resolve("scripts/detect-speech.mjs");
const SEALER = resolve("scripts/seal-speech-preflight.mjs");
const INPUT_FILES = ["clip.m4a", "source.json", "media-probe.json", "preflight.json"];

interface CommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

let firstDirectory = "";
let secondDirectory = "";
const temporaryDirectories: string[] = [];

function execute(script: string, directory: string, extra: string[] = []): CommandResult {
  const result = spawnSync(
    process.execPath,
    [script, "--run", "run-005", "--directory", directory, ...extra],
    { cwd: ROOT, encoding: "utf8" },
  );
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function expectSuccess(result: CommandResult, label: string): void {
  assert.equal(result.status, 0, `${label} failed:\n${result.stderr || result.stdout}`);
}

function expectFailure(result: CommandResult, expected: RegExp, label: string): void {
  assert.notEqual(result.status, 0, `${label} unexpectedly succeeded`);
  assert.match(result.stderr, expected, `${label} did not report the exact failed invariant`);
}

async function makeInputDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "studio-speech-production-"));
  temporaryDirectories.push(directory);
  await Promise.all(INPUT_FILES.map((file) => copyFile(join(FIXTURE, file), join(directory, file))));
  return directory;
}

async function makeProducedDirectory(): Promise<string> {
  const directory = await makeInputDirectory();
  await Promise.all(
    ["speech-input.pcm", "speech-activity.json"].map((file) =>
      copyFile(join(firstDirectory, file), join(directory, file)),
    ),
  );
  return directory;
}

async function json(path: string): Promise<any> {
  return JSON.parse(await readFile(path, "utf8"));
}

async function digest(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

function exactKeys(value: object, expected: string[]): void {
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort());
}

test.before(async () => {
  firstDirectory = await makeInputDirectory();
  secondDirectory = await makeInputDirectory();
  expectSuccess(execute(DETECTOR, firstDirectory), "first real speech detection");
  expectSuccess(execute(DETECTOR, secondDirectory), "second real speech detection");
});

test.after(async () => {
  await Promise.all(temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })));
});

test("real pinned VAD execution is byte-deterministic and fully receipted", async () => {
  const firstPcm = await readFile(join(firstDirectory, "speech-input.pcm"));
  const secondPcm = await readFile(join(secondDirectory, "speech-input.pcm"));
  const firstReceiptBytes = await readFile(join(firstDirectory, "speech-activity.json"));
  const secondReceiptBytes = await readFile(join(secondDirectory, "speech-activity.json"));
  assert.deepEqual(firstPcm, secondPcm);
  assert.deepEqual(firstReceiptBytes, secondReceiptBytes);

  const receipt = JSON.parse(firstReceiptBytes.toString("utf8"));
  exactKeys(receipt, [
    "schema", "producer", "run", "input", "normalization", "configuration", "frames",
    "speech_windows", "non_speech_windows", "note",
  ]);
  assert.equal(receipt.schema, "studio.speech-activity.v1");
  assert.deepEqual(
    {
      id: receipt.producer.id,
      version: receipt.producer.version,
      implementation: receipt.producer.implementation,
      revision: receipt.producer.model.revision,
      modelDigest: receipt.producer.model.content.hash.digest,
    },
    {
      id: "silero-vad",
      version: "6.2.1",
      implementation: "scripts/detect-speech.mjs",
      revision: "7e30209a3e901f9842f81b225f3e93d8199902b1",
      modelDigest: "7ed98ddbad84ccac4cd0aeb3099049280713df825c610a8ed34543318f1b2c49",
    },
  );
  assert.deepEqual(
    {
      id: receipt.producer.runtime.id,
      version: receipt.producer.runtime.version,
      provider: receipt.producer.runtime.execution_provider,
      mode: receipt.producer.runtime.execution_mode,
      intra: receipt.producer.runtime.intra_op_threads,
      inter: receipt.producer.runtime.inter_op_threads,
    },
    { id: "onnxruntime-node", version: "1.27.0", provider: "cpu", mode: "sequential", intra: 1, inter: 1 },
  );
  assert.equal(
    await digest(join(ROOT, receipt.producer.model.path)),
    receipt.producer.model.content.hash.digest,
  );
  assert.equal(
    await digest(join(ROOT, receipt.producer.runtime.binary.path)),
    receipt.producer.runtime.binary.content.hash.digest,
  );
  assert.equal(
    await digest(receipt.normalization.producer.binary.path),
    receipt.normalization.producer.binary.content.hash.digest,
  );
  assert.equal(await digest(join(firstDirectory, "clip.m4a")), receipt.input.content_id.slice("sha256:".length));
  assert.equal(await digest(join(firstDirectory, "speech-input.pcm")), receipt.normalization.artifact.content.hash.digest);
  assert.equal(receipt.normalization.artifact.content.bytes, receipt.normalization.sample_count * 2);
  assert.deepEqual(receipt.normalization.arguments, [
    "-nostdin", "-hide_banner", "-loglevel", "error", "-threads", "1", "-i", "<input>",
    "-map", "0:0", "-vn", "-ac", "1", "-ar", "16000", "-sample_fmt", "s16",
    "-c:a", "pcm_s16le", "-f", "s16le", "<output>",
  ]);

  assert.equal(receipt.frames.length, Math.ceil(receipt.normalization.sample_count / 512));
  receipt.frames.forEach((frame: any, index: number) => {
    assert.deepEqual(Object.keys(frame), ["start_sample", "end_sample", "probability"]);
    assert.equal(frame.start_sample, index * 512);
    assert.equal(frame.end_sample, Math.min(receipt.normalization.sample_count, frame.start_sample + 512));
    assert.ok(frame.probability >= 0 && frame.probability <= 1);
  });
  const partition = [
    ...receipt.speech_windows.map((range: any) => ({ ...range, kind: "speech" })),
    ...receipt.non_speech_windows.map((range: any) => ({ ...range, kind: "non_speech" })),
  ].sort((left, right) => left.start_sample - right.start_sample);
  let cursor = 0;
  partition.forEach((range: any, index: number) => {
    assert.equal(range.start_sample, cursor);
    if (index > 0) assert.notEqual(range.kind, partition[index - 1].kind);
    cursor = range.end_sample;
  });
  assert.equal(cursor, receipt.normalization.sample_count);
  assert.ok(receipt.speech_windows.length > 0);
  assert.ok(receipt.non_speech_windows.length > 0);

  expectSuccess(execute(DETECTOR, firstDirectory, ["--check"]), "detector check mode");
  const before = await Promise.all([
    digest(join(firstDirectory, "speech-input.pcm")),
    digest(join(firstDirectory, "speech-activity.json")),
  ]);
  expectFailure(execute(DETECTOR, firstDirectory), /speech evidence already exists/, "implicit overwrite");
  assert.deepEqual(
    await Promise.all([
      digest(join(firstDirectory, "speech-input.pcm")),
      digest(join(firstDirectory, "speech-activity.json")),
    ]),
    before,
  );
});

test("v2 seal preserves v1, exact lineage, and validates as one evidence unit", async () => {
  const firstV1Before = await digest(join(firstDirectory, "preflight.json"));
  const secondV1Before = await digest(join(secondDirectory, "preflight.json"));
  expectSuccess(execute(SEALER, firstDirectory), "first speech preflight seal");
  expectSuccess(execute(SEALER, secondDirectory), "second speech preflight seal");
  assert.equal(await digest(join(firstDirectory, "preflight.json")), firstV1Before);
  assert.equal(await digest(join(secondDirectory, "preflight.json")), secondV1Before);
  assert.deepEqual(
    await readFile(join(firstDirectory, "preflight-v2.json")),
    await readFile(join(secondDirectory, "preflight-v2.json")),
  );

  const source = await json(join(firstDirectory, "source.json"));
  const probe = await json(join(firstDirectory, "media-probe.json"));
  const v1 = await json(join(firstDirectory, "preflight.json"));
  const receipt = await json(join(firstDirectory, "speech-activity.json"));
  const bundle = await json(join(firstDirectory, "preflight-v2.json"));
  const probeArtifact = v1.artifacts.find((artifact: any) => artifact.artifact_id === "container-probe");
  const binding = {
    receiptId: source.receipt_id,
    receiptProducer: source.producer,
    receiptPath: "source.json",
    raw: {
      path: source.raw_media.path,
      contentId: source.raw_media.content_id,
      bytes: source.raw_media.bytes,
      producer: source.producer,
    },
    mediaProbe: {
      path: "media-probe.json",
      contentId: probeArtifact.content.id,
      producer: probe.producer,
    },
  };
  assertSpeechActivityReceipt(receipt, binding, probe, "Produced speech receipt");
  assertPreflightBundle(bundle, binding, "Produced speech preflight", receipt);
  assert.equal(bundle.schema, "studio.preflight-bundle.v2");
  assert.equal(bundle.producer, "scripts/seal-speech-preflight.mjs");
  assert.equal(bundle.preflight_id, `preflight:${source.content.id}:speech-v1`);
  assert.deepEqual(bundle.artifacts.map((artifact: any) => artifact.artifact_id), [
    "raw-media", "source-receipt", "container-probe", "speech-detector-audio", "speech-activity",
  ]);
  const normalized = bundle.artifacts[3];
  const speech = bundle.artifacts[4];
  assert.deepEqual(normalized.source_content_ids, [source.content.id]);
  assert.deepEqual(speech.source_content_ids, [
    source.content.id,
    receipt.normalization.artifact.content.id,
    receipt.producer.model.content.id,
  ]);
  assert.equal(bundle.findings.speech_activity, "speech-activity");
  for (const key of ["language_ranges", "acoustic_ranges", "speaker_overlap", "complexity"] as const) {
    assert.equal(bundle.findings[key], null);
  }

  expectSuccess(execute(SEALER, firstDirectory, ["--check"]), "sealer check mode");
  expectFailure(execute(SEALER, firstDirectory), /already exists; refusing to replace/, "immutable v2 overwrite");
});

test("detector fails closed before output for ambiguous tracks and stale duration evidence", async () => {
  const ambiguous = await makeInputDirectory();
  const ambiguousProbe = await json(join(ambiguous, "media-probe.json"));
  ambiguousProbe.tracks.push({ ...ambiguousProbe.tracks[0], index: 1 });
  await writeFile(join(ambiguous, "media-probe.json"), `${JSON.stringify(ambiguousProbe, null, 2)}\n`);
  expectFailure(execute(DETECTOR, ambiguous), /multiple audio tracks; provide --track explicitly/, "ambiguous track detection");
  await assert.rejects(readFile(join(ambiguous, "speech-input.pcm")), { code: "ENOENT" });
  await assert.rejects(readFile(join(ambiguous, "speech-activity.json")), { code: "ENOENT" });

  const stale = await makeInputDirectory();
  const staleProbe = await json(join(stale, "media-probe.json"));
  staleProbe.duration = 60;
  await writeFile(join(stale, "media-probe.json"), `${JSON.stringify(staleProbe, null, 2)}\n`);
  expectFailure(execute(DETECTOR, stale), /normalized PCM duration does not match the measured container duration/, "stale duration detection");
  await assert.rejects(readFile(join(stale, "speech-input.pcm")), { code: "ENOENT" });
  await assert.rejects(readFile(join(stale, "speech-activity.json")), { code: "ENOENT" });
});

test("sealer rejects unknown fields, invalid producers, missing fields, stale bytes, and underived windows", async () => {
  const mutations: Array<{
    label: string;
    expected: RegExp;
    mutate: (directory: string, receipt: any) => Promise<void> | void;
  }> = [
    {
      label: "unknown receipt field",
      expected: /speech must contain exactly/,
      mutate: (_directory, receipt) => { receipt.synthetic = true; },
    },
    {
      label: "invalid producer",
      expected: /speech\.producer\.id must equal silero-vad/,
      mutate: (_directory, receipt) => { receipt.producer.id = "unregistered-vad"; },
    },
    {
      label: "missing configuration field",
      expected: /speech\.configuration must contain exactly/,
      mutate: (_directory, receipt) => { delete receipt.configuration.threshold; },
    },
    {
      label: "stale normalized artifact",
      expected: /speech normalized PCM does not match its indexed bytes/,
      mutate: async (directory) => {
        const pcm = await readFile(join(directory, "speech-input.pcm"));
        pcm[0] ^= 0xff;
        await writeFile(join(directory, "speech-input.pcm"), pcm);
      },
    },
    {
      label: "underived speech windows",
      expected: /speech\.speech_windows do not derive from the receipted frame probabilities/,
      mutate: (_directory, receipt) => { receipt.frames[0].probability = receipt.frames[0].probability >= 0.5 ? 0 : 1; },
    },
  ];

  for (const mutation of mutations) {
    const directory = await makeProducedDirectory();
    const receiptPath = join(directory, "speech-activity.json");
    const receipt = await json(receiptPath);
    await mutation.mutate(directory, receipt);
    if (mutation.label !== "stale normalized artifact") {
      await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
    }
    expectFailure(execute(SEALER, directory), mutation.expected, mutation.label);
    await assert.rejects(readFile(join(directory, "preflight-v2.json")), { code: "ENOENT" });
  }
});
