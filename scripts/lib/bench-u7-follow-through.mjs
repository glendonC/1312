/** Exact minimum-grid accounting for the registered U7 raw-versus-stem ablation. */

import { canonicalJson, contentIdForJson } from "./immutable-receipts.mjs";
import { verifiedBinding } from "./bench-gold.mjs";

export const BENCH_U7_FOLLOW_THROUGH_SCHEMA = "studio.bench.u7-follow-through.v1";
export const U7_STEM_ROLES = Object.freeze(["source_estimate_1", "source_estimate_2"]);

const CONTENT_ID = /^sha256:[a-f0-9]{64}$/;
const CAPTURE_ID = /^u7-ablation:sha256:[a-f0-9]{64}$/;
const SCORE_ID = /^bench-score:sha256:[a-f0-9]{64}$/;
const SOURCE_STATES = new Set(["verified", "unavailable", "drifted"]);
const SEPARATOR_STATES = new Set([
  "qualified",
  "unsupported_platform",
  "model_unavailable",
  "runtime_drift",
  "separator_timeout",
  "separator_failed",
]);

function fail(message) {
  throw new Error(`bench U7 follow-through: ${message}`);
}

function object(value, context) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${context} must be an object`);
  return value;
}

function exact(value, keys, context) {
  const item = object(value, context);
  const found = Object.keys(item).sort((left, right) => left.localeCompare(right));
  const expected = [...keys].sort((left, right) => left.localeCompare(right));
  if (JSON.stringify(found) !== JSON.stringify(expected)) fail(`${context} shape is not closed`);
  return item;
}

function text(value, context) {
  if (typeof value !== "string" || value.length === 0) fail(`${context} must be a non-empty string`);
  return value;
}

function integer(value, context, minimum = 0) {
  if (!Number.isInteger(value) || value < minimum) fail(`${context} must be an integer at least ${minimum}`);
  return value;
}

function binding(value, context) {
  const item = exact(value, ["path", "content_id", "bytes"], context);
  text(item.path, `${context}.path`);
  if (item.path.startsWith("/") || item.path.split("/").includes("..")) fail(`${context}.path must remain workspace-relative`);
  if (typeof item.content_id !== "string" || !CONTENT_ID.test(item.content_id)) fail(`${context}.content_id is invalid`);
  integer(item.bytes, `${context}.bytes`, 1);
  return item;
}

function captureKey(entry) {
  return `${entry.clip_id}\0${entry.repetition}\0${entry.stem_role}`;
}

function pairKey(entry) {
  return `${entry.clip_id}\0${entry.repetition}`;
}

function orderedClipIds(inputs) {
  const ids = inputs.clips.map((entry) => text(entry.clip_id, "inputs clip id"));
  if (new Set(ids).size !== ids.length) fail("input registry repeats a clip id");
  return ids.sort((left, right) => left.localeCompare(right));
}

function validateRegistration(registration, inputs) {
  object(registration, "registration");
  object(inputs, "inputs");
  if (
    registration.family !== "raw_vs_eligible_stem" ||
    registration.results !== null ||
    registration.lanes?.semantic?.authority !== "human_labels_only" ||
    registration.lanes.semantic.judge !== null ||
    registration.lanes?.structural?.semantic_authority !== false ||
    registration.capture_policy?.selection !== "all_frozen_pack_clips" ||
    registration.capture_policy.pairing !== "same_clip_and_repetition" ||
    registration.capture_policy.score_every_capture !== true ||
    registration.capture_policy.variant_inputs !== "all_declared_stems_no_selection" ||
    registration.capture_policy.ineligible_variant_outcome !== "missing_or_withheld"
  ) {
    fail("registration does not retain the closed result-free U7 policy");
  }
  integer(registration.capture_policy.minimum_repetitions_per_clip, "minimum repetitions", 3);
  if (inputs.ablation?.ablation_id !== registration.ablation_id || inputs.pack_id !== registration.pack.pack_id) {
    fail("input registry does not bind the U7 registration and pack");
  }
  orderedClipIds(inputs);
}

function normalizeEnvironment(environment, clipIds) {
  const item = exact(environment, ["sources", "separator"], "environment");
  if (!Array.isArray(item.sources)) fail("environment.sources must be an array");
  const sources = item.sources.map((entry, index) => {
    const source = exact(entry, ["clip_id", "state"], `environment.sources[${index}]`);
    text(source.clip_id, `environment.sources[${index}].clip_id`);
    if (!SOURCE_STATES.has(source.state)) fail(`environment.sources[${index}].state is not registered`);
    return { clip_id: source.clip_id, state: source.state };
  }).sort((left, right) => left.clip_id.localeCompare(right.clip_id));
  if (
    new Set(sources.map((entry) => entry.clip_id)).size !== sources.length ||
    JSON.stringify(sources.map((entry) => entry.clip_id)) !== JSON.stringify(clipIds)
  ) {
    fail("environment source readiness must name every registered clip exactly once");
  }
  const separator = exact(item.separator, ["state", "lineage_content_id"], "environment.separator");
  if (!SEPARATOR_STATES.has(separator.state)) fail("environment.separator.state is not registered");
  if (separator.state === "qualified") {
    if (typeof separator.lineage_content_id !== "string" || !CONTENT_ID.test(separator.lineage_content_id)) {
      fail("qualified separator readiness requires a lineage content id");
    }
  } else if (separator.lineage_content_id !== null) {
    fail("unqualified separator readiness cannot claim lineage bytes");
  }
  return { sources, separator: { state: separator.state, lineage_content_id: separator.lineage_content_id } };
}

function normalizeCaptures(captures, registration, inputs, clipIds) {
  if (!Array.isArray(captures)) fail("captures must be an array");
  const bySlot = new Map();
  const captureIds = new Set();
  for (const [index, value] of captures.entries()) {
    const entry = exact(value, [
      "ablation_id", "inputs_id", "clip_id", "repetition", "stem_role", "operation_id", "capture_id", "binding",
    ], `captures[${index}]`);
    if (entry.ablation_id !== registration.ablation_id || entry.inputs_id !== inputs.inputs_id) {
      fail(`captures[${index}] changed registration or input identity`);
    }
    if (!clipIds.includes(entry.clip_id)) fail(`captures[${index}] names an unregistered clip`);
    integer(entry.repetition, `captures[${index}].repetition`, 1);
    if (!U7_STEM_ROLES.includes(entry.stem_role)) fail(`captures[${index}].stem_role is not registered`);
    text(entry.operation_id, `captures[${index}].operation_id`);
    if (typeof entry.capture_id !== "string" || !CAPTURE_ID.test(entry.capture_id)) fail(`captures[${index}].capture_id is invalid`);
    if (captureIds.has(entry.capture_id)) fail(`capture ${entry.capture_id} is repeated`);
    const key = captureKey(entry);
    if (bySlot.has(key)) fail(`capture slot ${entry.clip_id}/${entry.repetition}/${entry.stem_role} is repeated`);
    captureIds.add(entry.capture_id);
    bySlot.set(key, {
      ablation_id: entry.ablation_id,
      inputs_id: entry.inputs_id,
      clip_id: entry.clip_id,
      repetition: entry.repetition,
      stem_role: entry.stem_role,
      operation_id: entry.operation_id,
      capture_id: entry.capture_id,
      binding: binding(entry.binding, `captures[${index}].binding`),
    });
  }

  const pairs = new Map();
  for (const entry of bySlot.values()) {
    const key = pairKey(entry);
    const group = pairs.get(key) ?? [];
    group.push(entry);
    pairs.set(key, group);
  }
  for (const [key, group] of pairs) {
    group.sort((left, right) => left.stem_role.localeCompare(right.stem_role));
    if (
      group.length !== 2 ||
      JSON.stringify(group.map((entry) => entry.stem_role)) !== JSON.stringify(U7_STEM_ROLES) ||
      group[0].operation_id !== group[1].operation_id
    ) {
      fail(`capture pair ${key.replaceAll("\0", "/")} is partial, reordered, or cross-operation`);
    }
  }
  return { bySlot, pairs, captureIds };
}

function normalizeScores(scores, captures) {
  if (!Array.isArray(scores)) fail("scores must be an array");
  const byCapture = new Map();
  const scoreIds = new Set();
  for (const [index, value] of scores.entries()) {
    const entry = exact(value, ["capture_id", "score_id", "judge", "binding"], `scores[${index}]`);
    if (!captures.captureIds.has(entry.capture_id)) fail(`scores[${index}] names an absent capture`);
    if (entry.judge !== null) fail(`scores[${index}] carries model-judge authority`);
    if (typeof entry.score_id !== "string" || !SCORE_ID.test(entry.score_id)) fail(`scores[${index}].score_id is invalid`);
    if (scoreIds.has(entry.score_id) || byCapture.has(entry.capture_id)) fail(`score for ${entry.capture_id} is repeated`);
    scoreIds.add(entry.score_id);
    byCapture.set(entry.capture_id, {
      score_id: entry.score_id,
      binding: binding(entry.binding, `scores[${index}].binding`),
    });
  }
  return byCapture;
}

function slot(clipId, repetition, stemRole, captures, scores) {
  const capture = captures.get(`${clipId}\0${repetition}\0${stemRole}`) ?? null;
  const score = capture ? scores.get(capture.capture_id) ?? null : null;
  return {
    clip_id: clipId,
    repetition,
    stem_role: stemRole,
    state: score ? "scored" : capture ? "captured_unscored" : "pending",
    capture: capture ? {
      capture_id: capture.capture_id,
      operation_id: capture.operation_id,
      binding: capture.binding,
    } : null,
    score,
  };
}

function summaryFor(minimumSlots, extraSlots, environment) {
  const count = (slots, state) => slots.filter((entry) => entry.state === state).length;
  const minimumCaptured = minimumSlots.length - count(minimumSlots, "pending");
  const minimumScored = count(minimumSlots, "scored");
  const localExecutionReady = environment.sources.every((entry) => entry.state === "verified") && environment.separator.state === "qualified";
  return {
    state: minimumScored === minimumSlots.length ? "scored_complete" : minimumCaptured > 0 ? "in_progress" : "pending",
    minimum_pairs_required: minimumSlots.length / U7_STEM_ROLES.length,
    minimum_capture_slots: minimumSlots.length,
    minimum_captured_slots: minimumCaptured,
    minimum_scored_slots: minimumScored,
    minimum_pending_slots: count(minimumSlots, "pending"),
    extra_pairs: extraSlots.length / U7_STEM_ROLES.length,
    extra_capture_slots: extraSlots.length,
    extra_scored_slots: count(extraSlots, "scored"),
    minimum_capture_complete: minimumCaptured === minimumSlots.length,
    minimum_score_complete: minimumScored === minimumSlots.length,
    local_execution_ready: localExecutionReady,
  };
}

export function u7FollowThroughId(report) {
  const { report_id: _id, ...body } = report;
  return `bench-u7-follow-through:${contentIdForJson(body)}`;
}

export function validateU7FollowThroughReport(value) {
  const report = exact(value, [
    "report_id", "schema", "ablation_id", "inputs_id", "pack_id", "registered_clips", "capture_policy", "environment",
    "minimum_slots", "extra_slots", "summary", "semantic", "non_claims",
  ], "report");
  if (report.schema !== BENCH_U7_FOLLOW_THROUGH_SCHEMA) fail("report schema is not registered");
  for (const key of ["ablation_id", "inputs_id", "pack_id"]) text(report[key], `report.${key}`);
  if (!Array.isArray(report.registered_clips) || report.registered_clips.length === 0) fail("report.registered_clips must be a non-empty array");
  const clipIds = report.registered_clips.map((entry, index) => text(entry, `report.registered_clips[${index}]`));
  if (
    new Set(clipIds).size !== clipIds.length ||
    canonicalJson(clipIds) !== canonicalJson([...clipIds].sort((left, right) => left.localeCompare(right)))
  ) fail("report.registered_clips must be unique and sorted");
  const policy = exact(report.capture_policy, ["minimum_repetitions_per_clip", "stem_roles"], "report.capture_policy");
  integer(policy.minimum_repetitions_per_clip, "report.capture_policy.minimum_repetitions_per_clip", 3);
  if (JSON.stringify(policy.stem_roles) !== JSON.stringify(U7_STEM_ROLES)) fail("report changed anonymous stem roles");
  if (!Array.isArray(report.minimum_slots) || !Array.isArray(report.extra_slots)) fail("report slots must be arrays");
  const environment = normalizeEnvironment(report.environment, clipIds);
  const validateSlot = (entry, index, kind) => {
    const held = exact(entry, ["clip_id", "repetition", "stem_role", "state", "capture", "score"], `${kind}[${index}]`);
    text(held.clip_id, `${kind}[${index}].clip_id`);
    integer(held.repetition, `${kind}[${index}].repetition`, 1);
    if (!U7_STEM_ROLES.includes(held.stem_role)) fail(`${kind}[${index}] changed stem role`);
    if (!new Set(["pending", "captured_unscored", "scored"]).has(held.state)) fail(`${kind}[${index}] state is not registered`);
    if (held.state === "pending" && (held.capture !== null || held.score !== null)) fail(`${kind}[${index}] pending slot carries artifacts`);
    if (held.state !== "pending") {
      const capture = exact(held.capture, ["capture_id", "operation_id", "binding"], `${kind}[${index}].capture`);
      if (!CAPTURE_ID.test(capture.capture_id)) fail(`${kind}[${index}] capture id is invalid`);
      text(capture.operation_id, `${kind}[${index}].capture.operation_id`);
      binding(capture.binding, `${kind}[${index}].capture.binding`);
    }
    if (held.state === "scored") {
      const score = exact(held.score, ["score_id", "binding"], `${kind}[${index}].score`);
      if (!SCORE_ID.test(score.score_id)) fail(`${kind}[${index}] score id is invalid`);
      binding(score.binding, `${kind}[${index}].score.binding`);
    } else if (held.score !== null) fail(`${kind}[${index}] unscored slot carries a score`);
    return held;
  };
  const minimumSlots = report.minimum_slots.map((entry, index) => validateSlot(entry, index, "minimum_slots"));
  const extraSlots = report.extra_slots.map((entry, index) => validateSlot(entry, index, "extra_slots"));
  if (new Set([...minimumSlots, ...extraSlots].map(captureKey)).size !== minimumSlots.length + extraSlots.length) fail("report repeats a capture slot");
  const expectedMinimumKeys = [];
  for (const clipId of clipIds) {
    for (let repetition = 1; repetition <= policy.minimum_repetitions_per_clip; repetition += 1) {
      for (const stemRole of U7_STEM_ROLES) expectedMinimumKeys.push(`${clipId}\0${repetition}\0${stemRole}`);
    }
  }
  if (canonicalJson(minimumSlots.map(captureKey).sort()) !== canonicalJson(expectedMinimumKeys.sort())) {
    fail("report minimum slots do not equal the registered clip, repetition, and stem grid");
  }
  if (extraSlots.some((entry) => !clipIds.includes(entry.clip_id) || entry.repetition <= policy.minimum_repetitions_per_clip)) {
    fail("report extra slots must be registered clips above the minimum repetition grid");
  }
  const allCaptureIds = new Set();
  const allScoreIds = new Set();
  for (const [kind, slots] of [["minimum", minimumSlots], ["extra", extraSlots]]) {
    const pairs = new Map();
    for (const entry of slots) {
      const group = pairs.get(pairKey(entry)) ?? [];
      group.push(entry);
      pairs.set(pairKey(entry), group);
      if (entry.capture) {
        if (allCaptureIds.has(entry.capture.capture_id)) fail("report repeats a capture identity");
        allCaptureIds.add(entry.capture.capture_id);
      }
      if (entry.score) {
        if (allScoreIds.has(entry.score.score_id)) fail("report repeats a score identity");
        allScoreIds.add(entry.score.score_id);
      }
    }
    for (const [key, pair] of pairs) {
      pair.sort((left, right) => left.stem_role.localeCompare(right.stem_role));
      if (pair.length !== 2 || canonicalJson(pair.map((entry) => entry.stem_role)) !== canonicalJson(U7_STEM_ROLES)) {
        fail(`report ${kind} pair ${key.replaceAll("\0", "/")} is incomplete`);
      }
      const captured = pair.filter((entry) => entry.capture !== null);
      if (captured.length !== 0 && (captured.length !== 2 || captured[0].capture.operation_id !== captured[1].capture.operation_id)) {
        fail(`report ${kind} pair ${key.replaceAll("\0", "/")} is partial or cross-operation`);
      }
    }
  }
  const expectedSummary = summaryFor(minimumSlots, extraSlots, environment);
  if (canonicalJson(report.summary) !== canonicalJson(expectedSummary)) fail("report summary does not re-derive from slots and readiness");
  const semantic = exact(report.semantic, ["authority", "judge", "preference", "results"], "report.semantic");
  if (semantic.authority !== "human_labels_only" || semantic.judge !== null || semantic.preference !== null || semantic.results !== null) {
    fail("report carries semantic authority or results");
  }
  const nonClaims = exact(report.non_claims, ["separation_quality", "semantic_improvement", "stem_selection", "caption_authority", "publication"], "report.non_claims");
  if (
    nonClaims.separation_quality !== "not_assessed" ||
    nonClaims.semantic_improvement !== "not_assessed" ||
    nonClaims.stem_selection !== "not_performed" ||
    nonClaims.caption_authority !== "not_granted" ||
    nonClaims.publication !== "not_granted"
  ) fail("report changed U7 non-claims");
  if (report.report_id !== u7FollowThroughId(report)) fail("report_id does not match canonical report contents");
  return report;
}

export function buildU7FollowThroughReport({ registration, inputs, captures = [], scores = [], environment }) {
  validateRegistration(registration, inputs);
  const clipIds = orderedClipIds(inputs);
  const normalizedEnvironment = normalizeEnvironment(environment, clipIds);
  const normalizedCaptures = normalizeCaptures(captures, registration, inputs, clipIds);
  const normalizedScores = normalizeScores(scores, normalizedCaptures);
  const minimumRepetitions = registration.capture_policy.minimum_repetitions_per_clip;
  const minimumSlots = [];
  for (const clipId of clipIds) {
    for (let repetition = 1; repetition <= minimumRepetitions; repetition += 1) {
      for (const stemRole of U7_STEM_ROLES) minimumSlots.push(slot(clipId, repetition, stemRole, normalizedCaptures.bySlot, normalizedScores));
    }
  }
  const extraSlots = [...normalizedCaptures.pairs.values()]
    .filter((pair) => pair[0].repetition > minimumRepetitions)
    .sort((left, right) => left[0].clip_id.localeCompare(right[0].clip_id) || left[0].repetition - right[0].repetition)
    .flatMap((pair) => pair.map((entry) => slot(entry.clip_id, entry.repetition, entry.stem_role, normalizedCaptures.bySlot, normalizedScores)));
  const body = {
    schema: BENCH_U7_FOLLOW_THROUGH_SCHEMA,
    ablation_id: registration.ablation_id,
    inputs_id: inputs.inputs_id,
    pack_id: inputs.pack_id,
    registered_clips: clipIds,
    capture_policy: {
      minimum_repetitions_per_clip: minimumRepetitions,
      stem_roles: [...U7_STEM_ROLES],
    },
    environment: normalizedEnvironment,
    minimum_slots: minimumSlots,
    extra_slots: extraSlots,
    summary: summaryFor(minimumSlots, extraSlots, normalizedEnvironment),
    semantic: { authority: "human_labels_only", judge: null, preference: null, results: null },
    non_claims: {
      separation_quality: "not_assessed",
      semantic_improvement: "not_assessed",
      stem_selection: "not_performed",
      caption_authority: "not_granted",
      publication: "not_granted",
    },
  };
  return validateU7FollowThroughReport({ report_id: u7FollowThroughId(body), ...body });
}

export async function probeU7LocalReadiness(inputs, {
  workspaceRoot,
  separator = null,
  platform = process.platform,
  arch = process.arch,
  timeoutMs = 5_000,
  verifySource = verifiedBinding,
} = {}) {
  const clipIds = orderedClipIds(inputs);
  const sourceById = new Map(inputs.clips.map((entry) => [entry.clip_id, entry.source]));
  const sources = [];
  for (const clipId of clipIds) {
    try {
      await verifySource(sourceById.get(clipId), workspaceRoot, `U7 local source ${clipId}`);
      sources.push({ clip_id: clipId, state: "verified" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sources.push({ clip_id: clipId, state: /no longer matches|content|bytes/i.test(message) ? "drifted" : "unavailable" });
    }
  }
  let separatorState;
  if (platform !== "darwin" || arch !== "arm64") {
    separatorState = { state: "unsupported_platform", lineage_content_id: null };
  } else if (!separator) {
    separatorState = { state: "model_unavailable", lineage_content_id: null };
  } else {
    try {
      const lineage = await separator.currentLineage(performance.now() + timeoutMs);
      separatorState = { state: "qualified", lineage_content_id: contentIdForJson(lineage) };
    } catch (error) {
      const reason = typeof error === "object" && error !== null && "reason" in error ? error.reason : "model_unavailable";
      separatorState = { state: SEPARATOR_STATES.has(reason) && reason !== "qualified" ? reason : "model_unavailable", lineage_content_id: null };
    }
  }
  return normalizeEnvironment({ sources, separator: separatorState }, clipIds);
}

export function portableU7Readiness(inputs) {
  return normalizeEnvironment({
    sources: orderedClipIds(inputs).map((clipId) => ({ clip_id: clipId, state: "unavailable" })),
    separator: { state: "model_unavailable", lineage_content_id: null },
  }, orderedClipIds(inputs));
}
