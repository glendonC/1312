import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";

import {
  contaminationGuard,
  freezeChecks,
  loadCandidatesManifests,
  readJsonFile,
  receiptIdFor,
  scoreCapture,
  scoreEverythingCheck,
  validateAdjudication,
  validateCandidatesManifest,
  validateFreezeReceipt,
  validateGold,
  validateOutputLabels,
  validatePack,
  validateScoreReceipt,
  verifiedBinding,
} from "./lib/bench-gold.mjs";
import { fileReceipt, writeImmutableJson } from "./lib/immutable-receipts.mjs";
import { loadLedger } from "./lib/memory-review.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const schemaUrl = new URL("../bench/schemas/report.schema.json", import.meta.url);
const schema = JSON.parse(readFileSync(schemaUrl, "utf8"));

const ajv = new Ajv2020({ allErrors: true, strict: true });
ajv.addFormat("date", /^\d{4}-\d{2}-\d{2}$/);
ajv.addFormat("date-time", /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/);
const validateSchema = ajv.compile(schema);

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

/* -------------------------------------------------------------------- reports */

/*
 * Every report the repository holds is validated the same way, wherever it lives. Discovery
 * replaces the original hardcoded example path: bench/examples/ holds honest samples the
 * /benchmarks/ page renders, and bench/packs/<pack>/report.json is where a real pack's public
 * aggregate will live once one exists.
 */
function checkReport(report, label) {
  if (!validateSchema(report)) {
    const errors = ajv.errorsText(validateSchema.errors, { separator: "\n" });
    throw new Error(`bench schema validation failed for ${label}:\n${errors}`);
  }

  assert(report.schema_version === "0.1.0", `${label}: unexpected schema version`);
  assert(["protocol_draft", "gold_frozen", "scored"].includes(report.status), `${label}: invalid report status`);
  assert(report.pack_id.length > 0, `${label}: pack id is required`);

  const clipIds = report.pack.clips.map((clip) => clip.id);
  assert(new Set(clipIds).size === clipIds.length, `${label}: clip ids must be unique`);
  assert(report.pack.clips.length === report.pack.target_clip_count, `${label}: clip slots must match the declared target count`);

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
  assert(new Set(systemIds).size === systemIds.length, `${label}: system ids must be unique`);
  assert(report.results.length === report.systems.length, `${label}: every system needs one result receipt`);

  const resultSystemIds = report.results.map((result) => result.system_id);
  assert(new Set(resultSystemIds).size === resultSystemIds.length, `${label}: result system ids must be unique`);
  assert(systemIds.every((systemId) => resultSystemIds.includes(systemId)), `${label}: every defined system needs exactly one result receipt`);

  const roleCount = (role) => report.systems.filter((system) => system.role === role).length;
  assert(roleCount("subject") === 1, `${label}: exactly one subject system is required`);
  assert(roleCount("internal_control") >= 1, `${label}: at least one internal control is required`);
  assert(roleCount("public_foil") >= 1, `${label}: at least one public foil is required`);

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
    assert(report.pack.frozen === false, `${label}: a protocol draft cannot claim a frozen pack`);
    assert(report.generated_at === null, `${label}: an unmeasured protocol draft must not claim a generation time`);
    assert(report.results.every((result) => result.status === "not_run"), `${label}: protocol draft contains a completed result`);
  }

  if (report.status === "scored") {
    assert(report.pack.frozen === true, `${label}: a scored report requires a frozen pack`);
    assert(report.generated_at !== null, `${label}: a scored report requires a generation timestamp`);
    assert(report.results.every((result) => result.status === "scored"), `${label}: a scored report contains incomplete systems`);
  }

  if (report.status === "gold_frozen" || report.status === "scored") {
    assert(report.pack.frozen === true, `${label}: ${report.status} requires a frozen pack`);
    assert(report.generated_at !== null, `${label}: ${report.status} requires a generation timestamp`);
  }

  if (report.pack.frozen) {
    assert(report.pack.clips.every((clip) => clip.status === "frozen"), `${label}: a frozen pack contains non-frozen clips`);
    assert(report.pack.clips.every(annotationsComplete), `${label}: a frozen pack is missing required annotations`);
  }
}

const reportPaths = [];
const examplesDir = join(ROOT, "bench/examples");
if (existsSync(examplesDir)) {
  for (const entry of readdirSync(examplesDir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".json")) reportPaths.push(join(examplesDir, entry.name));
  }
}
const packsDir = join(ROOT, "bench/packs");
if (existsSync(packsDir)) {
  for (const entry of readdirSync(packsDir, { withFileTypes: true })) {
    const reportPath = join(packsDir, entry.name, "report.json");
    if (entry.isDirectory() && existsSync(reportPath)) reportPaths.push(reportPath);
  }
}
assert(reportPaths.length > 0, "no benchmark reports found to validate");

let plannedSlots = 0;
let unrunSystems = 0;
let scoredSystems = 0;
for (const path of reportPaths) {
  const report = JSON.parse(readFileSync(path, "utf8"));
  checkReport(report, path.slice(ROOT.length));
  plannedSlots += report.pack.clips.filter((clip) => clip.status === "planned").length;
  unrunSystems += report.results.filter((result) => result.status === "not_run").length;
  scoredSystems += report.results.filter((result) => result.status === "scored").length;
}
console.log(
  `bench check passed: ${reportPaths.length} report(s), ${plannedSlots} planned slots, ${unrunSystems} unrun systems, ${scoredSystems} scored systems`,
);

/* ------------------------------------------------------------------ captures */

/*
 * A capture is a dated record of one run over one clip. It is not pack evidence and it is not
 * scored, and the point of checking it here is that it must never become either by accident.
 *
 * The schema pins `scored` and `pack_evidence` to false and every `gold` to null, so drift shows
 * up as a failed build rather than as a number on a page. What this pass adds on top is
 * arithmetic the schema cannot express: that the units add up, that coverage is the ratio it
 * claims to be, and — the one that matters — that no capture has quietly acquired a reference
 * translation from something other than a human.
 */
const capturesDir = new URL("../bench/runs/", import.meta.url);
const captureSchemaUrl = new URL("../bench/schemas/capture.schema.json", import.meta.url);
const captures = [];

// The schema is loaded unconditionally: a missing capture schema must crash the check, not
// silently skip every capture and leave the score-everything guard vacuous.
const validateCapture = ajv.compile(JSON.parse(readFileSync(captureSchemaUrl, "utf8")));

if (existsSync(capturesDir)) {
  const dirs = readdirSync(capturesDir, { withFileTypes: true }).filter((d) => d.isDirectory());
  let checked = 0;

  for (const dir of dirs) {
    const file = new URL(`../bench/runs/${dir.name}/capture.json`, import.meta.url);
    if (!existsSync(file)) continue;

    const capture = JSON.parse(readFileSync(file, "utf8"));

    if (!validateCapture(capture)) {
      throw new Error(
        `capture ${dir.name} failed schema validation:\n${ajv.errorsText(validateCapture.errors, { separator: "\n" })}`,
      );
    }

    for (const [systemId, m] of Object.entries(capture.measured)) {
      assert(
        m.units_emitted + m.units_withheld <= m.units_total,
        `${dir.name}/${systemId} emitted and withheld more units than exist`,
      );
      const expected = m.units_total === 0 ? 0 : m.units_emitted / m.units_total;
      assert(
        Math.abs(expected - m.coverage) < 5e-3,
        `${dir.name}/${systemId} coverage ${m.coverage} is not ${m.units_emitted}/${m.units_total}`,
      );
      if (m.latency.first_usable_s !== null && m.latency.complete_s !== null) {
        assert(
          m.latency.complete_s >= m.latency.first_usable_s,
          `${dir.name}/${systemId} completes before its first usable line`,
        );
      }
      assert(
        capture.systems.some((s) => s.id === systemId),
        `${dir.name} measured ${systemId} without declaring it`,
      );
    }

    assert(
      capture.units.every((u) => u.gold === null),
      `${dir.name} has a gold reference. Gold must be written by a human who reads the source language: a reference generated by a model, then used to score model output, is the model marking its own homework.`,
    );
    assert(
      capture.units.every((u) => u.t_end >= u.t_start),
      `${dir.name} has a unit that ends before it starts`,
    );

    captures.push(capture);
    checked += 1;
  }

  console.log(`capture check passed: ${checked} capture(s), 0 scored, 0 gold`);
}

/* ------------------------------------------- conveyor artifacts and guards */

/*
 * The miss-to-gold conveyor (RFC 0001): candidates manifests, gold candidates, adjudication
 * receipts, packs, freeze receipts, and score receipts are all validated on every check, and
 * the cross-artifact honesty rules are enforced here because no single artifact can see them:
 *
 *   exclusive routing    a clip mined for gold feeds no memory; a clip mined for training
 *                        enters no pack; one clip, one route, forever
 *   contamination        a memory proposal drawing on a pack or gold-routed clip fails,
 *                        resolved at CLIP level, not byte level
 *   pre-registration     nothing scores against gold that was not frozen strictly before the
 *                        capture existed
 *   score-everything     every post-freeze capture of a pack clip must carry a score receipt,
 *                        so a favourable rerun cannot be selected silently
 */

const manifests = await loadCandidatesManifests(join(ROOT, "bench/candidates"), ROOT);

// Routing is forever: writeImmutableJson stops a manifest from being rewritten in place, but
// nothing on disk stops `git rm`. Every candidates manifest this branch's history has ever
// added must still exist, or a routed clip could quietly shed its route.
let routedHistory = [];
try {
  execSync("git rev-parse --is-inside-work-tree", { cwd: ROOT, stdio: "pipe" });
  routedHistory = execSync("git log --diff-filter=A --name-only --format= -- bench/candidates", {
    cwd: ROOT,
    stdio: "pipe",
  })
    .toString()
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.endsWith("candidates.json"));
} catch {
  console.log("routing history unverified: not a git checkout or git unavailable");
}
for (const historical of new Set(routedHistory)) {
  assert(
    existsSync(join(ROOT, historical)),
    `candidates manifest ${historical} was routed and later deleted; exclusive routing is forever — restore it`,
  );
}

const reviewsDir = join(ROOT, "bench/reviews");
let adjudicationCount = 0;
if (existsSync(reviewsDir)) {
  for (const entry of readdirSync(reviewsDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    await validateAdjudication(await readJsonFile(join(reviewsDir, entry.name)), `adjudication ${entry.name}`);
    adjudicationCount += 1;
  }
}

const packClips = [];
const freezes = [];
const packById = new Map();
if (existsSync(packsDir)) {
  for (const entry of readdirSync(packsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const packDir = join(packsDir, entry.name);
    const pack = validatePack(await readJsonFile(join(packDir, "pack.json"), `pack ${entry.name}`), `pack ${entry.name}`);
    assert(pack.pack_id === entry.name, `pack directory ${entry.name} holds pack ${pack.pack_id}`);
    assert(
      !(pack.freeze_receipt === null && existsSync(join(packDir, "freeze.json"))),
      `pack ${pack.pack_id} has an orphan freeze receipt its manifest does not acknowledge; rerun freeze-pack freeze to complete the transition`,
    );
    const goldByClip = new Map();
    for (const clip of pack.clips) {
      if (clip.clip_id !== null) packClips.push({ pack_id: pack.pack_id, clip_id: clip.clip_id, status: clip.status });
      if (clip.gold_path !== null) {
        const gold = await validateGold(await readJsonFile(join(packDir, clip.gold_path)), `pack ${pack.pack_id} gold ${clip.gold_path}`);
        assert(gold.pack_id === pack.pack_id && gold.clip_id === clip.clip_id, `pack ${pack.pack_id} gold ${clip.gold_path} names a different pack or clip`);
        goldByClip.set(clip.clip_id, { gold, gold_path: clip.gold_path });
      }
    }
    let freeze = null;
    let freezeFile = null;
    if (pack.freeze_receipt !== null) {
      const freezePath = join(packDir, pack.freeze_receipt);
      freeze = validateFreezeReceipt(await readJsonFile(freezePath), `freeze receipt ${pack.pack_id}`);
      assert(freeze.pack_id === pack.pack_id, `freeze receipt in ${pack.pack_id} names ${freeze.pack_id}`);
      freezeFile = await fileReceipt(freezePath, `bench/packs/${pack.pack_id}/${pack.freeze_receipt}`);
      const frozenPackClipIds = new Set(pack.clips.filter((clip) => clip.status === "frozen").map((clip) => clip.clip_id));
      assert(
        freeze.clips.length === frozenPackClipIds.size && freeze.clips.every((clip) => frozenPackClipIds.has(clip.clip_id)),
        `freeze receipt and pack manifest disagree about which clips are frozen in ${pack.pack_id}`,
      );
      for (const clip of freeze.clips) {
        // Byte verification alone is not enough: the referenced receipts must also SAY what the
        // freeze claims they say. A hand-written freeze.json pointing at reject, unblinded, or
        // stale-bytes receipts has to die here, not pass as "files exist unchanged".
        await verifiedBinding(clip.gold, ROOT, `frozen ${pack.pack_id}/${clip.clip_id} gold`);
        const held = goldByClip.get(clip.clip_id);
        assert(held, `freeze receipt freezes ${clip.clip_id}, which has no gold in pack ${pack.pack_id}`);
        assert(
          clip.gold.path === `bench/packs/${pack.pack_id}/${held.gold_path}`,
          `frozen ${pack.pack_id}/${clip.clip_id} gold binding does not point at the pack's gold file`,
        );
        if (clip.candidates_manifest !== null) {
          await verifiedBinding(clip.candidates_manifest, ROOT, `frozen ${pack.pack_id}/${clip.clip_id} candidates manifest`);
        }
        const seenReviewers = new Set();
        for (const adjudication of clip.adjudications) {
          await verifiedBinding(
            { path: adjudication.path, content_id: adjudication.content_id, bytes: adjudication.bytes },
            ROOT,
            `frozen ${pack.pack_id}/${clip.clip_id} adjudication`,
          );
          const receipt = await validateAdjudication(
            await readJsonFile(join(ROOT, adjudication.path)),
            `frozen ${pack.pack_id}/${clip.clip_id} adjudication ${adjudication.review_id}`,
          );
          assert(
            receipt.review_id === adjudication.review_id &&
              receipt.reviewer.name === adjudication.reviewer_name &&
              receipt.reviewer.git_identity === adjudication.reviewer_git_identity,
            `frozen ${pack.pack_id}/${clip.clip_id} adjudication entry does not match its receipt`,
          );
          assert(
            receipt.pack_id === pack.pack_id && receipt.clip_id === clip.clip_id,
            `frozen ${pack.pack_id}/${clip.clip_id} adjudication reviews a different pack or clip`,
          );
          assert(receipt.action === "accept", `frozen ${pack.pack_id}/${clip.clip_id} cites a non-accept adjudication`);
          assert(receipt.blinded === true, `frozen ${pack.pack_id}/${clip.clip_id} cites an unblinded adjudication`);
          assert(
            receipt.candidate.content_id === clip.gold.content_id && receipt.candidate.bytes === clip.gold.bytes,
            `frozen ${pack.pack_id}/${clip.clip_id} adjudication binds different gold bytes than the freeze`,
          );
          assert(
            receipt.drafter === held.gold.drafter &&
              receipt.reviewer.name !== held.gold.drafter &&
              receipt.reviewer.git_identity !== held.gold.drafter,
            `frozen ${pack.pack_id}/${clip.clip_id} adjudication drafter/reviewer identities are inconsistent with the gold`,
          );
          assert(
            Date.parse(freeze.frozen_at) >= Date.parse(receipt.created_at),
            `frozen ${pack.pack_id}/${clip.clip_id} freeze predates its adjudication`,
          );
          const identity = `${receipt.reviewer.name}\0${receipt.reviewer.git_identity}`;
          assert(!seenReviewers.has(identity), `frozen ${pack.pack_id}/${clip.clip_id} cites one reviewer twice`);
          seenReviewers.add(identity);
        }
      }
      freezes.push(freeze);
    }
    packById.set(pack.pack_id, { pack, packDir, freeze, freezeFile, goldByClip });
  }
}

const scoresDir = join(ROOT, "bench/scores");
const scores = [];
if (existsSync(scoresDir)) {
  for (const entry of readdirSync(scoresDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const path = join(scoresDir, entry.name, "score.json");
    if (!existsSync(path)) continue;
    const score = validateScoreReceipt(await readJsonFile(path), `score receipt ${entry.name}`);
    assert(score.run === entry.name, `score receipt ${entry.name} names run ${score.run}`);
    for (const name of ["gold", "freeze", "capture", "labels"]) {
      await verifiedBinding(score.bindings[name], ROOT, `score receipt ${entry.name} ${name} binding`);
    }

    // A score receipt is not trusted; it is RE-DERIVED. Its bindings must point at the pack's
    // actual freeze receipt, the run's actual pinned capture, and validated gold and labels —
    // and re-running the same pure scorer over those bytes must reproduce the receipt exactly.
    const packInfo = packById.get(score.pack_id);
    assert(
      packInfo?.freeze,
      `score receipt ${entry.name} names pack ${score.pack_id}, which has no freeze receipt in bench/packs/`,
    );
    assert(
      score.bindings.freeze.path === packInfo.freezeFile.path &&
        score.bindings.freeze.content_id === packInfo.freezeFile.content_id,
      `score receipt ${entry.name} does not bind the pack's actual freeze receipt`,
    );
    assert(
      score.bindings.capture.path === `bench/runs/${score.run}/capture.json`,
      `score receipt ${entry.name} does not bind the run's pinned capture`,
    );
    const held = packInfo.goldByClip.get(score.clip_id);
    assert(
      held && score.bindings.gold.path === `bench/packs/${score.pack_id}/${held.gold_path}`,
      `score receipt ${entry.name} does not bind the pack's gold for clip ${score.clip_id}`,
    );
    const scoredCapture = await readJsonFile(join(ROOT, score.bindings.capture.path), `score receipt ${entry.name} capture`);
    const scoredLabels = validateOutputLabels(
      await readJsonFile(join(ROOT, score.bindings.labels.path)),
      `score receipt ${entry.name} labels`,
    );
    const rederived = scoreCapture({
      gold: held.gold,
      freeze: packInfo.freeze,
      capture: scoredCapture,
      labels: scoredLabels,
      bindings: score.bindings,
      scoredAt: score.scored_at,
    });
    assert(
      rederived.score_id === score.score_id,
      `score receipt ${entry.name} does not re-derive from its bound bytes; every number in it is unsupported`,
    );
    scores.push(score);
  }
}

const ledger = await loadLedger({
  store: join(ROOT, "memory/review"),
  workspaceRoot: ROOT,
  verifyEvidence: false, // byte re-verification is memory:check's job; this pass needs provenance only
});
const runClipCache = new Map();
const resolveRunClip = (run) => {
  if (!runClipCache.has(run)) {
    let clip = null;
    for (const base of ["public/demo/runs", ".studio/runs"]) {
      const path = join(ROOT, base, run, "run.json");
      if (!existsSync(path)) continue;
      try {
        clip = JSON.parse(readFileSync(path, "utf8"))?.clip?.id ?? null;
      } catch {
        clip = null;
      }
      break;
    }
    runClipCache.set(run, clip);
  }
  return runClipCache.get(run);
};

contaminationGuard({ proposals: ledger.proposals, manifests, packClips, resolveRunClip });
scoreEverythingCheck({ freezes, captures, scores });

const goldRouted = manifests.filter(({ manifest }) => manifest.routing.route === "gold").length;
console.log(
  `conveyor check passed: ${manifests.length} candidates manifest(s) (${goldRouted} routed gold), ${adjudicationCount} adjudication receipt(s), ${packClips.length} pack clip(s), ${freezes.length} frozen pack(s), ${scores.length} score receipt(s), ${ledger.proposals.length} memory proposal(s) clean`,
);

/* ------------------------------------------------------- fail-closed drills */

/*
 * Synthetic fixtures in a temp directory, exercising the same validators and the same freeze
 * and score code paths the real tools use. None of this is evidence about any real clip — the
 * fixtures exist so that the guards that are easiest to break while wiring real data are proven
 * to fire on every check, BEFORE real gold exists. A guard that has never fired is a guess.
 */

async function rejects(operation, pattern, message) {
  try {
    await operation();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (pattern.test(detail)) return;
    throw new Error(`bench check failed: ${message}; received: ${detail}`);
  }
  throw new Error(`bench check failed: ${message}; operation was accepted`);
}

const temp = await mkdtemp(join(tmpdir(), "studio-bench-check-"));
try {
  const packDir = join(temp, "packs", "drill-pack");
  const drillReviews = join(temp, "reviews");

  const goldFor = (clipId, drafter = "drafter-agent-01") => ({
    schema: "studio.bench.gold.v1",
    pack_id: "drill-pack",
    clip_id: clipId,
    status: "candidate",
    drafter,
    source: { kind: "owned", channel: "drill fixture", licence: "synthetic fixture", attribution: "drill" },
    mined_from: null,
    units: [
      {
        t_start: 0,
        t_end: 2,
        korean_gold: "드릴 문장",
        english_guidance: null,
        critical_units: [
          { id: `${clipId}-u1`, phenomenon: "none", facts: ["says drill"], catastrophic_if: ["claims the opposite"] },
        ],
      },
    ],
    notes: "Synthetic drill fixture. Never evidence.",
  });

  const reviewFor = (gold, goldBinding, reviewer, overrides = {}) => {
    const body = {
      schema: "studio.bench.review.v1",
      pack_id: gold.pack_id,
      clip_id: gold.clip_id,
      candidate: goldBinding,
      reviewer,
      drafter: gold.drafter,
      blinded: true,
      action: "accept",
      reason: "Drill fixture review.",
      unit_decisions: [{ t_start: 0, t_end: 2, action: "accept", note: null }],
      minutes_spent: 1,
      created_at: "2026-07-14T00:00:00.000Z",
      ...overrides,
    };
    return { review_id: receiptIdFor("bench-review", { review_id: null, ...body }, "review_id"), ...body };
  };

  const pack = {
    schema: "studio.bench.pack.v1",
    pack_id: "drill-pack",
    label: "Drill pack (synthetic; never evidence)",
    frozen: false,
    target_clip_count: 3,
    clips: [
      { slot: "slot-control-01", role: "control", status: "gold_ready", clip_id: "drill-control-1", source: { kind: "owned" }, gold_path: "drill-control-1.gold.json", candidates_manifest: null },
      { slot: "slot-control-02", role: "control", status: "gold_ready", clip_id: "drill-control-2", source: { kind: "owned" }, gold_path: "drill-control-2.gold.json", candidates_manifest: null },
      { slot: "slot-hard-01", role: "hard", status: "gold_ready", clip_id: "drill-hard-1", source: { kind: "owned" }, gold_path: "drill-hard-1.gold.json", candidates_manifest: null },
    ],
    freeze_receipt: null,
  };

  const reviewers = [
    { name: "Reviewer One", git_identity: "reviewer-one <one@example.test>" },
    { name: "Reviewer Two", git_identity: "reviewer-two <two@example.test>" },
  ];

  const goldBindings = {};
  for (const clip of pack.clips) {
    const gold = goldFor(clip.clip_id);
    const path = join(packDir, clip.gold_path);
    await writeImmutableJson(path, gold);
    goldBindings[clip.clip_id] = await fileReceipt(path, `drill/${clip.gold_path}`);
  }

  // One receipt is not two: with a single blinded reviewer nothing freezes.
  await writeImmutableJson(
    join(drillReviews, "r1.json"),
    reviewFor(goldFor("drill-control-1"), goldBindings["drill-control-1"], reviewers[0]),
  );
  await rejects(
    () => freezeChecks({ pack, packDir, reviewsDir: drillReviews, frozenAt: "2026-07-14T12:00:00.000Z", workspaceRoot: ROOT }),
    /distinct blinded human accept receipt/,
    "a pack froze with one adjudication receipt",
  );

  // A second receipt from the SAME identity is still one human.
  await writeImmutableJson(
    join(drillReviews, "r1b.json"),
    reviewFor(goldFor("drill-control-1"), goldBindings["drill-control-1"], reviewers[0], { reason: "Second look, same human." }),
  );
  await rejects(
    () => freezeChecks({ pack, packDir, reviewsDir: drillReviews, frozenAt: "2026-07-14T12:00:00.000Z", workspaceRoot: ROOT }),
    /distinct blinded human accept receipt/,
    "two receipts from one identity froze a clip",
  );

  // The drafter reviewing their own gold does not count, no matter the name on the receipt.
  await rejects(
    async () => {
      const gold = goldFor("drill-control-1");
      await validateAdjudication(
        reviewFor(gold, goldBindings["drill-control-1"], { name: gold.drafter, git_identity: "whatever" }),
      );
    },
    /reviewed by its drafter/,
    "a drafter self-review validated",
  );

  // Complete the honest set: two distinct reviewers per clip; the pack CAN freeze.
  for (const clip of pack.clips) {
    for (const [index, reviewer] of reviewers.entries()) {
      await writeImmutableJson(
        join(drillReviews, `${clip.clip_id}-r${index}.json`),
        reviewFor(goldFor(clip.clip_id), goldBindings[clip.clip_id], reviewer),
      );
    }
  }
  const freeze = await freezeChecks({
    pack,
    packDir,
    reviewsDir: drillReviews,
    frozenAt: "2026-07-14T12:00:00.000Z",
    workspaceRoot: ROOT,
  });

  // A control clip mined from the system's own misses is not a control.
  await rejects(
    async () => {
      const minedControl = structuredClone(pack);
      minedControl.clips[0].candidates_manifest = "bench/candidates/run-006/candidates.json";
      validatePack(minedControl);
      await freezeChecks({ pack: minedControl, packDir, reviewsDir: drillReviews, frozenAt: "2026-07-14T12:00:00.000Z", workspaceRoot: ROOT });
    },
    /control|independently sourced/,
    "a mined control clip froze",
  );

  const capture = {
    schema_version: "0.1.0",
    kind: "capture",
    capture_id: "drill-run",
    captured_at: "2026-07-15",
    scored: false,
    pack_evidence: false,
    clip: { id: "drill-hard-1", duration_s: 2, lang: "ko", pair: "ko->en", source: { kind: "owned", url: "", channel: "drill", licence: "synthetic", attribution: "drill" } },
    reproducible: { deterministic: false, note: "drill" },
    systems: [
      { id: "subject-sys", role: "subject", config: { drill: true } },
      { id: "control-sys", role: "internal_control", config: { drill: true } },
    ],
    measured: {
      "subject-sys": { units_total: 1, units_emitted: 1, units_withheld: 0, coverage: 1, latency: { first_usable_s: 1, complete_s: 2 }, gate_hits: {}, repairs: 0 },
      "control-sys": { units_total: 1, units_emitted: 1, units_withheld: 0, coverage: 1, latency: { first_usable_s: 1, complete_s: 1 }, gate_hits: {}, repairs: 0 },
    },
    unscored: { critical_meaning: null, critical_outcomes: null, catastrophic: null, reason: "drill" },
    units: [
      {
        t_start: 0,
        t_end: 2,
        source: "드릴 문장",
        outputs: {
          "subject-sys": { text: "It's a drill sentence.", withheld: null },
          "control-sys": { text: "Drill sentence.", withheld: null },
        },
        gold: null,
      },
    ],
    notes: "drill",
  };
  const gold = goldFor("drill-hard-1");
  const bindings = {
    gold: goldBindings["drill-hard-1"],
    freeze: { path: "drill/freeze.json", content_id: `sha256:${"0".repeat(64)}`, bytes: 1 },
    capture: { path: "drill/capture.json", content_id: `sha256:${"1".repeat(64)}`, bytes: 1 },
    labels: { path: "drill/labels.json", content_id: `sha256:${"2".repeat(64)}`, bytes: 1 },
  };
  const labelsFor = (overrides = {}) => {
    const body = {
      schema: "studio.bench.output-labels.v1",
      pack_id: "drill-pack",
      clip_id: "drill-hard-1",
      run: "drill-run",
      capture: bindings.capture,
      blinded: true,
      reviewers,
      labels: [
        {
          t_start: 0,
          t_end: 2,
          system_id: "subject-sys",
          meaning_preserved: true,
          critical_units: [{ id: "drill-hard-1-u1", correct: true, catastrophic: false }],
          note: null,
        },
        {
          t_start: 0,
          t_end: 2,
          system_id: "control-sys",
          meaning_preserved: false,
          critical_units: [{ id: "drill-hard-1-u1", correct: false, catastrophic: true }],
          note: "drill",
        },
      ],
      notes: "Synthetic drill labels. Never evidence.",
      ...overrides,
    };
    return validateOutputLabels({ labels_id: receiptIdFor("bench-labels", { labels_id: null, ...body }, "labels_id"), ...body });
  };

  // Pre-registration: a capture pinned on or before the freeze day scores nothing.
  await rejects(
    () => Promise.resolve(scoreCapture({ gold, freeze, capture: { ...capture, captured_at: "2026-07-14" }, labels: labelsFor(), bindings, scoredAt: "2026-07-16T00:00:00.000Z" })),
    /pre-registration/,
    "a same-day capture was scored",
  );
  await rejects(
    () => Promise.resolve(scoreCapture({ gold, freeze, capture: { ...capture, captured_at: "2026-07-01" }, labels: labelsFor(), bindings, scoredAt: "2026-07-16T00:00:00.000Z" })),
    /pre-registration/,
    "a pre-freeze capture was scored",
  );

  // An emitted line with no human label cannot be scored; a label for a line the system never
  // emitted is fabricated evidence.
  await rejects(
    () =>
      Promise.resolve(
        scoreCapture({
          gold,
          freeze,
          capture,
          labels: labelsFor({
            labels: [
              {
                t_start: 0,
                t_end: 2,
                system_id: "subject-sys",
                meaning_preserved: true,
                critical_units: [{ id: "drill-hard-1-u1", correct: true, catastrophic: false }],
                note: null,
              },
            ],
          }),
          bindings,
          scoredAt: "2026-07-16T00:00:00.000Z",
        }),
      ),
    /no human label judges it/,
    "an unlabelled emitted line was scored",
  );
  await rejects(
    () =>
      Promise.resolve(
        scoreCapture({
          gold,
          freeze,
          capture: structuredClone({
            ...capture,
            units: [
              {
                ...capture.units[0],
                outputs: {
                  "subject-sys": { text: null, withheld: { gate: "drill", reason: "drill" } },
                  "control-sys": capture.units[0].outputs["control-sys"],
                },
              },
            ],
          }),
          labels: labelsFor(),
          bindings,
          scoredAt: "2026-07-16T00:00:00.000Z",
        }),
      ),
    /judgment about nothing|emitted nothing/,
    "a label for a withheld line was scored",
  );

  // Gold that is not the gold the freeze bound — a candidate, an amendment — scores nothing.
  await rejects(
    () =>
      Promise.resolve(
        scoreCapture({
          gold,
          freeze,
          capture,
          labels: labelsFor(),
          bindings: { ...bindings, gold: { ...bindings.gold, content_id: `sha256:${"3".repeat(64)}` } },
          scoredAt: "2026-07-16T00:00:00.000Z",
        }),
      ),
    /not the gold the freeze receipt bound/,
    "unfrozen gold bytes were scored against",
  );

  // The honest path scores, and its receipt survives its own arithmetic validator.
  const receipt = scoreCapture({ gold, freeze, capture, labels: labelsFor(), bindings, scoredAt: "2026-07-16T00:00:00.000Z" });
  assert(receipt.systems["subject-sys"].headline.critical_meaning.passes === 1, "drill subject meaning pass lost");
  assert(receipt.systems["control-sys"].headline.catastrophic.count === 1, "drill control catastrophic lost");
  assert(receipt.delta_vs_cold.catastrophic_count === -1, "drill delta lost");
  assert(receipt.judge === null, "drill receipt grew a judge");

  // The diarizer splits windows: a gold unit spanning several capture units consults ALL of
  // them. An emission in the smaller segment — here the catastrophic one — must be judged, and
  // a withheld segment cannot shadow an emitted one.
  const splitUnits = (subjectFirst, subjectSecond) => [
    {
      t_start: 0,
      t_end: 1.2,
      source: "드릴",
      outputs: { "subject-sys": subjectFirst, "control-sys": { text: "Drill.", withheld: null } },
      gold: null,
    },
    {
      t_start: 1.2,
      t_end: 2,
      source: "문장",
      outputs: { "subject-sys": subjectSecond, "control-sys": { text: "Sentence.", withheld: null } },
      gold: null,
    },
  ];
  const splitCapture = (subjectFirst, subjectSecond) => ({ ...capture, units: splitUnits(subjectFirst, subjectSecond) });
  const splitLabels = labelsFor({
    labels: [
      {
        t_start: 0,
        t_end: 2,
        system_id: "subject-sys",
        meaning_preserved: false,
        critical_units: [{ id: "drill-hard-1-u1", correct: false, catastrophic: true }],
        note: "the smaller segment carries the catastrophic emission",
      },
      {
        t_start: 0,
        t_end: 2,
        system_id: "control-sys",
        meaning_preserved: true,
        critical_units: [{ id: "drill-hard-1-u1", correct: true, catastrophic: false }],
        note: null,
      },
    ],
  });
  const splitReceipt = scoreCapture({
    gold,
    freeze,
    capture: splitCapture({ text: "Fine text.", withheld: null }, { text: "Catastrophic text.", withheld: null }),
    labels: splitLabels,
    bindings,
    scoredAt: "2026-07-16T00:00:00.000Z",
  });
  assert(
    splitReceipt.systems["subject-sys"].headline.catastrophic.count === 1,
    "a catastrophic emission in the smaller-overlap segment vanished from the receipt",
  );
  await rejects(
    () =>
      Promise.resolve(
        scoreCapture({
          gold,
          freeze,
          capture: splitCapture({ text: null, withheld: { gate: "drill", reason: "drill" } }, { text: "Emitted anyway.", withheld: null }),
          labels: labelsFor({
            labels: [
              {
                t_start: 0,
                t_end: 2,
                system_id: "control-sys",
                meaning_preserved: true,
                critical_units: [{ id: "drill-hard-1-u1", correct: true, catastrophic: false }],
                note: null,
              },
            ],
          }),
          bindings,
          scoredAt: "2026-07-16T00:00:00.000Z",
        }),
      ),
    /no human label judges it/,
    "a withheld segment shadowed an emitted one and dodged the label requirement",
  );

  // A freeze cannot be dated before the adjudication receipts that authorize it.
  await rejects(
    () => freezeChecks({ pack, packDir, reviewsDir: drillReviews, frozenAt: "2026-07-13T12:00:00.000Z", workspaceRoot: ROOT }),
    /cannot be dated before/,
    "a freeze predating its adjudications was accepted",
  );

  // Exclusive routing and contamination, at clip level.
  const drillManifests = [
    { path: "drill/a.json", manifest: { clip: { id: "clip-x" }, routing: { route: "gold" } } },
    { path: "drill/b.json", manifest: { clip: { id: "clip-x" }, routing: { route: "training" } } },
  ];
  await rejects(
    () => Promise.resolve(contaminationGuard({ proposals: [], manifests: drillManifests, packClips: [], resolveRunClip: () => null })),
    /exclusive routing allows exactly one/,
    "conflicting routes for one clip were accepted",
  );
  await rejects(
    () =>
      Promise.resolve(
        contaminationGuard({
          proposals: [],
          manifests: [drillManifests[1]],
          packClips: [{ pack_id: "drill-pack", clip_id: "clip-x", status: "sourced" }],
          resolveRunClip: () => null,
        }),
      ),
    /routed to training .* appears in pack/,
    "a training-routed clip entered a pack",
  );
  const drillProposal = {
    proposal_id: "memory-proposal:drill",
    source: { run_id: "drill-run-9", clip_id: "clip-x" },
    evidence: [{ path: "public/demo/runs/drill-run-9/captions.json", content_id: `sha256:${"4".repeat(64)}`, bytes: 1 }],
  };
  await rejects(
    () =>
      Promise.resolve(
        contaminationGuard({
          proposals: [drillProposal],
          manifests: [drillManifests[0]],
          packClips: [],
          resolveRunClip: () => "clip-x",
        }),
      ),
    /contributes nothing to memory/,
    "a memory proposal drew on a gold-routed clip",
  );
  // A self-declared clip_id must not stand in for a run the guard cannot resolve.
  await rejects(
    () =>
      Promise.resolve(
        contaminationGuard({
          proposals: [drillProposal],
          manifests: [],
          packClips: [],
          resolveRunClip: () => null,
        }),
      ),
    /cannot be resolved/,
    "a declared clip_id masked an unresolvable run reference",
  );
  await rejects(
    () =>
      Promise.resolve(
        contaminationGuard({
          proposals: [
            {
              proposal_id: "memory-proposal:drill-2",
              source: null,
              evidence: [{ path: "public/demo/runs/unresolvable-run/captions.json", content_id: `sha256:${"5".repeat(64)}`, bytes: 1 }],
            },
          ],
          manifests: [],
          packClips: [],
          resolveRunClip: () => null,
        }),
      ),
    /cannot be resolved/,
    "an unresolvable run reference passed the contamination guard",
  );
  await rejects(
    () =>
      Promise.resolve(
        contaminationGuard({
          proposals: [
            {
              proposal_id: "memory-proposal:drill-3",
              source: null,
              evidence: [{ path: "somewhere/else.json", content_id: `sha256:${"6".repeat(64)}`, bytes: 1 }],
            },
          ],
          manifests: [],
          packClips: [],
          resolveRunClip: () => null,
        }),
      ),
    /cannot be attributed/,
    "unattributable evidence passed the contamination guard",
  );

  // Score-everything: a post-freeze capture with no score receipt fails the whole check.
  await rejects(
    () =>
      Promise.resolve(
        scoreEverythingCheck({
          freezes: [freeze],
          captures: [{ capture_id: "drill-run-2", clip: { id: "drill-hard-1" }, captured_at: "2026-07-20" }],
          scores: [],
        }),
      ),
    /no score receipt/,
    "a post-freeze capture without a score receipt passed",
  );

  // A candidates manifest structurally cannot carry gold.
  const manifestPath = join(ROOT, "bench/candidates/run-006/candidates.json");
  if (existsSync(manifestPath)) {
    const real = await readJsonFile(manifestPath);
    const poisoned = structuredClone(real);
    poisoned.candidates[0].korean_gold = "몰래 쓴 골드";
    await rejects(
      () => Promise.resolve(validateCandidatesManifest(poisoned)),
      /structurally cannot hold gold|korean_gold/,
      "a candidates manifest carried gold",
    );
  }

  console.log(
    "fail-closed drills passed: single-reviewer freeze, same-identity freeze, drafter self-review, mined control, backdated freeze, pre-registration, unlabelled line, label-for-nothing, unfrozen gold, split-window aggregation, withheld-shadowed emission, route conflict, training-clip-in-pack, contaminated proposal, masked unresolvable run, unresolvable run, unattributable evidence, unscored post-freeze capture, manifest gold",
  );
} finally {
  await rm(temp, { recursive: true, force: true });
}
