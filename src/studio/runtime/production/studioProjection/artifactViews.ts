export type ProductionStudioOutputArtifactOrigin =
  | {
      kind: "media_operation" | "media_observation";
      operationId: string;
      receiptId: string;
      receiptContentId: string;
    }
  | {
      kind: "semantic_media_evidence";
      operationId: string;
      receiptId: string;
      receiptContentId: string;
      availabilityId: string;
    }
  | {
      kind: "worker_output";
      executionId: string;
      receiptId: string;
      receiptContentId: string;
    };

export interface ProductionStudioSourceArtifactView {
  artifactId: string;
  kind: string;
  mediaClass: "raw";
  publication: "private" | "public";
  contentId: string;
  bytes: number;
  durationMs: number | null;
  trackCount: number;
}

export interface ProductionStudioOutputArtifactView {
  artifactId: string;
  kind: string;
  mediaClass: "derived" | "non_media";
  publication: "private" | "public";
  contentId: string;
  bytes: number;
  durationMs: number | null;
  producerTaskId: string;
  producerAgentId: string;
  sourceArtifactIds: string[];
  origin: ProductionStudioOutputArtifactOrigin;
  reportIds: string[];
}
