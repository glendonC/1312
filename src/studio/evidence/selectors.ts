import type { RecordedCueDecisionState, RecordedEvidenceIndex } from "./types";

export function selectEvidenceArtifact(index: RecordedEvidenceIndex, artifactId: string) {
  return index.artifacts.find((artifact) => artifact.artifact_id === artifactId) ?? null;
}

export function selectCueDecision(index: RecordedEvidenceIndex, cueId: string) {
  return index.cue_decisions.find((decision) => decision.cue_id === cueId) ?? null;
}

export function summarizeRecordedEvidence(index: RecordedEvidenceIndex): {
  artifacts: number;
  cues: number;
  decisions: Record<RecordedCueDecisionState, number>;
} {
  const decisions: Record<RecordedCueDecisionState, number> = { committed: 0, withheld: 0, dropped: 0 };
  for (const decision of index.cue_decisions) decisions[decision.terminal_state] += 1;
  return { artifacts: index.artifacts.length, cues: index.cue_decisions.length, decisions };
}
