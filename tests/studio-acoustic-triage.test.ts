import assert from "node:assert/strict";
import { copyFile, cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import test from "node:test";

import type { AcousticClass, AcousticObservations } from "../src/studio/acoustic/contracts.ts";
import { ACOUSTIC_LIMITS } from "../src/studio/acoustic/contracts.ts";
import { canonicalSha256 } from "../src/studio/canonicalIdentity.ts";
import {
  deriveDialogueScopePolicy,
  rangeIsEntirelyNonDialogue,
  validateDialogueScopePolicy,
} from "../src/studio/acoustic/dialogueScopePolicy.ts";
import { validateAcousticObservations, validateAcousticReceipt } from "../src/studio/acoustic/validation.ts";
import { enforceCaptionDialogueScope } from "../src/studio/runtime/production/captions/captionStudyCausality.ts";
import type { CaptionProductionLine } from "../src/studio/runtime/production/model.ts";
import type { SpeechActivityReceipt } from "../src/studio/preflight/contracts.ts";
import { loadOwnedSourceSession } from "../src/studio/runtime/production/runStart/sourceSessionLoader.ts";
import { ContentAddressedArtifactStore } from "../src/studio/runtime/production/artifactStore.ts";

const run = promisify(execFile);
const FIXTURE = resolve("public/demo/runs/run-005");
const DETECTOR = resolve("scripts/detect-acoustics.mjs");
const SEALER = resolve("scripts/seal-acoustic-preflight.mjs");
const content = (digit: string, bytes = 32) => ({ id: `sha256:${digit.repeat(64)}`, hash: { algorithm: "sha256" as const, digest: digit.repeat(64) }, bytes });

function resealReceiptIdentity(value: any): void {
  const body = structuredClone(value);
  delete body.schema;
  delete body.receiptId;
  value.receiptId = `acoustic-triage:${canonicalSha256(body)}`;
}

function speech(vad: "speech" | "non_speech"): SpeechActivityReceipt {
  return {
    schema: "studio.speech-activity.v1",
    normalization: { sample_rate_hz: 16_000, sample_count: 15_360 },
    speech_windows: vad === "speech" ? [{ start_sample: 0, end_sample: 15_360 }] : [],
    non_speech_windows: vad === "non_speech" ? [{ start_sample: 0, end_sample: 15_360 }] : [],
  } as unknown as SpeechActivityReceipt;
}

function acoustic(classification: AcousticClass, certainty: "strong" | "weak" = "strong", status: AcousticObservations["status"] = "complete"): AcousticObservations {
  const value: AcousticObservations = {
    schema: "studio.acoustic-observations.v1",
    source: { contentId: content("a").id, bytes: 32, trackIndex: 0 },
    normalization: { content: content("b", 30_720), sampleRateHz: 16_000, channels: 1, sampleFormat: "s16le", sampleCount: 15_360 },
    requestedRange: { startMs: 0, endMs: 960, startSample: 0, endSample: 15_360 },
    returnedRange: { startMs: 0, endMs: 960, startSample: 0, endSample: 15_360 },
    status,
    observations: status === "complete" ? [{ index: 0, startSample: 0, endSample: 15_360, startMs: 0, endMs: 960, classification, confidence: { speechCandidate: classification === "speech_candidate" ? 0.9 : classification === "mixed" ? 0.8 : 0.1, music: classification === "music" || classification === "mixed" ? 0.9 : 0.1, noise: classification === "noise" ? 0.9 : 0.1, winningScore: classification === "unknown" ? 0.1 : 0.9, margin: classification === "unknown" ? 0 : classification === "mixed" ? 0.1 : 0.8 }, certainty, reason: certainty === "weak" ? "below_threshold_or_margin" : classification === "mixed" ? "supported_speech_and_music" : "strong_single_family" }] : [],
  };
  return validateAcousticObservations(value);
}

function policy(vad: "speech" | "non_speech", classification: AcousticClass, includeLyrics = false, certainty: "strong" | "weak" = "strong") {
  return deriveDialogueScopePolicy({
    sourceArtifactId: "artifact:source", sourceContentId: content("a").id, trackId: "stream:0", includeLyrics,
    requestedRange: { startMs: 0, endMs: 960 },
    speechEvidence: { artifactId: "artifact:vad", contentId: content("c").id, value: speech(vad) },
    acousticEvidence: { artifactId: "artifact:acoustic", contentId: content("d").id, producerReceiptContentId: content("e").id, value: acoustic(classification, certainty) },
  });
}

test("closed VAD/acoustic/lyrics truth table excludes only strong non-dialogue agreement", () => {
  const cases = [
    ["speech", "speech_candidate", false, "requested_dialogue_scope_candidate"],
    ["speech", "music", false, "unknown"],
    ["speech", "noise", false, "unknown"],
    ["speech", "mixed", false, "unknown"],
    ["non_speech", "noise", false, "not_in_requested_dialogue_scope"],
    ["non_speech", "music", false, "not_in_requested_dialogue_scope"],
    ["non_speech", "music", true, "requested_dialogue_scope_candidate"],
    ["non_speech", "mixed", false, "unknown"],
    ["non_speech", "speech_candidate", false, "unknown"],
  ] as const;
  for (const [vad, classification, lyrics, expected] of cases) {
    const derived = validateDialogueScopePolicy(policy(vad, classification, lyrics));
    assert.equal(derived.ranges[0].state, expected);
    assert.equal(derived.accounting.requestedSamples, 15_360);
    assert.equal(derived.accounting.semanticCoverageDenominatorSamples, expected === "not_in_requested_dialogue_scope" ? 0 : 15_360);
  }
  assert.equal(policy("non_speech", "unknown", false, "weak").ranges[0].state, "unknown");
  const missing = deriveDialogueScopePolicy({ sourceArtifactId: "artifact:source", sourceContentId: content("a").id, trackId: "stream:0", includeLyrics: false, requestedRange: { startMs: 0, endMs: 960 }, speechEvidence: null, acousticEvidence: null });
  assert.equal(missing.ranges[0].state, "unavailable");
  const truncated = deriveDialogueScopePolicy({ sourceArtifactId: "artifact:source", sourceContentId: content("a").id, trackId: "stream:0", includeLyrics: false, requestedRange: { startMs: 0, endMs: 960 }, speechEvidence: { artifactId: "artifact:vad", contentId: content("c").id, value: speech("non_speech") }, acousticEvidence: { artifactId: "artifact:acoustic", contentId: content("d").id, producerReceiptContentId: content("e").id, value: acoustic("unknown", "weak", "truncated") } });
  assert.equal(truncated.ranges[0].state, "withheld");
  const failed = deriveDialogueScopePolicy({ sourceArtifactId: "artifact:source", sourceContentId: content("a").id, trackId: "stream:0", includeLyrics: false, requestedRange: { startMs: 0, endMs: 960 }, speechEvidence: { artifactId: "artifact:vad", contentId: content("c").id, value: speech("non_speech") }, acousticEvidence: { artifactId: "artifact:acoustic", contentId: content("d").id, producerReceiptContentId: content("e").id, value: acoustic("unknown", "weak", "failed") } });
  assert.equal(failed.ranges[0].state, "unavailable");
});

test("policy and caption boundary keep excluded duration visible and strip both text languages", () => {
  const derived = policy("non_speech", "noise");
  assert.equal(rangeIsEntirelyNonDialogue(derived, 0, 960), true);
  assert.equal(derived.accounting.notInRequestedDialogueScopeSamples, derived.accounting.requestedSamples);
  const line = { id: "line:1", startMs: 0, endMs: 960, source: { language: "ko", state: "available", text: "invented", reasonCode: null }, target: { language: "en", state: "available", text: "invented", reasonCode: null }, lineage: {} } as unknown as CaptionProductionLine;
  const enforced = enforceCaptionDialogueScope(line, derived);
  assert.deepEqual(enforced.source, { language: "ko", state: "withheld", text: null, reasonCode: "not_in_requested_dialogue_scope" });
  assert.deepEqual(enforced.target, { language: "en", state: "withheld", text: null, reasonCode: "not_in_requested_dialogue_scope" });
});

test("acoustic validation rejects gaps, weak upgrades, receipt identity/config drift, and limit overflow", async (suite) => {
  const observations = acoustic("noise");
  const gap = structuredClone(observations); gap.observations[0].startSample = 1;
  assert.throws(() => validateAcousticObservations(gap), /gap, overlap/);
  const upgrade = structuredClone(observations); upgrade.observations[0].certainty = "weak";
  assert.throws(() => validateAcousticObservations(upgrade), /weak confidence/);
  const directory = await mkdtemp(join(tmpdir(), "studio-acoustic-validation-"));
  suite.after(() => rm(directory, { recursive: true, force: true }));
  for (const name of ["clip.m4a", "speech-input.pcm", "speech-activity.json"]) await copyFile(join(FIXTURE, name), join(directory, name));
  await run(process.execPath, [DETECTOR, "--directory", directory, "--start-ms", "0", "--end-ms", "1920"], { timeout: 10_000 });
  const receipt = JSON.parse(await readFile(join(directory, "acoustic-triage.json"), "utf8"));
  const realObservations = validateAcousticObservations(JSON.parse(await readFile(join(directory, "acoustic-observations.json"), "utf8")));
  validateAcousticReceipt(receipt, realObservations);
  const overlap = structuredClone(realObservations); overlap.observations[1].startSample -= 1;
  assert.throws(() => validateAcousticObservations(overlap), /gap, overlap/);
  const escaped = structuredClone(realObservations); escaped.returnedRange.endMs += 1; escaped.returnedRange.endSample += 16;
  assert.throws(() => validateAcousticObservations(escaped), /escapes the requested range/);
  const tooMany = structuredClone(realObservations); tooMany.observations = new Array(ACOUSTIC_LIMITS.maxItems + 1).fill({});
  assert.throws(() => validateAcousticObservations(tooMany), /item limit/);
  const identityTamper = structuredClone(receipt); identityTamper.receiptId = "acoustic-triage:" + "0".repeat(64);
  assert.throws(() => validateAcousticReceipt(identityTamper, realObservations), /canonical receipt content/);
  for (const mutate of [
    (value: any) => { value.producer.model.revision = "drift"; },
    (value: any) => { value.configuration.strongThreshold = 0.1; },
    (value: any) => { value.execution.toolCalls = 2; },
    (value: any) => { value.execution.wallMs = 60_001; },
    (value: any) => { value.output.itemCount += 1; },
    (value: any) => { value.output.content.bytes = ACOUSTIC_LIMITS.maxObservationBytes + 1; },
  ]) {
    const changed = structuredClone(receipt); mutate(changed); resealReceiptIdentity(changed);
    assert.throws(() => validateAcousticReceipt(changed, realObservations));
  }
});

test("real local producer is repeatable for exact owned bytes and fails on source drift", async (suite) => {
  const directories = await Promise.all([0, 1, 2].map(() => mkdtemp(join(tmpdir(), "studio-acoustic-producer-"))));
  suite.after(() => Promise.all(directories.map((directory) => rm(directory, { recursive: true, force: true }))));
  for (const directory of directories) for (const name of ["clip.m4a", "speech-input.pcm", "speech-activity.json"]) await copyFile(join(FIXTURE, name), join(directory, name));
  await Promise.all(directories.slice(0, 2).map((directory) => run(process.execPath, [DETECTOR, "--directory", directory, "--start-ms", "0", "--end-ms", "1920"], { timeout: 10_000 })));
  const [first, second] = await Promise.all(directories.slice(0, 2).map((directory) => readFile(join(directory, "acoustic-observations.json"), "utf8")));
  assert.equal(first, second);
  const complete = validateAcousticObservations(JSON.parse(first));
  assert.equal(complete.observations.length, 2);
  assert.equal(complete.observations[0].startSample, 0);
  assert.equal(complete.observations[1].endSample, 30_720);
  const driftPath = join(directories[2], "clip.m4a"); const bytes = await readFile(driftPath); bytes[0] ^= 1; await writeFile(driftPath, bytes);
  await assert.rejects(run(process.execPath, [DETECTOR, "--directory", directories[2], "--start-ms", "0", "--end-ms", "960"], { timeout: 10_000 }), /Source or normalized audio bytes drifted/);
});

test("V4 seals, registers, and recursively reopens observations plus a separate producer receipt", async (suite) => {
  const directory = await mkdtemp(join(tmpdir(), "studio-acoustic-v4-"));
  suite.after(() => rm(directory, { recursive: true, force: true }));
  await cp(FIXTURE, directory, { recursive: true });
  await run(process.execPath, [DETECTOR, "--directory", directory, "--start-ms", "0", "--end-ms", "1920"], { timeout: 10_000 });
  await run(process.execPath, [SEALER, "--run", "run-005", "--directory", directory], { timeout: 10_000 });
  const loaded = await loadOwnedSourceSession(directory);
  assert.equal(loaded.session.preflight.schema, "studio.preflight-bundle.v4");
  assert.deepEqual(loaded.evidenceDescriptors.map((descriptor) => descriptor.evidenceKind).sort(), ["acoustic_ranges", "language_ranges", "speech_activity"]);
  const acousticDescriptor = loaded.evidenceDescriptors.find((descriptor) => descriptor.evidenceKind === "acoustic_ranges");
  assert.ok(acousticDescriptor);
  assert.equal(acousticDescriptor?.schema, "studio.preflight-evidence-artifact.v2");
  assert.match(acousticDescriptor?.producerReceiptContent?.contentId ?? "", /^sha256:/);
  const store = new ContentAddressedArtifactStore(join(directory, ".test-artifacts"));
  const source = await store.registerSource("runtime:acoustic-v4", loaded.descriptor);
  const artifact = await store.registerPreflightEvidence("runtime:acoustic-v4", source.id, acousticDescriptor);
  assert.equal(artifact.origin.kind, "preflight_evidence");
  if (artifact.origin.kind !== "preflight_evidence") assert.fail("acoustic artifact origin changed");
  assert.equal(artifact.origin.evidenceKind, "acoustic_ranges");
  assert.ok((await store.receiptBytes(artifact.origin.producerReceiptContentId!)).byteLength > 0);
  const observationBytes = await readFile(acousticDescriptor!.path);
  await writeFile(acousticDescriptor!.path, "{}\n");
  await assert.rejects(store.registerPreflightEvidence("runtime:acoustic-v4-observation-tamper", source.id, acousticDescriptor), /content identity|content no longer matches|Acoustic evidence/);
  await writeFile(acousticDescriptor!.path, observationBytes);
  await writeFile(acousticDescriptor!.producerReceiptPath!, "{}\n");
  await assert.rejects(store.registerPreflightEvidence("runtime:acoustic-v4-tamper", source.id, acousticDescriptor), /producer receipt no longer matches/);
});
