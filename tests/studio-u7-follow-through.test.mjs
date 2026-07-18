import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  buildU7FollowThroughReport,
  portableU7Readiness,
  probeU7LocalReadiness,
  u7FollowThroughId,
  validateU7FollowThroughReport,
} from "../scripts/lib/bench-u7-follow-through.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = join(ROOT, "bench/ablations/hard-ko-v1-raw-vs-eligible-stem");
const sha = (digit) => `sha256:${digit.repeat(64)}`;
const captureId = (digit) => `u7-ablation:${sha(digit)}`;
const scoreId = (digit) => `bench-score:${sha(digit)}`;

async function fixtures() {
  return {
    registration: JSON.parse(await readFile(join(BASE, "registration.json"), "utf8")),
    inputs: JSON.parse(await readFile(join(BASE, "inputs.json"), "utf8")),
  };
}

function binding(name, digit) {
  return { path: `bench/fixtures/${name}.json`, content_id: sha(digit), bytes: 100 };
}

function capturePair(registration, inputs, { clipId = "Ux-TMWnmntM", repetition = 1, digit = 1 } = {}) {
  return ["source_estimate_1", "source_estimate_2"].map((stemRole, index) => ({
    ablation_id: registration.ablation_id,
    inputs_id: inputs.inputs_id,
    clip_id: clipId,
    repetition,
    stem_role: stemRole,
    operation_id: `operation:${clipId}:${repetition}`,
    capture_id: captureId(String(digit + index)),
    binding: binding(`capture-${digit + index}`, String(digit + index)),
  }));
}

test("U7 follow-through exposes every minimum capture slot as pending without inventing results", async () => {
  const { registration, inputs } = await fixtures();
  const report = buildU7FollowThroughReport({
    registration,
    inputs,
    environment: portableU7Readiness(inputs),
  });

  assert.equal(report.minimum_slots.length, 18);
  assert.equal(report.summary.minimum_pairs_required, 9);
  assert.equal(report.summary.minimum_captured_slots, 0);
  assert.equal(report.summary.minimum_scored_slots, 0);
  assert.equal(report.summary.minimum_pending_slots, 18);
  assert.equal(report.summary.state, "pending");
  assert.equal(report.summary.minimum_capture_complete, false);
  assert.equal(report.summary.minimum_score_complete, false);
  assert.equal(report.semantic.judge, null);
  assert.equal(report.semantic.preference, null);
  assert.equal(report.semantic.results, null);
  assert.equal(report.non_claims.separation_quality, "not_assessed");
  assert.equal(report.report_id, u7FollowThroughId(report));
  assert.equal(validateU7FollowThroughReport(report), report);
});

test("complete pairs and exact human score receipts advance only their own slots", async () => {
  const { registration, inputs } = await fixtures();
  const captures = capturePair(registration, inputs);
  const oneScore = [{
    capture_id: captures[0].capture_id,
    score_id: scoreId("a"),
    judge: null,
    binding: binding("score-a", "a"),
  }];
  const report = buildU7FollowThroughReport({
    registration,
    inputs,
    captures,
    scores: oneScore,
    environment: {
      sources: inputs.clips.map((entry) => ({ clip_id: entry.clip_id, state: "verified" })),
      separator: { state: "qualified", lineage_content_id: sha("f") },
    },
  });

  assert.equal(report.summary.state, "in_progress");
  assert.equal(report.summary.minimum_captured_slots, 2);
  assert.equal(report.summary.minimum_scored_slots, 1);
  assert.equal(report.summary.minimum_pending_slots, 16);
  assert.equal(report.summary.local_execution_ready, true);
  assert.deepEqual(
    report.minimum_slots.filter((entry) => entry.clip_id === "Ux-TMWnmntM" && entry.repetition === 1).map((entry) => entry.state),
    ["scored", "captured_unscored"],
  );
});

test("extra positive repetitions remain visible outside the registered minimum grid", async () => {
  const { registration, inputs } = await fixtures();
  const captures = capturePair(registration, inputs, { repetition: 4, digit: 3 });
  const report = buildU7FollowThroughReport({
    registration,
    inputs,
    captures,
    environment: portableU7Readiness(inputs),
  });
  assert.equal(report.summary.minimum_captured_slots, 0);
  assert.equal(report.summary.extra_pairs, 1);
  assert.equal(report.summary.extra_capture_slots, 2);
  assert.deepEqual(report.extra_slots.map((entry) => entry.repetition), [4, 4]);
});

test("U7 follow-through rejects partial, duplicated, cross-operation, and forged score state", async (t) => {
  const { registration, inputs } = await fixtures();
  const pair = capturePair(registration, inputs);
  const build = (captures, scores = []) => buildU7FollowThroughReport({
    registration,
    inputs,
    captures,
    scores,
    environment: portableU7Readiness(inputs),
  });

  await t.test("partial pair", () => assert.throws(() => build(pair.slice(0, 1)), /partial/));
  await t.test("duplicate role", () => {
    const changed = structuredClone(pair);
    changed[1].stem_role = "source_estimate_1";
    assert.throws(() => build(changed), /slot .* repeated|partial/);
  });
  await t.test("cross-operation", () => {
    const changed = structuredClone(pair);
    changed[1].operation_id = "operation:forged";
    assert.throws(() => build(changed), /cross-operation/);
  });
  await t.test("unknown clip", () => {
    const changed = structuredClone(pair);
    changed.forEach((entry) => { entry.clip_id = "not-in-pack"; });
    assert.throws(() => build(changed), /unregistered clip/);
  });
  await t.test("score without capture", () => assert.throws(() => build([], [{
    capture_id: captureId("9"), score_id: scoreId("9"), judge: null, binding: binding("score-9", "9"),
  }]), /absent capture/));
  await t.test("model judge", () => assert.throws(() => build(pair, [{
    capture_id: pair[0].capture_id, score_id: scoreId("8"), judge: "self-grader", binding: binding("score-8", "8"),
  }]), /model-judge authority/));
});

test("report validation rejects summary, identity, and semantic-authority tamper", async (t) => {
  const { registration, inputs } = await fixtures();
  const report = buildU7FollowThroughReport({ registration, inputs, environment: portableU7Readiness(inputs) });

  await t.test("summary", () => {
    const changed = structuredClone(report);
    changed.summary.minimum_pending_slots = 17;
    changed.report_id = u7FollowThroughId(changed);
    assert.throws(() => validateU7FollowThroughReport(changed), /summary does not re-derive/);
  });
  await t.test("identity", () => {
    const changed = structuredClone(report);
    changed.report_id = `bench-u7-follow-through:${sha("0")}`;
    assert.throws(() => validateU7FollowThroughReport(changed), /report_id/);
  });
  await t.test("semantic results", () => {
    const changed = structuredClone(report);
    changed.semantic.results = { winner: "source_estimate_1" };
    changed.report_id = u7FollowThroughId(changed);
    assert.throws(() => validateU7FollowThroughReport(changed), /semantic authority/);
  });
});

test("local readiness keeps source and platform limitations typed and non-authoritative", async () => {
  const { inputs } = await fixtures();
  let separatorCalls = 0;
  const qualified = await probeU7LocalReadiness(inputs, {
    workspaceRoot: ROOT,
    platform: "darwin",
    arch: "arm64",
    verifySource: async () => {},
    separator: {
      async currentLineage() {
        separatorCalls += 1;
        return { schema: "fixture.lineage.v1", model: "pinned" };
      },
    },
  });
  assert.equal(separatorCalls, 1);
  assert.equal(qualified.sources.every((entry) => entry.state === "verified"), true);
  assert.equal(qualified.separator.state, "qualified");
  assert.match(qualified.separator.lineage_content_id, /^sha256:/);

  const unsupported = await probeU7LocalReadiness(inputs, {
    workspaceRoot: ROOT,
    platform: "linux",
    arch: "x64",
    verifySource: async (_binding, _root, context) => {
      if (context.includes("Ux-TMWnmntM")) throw new Error("no longer matches its recorded bytes");
      throw new Error("ENOENT");
    },
    separator: { async currentLineage() { throw new Error("must not run"); } },
  });
  assert.equal(unsupported.separator.state, "unsupported_platform");
  assert.equal(unsupported.separator.lineage_content_id, null);
  assert.equal(unsupported.sources.some((entry) => entry.state === "drifted"), true);
  assert.equal(unsupported.sources.some((entry) => entry.state === "unavailable"), true);
});
