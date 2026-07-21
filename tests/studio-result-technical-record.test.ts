import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { projectTechnicalRecord } from "../src/studio/resultTechnicalRecord.ts";
import type { RunBundle } from "../src/studio/transport.ts";

const RUN_DIR = new URL("../public/demo/runs/run-006/", import.meta.url);

function readJson<T>(url: URL): T {
  return JSON.parse(readFileSync(url, "utf8")) as T;
}

/** The recorded run-006 bundle, read from the exact artifacts the Studio transport serves. */
function recordedBundle(): RunBundle {
  const bundle = {
    run: readJson(new URL("run.json", RUN_DIR)),
    captions: readJson(new URL("captions.json", RUN_DIR)),
    score: readJson(new URL("score.json", RUN_DIR)),
    pack: readJson(new URL("../../packs/ko-v3.json", RUN_DIR)),
    wave: readJson(new URL("waveform.json", RUN_DIR)),
    traces: readJson<{ traces: unknown[] }>(new URL("traces.json", RUN_DIR)).traces,
    glossary: readJson(new URL("glossary.json", RUN_DIR)),
    corrections: readJson(new URL("corrections.json", RUN_DIR)),
    ingestReceipt: readJson(new URL("source.json", RUN_DIR)),
    mediaProbe: readJson(new URL("media-probe.json", RUN_DIR)),
  };
  return bundle as unknown as RunBundle;
}

test("the technical record is bound to run-006's recorded artifacts", () => {
  const bundle = recordedBundle();
  const record = projectTechnicalRecord(bundle);

  assert.equal(record.wallS, bundle.run.wall_s);
  assert.equal(record.wallS, 111.98);
  assert.equal(record.recordedWorkers, bundle.run.agents.length);
  assert.equal(record.recordedWorkers, 5);

  assert.deepEqual(record.gates, { names: ["address", "asr_agreement"], checks: 13, failed: 5 });

  assert.deepEqual(record.corroboration, {
    checkers: ["whisper-1"],
    measured: 8,
    unmeasurable: 3,
    unchecked: 0,
  });

  // The corroboration accounting must partition exactly the lines the coverage accounting calls
  // captioned: a target with text that no gate withheld. Recounted here from the captions
  // artifact itself so the two projections cannot drift apart.
  let captioned = 0;
  for (const cue of bundle.captions.cues) {
    if (cue.silence) continue;
    const target = cue.targets.find((candidate) => candidate.lang === bundle.run.pair.target);
    if (target?.withheld) continue;
    if (target?.text) captioned += 1;
  }
  const { measured, unmeasurable, unchecked } = record.corroboration;
  assert.equal(measured + unmeasurable + unchecked, captioned);
  assert.equal(captioned, 11);

  assert.ok(record.media);
  assert.equal(record.media.contentId, bundle.mediaProbe?.input.content_id);
  assert.match(record.media.contentId, /^sha256:[0-9a-f]{64}$/);
  assert.equal(record.media.bytes, 3465772);
  assert.equal(record.media.durationS, 40.04);
  assert.equal(record.media.tracks.length, 2);

  assert.deepEqual(record.sourceWindow, {
    kind: "provider_timestamps",
    start: "00:05:10",
    end: "00:05:50",
  });

  // run-006 has no gold: the proof state must stay honestly unscored while the two latencies,
  // which are measurements of what the run did, pass through.
  assert.equal(record.proof.status, "unscored");
  assert.equal(record.proof.deltaVsCold, null);
  assert.equal(record.proof.timeToUsableS, 55.86);
  assert.equal(record.proof.timeToCompleteS, 111.98);

  assert.deepEqual(record.conveyor, {
    pack: "ko-v3",
    glossaryTerms: 7,
    glossaryDisposition: "promoted",
    correctionRows: 5,
  });
});

test("absent receipts project as null, never as invented facts", () => {
  const bundle = recordedBundle();
  bundle.ingestReceipt = null;
  bundle.mediaProbe = null;
  const record = projectTechnicalRecord(bundle);

  assert.equal(record.media, null);
  assert.equal(record.sourceWindow, null);
});

test("a score file without this run's path leaves both latencies null", () => {
  const bundle = recordedBundle();
  bundle.score = { ...bundle.score, paths: {} };
  const record = projectTechnicalRecord(bundle);

  assert.equal(record.proof.timeToUsableS, null);
  assert.equal(record.proof.timeToCompleteS, null);
});

test("a recorded delta passes through unchanged", () => {
  const bundle = recordedBundle();
  bundle.score = { ...bundle.score, status: "scored", delta_vs_cold: 1.5 };
  const record = projectTechnicalRecord(bundle);

  assert.equal(record.proof.status, "scored");
  assert.equal(record.proof.deltaVsCold, 1.5);
});

test("glossary disposition follows the artifact's own routing fields", () => {
  const base = recordedBundle();
  assert.equal(projectTechnicalRecord(base).conveyor.glossaryDisposition, "promoted");

  const pending = recordedBundle();
  pending.glossary = {
    ...pending.glossary,
    promoted_to: null,
    promotion: {
      status: "pending_review",
      proposal_kind: "glossary",
      proposal_manifest: "memory/proposals/example.json",
      note: "test",
    },
  };
  assert.equal(projectTechnicalRecord(pending).conveyor.glossaryDisposition, "pending_review");

  const benchOnly = recordedBundle();
  benchOnly.glossary = {
    ...benchOnly.glossary,
    promoted_to: null,
    routing: { status: "bench_only", pack_id: "ko-v3", note: "test" },
  };
  assert.equal(projectTechnicalRecord(benchOnly).conveyor.glossaryDisposition, "bench_only");

  const runScoped = recordedBundle();
  runScoped.glossary = { ...runScoped.glossary, promoted_to: null };
  assert.equal(projectTechnicalRecord(runScoped).conveyor.glossaryDisposition, "run_scoped");
});

test("withheld and silent lines never enter the corroboration accounting", () => {
  const bundle = recordedBundle();
  bundle.captions = {
    ...bundle.captions,
    cues: [
      {
        id: "c1",
        t_start: 0,
        t_end: 1,
        speakers: ["s1"],
        source: { lang: "ko", text: "가" },
        targets: [
          {
            lang: "en",
            text: null,
            withheld: { gate: "asr_agreement", reason: "test" },
          },
        ],
        corroboration: { agreement: 0.2, by: "whisper-1", heard: "가" },
        owner: "w1",
      },
      {
        id: "c2",
        t_start: 1,
        t_end: 2,
        speakers: [],
        source: { lang: "ko", text: null },
        targets: [],
        silence: true,
        owner: "w1",
      },
      {
        id: "c3",
        t_start: 2,
        t_end: 3,
        speakers: ["s1"],
        source: { lang: "ko", text: "나" },
        targets: [{ lang: "en", text: "me" }],
        owner: "w1",
      },
    ],
  };

  assert.deepEqual(projectTechnicalRecord(bundle).corroboration, {
    checkers: [],
    measured: 0,
    unmeasurable: 0,
    unchecked: 1,
  });
});
