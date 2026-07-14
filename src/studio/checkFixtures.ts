import { access, readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";

import { assertRunBundle } from "./bundle";
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
import { SCENARIOS, validateScenarioEvidence } from "./lab/scenarios";
import { projectRun } from "./replayProjection";
import { assessRecordedRequest, recordedPreflight } from "./preflight/model";
import { classifySourceUrl } from "./preflight/sourceAdapters";

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

/** Executed from the Studio route during Astro's production build. */
export async function checkRecordedRuns(): Promise<void> {
  const entries = (await readdir(RUNS, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name));

  if (entries.length === 0) throw new Error("Studio fixture check found no recorded runs");

  const bundles = new Map<string, RunBundle>();
  for (const entry of entries) {
    const base = new URL(`${entry.name}/`, RUNS);
    const [run, captions, score, wave, traceFile, glossary, corrections, ingestReceipt, mediaProbe] = await Promise.all([
      json<RunManifest>(new URL("run.json", base)),
      json<CaptionsFile>(new URL("captions.json", base)),
      json<ScoreFile>(new URL("score.json", base)),
      json<WaveFile>(new URL("waveform.json", base)),
      json<TracesFile>(new URL("traces.json", base)),
      json<GlossaryFile>(new URL("glossary.json", base)),
      json<CorrectionsFile>(new URL("corrections.json", base)),
      optionalJson<IngestReceipt>(new URL("source.json", base)),
      optionalJson<MediaProbeReceipt>(new URL("media-probe.json", base)),
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
    };

    assertRunBundle(bundle, `Recorded Studio fixture ${entry.name}`);
    bundles.set(run.id, bundle);

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

  const current = bundles.get("run-006");
  if (!current) throw new Error("Studio lab checkpoints require run-006");
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
  for (const checkpoint of deriveCheckpoints(current)) {
    if (checkpoint.phase !== "Ready" && checkpoint.cursor === null) {
      throw new Error(`Studio lab could not derive the ${checkpoint.phase} checkpoint from run-006`);
    }
  }
}
