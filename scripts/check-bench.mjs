import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";

const reportUrl = new URL("../bench/examples/unscored-report.json", import.meta.url);
const schemaUrl = new URL("../bench/schemas/report.schema.json", import.meta.url);
const report = JSON.parse(readFileSync(reportUrl, "utf8"));
const schema = JSON.parse(readFileSync(schemaUrl, "utf8"));

const ajv = new Ajv2020({ allErrors: true, strict: true });
ajv.addFormat("date", /^\d{4}-\d{2}-\d{2}$/);
ajv.addFormat("date-time", /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/);
const validateSchema = ajv.compile(schema);

if (!validateSchema(report)) {
  const errors = ajv.errorsText(validateSchema.errors, { separator: "\n" });
  throw new Error(`bench schema validation failed:\n${errors}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(`bench check failed: ${message}`);
}

function allNull(value) {
  if (value === null) return true;
  if (Array.isArray(value)) return value.every(allNull);
  if (typeof value === "object") return Object.values(value).every(allNull);
  return false;
}

function isNonEmptyObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0;
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function annotationsComplete(clip) {
  return Object.values(clip.annotations).every((value) => value === true);
}

assert(report.schema_version === "0.1.0", "unexpected schema version");
assert(["protocol_draft", "gold_frozen", "scored"].includes(report.status), "invalid report status");
assert(report.pack_id.length > 0, "pack id is required");

const clipIds = report.pack.clips.map((clip) => clip.id);
assert(new Set(clipIds).size === clipIds.length, "clip ids must be unique");
assert(report.pack.clips.length === report.pack.target_clip_count, "clip slots must match the declared target count");

for (const clip of report.pack.clips) {
  assert(clip.target_duration_s.max >= clip.target_duration_s.min, `${clip.id} has an invalid duration target`);
  if (clip.status === "planned") {
    assert(clip.source === null, `${clip.id} is planned but already claims a source`);
    assert(Object.values(clip.annotations).every((value) => value === false), `${clip.id} is planned but claims annotations`);
  } else {
    assert(clip.source !== null, `${clip.id} claims ${clip.status} without source provenance`);
  }

  if (clip.status === "gold_ready" || clip.status === "frozen") {
    assert(annotationsComplete(clip), `${clip.id} claims ${clip.status} without every required annotation`);
  }
}

const systemIds = report.systems.map((system) => system.id);
assert(new Set(systemIds).size === systemIds.length, "system ids must be unique");
assert(report.results.length === report.systems.length, "every system needs one result receipt");

const resultSystemIds = report.results.map((result) => result.system_id);
assert(new Set(resultSystemIds).size === resultSystemIds.length, "result system ids must be unique");
assert(systemIds.every((systemId) => resultSystemIds.includes(systemId)), "every defined system needs exactly one result receipt");

const roleCount = (role) => report.systems.filter((system) => system.role === role).length;
assert(roleCount("subject") === 1, "exactly one subject system is required");
assert(roleCount("internal_control") >= 1, "at least one internal control is required");
assert(roleCount("public_foil") >= 1, "at least one public foil is required");

for (const system of report.systems) {
  if (system.status === "not_run") {
    assert(system.version === null, `${system.id} is not run but claims a version`);
    assert(system.capture_date === null, `${system.id} is not run but claims a capture date`);
  } else {
    assert(isNonEmptyString(system.version), `${system.id} is ${system.status} without a pinned version`);
    assert(system.capture_date !== null, `${system.id} is ${system.status} without a capture date`);
  }
}

for (const result of report.results) {
  assert(systemIds.includes(result.system_id), `${result.system_id} has no matching system definition`);

  const system = report.systems.find((candidate) => candidate.id === result.system_id);
  const expectedSystemStatus = result.status === "not_run" ? "not_run" : result.status === "scored" ? "scored" : "captured";
  assert(system.status === expectedSystemStatus, `${result.system_id} system and result states disagree`);

  if (result.status === "not_run") {
    assert(result.run_id === null, `${result.system_id} is not run but has a run id`);
    assert(result.config === null, `${result.system_id} is not run but has a config`);
    assert(allNull(result.headline), `${result.system_id} is not run but has headline values`);
    assert(allNull(result.diagnostics), `${result.system_id} is not run but has diagnostic values`);
    assert(allNull(result.artifacts), `${result.system_id} is not run but has artifacts`);
  } else {
    assert(isNonEmptyString(result.run_id), `${result.system_id} is ${result.status} without a run id`);
    assert(isNonEmptyObject(result.config), `${result.system_id} is ${result.status} without a pinned configuration`);
    assert(isNonEmptyString(result.artifacts.output), `${result.system_id} is ${result.status} without raw output`);
    assert(isNonEmptyString(result.artifacts.runtime), `${result.system_id} is ${result.status} without a runtime receipt`);
  }

  if (result.status === "reviewed" || result.status === "scored") {
    assert(isNonEmptyString(result.artifacts.review), `${result.system_id} is ${result.status} without reviewer evidence`);
  }

  if (result.status === "scored") {
    const meaning = result.headline.critical_meaning;
    const outcomes = result.headline.critical_outcomes;
    const catastrophic = result.headline.catastrophic;
    const latency = result.headline.latency;

    assert([meaning.passes, meaning.total, meaning.rate].every((value) => value !== null), `${result.system_id} is scored without critical-meaning values`);
    assert(meaning.total > 0, `${result.system_id} is scored without critical-meaning evidence`);
    assert(
      [outcomes.correct, outcomes.wrong, outcomes.withheld, outcomes.missing, outcomes.total].every((value) => value !== null),
      `${result.system_id} is scored without all four critical-unit outcomes`,
    );
    assert(outcomes.total > 0, `${result.system_id} is scored without critical-unit evidence`);
    assert(catastrophic.count !== null && catastrophic.denominator !== null, `${result.system_id} is scored without catastrophic-error counts`);
    assert(
      latency.first_usable_s !== null && latency.complete_s !== null,
      `${result.system_id} is scored without both latency measurements`,
    );
    assert(isNonEmptyString(result.artifacts.score), `${result.system_id} is scored without a score artifact`);
  }

  const outcomes = result.headline.critical_outcomes;
  const outcomeValues = [outcomes.correct, outcomes.wrong, outcomes.withheld, outcomes.missing, outcomes.total];
  if (outcomeValues.every((value) => value !== null)) {
    assert(
      outcomes.correct + outcomes.wrong + outcomes.withheld + outcomes.missing === outcomes.total,
      `${result.system_id} critical outcomes do not sum to total`,
    );
  }

  const meaning = result.headline.critical_meaning;
  if (meaning.passes !== null && meaning.total !== null && meaning.rate !== null) {
    assert(meaning.passes <= meaning.total, `${result.system_id} has more passes than critical units`);
    const expected = meaning.total === 0 ? 0 : meaning.passes / meaning.total;
    assert(Math.abs(expected - meaning.rate) < 1e-9, `${result.system_id} critical meaning rate is inconsistent`);
  }

  const catastrophic = result.headline.catastrophic;
  if (catastrophic.count !== null && catastrophic.denominator !== null) {
    assert(catastrophic.count <= catastrophic.denominator, `${result.system_id} has more catastrophic errors than emitted units`);
    if (catastrophic.denominator === 0) {
      assert(catastrophic.count === 0, `${result.system_id} has catastrophic errors with no emitted denominator`);
      assert(catastrophic.rate === null, `${result.system_id} must leave an undefined zero-denominator rate null`);
    } else {
      assert(catastrophic.rate !== null, `${result.system_id} has a catastrophic count without a rate`);
      const expected = catastrophic.count / catastrophic.denominator;
      assert(Math.abs(expected - catastrophic.rate) < 1e-9, `${result.system_id} catastrophic-error rate is inconsistent`);
    }
  }

  const latency = result.headline.latency;
  if (latency.first_usable_s !== null && latency.complete_s !== null) {
    assert(latency.complete_s >= latency.first_usable_s, `${result.system_id} completes before its first usable output`);
  }
}

if (report.status === "protocol_draft") {
  assert(report.pack.frozen === false, "a protocol draft cannot claim a frozen pack");
  assert(report.generated_at === null, "an unmeasured protocol draft must not claim a generation time");
  assert(report.results.every((result) => result.status === "not_run"), "protocol draft contains a completed result");
}

if (report.status === "scored") {
  assert(report.pack.frozen === true, "a scored report requires a frozen pack");
  assert(report.generated_at !== null, "a scored report requires a generation timestamp");
  assert(report.results.every((result) => result.status === "scored"), "a scored report contains incomplete systems");
}

if (report.status === "gold_frozen" || report.status === "scored") {
  assert(report.pack.frozen === true, `${report.status} requires a frozen pack`);
  assert(report.generated_at !== null, `${report.status} requires a generation timestamp`);
}

if (report.pack.frozen) {
  assert(report.pack.clips.every((clip) => clip.status === "frozen"), "a frozen pack contains non-frozen clips");
  assert(report.pack.clips.every(annotationsComplete), "a frozen pack is missing required annotations");
}

const plannedSlots = report.pack.clips.filter((clip) => clip.status === "planned").length;
const unrunSystems = report.results.filter((result) => result.status === "not_run").length;
const scoredSystems = report.results.filter((result) => result.status === "scored").length;
console.log(
  `bench check passed: ${plannedSlots} planned slots, ${unrunSystems} unrun systems, ${scoredSystems} scored systems`,
);
