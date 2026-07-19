/**
 * Resolve one preregistered rule-change side into exact, path-free execution context.
 *
 * V1 deliberately certifies qualification inputs only. It cannot authorize runtime deployment,
 * and it admits no ambient accepted materialization. The with side compiles exactly one bounded
 * candidate rule from its byte-bound proposal; the without side compiles no rule.
 */

import { readdir } from "node:fs/promises";
import { isAbsolute, posix, resolve } from "node:path";

import Ajv2020 from "ajv/dist/2020.js";

import { benchConfigId } from "./bench-ablation.mjs";
import {
  readJsonFile,
  receiptIdFor,
  validateCandidatesManifest,
  validateFreezeReceipt,
  validatePack,
  verifiedBinding,
} from "./bench-gold.mjs";
import {
  canonicalJson,
  contentIdForJson,
  digestFromContentId,
  fileReceipt,
} from "./immutable-receipts.mjs";
import { assertCommitDescends, immutableArtifactCommit } from "./bench-git-evidence.mjs";
import { validateProposal } from "./memory-review.mjs";

export const CERTIFIED_RELEASE_SCHEMA = "studio.bench.certified-release.v1";
export const CERTIFIED_HOST_CONTEXT_SCHEMA = "studio.bench.certified-host-context.v1";

function fail(message) {
  throw new Error(`bench certified release: ${message}`);
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

function repositoryPath(path, context) {
  requiredText(path, context);
  if (isAbsolute(path) || path.startsWith("./") || path.split("/").includes("..")) {
    fail(`${context} must be a repository-relative path without traversal`);
  }
  return path;
}

function exactKeys(value, keys, context) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${context} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    fail(`${context} keys must be exactly ${expected.join(", ")}`);
  }
}

function assertPathFree(value, context) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertPathFree(item, `${context}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if (/(^|_)(path|file|directory|root|cwd|workspace)(_|$)/i.test(key)) {
      fail(`${context}.${key} carries filesystem authority`);
    }
    assertPathFree(item, `${context}.${key}`);
  }
}

function ruleValue(value, context) {
  exactKeys(value, ["instruction"], context);
  requiredText(value.instruction, `${context}.instruction`);
  return value;
}

function contextId(value) {
  const { context_id: _id, ...body } = value;
  return `bench-host-context:${contentIdForJson({ context_id: null, ...body })}`;
}

function releaseId(value) {
  const { release_id: _id, ...body } = value;
  return `bench-certified-release:${contentIdForJson({ release_id: null, ...body })}`;
}

function sideConfiguration(registration, side) {
  if (!new Set(["without", "with"]).has(side)) fail("side must be without or with");
  return side === "without" ? registration.subject.baseline : registration.subject.variant;
}

function candidateRule(registration, proposal, side) {
  if (side === "without") return null;
  return {
    proposal: registration.change.proposal,
    proposal_id: proposal.proposal_id,
    proposal_content_id: contentIdForJson(proposal),
    rule_content_id: contentIdForJson(proposal.value),
    namespace: proposal.namespace,
    key: proposal.key,
    value: ruleValue(proposal.value, "candidate rule value"),
  };
}

function exactBinding(left, right) {
  return left.path === right.path && left.content_id === right.content_id && left.bytes === right.bytes;
}

export async function validateCertifiedPromptMedia(
  manifest,
  { clipId, packId, candidates, candidatesManifest, workspaceRoot },
) {
  await verifiedBinding(candidates, workspaceRoot, `evaluation prompt ${clipId} candidates`);
  candidatesManifest = validateCandidatesManifest(candidatesManifest);
  exactKeys(
    manifest,
    [
      "schema",
      "prompt_id",
      "name",
      "version",
      "drafter_id",
      "pack_id",
      "clip_id",
      "prompt",
      "inputs",
      "output_contract",
      "notes",
    ],
    `evaluation prompt ${clipId}`,
  );
  if (manifest.schema !== "studio.bench.gold-prompt-pack.v1") fail(`evaluation prompt ${clipId} schema is not registered`);
  if (manifest.prompt_id !== receiptIdFor("bench-gold-prompt", manifest, "prompt_id")) {
    fail(`evaluation prompt ${clipId} id does not match its immutable contents`);
  }
  if (
    manifest.name !== "gold-drafter-v1" ||
    manifest.version !== "1.0.0" ||
    manifest.pack_id !== packId ||
    manifest.clip_id !== clipId ||
    !/^agent:[a-z0-9][a-z0-9._-]*$/.test(manifest.drafter_id)
  ) {
    fail(`evaluation prompt ${clipId} does not name the frozen pack and registered drafter`);
  }
  exactKeys(manifest.prompt, ["path", "content_id", "bytes"], `evaluation prompt ${clipId} instructions`);
  repositoryPath(manifest.prompt.path, `evaluation prompt ${clipId} instructions`);
  await verifiedBinding(manifest.prompt, workspaceRoot, `evaluation prompt ${clipId} instructions`);
  if (!Array.isArray(manifest.inputs)) fail(`evaluation prompt ${clipId} inputs must be an array`);
  const roles = new Map();
  for (const [index, input] of manifest.inputs.entries()) {
    exactKeys(input, ["role", "path", "content_id", "bytes"], `evaluation prompt ${clipId} input ${index}`);
    requiredText(input.role, `evaluation prompt ${clipId} input ${index} role`);
    repositoryPath(input.path, `evaluation prompt ${clipId} input ${input.role}`);
    if (roles.has(input.role)) fail(`evaluation prompt ${clipId} repeats input role ${input.role}`);
    roles.set(input.role, input);
    await verifiedBinding(
      { path: input.path, content_id: input.content_id, bytes: input.bytes },
      workspaceRoot,
      `evaluation prompt ${clipId} input ${input.role}`,
    );
  }
  const expectedRoles = [
    "candidates",
    "captions",
    "corrections",
    "gold_schema",
    "ko_pack",
    "media",
    "run",
    "source",
  ];
  if (canonicalJson([...roles.keys()].sort()) !== canonicalJson(expectedRoles)) {
    fail(`evaluation prompt ${clipId} input roles do not match the closed drafting contract`);
  }
  if (!exactBinding(roles.get("candidates"), candidates)) {
    fail(`evaluation prompt ${clipId} does not bind the frozen candidates`);
  }
  for (const role of ["run", "source", "captions", "corrections"]) {
    const sourceMatches = manifest.inputs.filter((input) =>
      input.role === role && candidatesManifest.source_artifacts.some((artifact) => exactBinding(input, artifact))
    );
    if (sourceMatches.length !== 1) {
      fail(`evaluation prompt ${clipId} ${role} input is absent from the frozen candidates authority`);
    }
  }
  const runInput = roles.get("run");
  const run = await readJsonFile(resolve(workspaceRoot, runInput.path), `evaluation prompt ${clipId} run`);
  if (
    run.id !== candidatesManifest.run ||
    run.clip?.id !== clipId ||
    typeof run.clip?.media !== "string" ||
    run.clip.media.length === 0 ||
    /[\\/]/.test(run.clip.media)
  ) {
    fail(`evaluation prompt ${clipId} run does not name one canonical clip media file`);
  }
  const expectedMediaPath = posix.join(posix.dirname(runInput.path), run.clip.media);
  const expectedMedia = await fileReceipt(
    resolve(workspaceRoot, expectedMediaPath),
    expectedMediaPath,
  );
  if (!exactBinding(roles.get("media"), expectedMedia)) {
    fail(`evaluation prompt ${clipId} media differs from the frozen candidates run receipt`);
  }
  exactKeys(
    manifest.output_contract,
    ["schema", "status", "materializer"],
    `evaluation prompt ${clipId} output contract`,
  );
  if (
    manifest.output_contract.schema !== "studio.bench.gold.v1" ||
    manifest.output_contract.status !== "candidate" ||
    manifest.output_contract.materializer !== "scripts/draft-gold-from-candidates.mjs"
  ) {
    fail(`evaluation prompt ${clipId} weakens the drafting output contract`);
  }
  return expectedMedia;
}

async function promptMediaSource(
  clipId,
  packId,
  candidates,
  candidatesManifest,
  freezeCommit,
  workspaceRoot,
) {
  const promptRoot = resolve(workspaceRoot, "bench/prompts");
  let entries;
  try {
    entries = await readdir(promptRoot, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") fail(`evaluation clip ${clipId} has no content-bound prompt media`);
    throw error;
  }
  const matches = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const path = `bench/prompts/${entry.name}/manifest.json`;
    let manifest;
    try {
      manifest = await readJsonFile(resolve(workspaceRoot, path), `evaluation prompt ${clipId}`);
    } catch (error) {
      if (error?.cause?.code === "ENOENT") continue;
      throw error;
    }
    if (manifest.schema !== "studio.bench.gold-prompt-pack.v1" || manifest.clip_id !== clipId) continue;
    const candidateInputs = manifest.inputs?.filter((input) => input.role === "candidates") ?? [];
    const mediaInputs = manifest.inputs?.filter((input) => input.role === "media") ?? [];
    if (
      candidateInputs.length !== 1 ||
      mediaInputs.length !== 1 ||
      !exactBinding(candidateInputs[0], candidates)
    ) {
      continue;
    }
    const mediaBinding = await validateCertifiedPromptMedia(manifest, {
      clipId,
      packId,
      candidates,
      candidatesManifest,
      workspaceRoot,
    });
    const authorityCommit = immutableArtifactCommit(path, {
      workspaceRoot,
      context: `evaluation prompt ${clipId} authority`,
    });
    assertCommitDescends(authorityCommit, freezeCommit, {
      workspaceRoot,
      context: `evaluation prompt ${clipId} freeze chronology`,
    });
    matches.push({
      clip_id: clipId,
      authority: await fileReceipt(resolve(workspaceRoot, path), path),
      artifact: mediaBinding,
    });
  }
  if (matches.length !== 1) {
    fail(`evaluation clip ${clipId} requires one content-bound prompt media authority`);
  }
  return matches[0];
}

export async function resolveCertifiedEvaluationSources(registration, workspaceRoot) {
  await verifiedBinding(registration.pack.manifest, workspaceRoot, "certified release pack manifest");
  await verifiedBinding(registration.pack.freeze, workspaceRoot, "certified release freeze receipt");
  const pack = validatePack(
    await readJsonFile(resolve(workspaceRoot, registration.pack.manifest.path), "certified release pack manifest"),
  );
  const freeze = validateFreezeReceipt(
    await readJsonFile(resolve(workspaceRoot, registration.pack.freeze.path), "certified release freeze receipt"),
  );
  const freezeCommit = immutableArtifactCommit(registration.pack.freeze.path, {
    workspaceRoot,
    context: "certified release freeze receipt",
  });
  const clipIds = [...new Set(registration.capture_plan.map((plan) => plan.clip_id))].sort();
  const sources = [];
  for (const clipId of clipIds) {
    const packClip = pack.clips.find((clip) => clip.clip_id === clipId);
    const freezeClip = freeze.clips.find((clip) => clip.clip_id === clipId);
    if (!packClip || !freezeClip) fail(`evaluation clip ${clipId} is absent from the frozen pack`);
    let source;
    if (packClip.source?.local_copy) {
      const recorded = packClip.source.local_copy;
      repositoryPath(recorded.path, `evaluation source ${clipId}`);
      await verifiedBinding(recorded, workspaceRoot, `evaluation source ${clipId}`);
      const artifact = await fileReceipt(resolve(workspaceRoot, recorded.path), recorded.path);
      if (!exactBinding(recorded, artifact)) fail(`evaluation source ${clipId} differs from its pack receipt`);
      source = { clip_id: clipId, authority: registration.pack.manifest, artifact };
    } else {
      const candidates = freezeClip.candidates_manifest;
      if (!candidates || packClip.candidates_manifest !== candidates.path) {
        fail(`evaluation clip ${clipId} has no byte-bound local copy or candidates media`);
      }
      await verifiedBinding(candidates, workspaceRoot, `evaluation candidates ${clipId}`);
      const manifest = validateCandidatesManifest(
        await readJsonFile(resolve(workspaceRoot, candidates.path), `evaluation candidates ${clipId}`),
      );
      if (manifest.clip.id !== clipId) fail(`evaluation candidates ${clipId} bind another clip`);
      source = await promptMediaSource(
        clipId,
        pack.pack_id,
        candidates,
        manifest,
        freezeCommit,
        workspaceRoot,
      );
    }
    sources.push(source);
  }
  return sources;
}

function buildHostContext(registration, configuration, rule) {
  const body = {
    schema: CERTIFIED_HOST_CONTEXT_SCHEMA,
    system_id: registration.subject.system_id,
    config_id: configuration.config_id,
    config: configuration.config,
    reviewed_memory: {
      accepted_materialization: null,
      entries: rule === null
        ? []
        : [{
            namespace: rule.namespace,
            kind: "rule",
            key: rule.key,
            value: rule.value,
            proposal_id: rule.proposal_id,
            rule_content_id: rule.rule_content_id,
            status: "qualification_candidate",
          }],
    },
  };
  assertPathFree(body, "host context");
  return { context_id: contextId(body), ...body };
}

let schemaValidatorPromise;

async function schemaValidator() {
  if (!schemaValidatorPromise) {
    schemaValidatorPromise = (async () => {
      const schema = await readJsonFile(
        new URL("../../bench/schemas/certified-release.schema.json", import.meta.url),
        "certified release schema",
      );
      const ajv = new Ajv2020({ allErrors: true, strict: true });
      ajv.addFormat(
        "date-time",
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/,
      );
      return { ajv, validate: ajv.compile(schema) };
    })();
  }
  return schemaValidatorPromise;
}

export function certifiedReleasePath(release) {
  const digest = digestFromContentId(
    release.release_id.slice("bench-certified-release:".length),
    "certified release id",
  );
  return `bench/releases/${digest}.json`;
}

export async function validateCertifiedRelease(release, context = "certified release") {
  const held = await schemaValidator();
  if (!held.validate(release)) {
    fail(`${context} failed schema validation:\n${held.ajv.errorsText(held.validate.errors, { separator: "\n" })}`);
  }
  exactTimestamp(release.created_at, `${context}.created_at`);
  if (release.release_id !== releaseId(release)) fail(`${context} release_id does not match its immutable contents`);
  if (release.host_context.context_id !== contextId(release.host_context)) {
    fail(`${context} host context id does not match its immutable contents`);
  }
  if (release.configuration.config_id !== benchConfigId(release.configuration.config)) {
    fail(`${context} configuration id does not match its canonical configuration`);
  }
  assertPathFree(release.host_context, `${context}.host_context`);
  return release;
}

async function validatedRegistration(path, workspaceRoot, validateRegistration) {
  if (typeof validateRegistration !== "function") fail("a rule-change registration validator is required");
  const recordedPath = repositoryPath(path, "registration path");
  const registration = await readJsonFile(resolve(workspaceRoot, recordedPath), "certified release registration");
  await validateRegistration(registration, { workspaceRoot, context: "certified release registration" });
  return {
    registration,
    binding: await fileReceipt(resolve(workspaceRoot, recordedPath), recordedPath),
  };
}

export async function materializeCertifiedRelease(
  { registrationPath, side },
  {
    workspaceRoot = process.cwd(),
    createdAt = new Date().toISOString(),
    validateRegistration,
  } = {},
) {
  const { registration, binding } = await validatedRegistration(
    registrationPath,
    workspaceRoot,
    validateRegistration,
  );
  const configuration = sideConfiguration(registration, side);
  const proposalPath = repositoryPath(registration.change.proposal.path, "candidate proposal path");
  await verifiedBinding(registration.change.proposal, workspaceRoot, "candidate proposal");
  const proposal = validateProposal(
    await readJsonFile(resolve(workspaceRoot, proposalPath), "certified release candidate proposal"),
  );
  const rule = candidateRule(registration, proposal, side);
  const sources = await resolveCertifiedEvaluationSources(registration, workspaceRoot);
  const at = exactTimestamp(createdAt, "certified release created_at");
  if (Date.parse(at) <= Date.parse(registration.registered_at)) {
    fail("certified release must be created after its registration");
  }
  const body = {
    schema: CERTIFIED_RELEASE_SCHEMA,
    created_at: at,
    purpose: "rule_change_qualification",
    runtime_deployable: false,
    registration: {
      receipt: binding,
      registration_id: registration.registration_id,
    },
    side,
    system_id: registration.subject.system_id,
    configuration,
    evaluation_sources: sources,
    reviewed_memory: {
      accepted_materialization: null,
      candidate_rule: rule,
    },
    host_context: buildHostContext(registration, configuration, rule),
  };
  const release = { release_id: releaseId(body), ...body };
  return validateCertifiedRelease(release);
}

export async function resolveCertifiedRelease(
  releasePath,
  { workspaceRoot = process.cwd(), validateRegistration } = {},
) {
  const recordedPath = repositoryPath(releasePath, "certified release path");
  const release = await validateCertifiedRelease(
    await readJsonFile(resolve(workspaceRoot, recordedPath), "certified release"),
  );
  if (recordedPath !== certifiedReleasePath(release)) {
    fail(`certified release path must be ${certifiedReleasePath(release)}`);
  }
  await verifiedBinding(release.registration.receipt, workspaceRoot, "certified release registration");
  const registration = await readJsonFile(
    resolve(workspaceRoot, release.registration.receipt.path),
    "certified release registration",
  );
  if (typeof validateRegistration !== "function") fail("a rule-change registration validator is required");
  await validateRegistration(registration, { workspaceRoot, context: "certified release registration" });
  if (registration.registration_id !== release.registration.registration_id) {
    fail("certified release registration identity does not match its bound bytes");
  }
  const configuration = sideConfiguration(registration, release.side);
  if (
    release.system_id !== registration.subject.system_id ||
    canonicalJson(release.configuration) !== canonicalJson(configuration)
  ) {
    fail("certified release configuration differs from its preregistered side");
  }
  await verifiedBinding(registration.change.proposal, workspaceRoot, "certified release candidate proposal");
  const proposal = validateProposal(
    await readJsonFile(
      resolve(workspaceRoot, registration.change.proposal.path),
      "certified release candidate proposal",
    ),
  );
  const rule = candidateRule(registration, proposal, release.side);
  if (canonicalJson(release.reviewed_memory.candidate_rule) !== canonicalJson(rule)) {
    fail("certified release candidate rule differs from the exact proposal bytes");
  }
  const sources = await resolveCertifiedEvaluationSources(registration, workspaceRoot);
  if (canonicalJson(release.evaluation_sources) !== canonicalJson(sources)) {
    fail("certified release evaluation sources differ from the frozen pack media bytes");
  }
  const expectedContext = buildHostContext(registration, configuration, rule);
  if (canonicalJson(release.host_context) !== canonicalJson(expectedContext)) {
    fail("certified release host context does not match its resolved inputs");
  }
  return {
    release,
    binding: await fileReceipt(resolve(workspaceRoot, recordedPath), recordedPath),
    registration,
    hostContext: structuredClone(release.host_context),
    evaluationSources: structuredClone(release.evaluation_sources),
  };
}
