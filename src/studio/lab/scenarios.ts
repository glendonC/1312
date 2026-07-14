import type { RunBundle } from "../transport";

export type ScenarioEvidence =
  | "recorded"
  | "uncorroborated"
  | "withheld"
  | "regression"
  | "unscored"
  | "provisional_measured";

export interface LabScenario {
  id: string;
  label: string;
  runId: string;
  evidence: ScenarioEvidence;
  anchor:
    | { kind: "start" }
    | { kind: "end" }
    | { kind: "trace"; agent: string; action: string; target: string };
  note: string;
}

/** Exact anchors into artifacts already recorded on disk. No scenario stores a snapshot. */
export const SCENARIOS: readonly LabScenario[] = [
  {
    id: "current-run",
    label: "Run 006 · start",
    runId: "run-006",
    evidence: "recorded",
    anchor: { kind: "start" },
    note: "The current real Creative Commons run, before any trace has been folded.",
  },
  {
    id: "uncorroborated",
    label: "Run 006 · uncorroborated",
    runId: "run-006",
    evidence: "uncorroborated",
    anchor: { kind: "trace", agent: "qc-01", action: "gate", target: "c02" },
    note: "The second recogniser timed no words in this window. That absence remains null, not zero.",
  },
  {
    id: "withheld",
    label: "Run 006 · withheld",
    runId: "run-006",
    evidence: "withheld",
    anchor: { kind: "trace", agent: "qc-01", action: "gate", target: "c11" },
    note: "Two recognisers disagreed and the recorded gate withheld the cue.",
  },
  {
    id: "unscored-complete",
    label: "Run 006 · unscored done",
    runId: "run-006",
    evidence: "unscored",
    anchor: { kind: "end" },
    note: "The completed real run has behavior measurements but no gold and no accuracy score.",
  },
  {
    id: "regression",
    label: "Run 005 · regression",
    runId: "run-005",
    evidence: "regression",
    anchor: { kind: "trace", agent: "qc-01", action: "pass", target: "c14" },
    note: "A synthetic recorded fixture where an overlap attribution regressed and remained visible.",
  },
  {
    id: "provisional-measured-complete",
    label: "Run 005 · provisional measured done",
    runId: "run-005",
    evidence: "provisional_measured",
    anchor: { kind: "end" },
    note:
      "Completed synthetic development fixture with a provisional measured score. The Hard-KO gold pack is not frozen, so this is not a gold benchmark result.",
  },
] as const;

export function resolveScenarioCursor(bundle: RunBundle, scenario: LabScenario): number {
  if (bundle.run.id !== scenario.runId) {
    throw new Error(`Scenario ${scenario.id} requires ${scenario.runId}, received ${bundle.run.id}`);
  }
  if (scenario.anchor.kind === "start") return 0;
  if (scenario.anchor.kind === "end") return bundle.traces.length;
  const anchor = scenario.anchor;

  const matches = bundle.traces
    .map((trace, index) => ({ trace, index }))
    .filter(
      ({ trace }) =>
        trace.agent === anchor.agent &&
        trace.action === anchor.action &&
        trace.target === anchor.target,
    );
  if (matches.length !== 1) {
    throw new Error(`Scenario ${scenario.id} anchor matched ${matches.length} traces; expected exactly one`);
  }
  return matches[0].index + 1;
}

export function validateScenarioEvidence(bundle: RunBundle, scenario: LabScenario): void {
  resolveScenarioCursor(bundle, scenario);
  if (scenario.evidence === "recorded") return;
  if (scenario.evidence === "unscored") {
    if (bundle.score.status !== "unscored") throw new Error(`Scenario ${scenario.id} is not unscored`);
    return;
  }
  if (scenario.evidence === "provisional_measured") {
    const measured = bundle.score.paths[bundle.run.id];
    if (
      bundle.score.status !== "provisional" ||
      !measured ||
      !Number.isFinite(measured.points) ||
      !Number.isFinite(measured.hard_line)
    ) {
      throw new Error(`Scenario ${scenario.id} is not a provisional measured completion`);
    }
    if (!bundle.score.rubric.note.toLowerCase().includes("gold is not frozen")) {
      throw new Error(`Scenario ${scenario.id} does not preserve the unfrozen-gold disclaimer`);
    }
    return;
  }

  const target = scenario.anchor.kind === "trace" ? scenario.anchor.target : null;
  const cue = bundle.captions.cues.find((candidate) => candidate.id === target);
  if (!cue) throw new Error(`Scenario ${scenario.id} references missing cue ${target ?? "(none)"}`);

  if (scenario.evidence === "uncorroborated" && cue.corroboration?.agreement !== null) {
    throw new Error(`Scenario ${scenario.id} cue must have null corroboration agreement`);
  }
  if (scenario.evidence === "withheld" && !cue.targets.some((line) => line.withheld)) {
    throw new Error(`Scenario ${scenario.id} cue is not withheld`);
  }
  if (scenario.evidence === "regression" && !cue.regression) {
    throw new Error(`Scenario ${scenario.id} cue has no recorded regression`);
  }
}
