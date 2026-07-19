/** Bench-owned one-shot execution host for preregistered rule-change captures. */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { basename, isAbsolute, resolve, dirname } from "node:path";

import Ajv2020 from "ajv/dist/2020.js";

import {
  CAPTURE_ADAPTER_IMPLEMENTATIONS,
  CAPTURE_HOST_IMPLEMENTATION_PATH,
  resolveCaptureExecutor,
  resolveCaptureExecutorAtCommit,
} from "./bench-capture-executor.mjs";
import { executeDeterministicFixture } from "./bench-adapters/deterministic-fixture-v1.mjs";
import { executeDeterministicFixtureFailure } from "./bench-adapters/deterministic-fixture-failure-v1.mjs";
import { executeDeterministicFixtureStaleConfig } from "./bench-adapters/deterministic-fixture-stale-config-v1.mjs";
import {
  buildOpenAIAudioTranslationRequest,
  captureFromOpenAIAudioTranslation,
  executeOpenAIAudioTranslation,
  materializeProviderCallReceipt,
  preflightOpenAIAudioTranslation,
  PROVIDER_CALL_SCHEMA,
} from "./bench-adapters/openai-audio-translation-v1.mjs";
import { resolveCertifiedRelease } from "./bench-certified-release.mjs";
import { assertCommitDescends, immutableArtifactCommit } from "./bench-git-evidence.mjs";
import { readJsonFile, verifiedBinding } from "./bench-gold.mjs";
import {
  canonicalJson,
  contentIdForJson,
  fileReceipt,
} from "./immutable-receipts.mjs";

export const SINGLE_ATTEMPT_SCHEMAS = Object.freeze({
  input: "studio.bench.execution-input.v1",
  inputProvider: "studio.bench.execution-input.v2",
  charge: "studio.bench.single-attempt-charge.v1",
  attribution: "studio.bench.execution-attribution.v1",
  attributionProvider: "studio.bench.execution-attribution.v2",
  journal: "studio.bench.single-attempt-journal.v1",
});

function fail(message) {
  throw new Error(`bench single attempt: ${message}`);
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

function runId(value, context = "run") {
  const run = requiredText(value, context);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(run)) fail(`${context} is not a safe canonical run id`);
  return run;
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

function receiptId(prefix, idField, value) {
  const { [idField]: _id, ...body } = value;
  return `${prefix}:${contentIdForJson({ [idField]: null, ...body })}`;
}

function executionInputId(value) {
  return receiptId("bench-execution-input", "execution_input_id", value);
}

function attributionId(value) {
  return receiptId("bench-execution-attribution", "attribution_id", value);
}

export function singleAttemptId({ registrationId, run, side }) {
  if (!new Set(["without", "with"]).has(side)) fail("attempt side must be without or with");
  return `bench-attempt:${contentIdForJson({
    registration_id: requiredText(registrationId, "registration id"),
    run: runId(run),
    side,
  })}`;
}

export function singleAttemptPaths(runValue) {
  const run = runId(runValue);
  const base = `bench/attempts/${run}`;
  return {
    input: `${base}/execution-input.json`,
    charge: `${base}/charge.json`,
    journal: `${base}/journal.json`,
    providerCall: `${base}/provider-call.json`,
    providerResponse: `${base}/provider-response.json`,
    attribution: `${base}/attribution.json`,
    capture: `bench/runs/${run}/capture.json`,
  };
}

async function writeOnceJson(path, value, context) {
  const rendered = `${JSON.stringify(value, null, 2)}\n`;
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(path, rendered, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if (error?.code === "EEXIST") fail(`${context} already exists; the preregistered slot is spent`);
    throw error;
  }
}

async function writeOnceBytes(path, value, context) {
  if (!Buffer.isBuffer(value) || value.length === 0) fail(`${context} must be non-empty bytes`);
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(path, value, { flag: "wx" });
  } catch (error) {
    if (error?.code === "EEXIST") fail(`${context} already exists; the preregistered slot is spent`);
    throw error;
  }
}

async function assertSlotEmpty(paths, workspaceRoot) {
  for (const [kind, path] of Object.entries(paths)) {
    try {
      await access(resolve(workspaceRoot, path));
      fail(`${kind} already exists; the preregistered slot is spent`);
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
  }
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const item of Object.values(value)) deepFreeze(item);
  return value;
}

function git(args, { workspaceRoot, input = null, context = "git evidence" }) {
  try {
    return execFileSync("git", args, {
      cwd: workspaceRoot,
      encoding: input === null ? "utf8" : undefined,
      input,
      stdio: [input === null ? "ignore" : "pipe", "pipe", "pipe"],
    });
  } catch (error) {
    const detail = error?.stderr?.toString().trim();
    fail(`${context} failed${detail ? `: ${detail}` : ""}`);
  }
}

async function requireHeadBytes(path, workspaceRoot, context) {
  const current = await readFile(resolve(workspaceRoot, path));
  const committed = git(["show", `HEAD:${path}`], { workspaceRoot, context });
  if (!current.equals(Buffer.from(committed))) fail(`${context} differs from the bytes committed at HEAD`);
}

function journalBody(charge, chargeBinding, headCommit) {
  return {
    schema: SINGLE_ATTEMPT_SCHEMAS.journal,
    attempt_id: charge.attempt_id,
    head_commit: headCommit,
    charge: chargeBinding,
  };
}

async function verifyChargeJournal(
  charge,
  chargeBinding,
  recorded,
  workspaceRoot,
) {
  const expectedPath = singleAttemptPaths(charge.slot.run).journal;
  if (recorded.path !== expectedPath) fail(`attempt charge journal path must be ${expectedPath}`);
  await verifiedBinding(fileBindingOnly(recorded), workspaceRoot, "attempt charge journal receipt");
  const object = await validateSingleAttemptJournal(
    await readJsonFile(resolve(workspaceRoot, recorded.path), "attempt charge journal"),
  );
  if (canonicalJson(object) !== canonicalJson(journalBody(charge, chargeBinding, recorded.head_commit))) {
    fail("attempt charge journal does not bind the exact pre-invocation charge");
  }
  git(["cat-file", "-e", `${recorded.head_commit}^{commit}`], {
    workspaceRoot,
    context: "attempt charge journal HEAD anchor",
  });
  const commits = [recorded.path, chargeBinding.path, charge.execution_input.receipt.path]
    .map((path) => immutableArtifactCommit(path, { workspaceRoot, context: `attempt charge evidence ${path}` }));
  if (new Set(commits).size !== 1 || commits[0] !== recorded.charge_commit) {
    fail("attempt input, charge, and journal do not share their immutable charge commit");
  }
  assertCommitDescends(recorded.head_commit, recorded.charge_commit, {
    workspaceRoot,
    context: "attempt charge evidence chronology",
  });
  return recorded;
}

async function recordChargeJournal(charge, chargeBinding, journalPath, workspaceRoot) {
  const headCommit = git(["rev-parse", "HEAD"], {
    workspaceRoot,
    context: "attempt charge HEAD anchor",
  }).trim();
  const body = journalBody(charge, chargeBinding, headCommit);
  await validateSingleAttemptJournal(body);
  await writeOnceJson(resolve(workspaceRoot, journalPath), body, "attempt charge journal");
  const binding = await fileReceipt(resolve(workspaceRoot, journalPath), journalPath);
  return { ...binding, head_commit: headCommit };
}

function commitChargeEvidence(paths, run, headCommit, workspaceRoot) {
  const evidencePaths = [paths.input, paths.charge, paths.journal];
  git(["add", "--", ...evidencePaths], {
    workspaceRoot,
    context: "stage exact attempt charge evidence",
  });
  git(
    ["commit", "--only", "-m", `Charge rule change attempt ${run}`, "--", ...evidencePaths],
    { workspaceRoot, context: "commit pre-invocation attempt charge evidence" },
  );
  const chargeCommit = git(["rev-parse", "HEAD"], {
    workspaceRoot,
    context: "attempt charge evidence commit",
  }).trim();
  if (chargeCommit === headCommit) fail("attempt charge evidence did not create a new commit");
  for (const path of evidencePaths) {
    const commit = immutableArtifactCommit(path, {
      workspaceRoot,
      context: `attempt charge evidence ${path}`,
    });
    if (commit !== chargeCommit) fail(`attempt charge evidence ${path} did not land in its charge commit`);
  }
  return chargeCommit;
}

function commitAttemptOutcome(outcomePaths, run, chargeCommit, workspaceRoot, message = `Record rule change attempt ${run}`) {
  git(["add", "--", ...outcomePaths], {
    workspaceRoot,
    context: "stage exact attempt outcome evidence",
  });
  git(
    ["commit", "--only", "-m", message, "--", ...outcomePaths],
    { workspaceRoot, context: "commit exact attempt outcome evidence" },
  );
  const outcomeCommit = git(["rev-parse", "HEAD"], {
    workspaceRoot,
    context: "attempt outcome evidence commit",
  }).trim();
  assertCommitDescends(chargeCommit, outcomeCommit, {
    workspaceRoot,
    context: "attempt outcome evidence chronology",
  });
  for (const path of outcomePaths) {
    const commit = immutableArtifactCommit(path, {
      workspaceRoot,
      context: `attempt outcome evidence ${path}`,
    });
    if (commit !== outcomeCommit) fail(`attempt outcome evidence ${path} did not land in its outcome commit`);
  }
  return outcomeCommit;
}

function planForRun(registration, run, side) {
  const key = side === "without" ? "without_run" : "with_run";
  const matches = registration.capture_plan.filter((plan) => plan[key] === run);
  if (matches.length !== 1) fail(`run ${run} is not one ${side} preregistered capture slot`);
  return matches[0];
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
      const [input, inputProvider, charge, journal, attribution, attributionProvider, providerCall, capture] = await Promise.all([
        readJsonFile(new URL("../../bench/schemas/execution-input.schema.json", import.meta.url)),
        readJsonFile(new URL("../../bench/schemas/execution-input-v2.schema.json", import.meta.url)),
        readJsonFile(new URL("../../bench/schemas/single-attempt-charge.schema.json", import.meta.url)),
        readJsonFile(new URL("../../bench/schemas/single-attempt-journal.schema.json", import.meta.url)),
        readJsonFile(new URL("../../bench/schemas/execution-attribution.schema.json", import.meta.url)),
        readJsonFile(new URL("../../bench/schemas/execution-attribution-v2.schema.json", import.meta.url)),
        readJsonFile(new URL("../../bench/schemas/provider-call.schema.json", import.meta.url)),
        readJsonFile(new URL("../../bench/schemas/capture.schema.json", import.meta.url)),
      ]);
      return {
        ajv,
        input: ajv.compile(input),
        inputProvider: ajv.compile(inputProvider),
        charge: ajv.compile(charge),
        journal: ajv.compile(journal),
        attribution: ajv.compile(attribution),
        attributionProvider: ajv.compile(attributionProvider),
        providerCall: ajv.compile(providerCall),
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

export async function validateExecutionInput(input, context = "execution input") {
  await schemaCheck(
    input,
    input?.schema === SINGLE_ATTEMPT_SCHEMAS.inputProvider ? "inputProvider" : "input",
    context,
  );
  exactTimestamp(input.created_at, `${context}.created_at`);
  if (input.execution_input_id !== executionInputId(input)) {
    fail(`${context} id does not match its immutable contents`);
  }
  const expectedAttempt = singleAttemptId({
    registrationId: input.registration.registration_id,
    run: input.plan.run,
    side: input.plan.side,
  });
  if (input.attempt_id !== expectedAttempt) fail(`${context} attempt id does not match its preregistered slot`);
  if (input.plan.clip_id !== input.source.clip_id) fail(`${context} source clip differs from its plan`);
  return input;
}

export async function validateSingleAttemptCharge(charge, context = "single-attempt charge") {
  await schemaCheck(charge, "charge", context);
  exactTimestamp(charge.charged_at, `${context}.charged_at`);
  const expected = singleAttemptId({
    registrationId: charge.slot.registration_id,
    run: charge.slot.run,
    side: charge.slot.side,
  });
  if (charge.attempt_id !== expected) fail(`${context} attempt id does not match its preregistered slot`);
  return charge;
}

export async function validateSingleAttemptJournal(journal, context = "single-attempt journal") {
  await schemaCheck(journal, "journal", context);
  return journal;
}

export async function validateExecutionAttribution(attribution, context = "execution attribution") {
  await schemaCheck(
    attribution,
    attribution?.schema === SINGLE_ATTEMPT_SCHEMAS.attributionProvider
      ? "attributionProvider"
      : "attribution",
    context,
  );
  exactTimestamp(attribution.completed_at, `${context}.completed_at`);
  if (attribution.attribution_id !== attributionId(attribution)) {
    fail(`${context} id does not match its immutable contents`);
  }
  if (attribution.attempt_id !== attribution.charge.attempt_id) {
    fail(`${context} attempt id differs from its charge`);
  }
  return attribution;
}

export async function validateProviderCall(providerCall, context = "provider call") {
  await schemaCheck(providerCall, "providerCall", context);
  exactTimestamp(providerCall.started_at, `${context}.started_at`);
  exactTimestamp(providerCall.completed_at, `${context}.completed_at`);
  if (Date.parse(providerCall.completed_at) < Date.parse(providerCall.started_at)) {
    fail(`${context} completion predates its start`);
  }
  const { provider_call_id: _id, ...body } = providerCall;
  const expectedId = `bench-provider-call:${contentIdForJson({ provider_call_id: null, ...body })}`;
  if (providerCall.provider_call_id !== expectedId) fail(`${context} id does not match its immutable contents`);
  return providerCall;
}

async function validatedRegistration(path, workspaceRoot, validateRegistration) {
  if (typeof validateRegistration !== "function") fail("a rule-change registration validator is required");
  const recordedPath = repositoryPath(path, "registration path");
  const registration = await readJsonFile(resolve(workspaceRoot, recordedPath), "single-attempt registration");
  await validateRegistration(registration, { workspaceRoot, context: "single-attempt registration" });
  return {
    registration,
    binding: await fileReceipt(resolve(workspaceRoot, recordedPath), recordedPath),
  };
}

function validateCaptureForInvocation(capture, { registration, release, plan, run, side }) {
  if (
    capture.capture_id !== run ||
    capture.clip.id !== plan.clip_id ||
    capture.captured_at <= registration.registered_at.slice(0, 10)
  ) {
    fail("executor capture differs from its preregistered run, clip, or capture window");
  }
  const system = capture.systems.find((candidate) => candidate.id === registration.subject.system_id);
  if (!system || canonicalJson(system.config) !== canonicalJson(release.configuration.config)) {
    fail(`executor capture does not carry the certified ${side} configuration`);
  }
}

async function clipDescriptor(registration, clipId, workspaceRoot) {
  const pack = await readJsonFile(
    resolve(workspaceRoot, registration.pack.manifest.path),
    "single-attempt pack manifest",
  );
  const matches = pack.clips?.filter((clip) => clip.clip_id === clipId) ?? [];
  if (matches.length !== 1) fail(`frozen pack does not describe one clip ${clipId}`);
  const source = matches[0].source;
  if (!source || typeof source !== "object" || typeof source.duration !== "number" || source.duration <= 0) {
    fail(`frozen pack clip ${clipId} has no exact positive duration`);
  }
  const text = (value) => typeof value === "string" ? value : "";
  return {
    durationS: source.duration,
    lang: "ko",
    pair: "ko->en",
    source: {
      kind: text(source.kind),
      url: text(source.url),
      channel: text(source.channel),
      licence: text(source.licence),
      window: source.window && typeof source.window === "object" ? structuredClone(source.window) : null,
      attribution: text(source.attribution),
    },
  };
}

function providerAdapter(adapterId) {
  return adapterId === "openai_audio_translation_v1";
}

async function executeHostOwnedAdapter(
  adapterId,
  invocation,
  completedAt,
  { providerExecution, providerResponsePath },
) {
  if (providerAdapter(adapterId)) {
    const injectedCompletion = providerExecution?.mode === "test" ? completedAt : null;
    return executeOpenAIAudioTranslation(invocation, providerExecution, {
      startedAt: injectedCompletion
        ? injectedCompletion
        : new Date().toISOString(),
      now: () => injectedCompletion ?? new Date().toISOString(),
      providerResponsePath,
    });
  }
  if (invocation.hostContext.config.model !== "deterministic-fixture") {
    fail(`capture adapter ${adapterId} cannot execute ${String(invocation.hostContext.config.model)}`);
  }
  if (adapterId === "deterministic_fixture_v1") {
    return { ok: true, capture: executeDeterministicFixture(invocation, completedAt), evidence: null };
  }
  if (adapterId === "deterministic_fixture_failure_v1") {
    return { ok: true, capture: executeDeterministicFixtureFailure(invocation, completedAt), evidence: null };
  }
  if (adapterId === "deterministic_fixture_stale_config_v1") {
    return { ok: true, capture: executeDeterministicFixtureStaleConfig(invocation, completedAt), evidence: null };
  }
  fail(`capture adapter ${adapterId} is not host-owned`);
}

export async function runSingleAttempt(
  request,
  {
    workspaceRoot = process.cwd(),
    chargedAt = new Date().toISOString(),
    completedAt = null,
    validateRegistration,
    providerExecution = null,
  } = {},
) {
  exactKeys(
    request,
    ["registrationPath", "releasePath", "executorManifestPath", "run", "side"],
    "single-attempt request",
  );
  const {
    registrationPath,
    releasePath,
    executorManifestPath,
    run: runValue,
    side,
  } = request;
  const run = runId(runValue);
  const { registration, binding: registrationBinding } = await validatedRegistration(
    registrationPath,
    workspaceRoot,
    validateRegistration,
  );
  const resolved = await resolveCertifiedRelease(releasePath, { workspaceRoot, validateRegistration });
  const resolvedExecutor = await resolveCaptureExecutor(executorManifestPath, { workspaceRoot });
  if (
    resolved.release.registration.registration_id !== registration.registration_id ||
    resolved.release.side !== side
  ) {
    fail("certified release does not belong to the requested registration side");
  }
  const plan = planForRun(registration, run, side);
  const paths = singleAttemptPaths(run);
  const attemptId = singleAttemptId({ registrationId: registration.registration_id, run, side });
  const existingCharges = await auditSingleAttemptCharges({ workspaceRoot });
  if (existingCharges.some((item) => item.charge.attempt_id === attemptId)) {
    fail(`duplicate attempt id ${attemptId} is already charged`);
  }
  await assertSlotEmpty(paths, workspaceRoot);
  const sourceRows = resolved.evaluationSources.filter((source) => source.clip_id === plan.clip_id);
  if (sourceRows.length !== 1) fail(`certified release does not bind one source for ${plan.clip_id}`);
  const sourceBinding = sourceRows[0].artifact;
  const sourceBytes = await readFile(resolve(workspaceRoot, sourceBinding.path));
  if (!exactBytesBinding(sourceBytes, sourceBinding)) {
    fail("certified evaluation source bytes differ from the buffer passed to the adapter");
  }
  await Promise.all([
    requireHeadBytes(registrationBinding.path, workspaceRoot, "single-attempt registration"),
    requireHeadBytes(resolved.binding.path, workspaceRoot, "single-attempt certified release"),
    requireHeadBytes(resolvedExecutor.binding.path, workspaceRoot, "single-attempt executor manifest"),
    requireHeadBytes(
      resolvedExecutor.executor.host.path,
      workspaceRoot,
      "single-attempt host implementation",
    ),
    requireHeadBytes(
      resolvedExecutor.executor.implementation.path,
      workspaceRoot,
      "single-attempt host adapter implementation",
    ),
  ]);
  const usesProvider = providerAdapter(resolvedExecutor.executor.adapter_id);
  const invocation = deepFreeze({
    attemptId,
    run,
    clipId: plan.clip_id,
    repetition: plan.repetition,
    side,
    source: {
      contentId: sourceBinding.content_id,
      bytes: sourceBinding.bytes,
      dataBase64: sourceBytes.toString("base64"),
      ...(usesProvider ? { filename: basename(sourceBinding.path) } : {}),
    },
    ...(usesProvider ? { clip: await clipDescriptor(registration, plan.clip_id, workspaceRoot) } : {}),
    hostContext: structuredClone(resolved.hostContext),
  });
  if (usesProvider) {
    preflightOpenAIAudioTranslation(invocation, providerExecution);
    if (completedAt !== null && providerExecution?.mode !== "test") {
      fail("provider completion time injection is test-only");
    }
  } else if (providerExecution !== null) {
    fail("provider execution authority was supplied to a non-provider adapter");
  }
  const at = exactTimestamp(chargedAt, "attempt charged_at");
  if (Date.parse(at) < Date.parse(resolved.release.created_at)) {
    fail("attempt charge predates its certified release");
  }
  const inputBody = {
    schema: usesProvider ? SINGLE_ATTEMPT_SCHEMAS.inputProvider : SINGLE_ATTEMPT_SCHEMAS.input,
    created_at: at,
    attempt_id: attemptId,
    registration: {
      receipt: registrationBinding,
      registration_id: registration.registration_id,
    },
    release: {
      receipt: resolved.binding,
      release_id: resolved.release.release_id,
    },
    executor: {
      receipt: resolvedExecutor.binding,
      executor_id: resolvedExecutor.executor.executor_id,
      adapter_id: resolvedExecutor.executor.adapter_id,
      host_content_id: resolvedExecutor.executor.host.content_id,
      implementation_content_id: resolvedExecutor.executor.implementation.content_id,
    },
    plan: {
      run,
      clip_id: plan.clip_id,
      repetition: plan.repetition,
      side,
    },
    source: {
      clip_id: plan.clip_id,
      artifact: sourceBinding,
    },
    host_context_id: resolved.hostContext.context_id,
  };
  const input = { execution_input_id: executionInputId(inputBody), ...inputBody };
  await validateExecutionInput(input);
  await writeOnceJson(resolve(workspaceRoot, paths.input), input, "execution input");
  const inputBinding = await fileReceipt(resolve(workspaceRoot, paths.input), paths.input);
  const charge = {
    schema: SINGLE_ATTEMPT_SCHEMAS.charge,
    attempt_id: attemptId,
    charged_at: at,
    slot: {
      registration_id: registration.registration_id,
      run,
      side,
    },
    execution_input: {
      receipt: inputBinding,
      execution_input_id: input.execution_input_id,
    },
  };
  await validateSingleAttemptCharge(charge);
  await writeOnceJson(resolve(workspaceRoot, paths.charge), charge, "single-attempt charge");
  const chargeBinding = await fileReceipt(resolve(workspaceRoot, paths.charge), paths.charge);
  let chargeJournal = await recordChargeJournal(charge, chargeBinding, paths.journal, workspaceRoot);
  const chargeCommit = commitChargeEvidence(paths, run, chargeJournal.head_commit, workspaceRoot);
  chargeJournal = { ...chargeJournal, charge_commit: chargeCommit };

  if (completedAt !== null && Date.parse(exactTimestamp(completedAt, "attempt completed_at")) < Date.parse(at)) {
    fail("attempt completed_at predates its charge");
  }
  const adapterCompletedAt = usesProvider
    ? completedAt
    : exactTimestamp(completedAt ?? new Date().toISOString(), "attempt completed_at");
  const adapterOutcome = await executeHostOwnedAdapter(
    resolvedExecutor.executor.adapter_id,
    invocation,
    adapterCompletedAt,
    { providerExecution, providerResponsePath: paths.providerResponse },
  );
  let providerCall = null;
  let providerCallBinding = null;
  let providerResponseBinding = null;
  if (usesProvider) {
    if (Buffer.isBuffer(adapterOutcome.responseBytes) && adapterOutcome.responseBytes.length > 0) {
      await writeOnceBytes(
        resolve(workspaceRoot, paths.providerResponse),
        adapterOutcome.responseBytes,
        "provider response",
      );
      providerResponseBinding = await fileReceipt(
        resolve(workspaceRoot, paths.providerResponse),
        paths.providerResponse,
      );
    } else if (Buffer.isBuffer(adapterOutcome.responseBytes)) {
      providerResponseBinding = byteContentBinding(adapterOutcome.responseBytes);
    }
    providerCall = materializeProviderCallReceipt(adapterOutcome.evidence, providerResponseBinding);
    await validateProviderCall(providerCall);
    await writeOnceJson(resolve(workspaceRoot, paths.providerCall), providerCall, "provider call");
    providerCallBinding = await fileReceipt(resolve(workspaceRoot, paths.providerCall), paths.providerCall);
    if (!adapterOutcome.ok) {
      const failedPaths = [
        ...(providerResponseBinding?.path ? [paths.providerResponse] : []),
        paths.providerCall,
      ];
      const outcomeCommit = commitAttemptOutcome(
        failedPaths,
        run,
        chargeCommit,
        workspaceRoot,
        `Record failed provider attempt ${run}`,
      );
      const error = new Error(`provider attempt failed after charge: ${adapterOutcome.failureCode}`);
      error.code = adapterOutcome.failureCode;
      error.outcomeCommit = outcomeCommit;
      throw error;
    }
  }
  const finishedAt = usesProvider
    ? providerCall.completed_at
    : adapterCompletedAt;
  const capture = adapterOutcome.capture;
  await schemaCheck(capture, "capture", "executor capture");
  validateCaptureForInvocation(capture, {
    registration,
    release: resolved.release,
    plan,
    run,
    side,
  });
  await writeOnceJson(resolve(workspaceRoot, paths.capture), capture, "capture");
  const captureBinding = await fileReceipt(resolve(workspaceRoot, paths.capture), paths.capture);
  if (capture.captured_at !== finishedAt.slice(0, 10)) {
    fail("executor capture date differs from the host completion date");
  }
  const attributionBody = {
    schema: usesProvider
      ? SINGLE_ATTEMPT_SCHEMAS.attributionProvider
      : SINGLE_ATTEMPT_SCHEMAS.attribution,
    completed_at: finishedAt,
    attempt_id: attemptId,
    run,
    side,
    release_id: resolved.release.release_id,
    host_context_id: resolved.hostContext.context_id,
    execution_input: {
      ...inputBinding,
      id: input.execution_input_id,
    },
    charge: {
      ...chargeBinding,
      attempt_id: attemptId,
    },
    charge_journal: chargeJournal,
    ...(usesProvider
      ? {
          provider_call: {
            ...providerCallBinding,
            id: providerCall.provider_call_id,
          },
        }
      : {}),
    capture: {
      ...captureBinding,
      id: capture.capture_id,
    },
  };
  const attribution = { attribution_id: attributionId(attributionBody), ...attributionBody };
  await validateExecutionAttribution(attribution);
  await writeOnceJson(resolve(workspaceRoot, paths.attribution), attribution, "execution attribution");
  const outcomePaths = usesProvider
    ? [paths.providerResponse, paths.providerCall, paths.capture, paths.attribution]
    : [paths.capture, paths.attribution];
  const outcomeCommit = commitAttemptOutcome(outcomePaths, run, chargeCommit, workspaceRoot);
  return {
    input,
    charge,
    chargeJournal,
    outcomeCommit,
    attribution,
    providerCall,
    paths,
  };
}

function exactBinding(left, right) {
  return left.path === right.path && left.content_id === right.content_id && left.bytes === right.bytes;
}

function exactBytesBinding(bytes, binding) {
  return (
    bytes.length === binding.bytes &&
    `sha256:${createHash("sha256").update(bytes).digest("hex")}` === binding.content_id
  );
}

function byteContentBinding(bytes) {
  if (!Buffer.isBuffer(bytes)) fail("provider response content must be bytes");
  return {
    content_id: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    bytes: bytes.length,
  };
}

function sameContentBinding(left, right) {
  return left.content_id === right.content_id && left.bytes === right.bytes;
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function fileBindingOnly(binding) {
  return {
    path: binding.path,
    content_id: binding.content_id,
    bytes: binding.bytes,
  };
}

export async function verifyExecutionAttribution(
  attributionPath,
  {
    workspaceRoot = process.cwd(),
    registration,
    expectedRun,
    expectedSide,
    expectedCapture,
    expectedRegistration,
    validateRegistration,
  } = {},
) {
  const run = runId(expectedRun, "expected run");
  if (!registration || typeof registration !== "object") fail("verified registration is required");
  const recordedPath = repositoryPath(attributionPath, "execution attribution path");
  const paths = singleAttemptPaths(run);
  if (recordedPath !== paths.attribution) fail(`execution attribution path must be ${paths.attribution}`);
  const attribution = await validateExecutionAttribution(
    await readJsonFile(resolve(workspaceRoot, recordedPath), "execution attribution"),
  );
  const providerAttribution = attribution.schema === SINGLE_ATTEMPT_SCHEMAS.attributionProvider;
  if (attribution.run !== run || attribution.side !== expectedSide) {
    fail("execution attribution names a different preregistered slot");
  }
  await verifiedBinding(fileBindingOnly(attribution.execution_input), workspaceRoot, "execution input");
  await verifiedBinding(fileBindingOnly(attribution.charge), workspaceRoot, "single-attempt charge");
  await verifiedBinding(fileBindingOnly(attribution.capture), workspaceRoot, "execution capture");
  if (
    attribution.execution_input.path !== paths.input ||
    attribution.charge.path !== paths.charge ||
    attribution.capture.path !== paths.capture
  ) {
    fail("execution attribution does not use canonical attempt paths");
  }
  let providerCall = null;
  if (providerAttribution) {
    if (attribution.provider_call.path !== paths.providerCall) {
      fail("provider execution attribution does not use its canonical provider call path");
    }
    await verifiedBinding(fileBindingOnly(attribution.provider_call), workspaceRoot, "provider call");
    providerCall = await validateProviderCall(
      await readJsonFile(resolve(workspaceRoot, attribution.provider_call.path), "provider call"),
    );
    if (
      attribution.provider_call.id !== providerCall.provider_call_id ||
      providerCall.attempt_id !== attribution.attempt_id ||
      providerCall.host_context_id !== attribution.host_context_id ||
      providerCall.completed_at !== attribution.completed_at ||
      providerCall.outcome !== "success" ||
      providerCall.failure_code !== null ||
      providerCall.execution_mode !== "live_openai"
    ) {
      fail("provider call cannot prove one successful live provider execution");
    }
    if (!providerCall.response || providerCall.response.path !== paths.providerResponse) {
      fail("provider call does not bind its canonical response artifact");
    }
    await verifiedBinding(providerCall.response, workspaceRoot, "provider response");
  }
  if (!expectedCapture || !exactBinding(attribution.capture, expectedCapture)) {
    fail("execution attribution capture differs from the score-bound capture bytes");
  }
  const input = await validateExecutionInput(
    await readJsonFile(resolve(workspaceRoot, attribution.execution_input.path), "execution input"),
  );
  const charge = await validateSingleAttemptCharge(
    await readJsonFile(resolve(workspaceRoot, attribution.charge.path), "single-attempt charge"),
  );
  const capture = await readJsonFile(resolve(workspaceRoot, attribution.capture.path), "execution capture");
  await schemaCheck(capture, "capture", "execution capture");
  if (
    attribution.execution_input.id !== input.execution_input_id ||
    attribution.charge.attempt_id !== charge.attempt_id ||
    attribution.capture.id !== capture.capture_id ||
    attribution.attempt_id !== input.attempt_id ||
    attribution.attempt_id !== charge.attempt_id ||
    charge.execution_input.execution_input_id !== input.execution_input_id ||
    !exactBinding(charge.execution_input.receipt, attribution.execution_input)
  ) {
    fail("execution attribution identities do not close over input, charge, and capture");
  }
  await verifyChargeJournal(
    charge,
    fileBindingOnly(attribution.charge),
    attribution.charge_journal,
    workspaceRoot,
  );
  const outcomeCommits = [
    attribution.capture.path,
    recordedPath,
    ...(providerAttribution ? [attribution.provider_call.path, providerCall.response.path] : []),
  ]
    .map((path) => immutableArtifactCommit(path, {
      workspaceRoot,
      context: `attempt outcome evidence ${path}`,
    }));
  if (new Set(outcomeCommits).size !== 1) {
    fail("attempt capture and attribution do not share their immutable outcome commit");
  }
  assertCommitDescends(attribution.charge_journal.charge_commit, outcomeCommits[0], {
    workspaceRoot,
    context: "attempt outcome evidence chronology",
  });
  if (
    input.registration.registration_id !== registration.registration_id ||
    !expectedRegistration ||
    !exactBinding(input.registration.receipt, expectedRegistration) ||
    input.plan.run !== run ||
    input.plan.side !== expectedSide
  ) {
    fail("execution input differs from the preregistered execution slot");
  }
  await verifiedBinding(input.registration.receipt, workspaceRoot, "execution registration");
  await verifiedBinding(input.source.artifact, workspaceRoot, "execution source input");
  const resolved = await resolveCertifiedRelease(input.release.receipt.path, {
    workspaceRoot,
    validateRegistration,
  });
  const resolvedExecutor = await resolveCaptureExecutorAtCommit(
    input.executor.receipt.path,
    attribution.charge_journal.head_commit,
    { workspaceRoot },
  );
  const sourceRows = resolved.evaluationSources.filter((source) => source.clip_id === input.plan.clip_id);
  if (sourceRows.length !== 1 || !exactBinding(input.source.artifact, sourceRows[0].artifact)) {
    fail("execution source input differs from the frozen-pack media certified by the release");
  }
  if (
    !exactBinding(input.executor.receipt, resolvedExecutor.binding) ||
    input.executor.executor_id !== resolvedExecutor.executor.executor_id ||
    input.executor.adapter_id !== resolvedExecutor.executor.adapter_id ||
    input.executor.host_content_id !== resolvedExecutor.executor.host.content_id ||
    input.executor.implementation_content_id !== resolvedExecutor.executor.implementation.content_id ||
    resolvedExecutor.executor.host.path !== CAPTURE_HOST_IMPLEMENTATION_PATH ||
    resolvedExecutor.executor.implementation.path !==
      CAPTURE_ADAPTER_IMPLEMENTATIONS[resolvedExecutor.executor.adapter_id]
  ) {
    fail("execution input differs from its closed host-owned capture adapter");
  }
  if (providerAttribution) {
    if (!providerAdapter(resolvedExecutor.executor.adapter_id) || input.schema !== SINGLE_ATTEMPT_SCHEMAS.inputProvider) {
      fail("provider attribution does not use the provider execution input and adapter");
    }
    const sourceBytes = await readFile(resolve(workspaceRoot, input.source.artifact.path));
    if (!exactBytesBinding(sourceBytes, input.source.artifact)) {
      fail("provider execution source bytes differ from their certified identity");
    }
    const providerInvocation = deepFreeze({
      attemptId: attribution.attempt_id,
      run,
      clipId: input.plan.clip_id,
      repetition: input.plan.repetition,
      side: expectedSide,
      source: {
        contentId: input.source.artifact.content_id,
        bytes: input.source.artifact.bytes,
        dataBase64: sourceBytes.toString("base64"),
        filename: basename(input.source.artifact.path),
      },
      clip: await clipDescriptor(registration, input.plan.clip_id, workspaceRoot),
      hostContext: structuredClone(resolved.hostContext),
    });
    const expectedRequest = buildOpenAIAudioTranslationRequest(providerInvocation);
    if (
      providerCall.request.content_id !== expectedRequest.request.content_id ||
      providerCall.request.bytes !== expectedRequest.request.bytes ||
      canonicalJson(providerCall.prompt) !== canonicalJson(expectedRequest.prompt) ||
      providerCall.media.content_id !== input.source.artifact.content_id ||
      providerCall.media.bytes !== input.source.artifact.bytes ||
      providerCall.requested_model !== resolved.hostContext.config.model
    ) {
      fail("provider call request differs from the exact certified media, model, prompt, or rule bytes");
    }
    const responseBytes = await readFile(resolve(workspaceRoot, providerCall.response.path));
    const expectedCaptureObject = captureFromOpenAIAudioTranslation(providerInvocation, responseBytes, {
      startedAt: providerCall.started_at,
      completedAt: providerCall.completed_at,
      providerResponsePath: providerCall.response.path,
    });
    if (canonicalJson(expectedCaptureObject) !== canonicalJson(capture)) {
      fail("provider capture differs from the exact provider response bytes");
    }
  } else if (providerAdapter(resolvedExecutor.executor.adapter_id)) {
    fail("provider adapter execution is missing provider attribution");
  }
  if (
    !exactBinding(input.release.receipt, resolved.binding) ||
    input.release.release_id !== resolved.release.release_id ||
    attribution.release_id !== resolved.release.release_id ||
    input.host_context_id !== resolved.hostContext.context_id ||
    attribution.host_context_id !== resolved.hostContext.context_id ||
    resolved.release.registration.registration_id !== registration.registration_id ||
    resolved.release.side !== expectedSide
  ) {
    fail("execution attribution release or host context differs from the certified inputs");
  }
  const expectedAttempt = singleAttemptId({
    registrationId: registration.registration_id,
    run,
    side: expectedSide,
  });
  if (attribution.attempt_id !== expectedAttempt) fail("execution attribution attempt id is stale or forged");
  if (Date.parse(input.created_at) > Date.parse(charge.charged_at)) {
    fail("single-attempt charge predates its execution input receipt");
  }
  if (Date.parse(charge.charged_at) > Date.parse(attribution.completed_at)) {
    fail("execution attribution completion predates its charge");
  }
  if (capture.captured_at !== attribution.completed_at.slice(0, 10)) {
    fail("execution capture date differs from the host completion date");
  }
  const plan = planForRun(registration, run, expectedSide);
  validateCaptureForInvocation(capture, {
    registration,
    release: resolved.release,
    plan,
    run,
    side: expectedSide,
  });
  return {
    receipt: await fileReceipt(resolve(workspaceRoot, recordedPath), recordedPath),
    attempt_id: attribution.attempt_id,
    release_id: attribution.release_id,
    execution_input_id: input.execution_input_id,
  };
}

function validateProviderFailureSemantics(providerCall, context) {
  const { failure_code: code, http_status: status } = providerCall;
  if (code === "provider_rate_limited" && status !== 429) {
    fail(`${context} rate-limit failure does not carry HTTP 429`);
  }
  if (
    code === "provider_http_error" &&
    (status === null || status === 429 || (status >= 200 && status < 300))
  ) {
    fail(`${context} HTTP failure does not carry a non-2xx, non-429 status`);
  }
  if (
    new Set(["provider_invalid_output", "provider_response_limit_exceeded"]).has(code) &&
    status !== null &&
    (status < 200 || status >= 300)
  ) {
    fail(`${context} output failure carries a non-success HTTP status`);
  }
  if (new Set(["provider_timeout", "provider_transport_failed"]).has(code) && status !== null) {
    fail(`${context} transport failure unexpectedly carries an HTTP status`);
  }
}

async function auditProviderOutcome(item, journal, workspaceRoot, validateRegistration) {
  if (item.input.schema !== SINGLE_ATTEMPT_SCHEMAS.inputProvider) return;
  const run = item.charge.slot.run;
  const paths = singleAttemptPaths(run);
  const providerCallPath = resolve(workspaceRoot, paths.providerCall);
  if (!await pathExists(providerCallPath)) return;
  const providerCall = await validateProviderCall(
    await readJsonFile(providerCallPath, `provider call ${run}`),
    `provider call ${run}`,
  );
  if (
    providerCall.attempt_id !== item.charge.attempt_id ||
    providerCall.host_context_id !== item.input.host_context_id ||
    item.input.executor.adapter_id !== "openai_audio_translation_v1" ||
    !sameContentBinding(providerCall.media, item.input.source.artifact)
  ) {
    fail(`provider call ${run} differs from its charged execution input`);
  }
  const outcomePaths = [paths.providerCall];
  if (providerCall.response?.path) {
    if (providerCall.response.path !== paths.providerResponse) {
      fail(`provider call ${run} does not use its canonical response path`);
    }
    await verifiedBinding(providerCall.response, workspaceRoot, `provider call ${run} response`);
    outcomePaths.push(paths.providerResponse);
  }
  const outcomeCommits = outcomePaths.map((path) => immutableArtifactCommit(path, {
    workspaceRoot,
    context: `provider call ${run} outcome ${path}`,
  }));
  if (new Set(outcomeCommits).size !== 1) {
    fail(`provider call ${run} receipt and response do not share one immutable outcome commit`);
  }
  assertCommitDescends(journal.charge_commit, outcomeCommits[0], {
    workspaceRoot,
    context: `provider call ${run} outcome chronology`,
  });
  if (providerCall.outcome !== "failed") return;
  validateProviderFailureSemantics(providerCall, `provider call ${run}`);
  if (
    new Set(["provider_rate_limited", "provider_http_error", "provider_invalid_output"]).has(
      providerCall.failure_code,
    ) &&
    providerCall.response === null
  ) {
    fail(`provider call ${run} dropped the exact HTTP response identity`);
  }
  if (
    new Set(["provider_timeout", "provider_transport_failed"]).has(providerCall.failure_code) &&
    providerCall.response !== null
  ) {
    fail(`provider call ${run} invents response bytes for a transport failure`);
  }
  if (
    await pathExists(resolve(workspaceRoot, paths.capture)) ||
    await pathExists(resolve(workspaceRoot, paths.attribution))
  ) {
    fail(`failed provider call ${run} cannot carry capture or attribution evidence`);
  }
  if (typeof validateRegistration !== "function") return;
  const { registration, binding: registrationBinding } = await validatedRegistration(
    item.input.registration.receipt.path,
    workspaceRoot,
    validateRegistration,
  );
  if (
    item.input.registration.registration_id !== registration.registration_id ||
    !exactBinding(item.input.registration.receipt, registrationBinding)
  ) {
    fail(`provider call ${run} registration differs from its charged execution input`);
  }
  const resolved = await resolveCertifiedRelease(item.input.release.receipt.path, {
    workspaceRoot,
    validateRegistration,
  });
  if (
    item.input.release.release_id !== resolved.release.release_id ||
    !exactBinding(item.input.release.receipt, resolved.binding) ||
    resolved.hostContext.context_id !== item.input.host_context_id ||
    providerCall.requested_model !== resolved.hostContext.config.model
  ) {
    fail(`provider call ${run} release or model differs from its charged execution input`);
  }
  const resolvedExecutor = await resolveCaptureExecutorAtCommit(
    item.input.executor.receipt.path,
    journal.head_commit,
    { workspaceRoot },
  );
  if (
    !exactBinding(item.input.executor.receipt, resolvedExecutor.binding) ||
    item.input.executor.executor_id !== resolvedExecutor.executor.executor_id ||
    item.input.executor.adapter_id !== resolvedExecutor.executor.adapter_id ||
    resolvedExecutor.executor.adapter_id !== "openai_audio_translation_v1"
  ) {
    fail(`provider call ${run} executor differs from its precharge certified bytes`);
  }
  await verifiedBinding(item.input.source.artifact, workspaceRoot, `provider call ${run} source`);
  const sourceRows = resolved.evaluationSources.filter(
    (source) => source.clip_id === item.input.plan.clip_id,
  );
  if (sourceRows.length !== 1 || !exactBinding(item.input.source.artifact, sourceRows[0].artifact)) {
    fail(`provider call ${run} source differs from its certified release`);
  }
  const sourceBytes = await readFile(resolve(workspaceRoot, item.input.source.artifact.path));
  const invocation = deepFreeze({
    attemptId: item.charge.attempt_id,
    run,
    clipId: item.input.plan.clip_id,
    repetition: item.input.plan.repetition,
    side: item.input.plan.side,
    source: {
      contentId: item.input.source.artifact.content_id,
      bytes: item.input.source.artifact.bytes,
      dataBase64: sourceBytes.toString("base64"),
      filename: basename(item.input.source.artifact.path),
    },
    clip: await clipDescriptor(registration, item.input.plan.clip_id, workspaceRoot),
    hostContext: structuredClone(resolved.hostContext),
  });
  const expected = buildOpenAIAudioTranslationRequest(invocation);
  if (
    !sameContentBinding(providerCall.request, expected.request) ||
    canonicalJson(providerCall.prompt) !== canonicalJson(expected.prompt)
  ) {
    fail(`provider call ${run} request differs from the certified media, prompt, or rule bytes`);
  }
}

export async function auditSingleAttemptCharges({
  workspaceRoot = process.cwd(),
  validateRegistration = null,
} = {}) {
  const attemptsRoot = resolve(workspaceRoot, "bench/attempts");
  let entries = [];
  try {
    entries = await readdir(attemptsRoot, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") entries = [];
    else throw error;
  }
  const seen = new Map();
  const charges = [];
  const historicalCharges = git(
    ["log", "--diff-filter=A", "--name-only", "--format=", "--", "bench/attempts"],
    { workspaceRoot, context: "single-attempt charge history" },
  )
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.endsWith("/charge.json"));
  for (const path of new Set(historicalCharges)) {
    try {
      await access(resolve(workspaceRoot, repositoryPath(path, "historical single-attempt charge")));
    } catch (error) {
      if (error?.code === "ENOENT") fail(`committed single-attempt history names a deleted charge ${path}`);
      throw error;
    }
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const run = runId(entry.name, "attempt directory");
    const path = singleAttemptPaths(run).charge;
    let charge;
    try {
      charge = await validateSingleAttemptCharge(
        await readJsonFile(resolve(workspaceRoot, path), `single-attempt charge ${run}`),
      );
    } catch (error) {
      if (error?.cause?.code === "ENOENT") continue;
      throw error;
    }
    const prior = seen.get(charge.attempt_id);
    if (prior) fail(`duplicate attempt id ${charge.attempt_id} appears in ${prior} and ${path}`);
    seen.set(charge.attempt_id, path);
    if (charge.slot.run !== run) fail(`attempt directory ${run} contains a charge for ${charge.slot.run}`);
    if (charge.execution_input.receipt.path !== singleAttemptPaths(run).input) {
      fail(`single-attempt charge ${run} does not bind its canonical execution input`);
    }
    await verifiedBinding(charge.execution_input.receipt, workspaceRoot, `single-attempt charge ${run} input`);
    const input = await validateExecutionInput(
      await readJsonFile(
        resolve(workspaceRoot, charge.execution_input.receipt.path),
        `single-attempt charge ${run} input`,
      ),
    );
    if (
      input.execution_input_id !== charge.execution_input.execution_input_id ||
      input.attempt_id !== charge.attempt_id
    ) {
      fail(`single-attempt charge ${run} does not close over its execution input identity`);
    }
    charges.push({
      path,
      charge,
      input,
      binding: await fileReceipt(resolve(workspaceRoot, path), path),
    });
  }
  for (const item of charges) {
    const journalPath = singleAttemptPaths(item.charge.slot.run).journal;
    const journal = await readJsonFile(
      resolve(workspaceRoot, journalPath),
      `single-attempt journal ${item.charge.attempt_id}`,
    );
    const journalBinding = await fileReceipt(resolve(workspaceRoot, journalPath), journalPath);
    const verifiedJournal = {
      ...journalBinding,
      head_commit: journal.head_commit,
      charge_commit: immutableArtifactCommit(item.path, {
        workspaceRoot,
        context: `single-attempt charge ${item.charge.slot.run}`,
      }),
    };
    await verifyChargeJournal(
      item.charge,
      item.binding,
      verifiedJournal,
      workspaceRoot,
    );
    await auditProviderOutcome(item, verifiedJournal, workspaceRoot, validateRegistration);
  }
  return charges;
}
