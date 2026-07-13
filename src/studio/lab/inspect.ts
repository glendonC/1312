import { projectRun } from "../replayProjection";
import type { RunState } from "../replay";
import type { RunBundle } from "../transport";

function changedCues(before: RunState, after: RunState) {
  return Object.keys(after.cues)
    .filter((id) => before.cues[id] !== after.cues[id])
    .map((id) => ({ id, from: before.cues[id] ?? null, to: after.cues[id] }));
}

function changedAgents(before: RunState, after: RunState) {
  return Object.keys(after.agents)
    .filter((id) => JSON.stringify(before.agents[id] ?? null) !== JSON.stringify(after.agents[id]))
    .map((id) => ({
      id,
      from: before.agents[id]?.status ?? null,
      to: after.agents[id]?.status ?? null,
      actions: after.agents[id]?.actions ?? 0,
    }));
}

export function inspectCursor(bundle: RunBundle, cursor: number) {
  if (cursor <= 0) {
    return {
      trace: null,
      agent: null,
      task: "Not recorded in the current contract.",
      media: null,
      projectionEffect: null,
      staticSupport: null,
    };
  }

  const trace = bundle.traces[Math.min(cursor, bundle.traces.length) - 1];
  const before = projectRun(bundle, cursor - 1);
  const after = projectRun(bundle, cursor);
  const cue =
    bundle.captions.cues.find((candidate) => candidate.id === trace.target) ??
    bundle.captions.cues.find(
      (candidate) => trace.clip_t !== undefined && trace.clip_t >= candidate.t_start && trace.clip_t < candidate.t_end,
    ) ??
    null;
  const agent =
    trace.agent === "orchestrator"
      ? { id: "orchestrator", role: "orchestrator", parent: null }
      : (bundle.run.agents.find((candidate) => candidate.id === trace.agent) ?? null);
  const gate = trace.view?.gate
    ? bundle.pack.gates.find((candidate) => candidate.label === trace.view?.gate?.name) ?? null
    : null;
  const glossary = bundle.glossary.entries.filter(
    (entry) => entry.term === trace.target || trace.detail.includes(entry.term),
  );
  const correction = cue
    ? bundle.corrections.rows.find(
        (row) => Math.abs(row.t_start - cue.t_start) < 0.01 && Math.abs(row.t_end - cue.t_end) < 0.01,
      ) ?? null
    : null;
  const artifact = bundle.run.artifacts.find(
    (candidate) => trace.target === candidate || trace.target.endsWith(`/${candidate}`) || trace.detail.includes(candidate),
  );

  return {
    trace,
    agent,
    task: "Not recorded in the current contract.",
    media: {
      traceTime: trace.t,
      clipTime: trace.clip_t ?? trace.view?.playhead ?? null,
      cue: cue ? { id: cue.id, range: [cue.t_start, cue.t_end], speakers: cue.speakers } : null,
    },
    projectionEffect: {
      status: before.status === after.status ? null : { from: before.status, to: after.status },
      orchestrator:
        JSON.stringify(before.orchestrator) === JSON.stringify(after.orchestrator) ? null : after.orchestrator,
      agents: changedAgents(before, after),
      cues: changedCues(before, after),
      score: {
        hardLine: before.hardLine === after.hardLine ? null : { from: before.hardLine, to: after.hardLine },
        coverage: before.coverage === after.coverage ? null : { from: before.coverage, to: after.coverage },
        fabrications:
          before.fabrications === after.fabrications
            ? null
            : { from: before.fabrications, to: after.fabrications },
      },
    },
    staticSupport: {
      cue,
      gate,
      glossary,
      correction,
      artifact: artifact ?? null,
      score: trace.action === "score" ? bundle.score : null,
      source: bundle.run.clip.source,
      media: bundle.run.clip.media,
    },
  };
}
