import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  DurableRuntimeCommandStore,
  DeterministicCurrentRunCaptionTestExecutor,
  DeterministicRuntimeExecutor,
  OwnedMediaIngestService,
  OpenAiCaptionProductionExecutor,
  OpenAiCurrentRunSpeechRecognizer,
  OpenAiLanguageExplanationExecutor,
  RecordedCaptionFixtureExecutor,
  RuntimeSourceRegistry,
  RuntimeStartService,
  codexOrchestratorLauncherFactory,
  codexWorkerLauncherFactory,
  createRuntimeHostHttpServer,
  listenRuntimeHost,
} from "../src/studio/runtime/production/runtimeHost/index.ts";
import { resolveLanguageExplanationExecutorConfiguration } from "../src/studio/runtime/production/languageExplanations/configuration.ts";

const REPOSITORY = resolve(import.meta.dirname, "..");

function values(name: string): string[] {
  const output: string[] = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] !== name) continue;
    const value = process.argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
    output.push(value);
  }
  return output;
}

function value(name: string): string | null {
  const found = values(name);
  if (found.length > 1) throw new Error(`${name} may be supplied only once`);
  return found[0] ?? null;
}

function flag(name: string): boolean {
  return process.argv.includes(name);
}

function integer(name: string, fallback: number): number {
  const candidate = value(name);
  if (candidate === null) return fallback;
  const parsed = Number(candidate);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative integer`);
  return parsed;
}

const sourceDirectories = values("--source-directory");
const executorMode = value("--executor") ?? "deterministic";
if (executorMode !== "deterministic" && executorMode !== "codex") {
  throw new Error("--executor must be deterministic or codex");
}
if (executorMode === "codex" && !flag("--allow-real-codex")) {
  throw new Error("Real Codex execution requires --allow-real-codex");
}
const configuredModel = value("--model");
if (executorMode === "codex" && !configuredModel) {
  throw new Error("Real Codex orchestration requires an explicit --model identity");
}
const captionExecutorMode = value("--caption-executor") ?? "recorded";
if (captionExecutorMode !== "recorded" && captionExecutorMode !== "deterministic-test" && captionExecutorMode !== "openai") {
  throw new Error("--caption-executor must be recorded, deterministic-test, or openai");
}
if (captionExecutorMode === "openai" && !flag("--allow-real-caption-production")) {
  throw new Error("Real caption production requires --allow-real-caption-production");
}
if (captionExecutorMode === "deterministic-test" && !flag("--allow-deterministic-caption-test-seam")) {
  throw new Error("Deterministic current-run caption testing requires --allow-deterministic-caption-test-seam");
}
const semanticRecognizerMode = value("--semantic-recognizer") ?? "unavailable";
if (semanticRecognizerMode !== "unavailable" && semanticRecognizerMode !== "openai") {
  throw new Error("--semantic-recognizer must be unavailable or openai");
}
if (semanticRecognizerMode === "openai" && !flag("--allow-real-semantic-evidence")) {
  throw new Error("Real current-run semantic evidence requires --allow-real-semantic-evidence");
}
const languageExplanationConfiguration = resolveLanguageExplanationExecutorConfiguration({
  mode: value("--language-explanation-executor"),
  allowReal: flag("--allow-real-language-explanation"),
  model: value("--language-explanation-model"),
});

async function openAiKey(): Promise<string> {
  const environmentKey = process.env.OPENAI_API_KEY?.trim();
  if (environmentKey) return environmentKey;
  const contents = await readFile(resolve(REPOSITORY, ".env"), "utf8").catch(() => "");
  const key = (contents.match(/^OPENAI_API_KEY=(.+)$/m) ?? [])[1]?.trim();
  if (!key) throw new Error("Real OpenAI runtime execution requires OPENAI_API_KEY or OPENAI_API_KEY in .env");
  return key;
}

const runtimeRoot = resolve(value("--runtime-root") ?? resolve(REPOSITORY, ".studio/runtime-host"));
const ownedIngestRoot = resolve(value("--owned-ingest-root") ?? resolve(REPOSITORY, ".studio/owned-sources"));
const maximumOwnedMediaBytes = integer("--maximum-owned-media-bytes", 512 * 1024 * 1024);
const sourceRoot = value("--source-root");
const reviewerId = value("--reviewer-id") ?? "reviewer:local-operator";
const reviewerLabel = value("--reviewer-label") ?? "Local review operator";
const origins = values("--allowed-origin");
const allowedOrigins = origins.length > 0
  ? origins
  : ["http://127.0.0.1:4321", "http://localhost:4321"];
const sources = await RuntimeSourceRegistry.open({
  sourceDirectories: sourceDirectories.map((directory) => resolve(directory)),
  ...(sourceRoot ? { sourceRoot: resolve(sourceRoot) } : {}),
});
const ownedMediaIngest = await OwnedMediaIngestService.open({
  root: ownedIngestRoot,
  repositoryRoot: REPOSITORY,
  sources,
  maximumBytes: maximumOwnedMediaBytes,
});
const store = await DurableRuntimeCommandStore.open(runtimeRoot);
const deterministic = executorMode === "deterministic" ? new DeterministicRuntimeExecutor() : null;
const captionExecutor = captionExecutorMode === "openai"
  ? new OpenAiCaptionProductionExecutor({ apiKey: await openAiKey() })
  : captionExecutorMode === "deterministic-test"
    ? new DeterministicCurrentRunCaptionTestExecutor()
    : new RecordedCaptionFixtureExecutor();
const semanticRecognizer = semanticRecognizerMode === "openai"
  ? new OpenAiCurrentRunSpeechRecognizer({ apiKey: await openAiKey() })
  : undefined;
const languageExplanationExecutor = languageExplanationConfiguration.mode === "openai"
  ? new OpenAiLanguageExplanationExecutor({
      apiKey: await openAiKey(),
      model: languageExplanationConfiguration.model,
    })
  : undefined;
const service = await RuntimeStartService.open({
  store,
  sources,
  launcherFactory: deterministic
    ? deterministic.factory()
    : codexWorkerLauncherFactory({ model: configuredModel, maximumWallMs: 45_000, semanticRecognizer }),
  ...(deterministic ? {} : {
    orchestratorLauncherFactory: codexOrchestratorLauncherFactory({
      model: configuredModel!,
      maximumWallMs: 60_000,
    }),
  }),
  reviewer: { id: reviewerId, label: reviewerLabel },
  captionExecutor,
  languageExplanationExecutor,
});
const token = randomBytes(32).toString("hex");
const server = createRuntimeHostHttpServer({ service, ownedMediaIngest, token, allowedOrigins });
const listening = await listenRuntimeHost(server, {
  host: value("--host") ?? "127.0.0.1",
  port: integer("--port", 4312),
  unsafeDevelopmentBind: flag("--unsafe-development-bind"),
});

process.stdout.write(`${JSON.stringify({
  service: "1321 local development runtime host",
  listening: `http://${listening.host}:${listening.port}`,
  allowedOrigins,
  sourceSessionIds: service.listSources().map((source) => source.sourceSessionId),
  ownedMediaIngest: {
    enabled: true,
    maximumBytes: maximumOwnedMediaBytes,
  },
  reviewer: { id: reviewerId, label: reviewerLabel },
  runtimeRoot,
  executor: executorMode === "codex" ? "real-codex-opt-in" : "deterministic-no-model",
  captionExecutor: captionExecutorMode === "openai"
    ? "real-recognizer-translator-opt-in"
    : captionExecutorMode === "deterministic-test"
      ? "deterministic-current-run-test-seam-no-cognition"
      : "recorded-real-pipeline-fixture-adapter",
  semanticRecognizer: semanticRecognizerMode === "openai"
    ? "current-run-openai-opt-in"
    : "current-run-unavailable-no-fixture-fallback",
  languageExplanationExecutor: languageExplanationConfiguration.mode === "openai"
    ? `current-run-openai-opt-in:${languageExplanationConfiguration.model}`
    : "unavailable-no-fixture-fallback",
  authorizationToken: token,
}, null, 2)}\n`);

const close = (): void => {
  server.close(() => process.exit(0));
};
process.once("SIGINT", close);
process.once("SIGTERM", close);
