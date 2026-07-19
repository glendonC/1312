/**
 * Preregister and evaluate one reviewed-memory behavioral rule against a frozen pack.
 *
 * Registration binds a training-routed miss, exact rule bytes, one scalar config delta, and a
 * complete run grid before captures exist. Evaluation cold-reopens every pair, score, capture,
 * and optional certified single-attempt proof. Historical V1 remains refusal-only; V2 can become
 * eligible only when the complete execution grid is host-attributed.
 */

import { readdir } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

import Ajv2020 from "ajv/dist/2020.js";

import { benchConfigId } from "./bench-ablation.mjs";
import {
  contaminationGuard,
  loadCandidatesManifests,
  readJsonFile,
  validateCandidatesManifest,
  validateFreezeReceipt,
  validatePack,
  validateScoreReceipt,
  verifyScoreReceipt,
  verifiedBinding,
} from "./bench-gold.mjs";
import {
  validatePairedScoreReceipt,
  verifyPairedScoreReceipt,
} from "./bench-paired-score.mjs";
import { verifyExecutionAttribution } from "./bench-single-attempt.mjs";
import {
  canonicalJson,
  contentIdForJson,
  fileReceipt,
} from "./immutable-receipts.mjs";
import { validateProposal } from "./memory-review.mjs";
import { normalizeSourceReceipt } from "./source-receipts.mjs";

export const RULE_CHANGE_SCHEMAS = Object.freeze({
  registration: "studio.bench.rule-change-registration.v1",
  resultV1: "studio.bench.rule-change-result.v1",
  result: "studio.bench.rule-change-result.v2",
});

function fail(message) {
  throw new Error(`bench rule change: ${message}`);
}

function exactKeys(value, keys, context) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${context} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(`${context} keys must be exactly ${expected.join(", ")}`);
  }
}

function exactTimestamp(value, context) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value) {
    fail(`${context} must be an exact ISO-8601 UTC timestamp`);
  }
  return value;
}

function requiredText(value, context) {
  if (typeof value !== "string" || value.trim().length === 0) fail(`${context} must be a non-empty string`);
  return value;
}

function resolveFile(path, workspaceRoot) {
  return isAbsolute(path) ? path : resolve(workspaceRoot, path);
}

function repositoryPath(path, context) {
  requiredText(path, context);
  if (isAbsolute(path) || path.startsWith("./") || path.split("/").includes("..")) {
    fail(`${context} must be a repository-relative path without traversal`);
  }
  return path;
}

function youtubeVideoId(value, context) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail(`${context} must be a valid URL`);
  }
  if (
    url.protocol !== "https:" ||
    !new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"]).has(url.hostname)
  ) {
    fail(`${context} must be an HTTPS YouTube URL`);
  }
  return url.hostname === "youtu.be"
    ? url.pathname.slice(1).split("/")[0]
    : url.searchParams.get("v");
}

function pointerPart(value) {
  return String(value).replaceAll("~", "~0").replaceAll("/", "~1");
}

function scalar(value) {
  return value === null || ["string", "number", "boolean"].includes(typeof value);
}

function leafDifferences(left, right, path = "") {
  if (scalar(left) || scalar(right)) {
    if (!scalar(left) || !scalar(right)) fail(`configurations change shape at ${path || "/"}`);
    return canonicalJson(left) === canonicalJson(right) ? [] : [{ path, baseline: left, variant: right }];
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      fail(`configurations change array shape at ${path || "/"}`);
    }
    return left.flatMap((value, index) => leafDifferences(value, right[index], `${path}/${index}`));
  }
  if (!left || !right || typeof left !== "object" || typeof right !== "object") {
    fail(`configurations contain a non-JSON value at ${path || "/"}`);
  }
  const leftKeys = Object.keys(left).sort((a, b) => a.localeCompare(b));
  const rightKeys = Object.keys(right).sort((a, b) => a.localeCompare(b));
  if (canonicalJson(leftKeys) !== canonicalJson(rightKeys)) {
    fail(`configurations change object shape at ${path || "/"}`);
  }
  return leftKeys.flatMap((key) => leafDifferences(left[key], right[key], `${path}/${pointerPart(key)}`));
}

function registrationId(value) {
  const { registration_id: _id, ...body } = value;
  return `bench-rule-change-registration:${contentIdForJson({ registration_id: null, ...body })}`;
}

function resultId(value) {
  const { result_id: _id, ...body } = value;
  return `bench-rule-change-result:${contentIdForJson({ result_id: null, ...body })}`;
}

function expectedCapturePlan(slug, clipIds, repetitions) {
  return [...clipIds]
    .sort((left, right) => left.localeCompare(right))
    .flatMap((clipId, clipIndex) =>
      Array.from({ length: repetitions }, (_, index) => {
        const repetition = index + 1;
        const prefix = `rule-change-${slug}-c${clipIndex + 1}-r${repetition}`;
        return {
          clip_id: clipId,
          repetition,
          without_run: `${prefix}-without`,
          with_run: `${prefix}-with`,
        };
      }),
    );
}

let validatorsPromise;

async function validators() {
  if (!validatorsPromise) {
    validatorsPromise = (async () => {
      const ajv = new Ajv2020({ allErrors: true, strict: true });
      ajv.addFormat(
        "date-time",
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/,
      );
      ajv.addFormat("date", /^\d{4}-\d{2}-\d{2}$/);
      const [registration, resultV1, result, capture] = await Promise.all([
        readJsonFile(new URL("../../bench/schemas/rule-change-registration.schema.json", import.meta.url)),
        readJsonFile(new URL("../../bench/schemas/rule-change-result.schema.json", import.meta.url)),
        readJsonFile(new URL("../../bench/schemas/rule-change-result-v2.schema.json", import.meta.url)),
        readJsonFile(new URL("../../bench/schemas/capture.schema.json", import.meta.url)),
      ]);
      return {
        ajv,
        registration: ajv.compile(registration),
        resultV1: ajv.compile(resultV1),
        result: ajv.compile(result),
        capture: ajv.compile(capture),
      };
    })();
  }
  return validatorsPromise;
}

async function schemaCheck(value, name, context) {
  const held = await validators();
  const validate = held[name];
  if (!validate(value)) {
    fail(`${context} failed schema validation:\n${held.ajv.errorsText(validate.errors, { separator: "\n" })}`);
  }
}

async function verifiedRegistrationInputs(registration, workspaceRoot, context) {
  repositoryPath(registration.change.proposal.path, `${context} proposal path`);
  await verifiedBinding(registration.change.proposal, workspaceRoot, `${context} proposal`);
  const proposal = validateProposal(
    await readJsonFile(resolveFile(registration.change.proposal.path, workspaceRoot), `${context} proposal`),
  );
  if (
    proposal.kind !== "rule" ||
    proposal.proposal_id !== registration.change.proposal_id ||
    contentIdForJson(proposal) !== registration.change.proposal_content_id ||
    contentIdForJson(proposal.value) !== registration.change.rule_content_id
  ) {
    fail(`${context} change does not bind the exact behavioral rule proposal bytes`);
  }
  const proposalDigest = proposal.proposal_id.slice("memory-proposal:sha256:".length);
  const expectedProposalPath = `memory/review/proposals/${proposalDigest}.json`;
  if (registration.change.proposal.path !== expectedProposalPath) {
    fail(`${context} proposal path must be ${expectedProposalPath}`);
  }
  for (const [index, evidence] of proposal.evidence.entries()) {
    repositoryPath(evidence.path, `${context} proposal evidence ${index} path`);
    await verifiedBinding(evidence, workspaceRoot, `${context} proposal evidence ${index}`);
  }

  await verifiedBinding(registration.change.origin.candidates_manifest, workspaceRoot, `${context} candidates manifest`);
  const manifest = validateCandidatesManifest(
    await readJsonFile(
      resolveFile(registration.change.origin.candidates_manifest.path, workspaceRoot),
      `${context} candidates manifest`,
    ),
  );
  const origin = registration.change.origin;
  if (
    manifest.manifest_id !== origin.manifest_id ||
    manifest.run !== origin.run_id ||
    manifest.clip.id !== origin.clip_id ||
    manifest.routing.route !== "training"
  ) {
    fail(`${context} origin is not the exact training-routed candidates manifest`);
  }
  repositoryPath(origin.source_receipt.path, `${context} source receipt path`);
  await verifiedBinding(origin.source_receipt, workspaceRoot, `${context} source receipt`);
  const source = await readJsonFile(
    resolveFile(origin.source_receipt.path, workspaceRoot),
    `${context} source receipt`,
  );
  const expectedSourcePath = `public/demo/runs/${origin.run_id}/source.json`;
  let normalizedSource;
  try {
    normalizedSource = normalizeSourceReceipt(source);
  } catch (error) {
    fail(`${context} source receipt is not a valid redistributable source: ${error.message}`);
  }
  if (
    origin.source_receipt.path !== expectedSourcePath ||
    normalizedSource.kind !== "youtube" ||
    !/^[A-Za-z0-9_-]{11}$/.test(normalizedSource.sourceId) ||
    youtubeVideoId(normalizedSource.locator.url, `${context} source URL`) !== normalizedSource.sourceId ||
    normalizedSource.rights.label !== "Creative Commons Attribution license (reuse allowed)" ||
    !normalizedSource.rights.attribution.includes(normalizedSource.creator) ||
    normalizedSource.sourceId !== origin.clip_id ||
    normalizedSource.selection.duration !== manifest.clip.duration_s ||
    origin.source_kind !== "youtube" ||
    origin.media_class !== "recorded_youtube_bytes"
  ) {
    fail(`${context} origin must bind one valid YouTube identity and matching recorded media bytes`);
  }
  repositoryPath(origin.run_receipt.path, `${context} run receipt path`);
  await verifiedBinding(origin.run_receipt, workspaceRoot, `${context} run receipt`);
  const expectedRunPath = `public/demo/runs/${origin.run_id}/run.json`;
  const run = await readJsonFile(resolveFile(origin.run_receipt.path, workspaceRoot), `${context} run receipt`);
  if (
    origin.run_receipt.path !== expectedRunPath ||
    run.id !== origin.run_id ||
    run.clip?.id !== origin.clip_id ||
    run.clip?.duration !== manifest.clip.duration_s ||
    typeof run.clip?.media !== "string" ||
    run.clip.media.length === 0 ||
    run.clip.media.includes("/")
  ) {
    fail(`${context} run receipt does not bind the origin run, clip, duration, and media filename`);
  }
  repositoryPath(origin.media_artifact.path, `${context} media artifact path`);
  await verifiedBinding(origin.media_artifact, workspaceRoot, `${context} media artifact`);
  const expectedMediaPath = `public/demo/runs/${origin.run_id}/${run.clip.media}`;
  if (origin.media_artifact.path !== expectedMediaPath) {
    fail(`${context} media artifact path must be ${expectedMediaPath}`);
  }
  const expectedManifestPath = `bench/candidates/${origin.run_id}/candidates.json`;
  if (origin.candidates_manifest.path !== expectedManifestPath) {
    fail(`${context} candidates manifest path must be ${expectedManifestPath}`);
  }
  if (
    !proposal.source ||
    typeof proposal.source !== "object" ||
    Array.isArray(proposal.source) ||
    proposal.source.run_id !== origin.run_id ||
    proposal.source.clip_id !== origin.clip_id
  ) {
    fail(`${context} proposal source must bind the origin run and clip`);
  }
  const attributable = new Set([
    origin.candidates_manifest.path,
    ...manifest.source_artifacts.map((artifact) => artifact.path),
  ]);
  for (const evidence of proposal.evidence) {
    const runMatch = /(?:public\/demo\/runs|\.studio\/runs)\/([^/]+)\//.exec(evidence.path);
    if (!attributable.has(evidence.path) && runMatch?.[1] !== origin.run_id) {
      fail(`${context} proposal evidence ${evidence.path} is not attributable to the training-routed origin`);
    }
  }

  await verifiedBinding(registration.pack.manifest, workspaceRoot, `${context} pack manifest`);
  const pack = validatePack(
    await readJsonFile(resolveFile(registration.pack.manifest.path, workspaceRoot), `${context} pack manifest`),
  );
  if (
    pack.pack_id !== registration.pack.pack_id ||
    !pack.frozen ||
    registration.pack.manifest.path !== `bench/packs/${pack.pack_id}/pack.json` ||
    !pack.freeze_receipt
  ) {
    fail(`${context} does not bind one frozen pack manifest at its canonical path`);
  }
  await verifiedBinding(registration.pack.freeze, workspaceRoot, `${context} freeze receipt`);
  const expectedFreezePath = `bench/packs/${pack.pack_id}/${pack.freeze_receipt}`;
  const freeze = validateFreezeReceipt(
    await readJsonFile(resolveFile(registration.pack.freeze.path, workspaceRoot), `${context} freeze receipt`),
  );
  if (registration.pack.freeze.path !== expectedFreezePath || freeze.pack_id !== pack.pack_id) {
    fail(`${context} does not bind the pack's exact freeze receipt`);
  }
  const packClips = pack.clips.map((clip) => ({ pack_id: pack.pack_id, clip_id: clip.clip_id }));
  if (packClips.some((clip) => clip.clip_id === origin.clip_id)) {
    fail(`${context} training-routed origin clip appears in the evaluation pack`);
  }

  const manifests = await loadCandidatesManifests(resolve(workspaceRoot, "bench/candidates"), workspaceRoot);
  const runClips = new Map();
  for (const { manifest: candidateManifest } of manifests) {
    runClips.set(candidateManifest.run, candidateManifest.clip.id);
  }
  if (!runClips.has(origin.run_id)) runClips.set(origin.run_id, origin.clip_id);
  contaminationGuard({
    proposals: [proposal],
    manifests,
    packClips,
    resolveRunClip: (run) => runClips.get(run) ?? null,
  });

  return { proposal, manifest, pack, freeze };
}

export async function validateRuleChangeRegistration(
  registration,
  { workspaceRoot = process.cwd(), context = "rule change registration" } = {},
) {
  await schemaCheck(registration, "registration", context);
  if (registration.schema !== RULE_CHANGE_SCHEMAS.registration) fail(`${context} schema is not registered`);
  exactTimestamp(registration.registered_at, `${context}.registered_at`);
  if (registration.registration_id !== registrationId(registration)) {
    fail(`${context} registration_id does not match its immutable contents`);
  }

  const baseline = registration.subject.baseline;
  const variant = registration.subject.variant;
  if (baseline.config_id !== benchConfigId(baseline.config) || variant.config_id !== benchConfigId(variant.config)) {
    fail(`${context} configuration id does not match its canonical configuration`);
  }
  const differences = leafDifferences(baseline.config, variant.config);
  if (differences.length !== 1) fail(`${context} must change exactly one scalar config leaf; found ${differences.length}`);
  const [difference] = differences;
  if (
    difference.baseline !== null ||
    difference.variant !== registration.change.rule_content_id ||
    difference.path !== "/reviewed_memory/rule_content_id" ||
    registration.delta.path !== difference.path ||
    registration.delta.baseline !== null ||
    registration.delta.variant !== difference.variant
  ) {
    fail(`${context} exact config delta must change null to the bound rule content id`);
  }

  const inputs = await verifiedRegistrationInputs(registration, workspaceRoot, context);
  if (Date.parse(registration.registered_at) <= Date.parse(inputs.freeze.frozen_at)) {
    fail(`${context} must be registered after the frozen pack`);
  }
  if (Date.parse(registration.registered_at) <= Date.parse(inputs.proposal.created_at)) {
    fail(`${context} must be registered after the proposal was created`);
  }
  const expectedPlan = expectedCapturePlan(
    registration.slug,
    inputs.freeze.clips.map((clip) => clip.clip_id),
    registration.capture_policy.repetitions_per_clip,
  );
  if (canonicalJson(registration.capture_plan) !== canonicalJson(expectedPlan)) {
    fail(`${context} capture_plan does not cover the exact preregistered pack and repetition grid`);
  }
  return registration;
}

export async function materializeRuleChangeRegistration(
  draft,
  { workspaceRoot = process.cwd(), registeredAt = new Date().toISOString() } = {},
) {
  exactKeys(
    draft,
    [
      "schema",
      "slug",
      "status",
      "hypothesis",
      "proposal_path",
      "candidates_manifest_path",
      "pack_id",
      "subject",
      "capture_policy",
      "qualification_policy",
      "results",
      "notes",
    ],
    "rule change draft",
  );
  exactKeys(draft.subject, ["system_id", "baseline", "variant"], "rule change draft subject");
  exactKeys(draft.subject.baseline, ["config"], "rule change draft baseline");
  exactKeys(draft.subject.variant, ["config"], "rule change draft variant");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(draft.slug)) fail("rule change draft slug is malformed");

  const proposalPath = requiredText(draft.proposal_path, "rule change draft proposal_path");
  repositoryPath(proposalPath, "rule change draft proposal_path");
  const proposal = validateProposal(await readJsonFile(resolveFile(proposalPath, workspaceRoot), "rule change proposal"));
  if (proposal.kind !== "rule") fail("rule change proposal is not a behavioral rule");
  const manifestPath = requiredText(draft.candidates_manifest_path, "rule change draft candidates_manifest_path");
  repositoryPath(manifestPath, "rule change draft candidates_manifest_path");
  const manifest = validateCandidatesManifest(
    await readJsonFile(resolveFile(manifestPath, workspaceRoot), "rule change candidates manifest"),
  );
  const packPath = `bench/packs/${draft.pack_id}/pack.json`;
  const pack = validatePack(await readJsonFile(resolve(workspaceRoot, packPath), "rule change pack"));
  if (!pack.frozen || !pack.freeze_receipt) fail("rule change pack is not frozen");
  const freezePath = `bench/packs/${pack.pack_id}/${pack.freeze_receipt}`;
  const freeze = validateFreezeReceipt(await readJsonFile(resolve(workspaceRoot, freezePath), "rule change freeze"));
  const sourcePath = `public/demo/runs/${manifest.run}/source.json`;
  const sourceBinding = manifest.source_artifacts.find((artifact) => artifact.path === sourcePath);
  if (!sourceBinding) fail(`rule change origin candidates manifest does not bind ${sourcePath}`);
  const source = await readJsonFile(resolve(workspaceRoot, sourcePath), "rule change source receipt");
  let normalizedSource;
  try {
    normalizedSource = normalizeSourceReceipt(source);
  } catch (error) {
    fail(`rule change v1 requires a valid redistributable YouTube source: ${error.message}`);
  }
  if (
    normalizedSource.kind !== "youtube" ||
    !/^[A-Za-z0-9_-]{11}$/.test(normalizedSource.sourceId) ||
    youtubeVideoId(normalizedSource.locator.url, "rule change source URL") !== normalizedSource.sourceId ||
    normalizedSource.rights.label !== "Creative Commons Attribution license (reuse allowed)" ||
    !normalizedSource.rights.attribution.includes(normalizedSource.creator) ||
    normalizedSource.sourceId !== manifest.clip.id ||
    normalizedSource.selection.duration !== manifest.clip.duration_s
  ) {
    fail("rule change v1 requires one matching YouTube source identity");
  }
  const runPath = `public/demo/runs/${manifest.run}/run.json`;
  const runBinding = manifest.source_artifacts.find((artifact) => artifact.path === runPath);
  if (!runBinding) fail(`rule change origin candidates manifest does not bind ${runPath}`);
  const run = await readJsonFile(resolve(workspaceRoot, runPath), "rule change origin run");
  if (
    run.id !== manifest.run ||
    run.clip?.id !== manifest.clip.id ||
    run.clip?.duration !== manifest.clip.duration_s ||
    typeof run.clip?.media !== "string" ||
    run.clip.media.length === 0 ||
    run.clip.media.includes("/")
  ) {
    fail("rule change origin run does not match the candidates manifest and media filename");
  }
  const mediaPath = `public/demo/runs/${manifest.run}/${run.clip.media}`;
  const mediaBinding = manifest.source_artifacts.find((artifact) => artifact.path === mediaPath);
  if (!mediaBinding) fail(`rule change origin candidates manifest does not bind ${mediaPath}`);
  const differences = leafDifferences(draft.subject.baseline.config, draft.subject.variant.config);
  if (differences.length !== 1) fail(`rule change draft must change exactly one scalar config leaf; found ${differences.length}`);
  const [delta] = differences;

  const body = {
    schema: draft.schema,
    slug: draft.slug,
    status: draft.status,
    registered_at: exactTimestamp(registeredAt, "rule change registration time"),
    hypothesis: draft.hypothesis,
    change: {
      proposal: await fileReceipt(resolveFile(proposalPath, workspaceRoot), proposalPath),
      proposal_id: proposal.proposal_id,
      proposal_content_id: contentIdForJson(proposal),
      rule_content_id: contentIdForJson(proposal.value),
      origin: {
        candidates_manifest: await fileReceipt(resolveFile(manifestPath, workspaceRoot), manifestPath),
        manifest_id: manifest.manifest_id,
        run_id: manifest.run,
        clip_id: manifest.clip.id,
        route: manifest.routing.route,
        source_receipt: sourceBinding,
        run_receipt: runBinding,
        media_artifact: mediaBinding,
        source_kind: source.kind,
        media_class: "recorded_youtube_bytes",
      },
    },
    pack: {
      pack_id: pack.pack_id,
      manifest: await fileReceipt(resolve(workspaceRoot, packPath), packPath),
      freeze: await fileReceipt(resolve(workspaceRoot, freezePath), freezePath),
    },
    subject: {
      system_id: draft.subject.system_id,
      baseline: {
        config_id: benchConfigId(draft.subject.baseline.config),
        config: draft.subject.baseline.config,
      },
      variant: {
        config_id: benchConfigId(draft.subject.variant.config),
        config: draft.subject.variant.config,
      },
    },
    delta,
    capture_policy: draft.capture_policy,
    capture_plan: expectedCapturePlan(
      draft.slug,
      freeze.clips.map((clip) => clip.clip_id),
      draft.capture_policy.repetitions_per_clip,
    ),
    qualification_policy: draft.qualification_policy,
    results: draft.results,
    notes: draft.notes,
  };
  const registration = { registration_id: registrationId(body), ...body };
  return validateRuleChangeRegistration(registration, { workspaceRoot });
}

function rateRange(values) {
  if (values.some((value) => value === null)) return null;
  return Math.max(...values) - Math.min(...values);
}

function conditionSummary(headlines) {
  const summary = {
    critical_meaning: { passes: 0, total: 0, rate: null },
    critical_outcomes: { correct: 0, wrong: 0, withheld: 0, missing: 0 },
    catastrophic_count: 0,
  };
  for (const headline of headlines) {
    summary.critical_meaning.passes += headline.critical_meaning.passes;
    summary.critical_meaning.total += headline.critical_meaning.total;
    for (const outcome of ["correct", "wrong", "withheld", "missing"]) {
      summary.critical_outcomes[outcome] += headline.critical_outcomes[outcome];
    }
    summary.catastrophic_count += headline.catastrophic.count;
  }
  if (summary.critical_meaning.total > 0) {
    summary.critical_meaning.rate = summary.critical_meaning.passes / summary.critical_meaning.total;
  }
  return summary;
}

async function validateCaptureForSide({ score, registration, plan, side, workspaceRoot, context }) {
  const expectedRun = side === "without" ? plan.without_run : plan.with_run;
  const expectedCapturePath = `bench/runs/${expectedRun}/capture.json`;
  if (score.bindings.capture.path !== expectedCapturePath) {
    fail(`${context} capture path must be ${expectedCapturePath}`);
  }
  const expectedLabelsPath = `bench/reviews/labels/${expectedRun}.json`;
  if (score.bindings.labels.path !== expectedLabelsPath) {
    fail(`${context} labels path must be ${expectedLabelsPath}`);
  }
  await verifiedBinding(score.bindings.capture, workspaceRoot, `${context} capture`);
  const capture = await readJsonFile(resolveFile(score.bindings.capture.path, workspaceRoot), `${context} capture`);
  const held = await validators();
  if (!held.capture(capture)) {
    fail(`${context} capture failed schema validation:\n${held.ajv.errorsText(held.capture.errors, { separator: "\n" })}`);
  }
  if (
    score.run !== expectedRun ||
    capture.capture_id !== expectedRun ||
    capture.clip.id !== plan.clip_id ||
    score.clip_id !== plan.clip_id
  ) {
    fail(`${context} does not match its preregistered run and clip identity`);
  }
  const system = capture.systems.find((candidate) => candidate.id === registration.subject.system_id);
  const expectedConfig = side === "without"
    ? registration.subject.baseline.config
    : registration.subject.variant.config;
  if (!system || canonicalJson(system.config) !== canonicalJson(expectedConfig)) {
    fail(`${context} capture config differs from its preregistered ${side} config`);
  }
  if (capture.captured_at <= registration.registered_at.slice(0, 10)) {
    fail(`${context} capture must be dated strictly after the registration day`);
  }
  if (score.scored_at.slice(0, 10) < capture.captured_at) {
    fail(`${context} score predates its bound capture day`);
  }
  return {
    capture,
    captureBinding: score.bindings.capture,
    headline: score.systems[registration.subject.system_id].headline,
  };
}

async function rejectUnplannedMatchingCaptures(registration, plannedRuns, workspaceRoot) {
  const clipIds = new Set(registration.capture_plan.map((plan) => plan.clip_id));
  const capturesDir = resolve(workspaceRoot, "bench/runs");
  let captureEntries = [];
  try {
    captureEntries = await readdir(capturesDir, { withFileTypes: true });
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const held = await validators();
  for (const entry of captureEntries) {
    if (!entry.isDirectory()) continue;
    const path = join(capturesDir, entry.name, "capture.json");
    let capture;
    try {
      capture = await readJsonFile(path, `capture ${entry.name}`);
    } catch (error) {
      if (error?.cause?.code === "ENOENT") continue;
      throw error;
    }
    if (!held.capture(capture)) fail(`capture ${entry.name} failed schema validation`);
    if (!clipIds.has(capture.clip.id) || capture.captured_at <= registration.registered_at.slice(0, 10)) continue;
    const captureSystem = capture.systems.find((candidate) => candidate.id === registration.subject.system_id);
    const matchesConfig = captureSystem && [registration.subject.baseline.config, registration.subject.variant.config]
      .some((config) => canonicalJson(config) === canonicalJson(captureSystem.config));
    if (matchesConfig && !plannedRuns.has(capture.capture_id)) {
      fail(`unplanned matching capture ${capture.capture_id} exists outside the preregistered grid`);
    }
  }

  const scoresDir = resolve(workspaceRoot, "bench/scores");
  let entries = [];
  try {
    entries = await readdir(scoresDir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === "pairs") continue;
    const path = join(scoresDir, entry.name, "score.json");
    let score;
    try {
      score = validateScoreReceipt(await readJsonFile(path, `score receipt ${entry.name}`));
    } catch (error) {
      if (error?.cause?.code === "ENOENT") continue;
      throw error;
    }
    if (score.pack_id !== registration.pack.pack_id || !clipIds.has(score.clip_id)) continue;
    const subject = score.systems[registration.subject.system_id];
    if (!subject) continue;
    await verifiedBinding(score.bindings.capture, workspaceRoot, `score receipt ${entry.name} capture`);
    const capture = await readJsonFile(resolveFile(score.bindings.capture.path, workspaceRoot));
    const captureSystem = capture.systems?.find((candidate) => candidate.id === registration.subject.system_id);
    const matchesConfig = captureSystem && [registration.subject.baseline.config, registration.subject.variant.config]
      .some((config) => canonicalJson(config) === canonicalJson(captureSystem.config));
    if (
      matchesConfig &&
      capture.captured_at > registration.registered_at.slice(0, 10) &&
      !plannedRuns.has(score.run)
    ) {
      fail(`unplanned matching capture ${score.run} exists outside the preregistered grid`);
    }
  }
}

function executionProofsByRun(proofBindings, registration) {
  const plannedRuns = new Set(
    registration.capture_plan.flatMap((plan) => [plan.without_run, plan.with_run]),
  );
  const result = new Map();
  for (const binding of proofBindings) {
    const match = /^bench\/attempts\/([^/]+)\/attribution\.json$/.exec(binding.path);
    if (!match || !plannedRuns.has(match[1])) {
      fail(`execution proof path is not one preregistered canonical attempt: ${binding.path}`);
    }
    if (result.has(match[1])) fail(`rule change result repeats execution proof for ${match[1]}`);
    result.set(match[1], binding);
  }
  return result;
}

function sameBinding(left, right) {
  return left.path === right.path && left.content_id === right.content_id && left.bytes === right.bytes;
}

async function deriveRuleChangeResult({
  registration,
  registrationBinding,
  pairBindings,
  proofBindings = [],
  evaluatedAt,
  workspaceRoot,
  resultSchema = RULE_CHANGE_SCHEMAS.result,
}) {
  await validateRuleChangeRegistration(registration, { workspaceRoot });
  if (!new Set([RULE_CHANGE_SCHEMAS.resultV1, RULE_CHANGE_SCHEMAS.result]).has(resultSchema)) {
    fail(`rule change result schema ${String(resultSchema)} is not registered`);
  }
  if (resultSchema === RULE_CHANGE_SCHEMAS.resultV1 && proofBindings.length > 0) {
    fail("historical V1 results cannot carry execution proofs");
  }
  const expectedRegistrationPath = `bench/rule-changes/${registration.slug}/registration.json`;
  if (registrationBinding.path !== expectedRegistrationPath) {
    fail(`rule change registration path must be ${expectedRegistrationPath}`);
  }
  exactTimestamp(evaluatedAt, "rule change evaluated_at");
  if (Date.parse(evaluatedAt) <= Date.parse(registration.registered_at)) {
    fail("rule change result must be evaluated after registration");
  }
  if (pairBindings.length !== registration.capture_plan.length) {
    fail(`rule change result requires ${registration.capture_plan.length} preregistered pairs`);
  }
  const proofByRun = executionProofsByRun(proofBindings, registration);

  const plansByRuns = new Map(
    registration.capture_plan.map((plan) => [`${plan.without_run}\0${plan.with_run}`, plan]),
  );
  const seenPlans = new Set();
  const seenScores = new Set();
  const rows = [];
  const withoutHeadlines = [];
  const withHeadlines = [];
  const clipRates = new Map();
  let lostCorrectUnits = 0;
  let newCatastrophicUnits = 0;
  const seenAttempts = new Set();
  let verifiedExecutionCount = 0;

  const executionFor = async (run, side, captureBinding) => {
    const binding = proofByRun.get(run);
    if (!binding) return null;
    await verifiedBinding(binding, workspaceRoot, `rule change ${run} execution proof`);
    const proof = await verifyExecutionAttribution(binding.path, {
      workspaceRoot,
      registration,
      expectedRegistration: registrationBinding,
      expectedRun: run,
      expectedSide: side,
      expectedCapture: captureBinding,
      validateRegistration: validateRuleChangeRegistration,
    });
    if (!sameBinding(proof.receipt, binding)) {
      fail(`rule change ${run} execution proof differs from its recorded bytes`);
    }
    if (seenAttempts.has(proof.attempt_id)) fail(`attempt ${proof.attempt_id} appears more than once`);
    seenAttempts.add(proof.attempt_id);
    verifiedExecutionCount += 1;
    return proof;
  };

  for (const binding of pairBindings) {
    if (!/^bench\/scores\/pairs\/[^/]+\.json$/.test(binding.path)) {
      fail(`rule change pair path is outside bench/scores/pairs: ${binding.path}`);
    }
    await verifiedBinding(binding, workspaceRoot, "rule change pair receipt");
    const pair = validatePairedScoreReceipt(
      await readJsonFile(resolveFile(binding.path, workspaceRoot), "rule change pair receipt"),
    );
    await verifyPairedScoreReceipt(pair, { workspaceRoot });
    const plan = plansByRuns.get(`${pair.without.run}\0${pair.with.run}`);
    if (!plan || pair.clip_id !== plan.clip_id) {
      fail(`pair ${pair.pair_id} does not match a preregistered run pair`);
    }
    const planKey = `${plan.clip_id}\0${plan.repetition}`;
    if (seenPlans.has(planKey)) fail(`rule change result repeats preregistered pair ${planKey}`);
    seenPlans.add(planKey);
    if (pair.pack_id !== registration.pack.pack_id || pair.subject_system !== registration.subject.system_id) {
      fail(`pair ${pair.pair_id} names a different pack or subject system`);
    }
    if (
      pair.without.score.path !== `bench/scores/${pair.without.run}/score.json` ||
      pair.with.score.path !== `bench/scores/${pair.with.run}/score.json`
    ) {
      fail(`pair ${pair.pair_id} score paths are not canonical for their runs`);
    }
    if (pair.without.score.content_id === pair.with.score.content_id) {
      fail(`pair ${pair.pair_id} reuses one score on both sides`);
    }
    for (const side of ["without", "with"]) {
      if (seenScores.has(pair[side].score.content_id)) fail("one score receipt appears in multiple preregistered pairs");
      seenScores.add(pair[side].score.content_id);
    }
    if (pair.without.memory !== null) fail("without side cannot consume reviewed memory");
    if (pair.with.memory !== null) {
      fail("pre-promotion rule qualification cannot claim reviewed-memory consumption");
    }
    if (Date.parse(pair.compared_at) <= Date.parse(registration.registered_at)) {
      fail(`pair ${pair.pair_id} predates registration`);
    }
    if (Date.parse(evaluatedAt) < Date.parse(pair.compared_at)) {
      fail(`result evaluation predates pair ${pair.pair_id}`);
    }
    const withoutScore = validateScoreReceipt(
      await readJsonFile(resolveFile(pair.without.score.path, workspaceRoot), "without score"),
    );
    const withScore = validateScoreReceipt(
      await readJsonFile(resolveFile(pair.with.score.path, workspaceRoot), "with score"),
    );
    if (
      Date.parse(withoutScore.scored_at) <= Date.parse(registration.registered_at) ||
      Date.parse(withScore.scored_at) <= Date.parse(registration.registered_at)
    ) {
      fail(`pair ${pair.pair_id} contains a score that predates registration`);
    }
    await verifyScoreReceipt(withoutScore, {
      workspaceRoot,
      context: `pair ${pair.pair_id} without score`,
    });
    await verifyScoreReceipt(withScore, {
      workspaceRoot,
      context: `pair ${pair.pair_id} with score`,
    });
    if (
      withoutScore.bindings.freeze.content_id !== registration.pack.freeze.content_id ||
      withScore.bindings.freeze.content_id !== registration.pack.freeze.content_id
    ) {
      fail(`pair ${pair.pair_id} does not bind the preregistered freeze bytes`);
    }
    const without = await validateCaptureForSide({
      score: withoutScore,
      registration,
      plan,
      side: "without",
      workspaceRoot,
      context: `pair ${pair.pair_id} without`,
    });
    const withSide = await validateCaptureForSide({
      score: withScore,
      registration,
      plan,
      side: "with",
      workspaceRoot,
      context: `pair ${pair.pair_id} with`,
    });
    const withoutExecution = await executionFor(
      plan.without_run,
      "without",
      without.captureBinding,
    );
    const withExecution = await executionFor(
      plan.with_run,
      "with",
      withSide.captureBinding,
    );
    withoutHeadlines.push(without.headline);
    withHeadlines.push(withSide.headline);
    const rates = clipRates.get(plan.clip_id) ?? { without: [], with: [] };
    rates.without.push(without.headline.critical_meaning.rate);
    rates.with.push(withSide.headline.critical_meaning.rate);
    clipRates.set(plan.clip_id, rates);
    lostCorrectUnits += pair.regressions.length;
    newCatastrophicUnits += pair.catastrophic_regressions.length;
    const row = {
      clip_id: plan.clip_id,
      repetition: plan.repetition,
      without_run: plan.without_run,
      with_run: plan.with_run,
      receipt: binding,
      pair_id: pair.pair_id,
    };
    if (resultSchema === RULE_CHANGE_SCHEMAS.result) {
      row.without_execution = withoutExecution;
      row.with_execution = withExecution;
    }
    rows.push(row);
  }

  if (seenPlans.size !== registration.capture_plan.length) fail("rule change result omits a preregistered pair");
  const plannedRuns = new Set(
    registration.capture_plan.flatMap((plan) => [plan.without_run, plan.with_run]),
  );
  await rejectUnplannedMatchingCaptures(registration, plannedRuns, workspaceRoot);

  rows.sort((left, right) => {
    const leftIndex = registration.capture_plan.findIndex(
      (plan) => plan.clip_id === left.clip_id && plan.repetition === left.repetition,
    );
    const rightIndex = registration.capture_plan.findIndex(
      (plan) => plan.clip_id === right.clip_id && plan.repetition === right.repetition,
    );
    return leftIndex - rightIndex;
  });
  const without = conditionSummary(withoutHeadlines);
  const withSide = conditionSummary(withHeadlines);
  const criticalRateDelta = without.critical_meaning.rate === null || withSide.critical_meaning.rate === null
    ? null
    : withSide.critical_meaning.rate - without.critical_meaning.rate;
  const outcomeDelta = {};
  for (const outcome of ["correct", "wrong", "withheld", "missing"]) {
    outcomeDelta[outcome] = withSide.critical_outcomes[outcome] - without.critical_outcomes[outcome];
  }
  const byClip = [...clipRates.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([clipId, rates]) => ({
      clip_id: clipId,
      without_range: rateRange(rates.without),
      with_range: rateRange(rates.with),
    }));
  const ranges = byClip.flatMap((row) => [row.without_range, row.with_range]);
  const observedFloor = ranges.some((value) => value === null) ? null : Math.max(...ranges);
  const allRatesMeasurable = criticalRateDelta !== null && observedFloor !== null;
  const completeExecutionGrid =
    resultSchema === RULE_CHANGE_SCHEMAS.result &&
    verifiedExecutionCount === registration.capture_plan.length * 2;
  const checks = {
    complete_preregistered_grid: true,
    all_rates_measurable: allRatesMeasurable,
    minimum_effect_met:
      allRatesMeasurable && criticalRateDelta >= registration.qualification_policy.minimum_effect,
    effect_exceeds_observed_variance:
      allRatesMeasurable && criticalRateDelta > observedFloor,
    catastrophic_non_increase: withSide.catastrophic_count <= without.catastrophic_count,
    no_new_catastrophic_units: newCatastrophicUnits === 0,
    single_attempt_proven: completeExecutionGrid,
    execution_attribution_proven: completeExecutionGrid,
  };
  const reasons = [];
  if (!checks.all_rates_measurable) reasons.push("critical meaning rates or within-condition variance are not measurable");
  if (!checks.minimum_effect_met) reasons.push("preregistered minimum critical meaning effect was not met");
  if (!checks.effect_exceeds_observed_variance) reasons.push("critical meaning effect did not exceed observed variance");
  if (!checks.catastrophic_non_increase) reasons.push("catastrophic count increased");
  if (!checks.no_new_catastrophic_units) reasons.push("a new catastrophic critical unit appeared");
  if (!checks.single_attempt_proven) {
    reasons.push("no host-owned single-attempt receipt proves that best-of-K selection was impossible");
  }
  if (!checks.execution_attribution_proven) {
    reasons.push("no host-owned execution receipt binds the declared configuration to the capture bytes");
  }
  const qualified = Object.values(checks).every(Boolean);
  const body = {
    schema: resultSchema,
    registration: {
      receipt: registrationBinding,
      registration_id: registration.registration_id,
    },
    evaluated_at: evaluatedAt,
    pairs: rows,
    summary: {
      without,
      with: withSide,
      delta: {
        critical_meaning_rate: criticalRateDelta,
        catastrophic_count: withSide.catastrophic_count - without.catastrophic_count,
        critical_outcomes: outcomeDelta,
      },
      lost_correct_units: lostCorrectUnits,
      new_catastrophic_units: newCatastrophicUnits,
      variance: {
        method: "max_within_condition_clip_range",
        observed_floor: observedFloor,
        by_clip: byClip,
      },
    },
    qualification: {
      status: qualified ? "qualified" : "refused",
      promotion_eligibility: qualified ? "eligible_for_human_review" : "ineligible",
      checks,
      reasons,
    },
    judge: null,
    notes:
      resultSchema === RULE_CHANGE_SCHEMAS.resultV1
        ? "Mechanical evaluation only. Historical V1 refuses promotion because no host-owned single-attempt and execution-attribution receipt exists. This receipt does not prove a later run consumed the rule."
        : "Mechanical evaluation only. V2 verifies certified single-attempt execution when every capture carries a cold-reopenable proof. Eligibility is only for later human review and does not prove deployment, generalization, or a later run consuming the rule.",
  };
  const result = { result_id: resultId(body), ...body };
  await validateRuleChangeResult(result);
  return result;
}

export async function materializeRuleChangeResult(
  { registrationPath, pairPaths, proofPaths = [] },
  { workspaceRoot = process.cwd(), evaluatedAt = new Date().toISOString() } = {},
) {
  if (!Array.isArray(pairPaths) || pairPaths.length === 0) fail("rule change result requires pair paths");
  if (!Array.isArray(proofPaths)) fail("rule change execution proof paths must be an array");
  const recordedRegistrationPath = requiredText(registrationPath, "registration path");
  const registration = await readJsonFile(resolveFile(recordedRegistrationPath, workspaceRoot), "rule change registration");
  const registrationBinding = await fileReceipt(
    resolveFile(recordedRegistrationPath, workspaceRoot),
    recordedRegistrationPath,
  );
  const pairBindings = [];
  for (const path of pairPaths) {
    const recordedPath = requiredText(path, "pair path");
    pairBindings.push(await fileReceipt(resolveFile(recordedPath, workspaceRoot), recordedPath));
  }
  const proofBindings = [];
  for (const path of proofPaths) {
    const recordedPath = requiredText(path, "execution proof path");
    proofBindings.push(await fileReceipt(resolveFile(recordedPath, workspaceRoot), recordedPath));
  }
  return deriveRuleChangeResult({
    registration,
    registrationBinding,
    pairBindings,
    proofBindings,
    evaluatedAt,
    workspaceRoot,
  });
}

export async function validateRuleChangeResult(result, context = "rule change result") {
  const schemaName = result?.schema === RULE_CHANGE_SCHEMAS.resultV1
    ? "resultV1"
    : result?.schema === RULE_CHANGE_SCHEMAS.result
      ? "result"
      : null;
  if (!schemaName) fail(`${context} schema is not registered`);
  await schemaCheck(result, schemaName, context);
  exactTimestamp(result.evaluated_at, `${context}.evaluated_at`);
  if (result.result_id !== resultId(result)) fail(`${context} result_id does not match its immutable contents`);
  const passed = Object.values(result.qualification.checks).every(Boolean);
  if (
    (passed && (
      result.qualification.status !== "qualified" ||
      result.qualification.promotion_eligibility !== "eligible_for_human_review" ||
      result.qualification.reasons.length !== 0
    )) ||
    (!passed && (
      result.qualification.status !== "refused" ||
      result.qualification.promotion_eligibility !== "ineligible" ||
      result.qualification.reasons.length === 0
    ))
  ) {
    fail(`${context} qualification state disagrees with its checks`);
  }
  if (result.judge !== null) fail(`${context} names a judge`);
  return result;
}

export async function verifyRuleChangeResult(resultValue, { workspaceRoot = process.cwd() } = {}) {
  const result = await validateRuleChangeResult(resultValue);
  await verifiedBinding(result.registration.receipt, workspaceRoot, "rule change result registration");
  const registration = await readJsonFile(
    resolveFile(result.registration.receipt.path, workspaceRoot),
    "rule change result registration",
  );
  const rederived = await deriveRuleChangeResult({
    registration,
    registrationBinding: result.registration.receipt,
    pairBindings: result.pairs.map((pair) => pair.receipt),
    proofBindings: result.schema === RULE_CHANGE_SCHEMAS.result
      ? result.pairs.flatMap((pair) => [pair.without_execution, pair.with_execution])
          .filter((proof) => proof !== null)
          .map((proof) => proof.receipt)
      : [],
    evaluatedAt: result.evaluated_at,
    workspaceRoot,
    resultSchema: result.schema,
  });
  if (contentIdForJson(rederived) !== contentIdForJson(result)) {
    fail("stored result does not rederive from its registered grid and bound bytes");
  }
  return result;
}
