/** Closed artifact kinds supported by the first retrospective evidence index. */
export type RecordedArtifactKind =
  | "captions"
  | "corrections"
  | "glossary"
  | "score"
  | "traces"
  | "memory_proposals";

export interface RecordedEvidenceArtifact {
  artifact_id: string;
  kind: RecordedArtifactKind;
  path: string;
  content: {
    id: string;
    hash: { algorithm: "sha256"; digest: string };
    bytes: number;
  };
  /** Empty in v1 outputs: the post-run indexer does not reconstruct original artifact lineage. */
  source_artifact_ids: string[];
}

export type RecordedCueDecisionState = "committed" | "withheld" | "dropped";

export interface RecordedCueDecision {
  cue_id: string;
  terminal_state: RecordedCueDecisionState;
  /** Copied from captions.json. This is a recorded label, not reconstructed worker authorship. */
  caption_owner_id: string;
  gate: { id: string; reason: string } | null;
  evidence_artifact_ids: string[];
  /** The exact recorded terminal effect, not a structured handoff or provenance claim. */
  terminal_effect: {
    trace_index: number;
    at: number;
    agent_id: string;
    action: string;
  };
}

export interface RecordedEvidenceIndex {
  schema: "studio.recorded-evidence-index.v1";
  producer: "scripts/index-recorded-evidence.mjs";
  mode: "post_run_index";
  run: string;
  clip: string;
  claims: {
    artifact_byte_identity: true;
    terminal_caption_decisions: true;
    original_worker_lineage: false;
    structured_handoffs: false;
  };
  artifacts: RecordedEvidenceArtifact[];
  cue_decisions: RecordedCueDecision[];
  note: string;
}
