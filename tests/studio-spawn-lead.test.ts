import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { spawnLeadOf } from "../src/studio/spawnLead.ts";
import type { RunManifest, Trace } from "../src/studio/types.ts";

/** The real recorded run, loaded from disk exactly as the transport would fetch it. */
function loadRun006(): { run: RunManifest; traces: Trace[] } {
  const base = resolve("public/demo/runs/run-006");
  const run = JSON.parse(readFileSync(resolve(base, "run.json"), "utf8")) as RunManifest;
  const traces = (
    JSON.parse(readFileSync(resolve(base, "traces.json"), "utf8")) as { traces: Trace[] }
  ).traces;
  return { run, traces };
}

test("every recorded run-006 spawn is projected as instantaneous — no fabricated lead time", () => {
  const { run, traces } = loadRun006();
  for (const agent of run.agents) {
    const lead = spawnLeadOf(agent.id, run, traces);
    assert.equal(
      lead.kind,
      "instant",
      `${agent.id} spawns in a single recorded frame, so its lead must read as instant, not ${lead.kind}`,
    );
  }
});

test("the mitosis child reports the divider that announced it, at the recorded instant", () => {
  const { run, traces } = loadRun006();
  const lead = spawnLeadOf("translate-02", run, traces);
  assert.equal(lead.kind, "instant");
  if (lead.kind !== "instant") return;
  // translate-01 emits the `divide` effect that sets translate-02 spawning at t=47.4.
  assert.equal(lead.announcedBy, "translate-01");
  assert.equal(lead.atS, 47.4);
});

test("an orchestrator-announced worker names the orchestrator as its announcer", () => {
  const { run, traces } = loadRun006();
  const lead = spawnLeadOf("segment-01", run, traces);
  assert.equal(lead.kind, "instant");
  if (lead.kind !== "instant") return;
  assert.equal(lead.announcedBy, "orchestrator");
  assert.equal(lead.atS, 0.01);
});

test("a child never seen in the stream is unavailable, not guessed", () => {
  const { run, traces } = loadRun006();
  const lead = spawnLeadOf("ghost-99", run, traces);
  assert.equal(lead.kind, "unavailable");
});

test("a real recorded gap between announcement and first work reads as an intent window", () => {
  // This is the shape the runtime lane would emit (docs/local/HANDOFF_spawn_intent.md): the parent
  // announces the child, then real recorded time passes before the child begins working.
  const run = { agents: [] } as unknown as RunManifest;
  const traces: Trace[] = [
    {
      t: 12.0,
      agent: "translate-01",
      action: "divide",
      target: "translate-02",
      detail: "intends to divide the window",
      level: "info",
      effects: [{ type: "agent", id: "translate-02", status: "spawning" }],
    },
    {
      t: 15.5,
      agent: "translate-02",
      action: "open",
      target: "clip",
      detail: "begins its window",
      level: "info",
      effects: [{ type: "agent", id: "translate-02", status: "working" }],
    },
  ];

  const lead = spawnLeadOf("translate-02", run, traces);
  assert.equal(lead.kind, "intent");
  if (lead.kind !== "intent") return;
  assert.equal(lead.announcedBy, "translate-01");
  assert.equal(lead.announcedAtS, 12.0);
  assert.equal(lead.readyAtS, 15.5);
  assert.ok(Math.abs(lead.leadS - 3.5) < 1e-9, "lead time is the recorded distance, not invented");
});

test("a sub-frame gap is still instant — noise is not promoted to an intent window", () => {
  const run = { agents: [] } as unknown as RunManifest;
  const traces: Trace[] = [
    {
      t: 12.0,
      agent: "orchestrator",
      action: "spawn",
      target: "qc-01",
      detail: "",
      level: "info",
      effects: [{ type: "agent", id: "qc-01", status: "spawning" }],
    },
    {
      t: 12.01,
      agent: "qc-01",
      action: "open",
      target: "clip",
      detail: "",
      level: "info",
      effects: [{ type: "agent", id: "qc-01", status: "working" }],
    },
  ];
  assert.equal(spawnLeadOf("qc-01", run, traces).kind, "instant");
});
