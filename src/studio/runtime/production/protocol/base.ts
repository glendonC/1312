export type RuntimeProducerKind =
  | "scheduler"
  | "registry"
  | "artifact_store"
  | "media_host"
  | "frame_host"
  | "ocr_host"
  | "speaker_host"
  | "separation_host"
  | "semantic_evidence_host"
  | "evidence_host"
  | "assessment_host"
  | "decision_host"
  | "publish_review_intake_host"
  | "publish_review_host"
  | "caption_production_host"
  | "caption_quality_control_host"
  | "handoff_host"
  | "admission_host"
  | "artifact_read_host"
  | "study_planning_host"
  | "study_restudy_host"
  | "study_synthesis_host"
  | "study_audit_host"
  | "launcher"
  | "recovery_host";

export interface RuntimeEventBase {
  schema: "studio.runtime.event.v1";
  runId: string;
  seq: number;
  eventId: string;
  recordedAt: string;
  producer: { kind: RuntimeProducerKind; id: string };
  causationId: string | null;
  correlationId: string | null;
}
