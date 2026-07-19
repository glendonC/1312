/**
 * Paired-score comparator for two studio.bench.score.v1 receipts on the same frozen pack/clip.
 *
 * This is a per-clip primitive, not a campaign result. It preserves the four-way outcome dyad
 * and lists unambiguous lost-correct regressions. It does not invent human labels, invent a
 * with-side capture, establish exact configuration control, or claim variance.
 */

import { resolve } from "node:path";

import { parseMemoryReviewArtifact } from "../../src/studio/runtime/production/memory/validation.ts";
import {
  readJsonFile,
  validateScoreReceipt,
  verifiedBinding,
} from "./bench-gold.mjs";
import { contentIdForJson } from "./immutable-receipts.mjs";

export const PAIRED_SCORE_SCHEMA = "studio.bench.paired-score.v2";

function fail(message) {
  throw new Error(`bench paired-score: ${message}`);
}

function exactKeys(value, keys, context) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${context} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(`${context} keys must be exactly ${expected.join(", ")}`);
  }
}

function fileBinding(value, context) {
  exactKeys(value, ["path", "content_id", "bytes"], context);
  if (typeof value.path !== "string" || value.path.trim().length === 0) fail(`${context}.path is malformed`);
  if (typeof value.content_id !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value.content_id)) {
    fail(`${context}.content_id is malformed`);
  }
  if (!Number.isInteger(value.bytes) || value.bytes <= 0) fail(`${context}.bytes is malformed`);
  return value;
}

function memoryBinding(value, context) {
  if (value === null) return null;
  exactKeys(
    value,
    [
      "receipt",
      "consumption_id",
      "run_id",
      "materialization_id",
      "snapshot_content_id",
      "materialization_receipt_content_id",
      "entry_count",
    ],
    context,
  );
  fileBinding(value.receipt, `${context}.receipt`);
  if (!/^memory-consumption:sha256:[a-f0-9]{64}$/.test(value.consumption_id)) {
    fail(`${context}.consumption_id is malformed`);
  }
  if (typeof value.run_id !== "string" || value.run_id.trim().length === 0) {
    fail(`${context}.run_id is malformed`);
  }
  if (!/^memory-materialization:sha256:[a-f0-9]{64}$/.test(value.materialization_id)) {
    fail(`${context}.materialization_id is malformed`);
  }
  if (!/^sha256:[a-f0-9]{64}$/.test(value.snapshot_content_id)) {
    fail(`${context}.snapshot_content_id is malformed`);
  }
  if (!/^sha256:[a-f0-9]{64}$/.test(value.materialization_receipt_content_id)) {
    fail(`${context}.materialization_receipt_content_id is malformed`);
  }
  if (!Number.isInteger(value.entry_count) || value.entry_count < 0) {
    fail(`${context}.entry_count is malformed`);
  }
  return value;
}

function exactTimestamp(value, context) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value) {
    fail(`${context} must be an exact ISO-8601 UTC timestamp`);
  }
  return value;
}

export async function pairedMemoryBindingFromReceipt({ receipt, binding, expectedRun = null }) {
  const parsed = await parseMemoryReviewArtifact(receipt, 0);
  if (parsed.schema !== "studio.memory.consumption.v1") {
    fail("with-memory input is not a consumption receipt");
  }
  if (expectedRun !== null && parsed.run_id !== expectedRun) {
    fail(`with-memory receipt belongs to ${parsed.run_id}, not paired run ${expectedRun}`);
  }
  return memoryBinding({
    receipt: fileBinding(binding, "with.memory.receipt"),
    consumption_id: parsed.consumption_id,
    run_id: parsed.run_id,
    materialization_id: parsed.snapshot.materialization_id,
    snapshot_content_id: parsed.snapshot.snapshot_content_id,
    materialization_receipt_content_id: parsed.snapshot.materialization_receipt_content_id,
    entry_count: parsed.snapshot.entry_count,
  }, "with.memory");
}

function unitKey(line, unitId) {
  return `${line.t_start}\0${line.t_end}\0${unitId}`;
}

function subjectSystem(score, subjectSystemId, context) {
  const system = score.systems?.[subjectSystemId];
  if (!system) fail(`${context} is missing subject system ${subjectSystemId}`);
  return system;
}

function outcomeMap(system) {
  const map = new Map();
  for (const line of system.per_line) {
    for (const unit of line.critical_units) {
      map.set(unitKey(line, unit.id), {
        t_start: line.t_start,
        t_end: line.t_end,
        critical_unit_id: unit.id,
        outcome: unit.outcome,
        catastrophic: unit.catastrophic,
      });
    }
  }
  return map;
}

/** Only loss of a previously correct critical unit is an unambiguous regression. */
function isRegression(withoutOutcome, withOutcome) {
  return withoutOutcome === "correct" && withOutcome !== "correct";
}

export function compareSubjectScores({
  withoutScore,
  withScore,
  withoutBinding,
  withBinding,
  withoutMemory = null,
  withMemory = null,
  subjectSystemId = "1321-prepped",
  comparedAt,
}) {
  validateScoreReceipt(withoutScore, "without score");
  validateScoreReceipt(withScore, "with score");
  exactTimestamp(comparedAt, "compared_at");
  if (Date.parse(comparedAt) < Date.parse(withoutScore.scored_at) || Date.parse(comparedAt) < Date.parse(withScore.scored_at)) {
    fail("compared_at cannot predate either score receipt");
  }
  if (withoutScore.judge !== null || withScore.judge !== null) {
    fail("a paired compare refuses any score that names a judge");
  }
  if (withoutScore.pack_id !== withScore.pack_id || withoutScore.clip_id !== withScore.clip_id) {
    fail("paired scores must bind the same pack_id and clip_id");
  }
  if (withoutScore.run === withScore.run) {
    fail("paired scores must come from two distinct runs");
  }
  const withoutCapture = withoutScore.bindings.capture.content_id;
  const withCapture = withScore.bindings.capture.content_id;
  if (withoutCapture === withCapture) {
    fail("paired scores must bind two distinct capture receipts; the same capture cannot be both sides");
  }
  if (withoutScore.bindings.gold.content_id !== withScore.bindings.gold.content_id) {
    fail("paired scores must bind identical frozen gold bytes");
  }
  if (withoutScore.bindings.freeze.content_id !== withScore.bindings.freeze.content_id) {
    fail("paired scores must bind identical freeze bytes");
  }

  const withoutSide = subjectSystem(withoutScore, subjectSystemId, "without score");
  const withSide = subjectSystem(withScore, subjectSystemId, "with score");
  const withoutUnits = outcomeMap(withoutSide);
  const withUnits = outcomeMap(withSide);
  if (withoutUnits.size !== withUnits.size) {
    fail("paired scores must expose the same critical-unit key set for the subject system");
  }
  for (const key of withoutUnits.keys()) {
    if (!withUnits.has(key)) fail("paired scores do not share critical-unit coverage");
  }

  const regressions = [];
  const catastrophicRegressions = [];
  for (const [key, before] of withoutUnits) {
    const after = withUnits.get(key);
    if (isRegression(before.outcome, after.outcome)) {
      regressions.push({
        t_start: before.t_start,
        t_end: before.t_end,
        critical_unit_id: before.critical_unit_id,
        without_outcome: before.outcome,
        with_outcome: after.outcome,
      });
    }
    if (before.catastrophic !== true && after.catastrophic === true) {
      catastrophicRegressions.push({
        t_start: before.t_start,
        t_end: before.t_end,
        critical_unit_id: before.critical_unit_id,
        without_catastrophic: before.catastrophic,
        with_catastrophic: true,
      });
    }
  }
  regressions.sort(
    (left, right) =>
      left.t_start - right.t_start ||
      left.t_end - right.t_end ||
      left.critical_unit_id.localeCompare(right.critical_unit_id),
  );
  catastrophicRegressions.sort(
    (left, right) =>
      left.t_start - right.t_start ||
      left.t_end - right.t_end ||
      left.critical_unit_id.localeCompare(right.critical_unit_id),
  );

  const beforeOutcomes = withoutSide.headline.critical_outcomes;
  const afterOutcomes = withSide.headline.critical_outcomes;
  const beforeRate = withoutSide.headline.critical_meaning.rate;
  const afterRate = withSide.headline.critical_meaning.rate;
  const delta = {
    critical_meaning_rate:
      beforeRate === null || afterRate === null ? null : afterRate - beforeRate,
    catastrophic_count:
      withSide.headline.catastrophic.count - withoutSide.headline.catastrophic.count,
    critical_outcomes: {
      correct: afterOutcomes.correct - beforeOutcomes.correct,
      wrong: afterOutcomes.wrong - beforeOutcomes.wrong,
      withheld: afterOutcomes.withheld - beforeOutcomes.withheld,
      missing: afterOutcomes.missing - beforeOutcomes.missing,
    },
  };

  const withoutMem = memoryBinding(withoutMemory, "without.memory");
  const withMem = memoryBinding(withMemory, "with.memory");
  if (withoutMem !== null) fail("the without side must keep memory null; reviewed memory belongs only on the with side");
  if (withMem !== null && withMem.run_id !== withScore.run) {
    fail(`with-memory receipt belongs to ${withMem.run_id}, not paired run ${withScore.run}`);
  } else if (withMem === null) {
    // Structural pairs may compare two non-memory scores (e.g. drills). Product claims that the
    // with side consumed reviewed memory must supply a consumption binding.
  }

  const body = {
    schema: PAIRED_SCORE_SCHEMA,
    pack_id: withoutScore.pack_id,
    clip_id: withoutScore.clip_id,
    compared_at: comparedAt,
    subject_system: subjectSystemId,
    without: {
      run: withoutScore.run,
      score: fileBinding(withoutBinding, "without.score"),
      memory: null,
    },
    with: {
      run: withScore.run,
      score: fileBinding(withBinding, "with.score"),
      memory: withMem,
    },
    delta,
    regressions,
    catastrophic_regressions: catastrophicRegressions,
    judge: null,
    notes:
      "Paired compare preserves critical_meaning rate delta, catastrophic count delta, and all four outcome deltas. Regressions list loss of a previously correct critical unit and newly catastrophic critical units. judge is pinned null. No composite score. A null with.memory means this pair does not claim reviewed-memory consumption.",
  };
  const pairId = `bench-paired-score:${contentIdForJson({ pair_id: null, ...body })}`;
  return validatePairedScoreReceipt({ pair_id: pairId, ...body });
}

export function validatePairedScoreReceipt(receipt, context = "paired score") {
  exactKeys(
    receipt,
    [
      "schema",
      "pair_id",
      "pack_id",
      "clip_id",
      "compared_at",
      "subject_system",
      "without",
      "with",
      "delta",
      "regressions",
      "catastrophic_regressions",
      "judge",
      "notes",
    ],
    context,
  );
  if (receipt.schema !== PAIRED_SCORE_SCHEMA) fail(`${context} schema is not registered`);
  if (!/^bench-paired-score:sha256:[a-f0-9]{64}$/.test(receipt.pair_id)) {
    fail(`${context} pair_id is malformed`);
  }
  if (typeof receipt.pack_id !== "string" || receipt.pack_id.trim().length === 0) fail(`${context} pack_id is malformed`);
  if (typeof receipt.clip_id !== "string" || receipt.clip_id.trim().length === 0) fail(`${context} clip_id is malformed`);
  if (typeof receipt.compared_at !== "string" || Number.isNaN(Date.parse(receipt.compared_at))) {
    fail(`${context} compared_at is malformed`);
  }
  exactTimestamp(receipt.compared_at, `${context}.compared_at`);
  if (typeof receipt.subject_system !== "string" || receipt.subject_system.trim().length === 0) {
    fail(`${context} subject_system is malformed`);
  }
  if (receipt.judge !== null) fail(`${context} names a judge; no model grades the pair`);
  if (typeof receipt.notes !== "string" || receipt.notes.trim().length === 0) fail(`${context} notes are required`);

  for (const side of ["without", "with"]) {
    exactKeys(receipt[side], ["run", "score", "memory"], `${context}.${side}`);
    if (typeof receipt[side].run !== "string" || receipt[side].run.trim().length === 0) {
      fail(`${context}.${side}.run is malformed`);
    }
    fileBinding(receipt[side].score, `${context}.${side}.score`);
    memoryBinding(receipt[side].memory, `${context}.${side}.memory`);
  }
  if (receipt.without.run === receipt.with.run) fail(`${context} sides must name distinct runs`);
  if (receipt.without.score.content_id === receipt.with.score.content_id) {
    fail(`${context} sides must bind distinct score receipts`);
  }
  if (receipt.without.memory !== null) fail(`${context}.without.memory must be null`);
  if (receipt.with.memory !== null && receipt.with.memory.run_id !== receipt.with.run) {
    fail(`${context}.with.memory belongs to another run`);
  }

  exactKeys(receipt.delta, ["critical_meaning_rate", "catastrophic_count", "critical_outcomes"], `${context}.delta`);
  if (
    receipt.delta.critical_meaning_rate !== null &&
    (typeof receipt.delta.critical_meaning_rate !== "number" ||
      !Number.isFinite(receipt.delta.critical_meaning_rate))
  ) {
    fail(`${context}.delta.critical_meaning_rate is malformed`);
  }
  if (!Number.isInteger(receipt.delta.catastrophic_count)) {
    fail(`${context}.delta.catastrophic_count is malformed`);
  }
  exactKeys(
    receipt.delta.critical_outcomes,
    ["correct", "wrong", "withheld", "missing"],
    `${context}.delta.critical_outcomes`,
  );
  for (const key of ["correct", "wrong", "withheld", "missing"]) {
    if (!Number.isInteger(receipt.delta.critical_outcomes[key])) {
      fail(`${context}.delta.critical_outcomes.${key} is malformed`);
    }
  }
  if (!Array.isArray(receipt.regressions)) fail(`${context}.regressions must be an array`);
  for (const [index, row] of receipt.regressions.entries()) {
    exactKeys(
      row,
      ["t_start", "t_end", "critical_unit_id", "without_outcome", "with_outcome"],
      `${context}.regressions[${index}]`,
    );
    if (!(row.t_end > row.t_start)) fail(`${context}.regressions[${index}] range is malformed`);
    for (const field of ["without_outcome", "with_outcome"]) {
      if (!["correct", "wrong", "withheld", "missing"].includes(row[field])) {
        fail(`${context}.regressions[${index}].${field} is not registered`);
      }
    }
    if (!isRegression(row.without_outcome, row.with_outcome)) {
      fail(`${context}.regressions[${index}] is not a regression`);
    }
  }
  if (!Array.isArray(receipt.catastrophic_regressions)) {
    fail(`${context}.catastrophic_regressions must be an array`);
  }
  for (const [index, row] of receipt.catastrophic_regressions.entries()) {
    exactKeys(
      row,
      ["t_start", "t_end", "critical_unit_id", "without_catastrophic", "with_catastrophic"],
      `${context}.catastrophic_regressions[${index}]`,
    );
    if (!(row.t_end > row.t_start)) {
      fail(`${context}.catastrophic_regressions[${index}] range is malformed`);
    }
    if (row.with_catastrophic !== true || row.without_catastrophic === true) {
      fail(`${context}.catastrophic_regressions[${index}] is not newly catastrophic`);
    }
  }

  const { pair_id: _pairId, ...body } = receipt;
  const rebuilt = `bench-paired-score:${contentIdForJson({ pair_id: null, ...body })}`;
  if (receipt.pair_id !== rebuilt) fail(`${context} pair_id does not match its immutable body`);
  return receipt;
}

/**
 * Cold verification for a stored paired receipt. Structural validation alone cannot prove a
 * supplied delta or regression list, so this reopens both score receipts and the optional memory
 * receipt, verifies every file binding, then derives the complete receipt again.
 */
export async function verifyPairedScoreReceipt(receiptValue, { workspaceRoot = process.cwd() } = {}) {
  const receipt = validatePairedScoreReceipt(receiptValue);
  await verifiedBinding(receipt.without.score, workspaceRoot, "paired score without binding");
  await verifiedBinding(receipt.with.score, workspaceRoot, "paired score with binding");
  const withoutScore = await readJsonFile(resolve(workspaceRoot, receipt.without.score.path), "paired score without receipt");
  const withScore = await readJsonFile(resolve(workspaceRoot, receipt.with.score.path), "paired score with receipt");

  let withMemory = null;
  if (receipt.with.memory !== null) {
    await verifiedBinding(receipt.with.memory.receipt, workspaceRoot, "paired score memory binding");
    const memoryReceipt = await readJsonFile(
      resolve(workspaceRoot, receipt.with.memory.receipt.path),
      "paired score memory receipt",
    );
    withMemory = await pairedMemoryBindingFromReceipt({
      receipt: memoryReceipt,
      binding: receipt.with.memory.receipt,
      expectedRun: withScore.run,
    });
  }

  const derived = compareSubjectScores({
    withoutScore,
    withScore,
    withoutBinding: receipt.without.score,
    withBinding: receipt.with.score,
    withoutMemory: null,
    withMemory,
    subjectSystemId: receipt.subject_system,
    comparedAt: receipt.compared_at,
  });
  if (contentIdForJson(derived) !== contentIdForJson(receipt)) {
    fail("stored receipt does not rederive from its bound score and memory bytes");
  }
  return receipt;
}
