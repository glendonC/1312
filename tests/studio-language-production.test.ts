import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { assertLanguageRangesReceipt } from "../src/studio/preflight/languageReceiptValidation.ts";
import { assertPreflightBundle } from "../src/studio/preflight/preflightBundleValidation.ts";
import { assertSpeechActivityReceipt } from "../src/studio/preflight/speechReceiptValidation.ts";
import { preflightSourceBinding } from "../src/studio/preflight/sourceAdapters.ts";

const ROOT = resolve(".");
const FIXTURE = resolve("public/demo/runs/run-005");
const DETECTOR = resolve("scripts/detect-language.mjs");
const SEALER = resolve("scripts/seal-language-preflight.mjs");
const INPUT_FILES = [
  "clip.m4a",
  "source.json",
  "media-probe.json",
  "speech-input.pcm",
  "speech-activity.json",
  "preflight-v2.json",
];

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
  const directory = await mkdtemp(join(tmpdir(), "studio-language-production-"));
  temporaryDirectories.push(directory);
  await Promise.all(INPUT_FILES.map((file) => copyFile(join(FIXTURE, file), join(directory, file))));
  return directory;
}

async function makeProducedDirectory(): Promise<string> {
  const directory = await makeInputDirectory();
  await copyFile(join(firstDirectory, "language-ranges.json"), join(directory, "language-ranges.json"));
  return directory;
}

async function json(path: string): Promise<any> {
  return JSON.parse(await readFile(path, "utf8"));
}

async function digest(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

function content(buffer: Buffer): { id: string; hash: { algorithm: "sha256"; digest: string }; bytes: number } {
  const hash = createHash("sha256").update(buffer).digest("hex");
  return { id: `sha256:${hash}`, hash: { algorithm: "sha256", digest: hash }, bytes: buffer.length };
}

function exactKeys(value: object, expected: string[]): void {
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort());
}

function bindingFor(source: any): NonNullable<ReturnType<typeof preflightSourceBinding>> {
  const binding = preflightSourceBinding(source);
  assert.ok(binding);
  return binding;
}

test.before(async () => {
  firstDirectory = await makeInputDirectory();
  secondDirectory = await makeInputDirectory();
  expectSuccess(execute(DETECTOR, firstDirectory), "first real language detection");
  expectSuccess(execute(DETECTOR, secondDirectory), "second real language detection");
});

test.after(async () => {
  await Promise.all(temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })));
});

test("real pinned language execution is byte-deterministic and fully receipted", async () => {
  const firstBytes = await readFile(join(firstDirectory, "language-ranges.json"));
  const secondBytes = await readFile(join(secondDirectory, "language-ranges.json"));
  assert.deepEqual(firstBytes, secondBytes);
  assert.equal(createHash("sha256").update(firstBytes).digest("hex"), createHash("sha256").update(secondBytes).digest("hex"));

  const receipt = JSON.parse(firstBytes.toString("utf8"));
  exactKeys(receipt, ["schema", "producer", "run", "input", "configuration", "languages", "ranges", "note"]);
  assert.equal(receipt.schema, "studio.language-ranges.v1");
  assert.deepEqual(
    {
      id: receipt.producer.id,
      version: receipt.producer.version,
      implementation: receipt.producer.implementation,
      model: receipt.producer.model.id,
      revision: receipt.producer.model.revision,
      quantization: receipt.producer.model.quantization,
      license: receipt.producer.model.license,
      upstreamLicense: receipt.producer.model.upstream_license,
    },
    {
      id: "whisper-language-id",
      version: "1.0.0",
      implementation: "scripts/detect-language.mjs",
      model: "Xenova/whisper-tiny",
      revision: "5332fcc35e32a33b86612b9a57a89be7906102b1",
      quantization: "q8",
      license: "Apache-2.0",
      upstreamLicense: "MIT",
    },
  );
  assert.deepEqual(
    receipt.producer.model.files.map((file: any) => file.role),
    ["encoder", "decoder", "model_config", "generation_config", "preprocessor_config", "license_evidence", "upstream_license"],
  );
  assert.deepEqual(
    {
      id: receipt.producer.runtime.id,
      version: receipt.producer.runtime.version,
      engine: receipt.producer.runtime.engine.id,
      engineVersion: receipt.producer.runtime.engine.version,
      provider: receipt.producer.runtime.engine.execution_provider,
      mode: receipt.producer.runtime.engine.execution_mode,
      graphOptimization: receipt.producer.runtime.engine.graph_optimization_level,
      intra: receipt.producer.runtime.engine.intra_op_threads,
      inter: receipt.producer.runtime.engine.inter_op_threads,
    },
    {
      id: "@huggingface/transformers",
      version: "4.2.0",
      engine: "onnxruntime-node",
      engineVersion: "1.24.3",
      provider: "cpu",
      mode: "sequential",
      graphOptimization: "all",
      intra: 1,
      inter: 1,
    },
  );
  for (const file of receipt.producer.model.files) {
    assert.equal(await digest(join(ROOT, file.path)), file.content.hash.digest);
  }
  for (const key of ["manifest", "entry", "license"]) {
    const file = receipt.producer.runtime.package[key];
    assert.equal(await digest(join(ROOT, file.path)), file.content.hash.digest);
  }
  assert.equal(
    await digest(join(ROOT, receipt.producer.runtime.engine.binary.path)),
    receipt.producer.runtime.engine.binary.content.hash.digest,
  );
  assert.equal(await digest(join(firstDirectory, "speech-activity.json")), receipt.input.speech_activity.content.hash.digest);
  assert.equal(await digest(join(firstDirectory, "speech-input.pcm")), receipt.input.normalized_audio.content.hash.digest);

  assert.deepEqual(receipt.configuration, {
    max_chunk_samples: 480_000,
    min_chunk_samples: 16_000,
    min_probability: 0.5,
    min_margin: 0.15,
    rounding_digits: 8,
    tie_break: "lowest_token_id",
    window_source: "speech_windows",
  });
  assert.equal(receipt.languages.length, 99);
  receipt.languages.forEach((language: any, index: number) => {
    assert.equal(language.token_id, 50_259 + index);
  });
  assert.equal(receipt.ranges.length, 21);
  const counts = receipt.ranges.reduce((totals: Record<string, number>, range: any) => {
    totals[range.decision.status] += 1;
    return totals;
  }, { classified: 0, unknown: 0, withheld: 0 });
  assert.deepEqual(counts, { classified: 10, unknown: 4, withheld: 7 });
  assert.deepEqual(
    receipt.ranges.filter((range: any) => range.decision.status === "classified").map((range: any) => range.decision.code),
    Array(10).fill("ko"),
  );
  for (const range of receipt.ranges) {
    const length = range.end_sample - range.start_sample;
    if (length < 16_000) {
      assert.equal(range.decision.status, "withheld");
      assert.deepEqual(range.scores, []);
      assert.equal(range.decision.reason, "insufficient_samples");
      continue;
    }
    assert.equal(range.scores.length, 99);
    assert.deepEqual(
      range.scores.map((score: any) => ({ code: score.code, token_id: score.token_id })),
      receipt.languages,
    );
    assert.ok(Math.abs(range.scores.reduce((sum: number, score: any) => sum + score.probability, 0) - 1) <= 0.000001);
  }

  const source = await json(join(firstDirectory, "source.json"));
  const probe = await json(join(firstDirectory, "media-probe.json"));
  const speech = await json(join(firstDirectory, "speech-activity.json"));
  assertSpeechActivityReceipt(speech, bindingFor(source), probe, "Produced speech receipt");
  assertLanguageRangesReceipt(receipt, bindingFor(source), probe, speech, "Produced language receipt");
  expectSuccess(execute(DETECTOR, firstDirectory, ["--check"]), "language detector check mode");
  expectFailure(execute(DETECTOR, firstDirectory), /language evidence already exists/, "implicit overwrite");
});

test("v3 seal preserves v2 exactly and adds only content-addressed language lineage", async () => {
  const firstV2Before = await readFile(join(firstDirectory, "preflight-v2.json"));
  const secondV2Before = await readFile(join(secondDirectory, "preflight-v2.json"));
  expectSuccess(execute(SEALER, firstDirectory), "first language preflight seal");
  expectSuccess(execute(SEALER, secondDirectory), "second language preflight seal");
  assert.deepEqual(await readFile(join(firstDirectory, "preflight-v2.json")), firstV2Before);
  assert.deepEqual(await readFile(join(secondDirectory, "preflight-v2.json")), secondV2Before);
  assert.deepEqual(
    await readFile(join(firstDirectory, "preflight-v3.json")),
    await readFile(join(secondDirectory, "preflight-v3.json")),
  );

  const source = await json(join(firstDirectory, "source.json"));
  const probe = await json(join(firstDirectory, "media-probe.json"));
  const speech = await json(join(firstDirectory, "speech-activity.json"));
  const language = await json(join(firstDirectory, "language-ranges.json"));
  const v2 = await json(join(firstDirectory, "preflight-v2.json"));
  const v3 = await json(join(firstDirectory, "preflight-v3.json"));
  const binding = bindingFor(source);
  assertSpeechActivityReceipt(speech, binding, probe, "Sealed speech receipt");
  assertLanguageRangesReceipt(language, binding, probe, speech, "Sealed language receipt");
  assertPreflightBundle(v3, binding, "Sealed language preflight", speech, language);
  assert.equal(v3.schema, "studio.preflight-bundle.v3");
  assert.equal(v3.preflight_id, `preflight:${source.content.id}:speech-v1:language-v1`);
  assert.deepEqual(v3.artifacts.slice(0, 5), v2.artifacts);
  assert.deepEqual(v3.artifacts.map((artifact: any) => artifact.artifact_id), [
    "raw-media", "source-receipt", "container-probe", "speech-detector-audio", "speech-activity", "language-ranges",
  ]);
  const languageArtifact = v3.artifacts[5];
  assert.equal(languageArtifact.content.hash.digest, await digest(join(firstDirectory, "language-ranges.json")));
  assert.deepEqual(languageArtifact.source_content_ids, [
    source.content.id,
    v2.artifacts[4].content.id,
    v2.artifacts[3].content.id,
    ...language.producer.model.files.slice(0, 5).map((file: any) => file.content.id),
  ]);
  assert.equal(v3.findings.language_ranges, "language-ranges");
  for (const key of ["acoustic_ranges", "speaker_overlap", "complexity"] as const) assert.equal(v3.findings[key], null);

  expectSuccess(execute(SEALER, firstDirectory, ["--check"]), "language sealer check mode");
  expectFailure(execute(SEALER, firstDirectory), /already exists; refusing to replace/, "immutable v3 overwrite");
});

test("producer rejects semantically mutated VAD evidence even when v2 is rehashed", async () => {
  const directory = await makeInputDirectory();
  const speechPath = join(directory, "speech-activity.json");
  const speech = await json(speechPath);
  speech.configuration.threshold = 0.51;
  const speechBytes = Buffer.from(`${JSON.stringify(speech, null, 2)}\n`);
  await writeFile(speechPath, speechBytes);

  const v2Path = join(directory, "preflight-v2.json");
  const v2 = await json(v2Path);
  const speechArtifact = v2.artifacts.find((artifact: any) => artifact.artifact_id === "speech-activity");
  speechArtifact.content = content(speechBytes);
  await writeFile(v2Path, `${JSON.stringify(v2, null, 2)}\n`);

  expectFailure(
    execute(DETECTOR, directory),
    /configuration\.threshold must equal 0\.5/,
    "semantically mutated VAD evidence",
  );
  await assert.rejects(readFile(join(directory, "language-ranges.json")), { code: "ENOENT" });
});

test("sealer rejects exact schema, producer, score, and content mutations", async () => {
  const mutations: Array<{
    label: string;
    expected: RegExp;
    mutate: (directory: string, receipt: any) => Promise<void> | void;
  }> = [
    {
      label: "unknown receipt field",
      expected: /receipt must contain exactly/,
      mutate: (_directory, receipt) => { receipt.synthetic = true; },
    },
    {
      label: "invalid producer",
      expected: /receipt\.producer\.id must equal whisper-language-id/,
      mutate: (_directory, receipt) => { receipt.producer.id = "unregistered-language-model"; },
    },
    {
      label: "missing configuration field",
      expected: /receipt\.configuration must contain exactly/,
      mutate: (_directory, receipt) => { delete receipt.configuration.min_margin; },
    },
    {
      label: "probability not derived from receipted logits",
      expected: /softmax probability/,
      mutate: (_directory, receipt) => {
        const measured = receipt.ranges.find((range: any) => range.scores.length === 99);
        measured.scores[0].probability = Number((measured.scores[0].probability + 0.01).toFixed(8));
      },
    },
    {
      label: "stale normalized audio",
      expected: /v2 artifact speech-detector-audio does not match its indexed bytes/,
      mutate: async (directory) => {
        const pcmPath = join(directory, "speech-input.pcm");
        const pcm = await readFile(pcmPath);
        pcm[0] ^= 0xff;
        await writeFile(pcmPath, pcm);
      },
    },
  ];

  for (const mutation of mutations) {
    const directory = await makeProducedDirectory();
    const receiptPath = join(directory, "language-ranges.json");
    const receipt = await json(receiptPath);
    await mutation.mutate(directory, receipt);
    if (mutation.label !== "stale normalized audio") {
      await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
    }
    expectFailure(execute(SEALER, directory), mutation.expected, mutation.label);
    await assert.rejects(readFile(join(directory, "preflight-v3.json")), { code: "ENOENT" });
  }
});
