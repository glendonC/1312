import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import {
  activityCounter,
  activityFacets,
  parseDetail,
  projectActivityEntry,
} from "../src/studio/focus/activityProjection.ts";
import type { Trace } from "../src/studio/types.ts";

/** The real recorded run, loaded from disk exactly as the transport would fetch it. */
function loadTraces(): Trace[] {
  const base = resolve("public/demo/runs/run-006");
  return (
    JSON.parse(readFileSync(resolve(base, "traces.json"), "utf8")) as { traces: Trace[] }
  ).traces;
}

const find = (traces: Trace[], predicate: (t: Trace) => boolean): Trace => {
  const hit = traces.find(predicate);
  assert.ok(hit, "expected a matching recorded trace");
  return hit;
};

test("a draft trace lifts its recorded source/target and cross-recogniser agreement", () => {
  const traces = loadTraces();
  const draftTrace = find(traces, (t) => Boolean(t.view?.draft));
  const facets = activityFacets(draftTrace);
  const draft = facets.find((f) => f.kind === "draft");
  assert.ok(draft && draft.kind === "draft");
  assert.equal(draft.source, draftTrace.view!.draft!.source);
  assert.equal(draft.target, draftTrace.view!.draft!.target);
  assert.equal(draft.agreement, draftTrace.view!.draft!.conf);
});

test("an unmeasurable agreement is preserved as null, never coerced to zero", () => {
  const traces = loadTraces();
  // A null conf is an ABSENCE of comparison; zero would falsely claim the recognisers disagreed.
  const nullConf = traces.find((t) => t.view?.draft && t.view.draft.conf === null);
  if (nullConf) {
    const draft = activityFacets(nullConf).find((f) => f.kind === "draft");
    assert.ok(draft && draft.kind === "draft");
    assert.equal(draft.agreement, null);
  }
});

test("a withheld QC gate lifts its measured value, limit, and failed flag", () => {
  const traces = loadTraces();
  const failing = find(traces, (t) => t.view?.gate?.fail === true);
  const gate = activityFacets(failing).find((f) => f.kind === "gate");
  assert.ok(gate && gate.kind === "gate");
  assert.equal(gate.value, failing.view!.gate!.value);
  assert.equal(gate.limit, failing.view!.gate!.limit);
  assert.equal(gate.failed, true);
});

test("a clean gate reports failed=false even though the recorded fail flag is absent", () => {
  const traces = loadTraces();
  const clean = find(traces, (t) => Boolean(t.view?.gate) && t.view?.gate?.fail !== true);
  const gate = activityFacets(clean).find((f) => f.kind === "gate");
  assert.ok(gate && gate.kind === "gate");
  assert.equal(gate.failed, false);
});

test("a resolved term lifts its gloss, and a stamp lifts its exact verdict kind", () => {
  const traces = loadTraces();
  const glossTrace = find(traces, (t) => Boolean(t.view?.gloss));
  const gloss = activityFacets(glossTrace).find((f) => f.kind === "gloss");
  assert.ok(gloss && gloss.kind === "gloss");
  assert.equal(gloss.term, glossTrace.view!.gloss!.term);

  const stampTrace = find(traces, (t) => Boolean(t.view?.stamp));
  const stamp = activityFacets(stampTrace).find((f) => f.kind === "stamp");
  assert.ok(stamp && stamp.kind === "stamp");
  assert.equal(stamp.verdict, stampTrace.view!.stamp!.kind);
});

test("a plain trace with no view invents no facets", () => {
  const plain: Trace = {
    t: 1,
    agent: "orchestrator",
    action: "open",
    target: "workspace",
    detail: "8 gates armed",
    level: "info",
  };
  assert.deepEqual(activityFacets(plain), []);
  const entry = projectActivityEntry(plain);
  assert.equal(entry.facets.length, 0);
  assert.equal(entry.clipT, null);
  assert.deepEqual(entry.detail, { chips: ["8 gates armed"], lines: [] });
});

test("a middot detail is split into scannable chips and prose lines, never a middot string", () => {
  // Pure metadata: every part is short → all chips, no separators reprinted.
  assert.deepEqual(
    parseDetail("40s · Creative Commons · 16k mono · 1250 KB · 420 peaks", []),
    { chips: ["40s", "Creative Commons", "16k mono", "1250 KB", "420 peaks"], lines: [] },
  );
  // A sentence-like slice becomes prose, short ones stay chips.
  const mixed = parseDetail('agreement 1.00 · whisper-1 heard "분들이 몇 분 계신데"', []);
  assert.deepEqual(mixed.chips, ["agreement 1.00"]);
  assert.equal(mixed.lines.length, 1);
  assert.match(mixed.lines[0], /whisper-1 heard/);
  assert.equal(parseDetail(null, []).chips.length, 0);
});

test("a chip that restates a typed facet is dropped so the two layers do not echo", () => {
  const draftFacet = activityFacets({
    t: 1, agent: "translate-01", action: "draft", target: "c01", detail: "", level: "warn",
    view: { draft: { source: "네", target: "Yeah.", conf: 0.82 } },
  });
  // With a draft facet present, the "asr_agreement 0.82" chip is redundant and removed; the
  // reasoning prose and the model chip remain.
  const detail = parseDetail("gpt-5 · asr_agreement 0.82 · Rendered it naturally.", draftFacet);
  assert.ok(!detail.chips.some((chip) => /agreement/i.test(chip)), "agreement chip should be dropped");
  assert.ok(detail.chips.includes("gpt-5"));
  assert.ok(detail.lines.some((line) => /Rendered it naturally/.test(line)));
});

test("clipT prefers an explicit playhead over clip_t", () => {
  const withPlayhead: Trace = {
    t: 1,
    agent: "segment-01",
    action: "return",
    target: "",
    detail: "",
    level: "info",
    clip_t: 5,
    view: { playhead: 12 },
  };
  assert.equal(projectActivityEntry(withPlayhead).clipT, 12);
  const clipOnly: Trace = { ...withPlayhead, view: undefined };
  assert.equal(projectActivityEntry(clipOnly).clipT, 5);
});

test("the counter sums real recorded times and event counts, and abstains on an empty log", () => {
  const traces = loadTraces();
  const qc = traces.filter((t) => t.agent === "qc-01");
  const counter = activityCounter(qc);
  assert.ok(counter);
  assert.equal(counter.events, qc.length);
  assert.equal(counter.firstT, Math.min(...qc.map((t) => t.t)));
  assert.equal(counter.lastT, Math.max(...qc.map((t) => t.t)));
  assert.equal(counter.spanS, counter.lastT - counter.firstT);
  assert.ok(counter.spanS >= 0);

  assert.equal(activityCounter([]), null);
});
