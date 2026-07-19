import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  compareSubjectScores,
  pairedMemoryBindingFromReceipt,
  validatePairedScoreReceipt,
  verifyPairedScoreReceipt,
} from "../scripts/lib/bench-paired-score.mjs";
import { receiptIdFor } from "../scripts/lib/bench-gold.mjs";
import {
  contentIdForJson,
  fileReceipt,
  writeImmutableJson,
} from "../scripts/lib/immutable-receipts.mjs";
import { memoryContentId } from "../src/studio/runtime/production/memory/contentIdentity.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCORE_PATH = join(ROOT, "bench/scores/run-007/score.json");

async function scorePair() {
  const withoutScore = JSON.parse(await readFile(SCORE_PATH, "utf8"));
  const withScore = structuredClone(withoutScore);
  withScore.run = "run-paired-score-test";
  withScore.bindings.capture = {
    path: "bench/runs/run-paired-score-test/capture.json",
    content_id: `sha256:${"c".repeat(64)}`,
    bytes: 101,
  };
  withScore.bindings.labels = {
    path: "bench/reviews/labels/run-paired-score-test.json",
    content_id: `sha256:${"d".repeat(64)}`,
    bytes: 102,
  };
  withScore.score_id = receiptIdFor("bench-score", withScore, "score_id");
  return { withoutScore, withScore };
}

function resealPair(pair) {
  const { pair_id: _pairId, ...body } = pair;
  pair.pair_id = `bench-paired-score:${contentIdForJson({ pair_id: null, ...body })}`;
  return pair;
}

test("paired score cold verification rederives every reported delta", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "studio-paired-score-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { withoutScore, withScore } = await scorePair();
  const withoutPath = join(directory, "without.json");
  const withPath = join(directory, "with.json");
  await writeImmutableJson(withoutPath, withoutScore);
  await writeImmutableJson(withPath, withScore);

  const pair = compareSubjectScores({
    withoutScore,
    withScore,
    withoutBinding: await fileReceipt(withoutPath),
    withBinding: await fileReceipt(withPath),
    comparedAt: "2026-07-19T12:30:00.000Z",
  });
  assert.equal(pair.judge, null);
  assert.equal(pair.without.memory, null);
  assert.deepEqual(pair.delta.critical_outcomes, {
    correct: 0,
    wrong: 0,
    withheld: 0,
    missing: 0,
  });
  await verifyPairedScoreReceipt(pair, { workspaceRoot: ROOT });

  const forged = resealPair(structuredClone(pair));
  forged.delta.critical_meaning_rate = 999;
  resealPair(forged);
  validatePairedScoreReceipt(forged);
  await assert.rejects(
    verifyPairedScoreReceipt(forged, { workspaceRoot: ROOT }),
    /does not rederive/,
  );
});

test("paired score memory binding is byte-bound and run-bound", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "studio-paired-memory-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { withoutScore, withScore } = await scorePair();
  const body = {
    schema: "studio.memory.consumption.v1",
    run_id: withScore.run,
    consumed_at: "2026-07-19T12:00:00.000Z",
    snapshot: {
      materialization_id: `memory-materialization:sha256:${"a".repeat(64)}`,
      snapshot_content_id: `sha256:${"b".repeat(64)}`,
      materialization_receipt_content_id: `sha256:${"c".repeat(64)}`,
      entry_count: 1,
    },
    policy: {
      promotion: "reviewed_materialization_only",
      legacy_unreviewed: "excluded",
      unavailable: "fail_closed",
    },
  };
  const consumption = {
    consumption_id: `memory-consumption:${await memoryContentId(body)}`,
    ...body,
  };
  const consumptionPath = join(directory, "consumption.json");
  await writeImmutableJson(consumptionPath, consumption);
  const binding = await fileReceipt(consumptionPath);
  const memory = await pairedMemoryBindingFromReceipt({
    receipt: consumption,
    binding,
    expectedRun: withScore.run,
  });
  assert.equal(memory.receipt.content_id, binding.content_id);
  assert.equal(memory.snapshot_content_id, body.snapshot.snapshot_content_id);

  await assert.rejects(
    pairedMemoryBindingFromReceipt({ receipt: consumption, binding, expectedRun: "another-run" }),
    /belongs to .* not paired run another-run/,
  );

  const withoutPath = join(directory, "without.json");
  const withPath = join(directory, "with.json");
  await writeImmutableJson(withoutPath, withoutScore);
  await writeImmutableJson(withPath, withScore);
  const pair = compareSubjectScores({
    withoutScore,
    withScore,
    withoutBinding: await fileReceipt(withoutPath),
    withBinding: await fileReceipt(withPath),
    withMemory: memory,
    comparedAt: "2026-07-19T12:30:00.000Z",
  });
  await verifyPairedScoreReceipt(pair, { workspaceRoot: ROOT });
});
