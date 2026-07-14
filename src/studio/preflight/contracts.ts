/**
 * A content-addressed preflight index, independent of a completed Studio run.
 *
 * Provider fields remain in their source receipt. This bundle only connects normalized source
 * identity to immutable artifacts and to the producer-backed findings that currently exist.
 * Missing detector findings are explicit nulls; a UI or orchestrator cannot turn them into
 * language, speech, acoustic, speaker, overlap, or complexity claims.
 */

export type PreflightArtifactKind = "raw_media" | "source_receipt" | "media_probe_receipt";
export type PreflightArtifactClass = "raw" | "receipt";

export interface PreflightArtifact {
  artifact_id: string;
  kind: PreflightArtifactKind;
  class: PreflightArtifactClass;
  path: string;
  content: {
    id: string;
    hash: { algorithm: "sha256"; digest: string };
    bytes: number;
  };
  producer: string;
  source_content_ids: string[];
}

export interface PreflightFindings {
  container_tracks: string;
  speech_activity: null;
  language_ranges: null;
  acoustic_ranges: null;
  speaker_overlap: null;
  complexity: null;
}

export interface PreflightBundle {
  schema: "studio.preflight-bundle.v1";
  producer: "scripts/preflight-owned-media.mjs";
  preflight_id: string;
  source: {
    receipt_id: string;
    receipt_artifact_id: string;
    raw_artifact_id: string;
  };
  artifacts: PreflightArtifact[];
  findings: PreflightFindings;
  note: string;
}

/** Provider-neutral facts supplied by a registered source adapter to bundle validation. */
export interface PreflightSourceBinding {
  receiptId: string;
  receiptProducer: string;
  receiptPath: string;
  raw: {
    path: string;
    contentId: string;
    bytes: number;
    producer: string;
  };
  mediaProbe: {
    path: string;
    contentId: string;
    producer: string;
  };
}
