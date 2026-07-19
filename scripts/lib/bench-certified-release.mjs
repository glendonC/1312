/**
 * Resolve one preregistered rule-change side into exact, path-free execution context.
 *
 * V1 deliberately certifies qualification inputs only. It cannot authorize runtime deployment,
 * and it admits no ambient accepted materialization. The with side compiles exactly one bounded
 * candidate rule from its byte-bound proposal; the without side compiles no rule.
 */

import { isAbsolute, resolve } from "node:path";

import Ajv2020 from "ajv/dist/2020.js";

import { benchConfigId } from "./bench-ablation.mjs";
import { readJsonFile, verifiedBinding } from "./bench-gold.mjs";
import {
  canonicalJson,
  contentIdForJson,
  digestFromContentId,
  fileReceipt,
} from "./immutable-receipts.mjs";
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
  const expectedContext = buildHostContext(registration, configuration, rule);
  if (canonicalJson(release.host_context) !== canonicalJson(expectedContext)) {
    fail("certified release host context does not match its resolved inputs");
  }
  return {
    release,
    binding: await fileReceipt(resolve(workspaceRoot, recordedPath), recordedPath),
    registration,
    hostContext: structuredClone(release.host_context),
  };
}
