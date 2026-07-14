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
import { classifySourceUrl, preflightSourceBinding } from "./preflight/sourceAdapters";
import { checkSourceReceiptPolicies } from "./preflight/checkReceiptPolicies";
import { checkPreflightBundlePolicies } from "./preflight/checkPreflightBundlePolicies";
import type { PreflightBundle } from "./preflight/contracts";
import { assertPreflightBundle } from "./preflight/preflightBundleValidation";
import { checkRuntimeContractPolicies } from "./runtime/checkContractPolicies";
import { validateRuntimeContractFixture } from "./runtime/validateContractFixture";
import { checkTracePolicies } from "./checkTracePolicies";

const RUNS = pathToFileURL(`${resolve(process.cwd(), "public/demo/runs")}/`);
const PACKS = pathToFileURL(`${resolve(process.cwd(), "public/demo/packs")}/`);

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

/** Executed from the Studio route during Astro's production build. */
export async function checkRecordedRuns(): Promise<void> {
  const entries = (await readdir(RUNS, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name));

  if (entries.length === 0) throw new Error("Studio fixture check found no recorded runs");

  const bundles = new Map<string, RunBundle>();
  for (const entry of entries) {
    const base = new URL(`${entry.name}/`, RUNS);
    const [run, captions, score, wave, traceFile, glossary, corrections, ingestReceipt, mediaProbe, preflightBundle, evidenceIndex] = await Promise.all([
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
      evidence: evidenceIndex,
    };

    assertRunBundle(bundle, `Recorded Studio fixture ${entry.name}`);
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
    if (preflightBundle) {
      const binding = preflightSourceBinding(ingestReceipt);
      if (!binding) {
        throw new Error(`Recorded Studio fixture ${entry.name}: preflight index has no content-addressed source adapter`);
      }
      assertPreflightBundle(preflightBundle, binding, `Recorded Studio fixture ${entry.name} preflight index`);
      for (const artifact of preflightBundle.artifacts) {
        const actual = await contentIdentity(new URL(artifact.path, base));
        if (artifact.content.id !== actual.contentId || artifact.content.bytes !== actual.bytes) {
          throw new Error(
            `Recorded Studio fixture ${entry.name}: preflight artifact ${artifact.artifact_id} does not match its indexed bytes`,
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
  const ownedPreflight = recordedPreflight(owned);
  if (
    ownedPreflight.status !== "ready" ||
    ownedPreflight.facts?.rights.basis !== "ownership_attestation" ||
    !ownedPreflight.facts.content?.id.startsWith("sha256:") ||
    ownedPreflight.facts.creator !== null
  ) {
    throw new Error("run-005 must retain its content-addressed owned/local receipt without inferring a creator");
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
