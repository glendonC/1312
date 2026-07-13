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
  RunManifest,
  ScoreFile,
  TracesFile,
  WaveFile,
} from "./types";

const RUNS = pathToFileURL(`${resolve(process.cwd(), "public/demo/runs")}/`);
const PACKS = pathToFileURL(`${resolve(process.cwd(), "public/demo/packs")}/`);

async function json<T>(url: URL): Promise<T> {
  try {
    return JSON.parse(await readFile(url, "utf8")) as T;
  } catch (error) {
    throw new Error(`Studio fixture ${fileURLToPath(url)} could not be read`, { cause: error });
  }
}

/** Executed from the Studio route during Astro's production build. */
export async function checkRecordedRuns(): Promise<void> {
  const entries = (await readdir(RUNS, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name));

  if (entries.length === 0) throw new Error("Studio fixture check found no recorded runs");

  for (const entry of entries) {
    const base = new URL(`${entry.name}/`, RUNS);
    const [run, captions, score, wave, traceFile, glossary, corrections] = await Promise.all([
      json<RunManifest>(new URL("run.json", base)),
      json<CaptionsFile>(new URL("captions.json", base)),
      json<ScoreFile>(new URL("score.json", base)),
      json<WaveFile>(new URL("waveform.json", base)),
      json<TracesFile>(new URL("traces.json", base)),
      json<GlossaryFile>(new URL("glossary.json", base)),
      json<CorrectionsFile>(new URL("corrections.json", base)),
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
    };

    assertRunBundle(bundle, `Recorded Studio fixture ${entry.name}`);

    for (const artifact of run.artifacts) await access(new URL(artifact, base));
    if (run.clip.media) await access(new URL(run.clip.media, base));
  }
}
