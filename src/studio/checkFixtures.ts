import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, readdir, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";

import { assertRunBundle } from "./bundle";
import { checkBundlePolicies } from "./checkBundlePolicies";
import { checkRecordedEvidencePolicies } from "./evidence/checkPolicies";
import type { RecordedEvidenceIndex } from "./evidence/types";
import type { RunBundle } from "./transport";
import type {
  CaptionsFile,
  CorrectionsFile,
  GlossaryFile,
  LanguagePack,
  MediaProbeReceipt,
  RunManifest,
  ScoreFile,
  IngestReceipt,
  TracesFile,
  WaveFile,
} from "./types";
import { deriveCheckpoints } from "./lab/checkpoints";
import { PREFLIGHT_SCENARIOS, validatePreflightScenario } from "./lab/preflightScenarios";
import { RUNTIME_CONTRACT_FIXTURES } from "./lab/runtimeFixtures";
import { SCENARIOS, validateScenarioEvidence } from "./lab/scenarios";
import { projectRun } from "./replayProjection";
import { assessRecordedRequest, recordedPreflight } from "./preflight/model";
import { classifySourceUrl } from "./preflight/sourceAdapters";
import { checkSourceReceiptPolicies } from "./preflight/checkReceiptPolicies";
import { checkPreflightBundlePolicies } from "./preflight/checkPreflightBundlePolicies";
import { checkSpeechReceiptPolicies } from "./preflight/checkSpeechReceiptPolicies";
import { checkLanguageReceiptPolicies } from "./preflight/checkLanguageReceiptPolicies";
import type { LanguageRangesReceipt, PreflightBundle, SpeechActivityReceipt } from "./preflight/contracts";
import { assertPreflightEvidence } from "./preflight/evidenceValidation";
import { checkRuntimeContractPolicies } from "./runtime/checkContractPolicies";
import { validateRuntimeContractFixture } from "./runtime/validateContractFixture";
import { checkTracePolicies } from "./checkTracePolicies";

const RUNS = pathToFileURL(`${resolve(process.cwd(), "public/demo/runs")}/`);
const PACKS = pathToFileURL(`${resolve(process.cwd(), "public/demo/packs")}/`);
const ROOT = pathToFileURL(`${resolve(process.cwd())}/`);

async function json<T>(url: URL): Promise<T> {
  try {
    return JSON.parse(await readFile(url, "utf8")) as T;
  } catch (error) {
    throw new Error(`Studio fixture ${fileURLToPath(url)} could not be read`, { cause: error });
  }
}

async function optionalJson<T>(url: URL): Promise<T | null> {
  try {
    return JSON.parse(await readFile(url, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error(`Studio fixture ${fileURLToPath(url)} could not be read`, { cause: error });
  }
}

async function contentIdentity(url: URL): Promise<{ contentId: string; bytes: number }> {
  const [digest, details] = await Promise.all([
    new Promise<string>((resolveDigest, reject) => {
      const hash = createHash("sha256");
      const input = createReadStream(url);
      input.on("error", reject);
      input.on("data", (chunk) => hash.update(chunk));
      input.on("end", () => resolveDigest(hash.digest("hex")));
    }),
    stat(url),
  ]);
  return { contentId: `sha256:${digest}`, bytes: details.size };
}

function expectPreflightFailure(action: () => void, expected: string): void {
  try {
    action();
  } catch (error) {
    if (error instanceof Error && error.message.includes(expected)) return;
    throw error;
  }
  throw new Error(`Studio preflight validation accepted evidence that should fail with ${expected}`);
}

/** Executed from the Studio route during Astro's production build. */
export async function checkRecordedRuns(): Promise<void> {
  const entries = (await readdir(RUNS, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name));

  if (entries.length === 0) throw new Error("Studio fixture check found no recorded runs");

  const bundles = new Map<string, RunBundle>();
  for (const entry of entries) {
    const base = new URL(`${entry.name}/`, RUNS);
    const [
      run,
      captions,
      score,
      wave,
      traceFile,
      glossary,
      corrections,
      ingestReceipt,
      mediaProbe,
      preflightV1,
      preflightV2,
      preflightV3,
      speechActivity,
      languageRanges,
      evidenceIndex,
    ] = await Promise.all([
      json<RunManifest>(new URL("run.json", base)),
      json<CaptionsFile>(new URL("captions.json", base)),
      json<ScoreFile>(new URL("score.json", base)),
      json<WaveFile>(new URL("waveform.json", base)),
      json<TracesFile>(new URL("traces.json", base)),
      json<GlossaryFile>(new URL("glossary.json", base)),
      json<CorrectionsFile>(new URL("corrections.json", base)),
      optionalJson<IngestReceipt>(new URL("source.json", base)),
      optionalJson<MediaProbeReceipt>(new URL("media-probe.json", base)),
      optionalJson<PreflightBundle>(new URL("preflight.json", base)),
      optionalJson<PreflightBundle>(new URL("preflight-v2.json", base)),
      optionalJson<PreflightBundle>(new URL("preflight-v3.json", base)),
      optionalJson<SpeechActivityReceipt>(new URL("speech-activity.json", base)),
      optionalJson<LanguageRangesReceipt>(new URL("language-ranges.json", base)),
      json<RecordedEvidenceIndex>(new URL("evidence.json", base)),
    ]);
    const pack = await json<LanguagePack>(new URL(`${run.pack}.json`, PACKS));
    if (traceFile.run !== run.id || traceFile.clip !== run.clip.id) {
      throw new Error(`Recorded Studio fixture ${entry.name}: traces file identity does not match run.json`);
    }
    if (!Number.isFinite(traceFile.wall_s) || Math.abs(traceFile.wall_s - run.wall_s) > 0.15) {
      throw new Error(`Recorded Studio fixture ${entry.name}: traces wall_s does not match run.json`);
    }
    const bundle: RunBundle = {
      run,
      captions,
      score,
      wave,
      traces: traceFile.traces,
      glossary,
      corrections,
      pack,
      ingestReceipt,
      mediaProbe,
      preflightBundle: preflightV3 ?? preflightV2 ?? preflightV1,
      speechActivity,
      languageRanges,
      evidence: evidenceIndex,
    };

    assertRunBundle(bundle, `Recorded Studio fixture ${entry.name}`);
    assertPreflightEvidence(bundle, `Recorded Studio fixture ${entry.name} preflight evidence`);
    checkRecordedEvidencePolicies(evidenceIndex, bundle);
    bundles.set(run.id, bundle);

    for (const artifact of evidenceIndex.artifacts) {
      const actual = await contentIdentity(new URL(artifact.path, base));
      if (artifact.content.id !== actual.contentId || artifact.content.bytes !== actual.bytes) {
        throw new Error(
          `Recorded Studio fixture ${entry.name}: evidence artifact ${artifact.artifact_id} does not match its indexed bytes`,
        );
      }
    }

    if (mediaProbe && run.clip.media) {
      const actual = await contentIdentity(new URL(run.clip.media, base));
      if (mediaProbe.input.content_id !== actual.contentId || mediaProbe.input.bytes !== actual.bytes) {
        throw new Error(`Recorded Studio fixture ${entry.name}: media probe input identity does not match the raw media bytes`);
      }
    }
    if (ingestReceipt?.kind === "owned_local") {
      if (ingestReceipt.rights.scope !== "redistribution") {
        throw new Error(`Recorded Studio fixture ${entry.name}: public owned media lacks redistribution scope`);
      }
      const raw = await contentIdentity(new URL(ingestReceipt.raw_media.path, base));
      if (ingestReceipt.content.id !== raw.contentId || ingestReceipt.content.bytes !== raw.bytes) {
        throw new Error(`Recorded Studio fixture ${entry.name}: owned local receipt does not match the raw media bytes`);
      }
      const probeArtifact = ingestReceipt.derived_artifacts[0];
      const derived = await contentIdentity(new URL(probeArtifact.path, base));
      if (probeArtifact.content_hash !== derived.contentId) {
        throw new Error(`Recorded Studio fixture ${entry.name}: derived media probe receipt does not match its artifact bytes`);
      }
    }
    if (preflightV1) {
      assertPreflightEvidence(
        { ...bundle, preflightBundle: preflightV1, speechActivity: null, languageRanges: null },
        `Recorded Studio fixture ${entry.name} preflight V1 evidence`,
      );
      if (preflightV1.schema !== "studio.preflight-bundle.v1") {
        throw new Error(`Recorded Studio fixture ${entry.name}: preflight.json must contain the V1 schema`);
      }
    }
    if (preflightV2) {
      assertPreflightEvidence(
        { ...bundle, preflightBundle: preflightV2, speechActivity, languageRanges: null },
        `Recorded Studio fixture ${entry.name} preflight V2 evidence`,
      );
      if (preflightV2.schema !== "studio.preflight-bundle.v2") {
        throw new Error(`Recorded Studio fixture ${entry.name}: preflight-v2.json must contain the V2 schema`);
      }
    }
    if (preflightV3) {
      assertPreflightEvidence(
        { ...bundle, preflightBundle: preflightV3, speechActivity, languageRanges },
        `Recorded Studio fixture ${entry.name} preflight V3 evidence`,
      );
      if (preflightV3.schema !== "studio.preflight-bundle.v3") {
        throw new Error(`Recorded Studio fixture ${entry.name}: preflight-v3.json must contain the V3 schema`);
      }
      expectPreflightFailure(
        () =>
          assertPreflightEvidence(
            { ...bundle, preflightBundle: preflightV3, languageRanges: null },
            `${entry.name} V3 missing language receipt`,
          ),
        "studio.preflight-bundle.v3 requires its language receipt",
      );
      expectPreflightFailure(
        () =>
          assertPreflightEvidence(
            { ...bundle, preflightBundle: preflightV3, speechActivity: null },
            `${entry.name} V3 missing speech receipt`,
          ),
        "studio.preflight-bundle.v3 requires its speech receipt",
      );
    }
    if (preflightV2 && languageRanges) {
      expectPreflightFailure(
        () =>
          assertPreflightEvidence(
            { ...bundle, preflightBundle: preflightV2 },
            `${entry.name} V2 with language receipt`,
          ),
        "language receipt requires studio.preflight-bundle.v3",
      );
    }
    for (const [indexName, preflightBundle] of [
      ["V1", preflightV1],
      ["V2", preflightV2],
      ["V3", preflightV3],
    ] as const) {
      if (!preflightBundle) continue;
      for (const artifact of preflightBundle.artifacts) {
        const actual = await contentIdentity(new URL(artifact.path, base));
        if (artifact.content.id !== actual.contentId || artifact.content.bytes !== actual.bytes) {
          throw new Error(
            `Recorded Studio fixture ${entry.name}: preflight ${indexName} artifact ${artifact.artifact_id} does not match its indexed bytes`,
          );
        }
      }
    }
    if (speechActivity) {
      const actual = await contentIdentity(new URL(speechActivity.producer.model.path, ROOT));
      const expected = speechActivity.producer.model.content;
      if (expected.id !== actual.contentId || expected.bytes !== actual.bytes) {
        throw new Error(`Recorded Studio fixture ${entry.name}: pinned speech model does not match its receipted bytes`);
      }
    }
    if (languageRanges) {
      for (const file of languageRanges.producer.model.files) {
        const actual = await contentIdentity(new URL(file.path, ROOT));
        if (file.content.id !== actual.contentId || file.content.bytes !== actual.bytes) {
          throw new Error(
            `Recorded Studio fixture ${entry.name}: pinned language model file ${file.role} does not match its receipted bytes`,
          );
        }
      }
    }

    for (let cursor = 0; cursor <= bundle.traces.length; cursor += 1) {
      const projected = projectRun(bundle, cursor);
      if (projected.cursor !== cursor) {
        throw new Error(`${run.id} projection cursor ${projected.cursor} did not match ${cursor}`);
      }
      const shouldBeComplete = cursor === bundle.traces.length;
      if ((projected.status === "complete") !== shouldBeComplete) {
        throw new Error(`${run.id} projection completion did not match cursor ${cursor}`);
      }
    }

    for (const artifact of run.artifacts) await access(new URL(artifact, base));
    if (run.clip.media) await access(new URL(run.clip.media, base));
  }

  for (const scenario of SCENARIOS) {
    const bundle = bundles.get(scenario.runId);
    if (!bundle) throw new Error(`Studio lab scenario ${scenario.id} references missing run ${scenario.runId}`);
    validateScenarioEvidence(bundle, scenario);
  }
  for (const scenario of PREFLIGHT_SCENARIOS) validatePreflightScenario(scenario);
  checkSourceReceiptPolicies();
  checkPreflightBundlePolicies();
  checkSpeechReceiptPolicies();
  checkLanguageReceiptPolicies();
  checkTracePolicies();
  for (const fixture of RUNTIME_CONTRACT_FIXTURES) validateRuntimeContractFixture(fixture);
  checkRuntimeContractPolicies(RUNTIME_CONTRACT_FIXTURES[0]);

  const current = bundles.get("run-006");
  if (!current) throw new Error("Studio lab checkpoints require run-006");
  checkBundlePolicies(current);
  const preflight = recordedPreflight(current);
  if (preflight.status !== "ready" || !preflight.facts) {
    throw new Error("run-006 must retain its producer-backed ingest receipt");
  }
  if (!preflight.facts.mediaProbe) {
    throw new Error("run-006 must retain its producer-backed media probe receipt");
  }
  if (!assessRecordedRequest(preflight, current, false).canReplay) {
    throw new Error("run-006 recorded selection must remain replayable after preflight");
  }
  const changedRange = {
    ...preflight,
    request: { ...preflight.request, rangeMode: "custom" as const, end: preflight.request.end - 1 },
  };
  if (assessRecordedRequest(changedRange, current, false).canReplay) {
    throw new Error("preflight must not claim a recorded artifact for an unrecorded custom range");
  }
  if (classifySourceUrl("https://www.youtube.com/watch?v=fixture").kind !== "supported") {
    throw new Error("the YouTube producer URL adapter is not registered");
  }
  if (classifySourceUrl("https://example.com/media").kind !== "unsupported") {
    throw new Error("an unregistered source provider was accepted");
  }
  const owned = bundles.get("run-005");
  if (!owned) throw new Error("owned local adapter checks require run-005");
  expectPreflightFailure(
    () =>
      assertPreflightEvidence(
        { ...owned, preflightBundle: null, languageRanges: null },
        "run-005 unpaired speech receipt",
      ),
    "speech receipt requires studio.preflight-bundle.v2 or v3",
  );
  if (owned.preflightBundle?.schema !== "studio.preflight-bundle.v3") {
    throw new Error("run-005 must expose its sealed V3 speech and language preflight index");
  }
  expectPreflightFailure(
    () => assertPreflightEvidence({ ...owned, speechActivity: null }, "run-005 V3 without speech receipt"),
    "studio.preflight-bundle.v3 requires its speech receipt",
  );
  expectPreflightFailure(
    () => assertPreflightEvidence({ ...owned, languageRanges: null }, "run-005 unpaired preflight V3"),
    "studio.preflight-bundle.v3 requires its language receipt",
  );
  const ownedPreflight = recordedPreflight(owned);
  if (
    ownedPreflight.status !== "ready" ||
    ownedPreflight.facts?.rights.basis !== "ownership_attestation" ||
    !ownedPreflight.facts.content?.id.startsWith("sha256:") ||
    ownedPreflight.facts.creator !== null
  ) {
    throw new Error("run-005 must retain its content-addressed owned/local receipt without inferring a creator");
  }
  if (
    !ownedPreflight.facts.speechActivity ||
    ownedPreflight.missing.some((gap) => gap.id === "speech") ||
    !ownedPreflight.facts.languageRanges ||
    ownedPreflight.missing.some((gap) => gap.id === "language")
  ) {
    throw new Error("run-005 must expose validated speech and language ranges");
  }
  const ownedLanguageRanges = owned.languageRanges;
  if (
    !ownedLanguageRanges ||
    ownedPreflight.facts.languageRanges.ranges.length !== ownedLanguageRanges.ranges.length ||
    ownedPreflight.facts.declaredLanguage !== owned.run.clip.lang ||
    !["acoustic", "overlap", "complexity"].every((id) =>
      ownedPreflight.missing.some((gap) => gap.id === id),
    )
  ) {
    throw new Error("run-005 language projection must preserve every range and leave unrelated detector gaps withheld");
  }
  if (
    !ownedPreflight.facts.languageRanges.ranges.every((projected, index) => {
      const receipted = ownedLanguageRanges.ranges[index];
      return (
        receipted !== undefined &&
        projected.speechWindowIndex === receipted.speech_window_index &&
        projected.chunkIndex === receipted.chunk_index &&
        projected.startSample === receipted.start_sample &&
        projected.endSample === receipted.end_sample &&
        projected.startSeconds === receipted.start_sample / ownedLanguageRanges.input.sample_rate_hz &&
        projected.endSeconds === receipted.end_sample / ownedLanguageRanges.input.sample_rate_hz &&
        JSON.stringify(projected.scores) === JSON.stringify(receipted.scores) &&
        JSON.stringify(projected.decision) === JSON.stringify(receipted.decision)
      );
    })
  ) {
    throw new Error("run-005 language projection must preserve exact range order, model scores, and decisions");
  }
  const languageDecisionCounts = ownedPreflight.facts.languageRanges.ranges.reduce(
    (counts, range) => ({ ...counts, [range.decision.status]: counts[range.decision.status] + 1 }),
    { classified: 0, unknown: 0, withheld: 0 },
  );
  if (
    languageDecisionCounts.classified !== 10 ||
    languageDecisionCounts.unknown !== 4 ||
    languageDecisionCounts.withheld !== 7
  ) {
    throw new Error("run-005 must preserve 10 classified, 4 unknown, and 7 withheld language decisions");
  }
  const detectedRange = {
    ...ownedPreflight,
    request: { ...ownedPreflight.request, rangeMode: "detected" as const },
  };
  if (
    assessRecordedRequest(detectedRange, owned, false).canReplay ||
    !assessRecordedRequest(detectedRange, owned, false).reason?.includes("no replayable detected-language subrange")
  ) {
    throw new Error("measured language ranges must not become a replayable recorded-runtime subrange");
  }
  if (ownedPreflight.relevance.music || ownedPreflight.relevance.backgroundSpeech || ownedPreflight.relevance.speakerFocus) {
    throw new Error("owned/local source facts must not infer acoustic or speaker relevance");
  }
  for (const checkpoint of deriveCheckpoints(current)) {
    if (checkpoint.phase !== "Ready" && checkpoint.cursor === null) {
      throw new Error(`Studio lab could not derive the ${checkpoint.phase} checkpoint from run-006`);
    }
  }
}
