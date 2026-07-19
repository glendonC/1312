/** Content-addressed executable boundary for bench single-attempt captures. */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { isAbsolute, resolve } from "node:path";

import Ajv2020 from "ajv/dist/2020.js";

import { readJsonFile, verifiedBinding } from "./bench-gold.mjs";
import {
  contentIdForJson,
  digestFromContentId,
  fileReceipt,
} from "./immutable-receipts.mjs";

export const CAPTURE_EXECUTOR_SCHEMA = "studio.bench.capture-executor.v1";
export const CAPTURE_EXECUTOR_PROVIDER_SCHEMA = "studio.bench.capture-executor.v2";
export const CAPTURE_HOST_IMPLEMENTATION_PATH = "scripts/lib/bench-single-attempt.mjs";
export const CAPTURE_ADAPTER_IMPLEMENTATIONS = Object.freeze({
  deterministic_fixture_v1: "scripts/lib/bench-adapters/deterministic-fixture-v1.mjs",
  deterministic_fixture_failure_v1: "scripts/lib/bench-adapters/deterministic-fixture-failure-v1.mjs",
  deterministic_fixture_stale_config_v1: "scripts/lib/bench-adapters/deterministic-fixture-stale-config-v1.mjs",
  openai_audio_translation_v1: "scripts/lib/bench-adapters/openai-audio-translation-v1.mjs",
});

function fail(message) {
  throw new Error(`bench capture executor: ${message}`);
}

function repositoryPath(path, context) {
  if (typeof path !== "string" || path.length === 0 || isAbsolute(path) || path.startsWith("./") || path.split("/").includes("..")) {
    fail(`${context} must be a repository-relative path without traversal`);
  }
  return path;
}

function executorId(value) {
  const { executor_id: _id, ...body } = value;
  return `bench-capture-executor:${contentIdForJson({ executor_id: null, ...body })}`;
}

let validatorPromise;

async function validator() {
  if (!validatorPromise) {
    validatorPromise = (async () => {
      const [schema, providerSchema] = await Promise.all([
        readJsonFile(
          new URL("../../bench/schemas/capture-executor.schema.json", import.meta.url),
          "capture executor schema",
        ),
        readJsonFile(
          new URL("../../bench/schemas/capture-executor-v2.schema.json", import.meta.url),
          "provider capture executor schema",
        ),
      ]);
      const ajv = new Ajv2020({ allErrors: true, strict: true });
      return {
        ajv,
        validate: ajv.compile(schema),
        validateProvider: ajv.compile(providerSchema),
      };
    })();
  }
  return validatorPromise;
}

export function captureExecutorPath(executor) {
  const digest = digestFromContentId(
    executor.executor_id.slice("bench-capture-executor:".length),
    "capture executor id",
  );
  return `bench/executors/${digest}.json`;
}

export async function validateCaptureExecutor(executor, context = "capture executor") {
  const held = await validator();
  const validate = executor?.schema === CAPTURE_EXECUTOR_PROVIDER_SCHEMA
    ? held.validateProvider
    : held.validate;
  if (!validate(executor)) {
    fail(`${context} failed schema validation:\n${held.ajv.errorsText(validate.errors, { separator: "\n" })}`);
  }
  if (executor.executor_id !== executorId(executor)) fail(`${context} id does not match its immutable contents`);
  repositoryPath(executor.implementation.path, `${context} implementation path`);
  return executor;
}

function gitBinding(binding, commit, workspaceRoot, context) {
  if (typeof commit !== "string" || !/^[a-f0-9]{40,64}$/.test(commit)) {
    fail(`${context} commit is not a Git object id`);
  }
  let bytes;
  try {
    bytes = execFileSync("git", ["show", `${commit}:${binding.path}`], {
      cwd: workspaceRoot,
      encoding: null,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    fail(`${context} cannot reopen ${binding.path} from ${commit}`);
  }
  const reopened = {
    path: binding.path,
    content_id: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    bytes: bytes.length,
  };
  if (
    reopened.content_id !== binding.content_id ||
    reopened.bytes !== binding.bytes
  ) {
    fail(`${context} differs from its charge-anchored Git bytes`);
  }
}

export async function readCaptureExecutorManifest(
  manifestPath,
  { workspaceRoot = process.cwd() } = {},
) {
  const path = repositoryPath(manifestPath, "capture executor manifest path");
  const executor = await validateCaptureExecutor(
    await readJsonFile(resolve(workspaceRoot, path), "capture executor manifest"),
  );
  if (path !== captureExecutorPath(executor)) {
    fail(`capture executor manifest path must be ${captureExecutorPath(executor)}`);
  }
  if (executor.implementation.path !== CAPTURE_ADAPTER_IMPLEMENTATIONS[executor.adapter_id]) {
    fail("capture executor implementation differs from its closed host adapter");
  }
  if (executor.host.path !== CAPTURE_HOST_IMPLEMENTATION_PATH) {
    fail("capture executor host differs from the certified single-attempt host");
  }
  return {
    executor,
    binding: await fileReceipt(resolve(workspaceRoot, path), path),
  };
}

export async function materializeCaptureExecutor(
  { adapterId, notes },
  { workspaceRoot = process.cwd() } = {},
) {
  const implementationPath = CAPTURE_ADAPTER_IMPLEMENTATIONS[adapterId];
  if (!implementationPath) fail(`capture adapter ${String(adapterId)} is not host-owned`);
  const body = {
    schema: adapterId === "openai_audio_translation_v1"
      ? CAPTURE_EXECUTOR_PROVIDER_SCHEMA
      : CAPTURE_EXECUTOR_SCHEMA,
    adapter_id: adapterId,
    host: await fileReceipt(
      resolve(workspaceRoot, CAPTURE_HOST_IMPLEMENTATION_PATH),
      CAPTURE_HOST_IMPLEMENTATION_PATH,
    ),
    implementation: await fileReceipt(
      resolve(workspaceRoot, implementationPath),
      implementationPath,
    ),
    attempt_policy: { host_invocations: 1, retries: 0, selection: "none" },
    notes,
  };
  return validateCaptureExecutor({ executor_id: executorId(body), ...body });
}

export async function resolveCaptureExecutor(
  manifestPath,
  { workspaceRoot = process.cwd() } = {},
) {
  const resolved = await readCaptureExecutorManifest(manifestPath, { workspaceRoot });
  const { executor } = resolved;
  await verifiedBinding(executor.host, workspaceRoot, "capture executor host");
  await verifiedBinding(executor.implementation, workspaceRoot, "capture executor implementation");
  return resolved;
}

export async function resolveCaptureExecutorAtCommit(
  manifestPath,
  commit,
  { workspaceRoot = process.cwd() } = {},
) {
  const resolved = await readCaptureExecutorManifest(manifestPath, { workspaceRoot });
  gitBinding(resolved.executor.host, commit, workspaceRoot, "capture executor host");
  gitBinding(
    resolved.executor.implementation,
    commit,
    workspaceRoot,
    "capture executor implementation",
  );
  return resolved;
}
