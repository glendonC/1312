import { randomUUID } from "node:crypto";

import type {
  ParentArtifactReadGrant,
  ParentArtifactReadRequest,
  TaskRecord,
} from "../model.ts";
import type { ParentArtifactReadResult } from "../admission/parentArtifactReadHost.ts";

export const PARENT_ARTIFACT_READ_TOOL = "artifact_read" as const;

export interface ParentArtifactReadCapabilityHost {
  read(request: unknown): Promise<ParentArtifactReadResult>;
}

/** Parent-private path-free tool; task, agent, grant, operation, artifact, and path identities are host-bound. */
export class BoundedParentArtifactReadBridge {
  private readonly task: TaskRecord;
  private readonly grant: ParentArtifactReadGrant;
  private readonly host: ParentArtifactReadCapabilityHost;
  private readonly nextOperationId: () => string;
  constructor(
    task: TaskRecord,
    grant: ParentArtifactReadGrant,
    host: ParentArtifactReadCapabilityHost,
    nextOperationId: () => string = () => `operation:parent-artifact-read:${randomUUID()}`,
  ) {
    this.task = structuredClone(task);
    this.grant = structuredClone(grant);
    this.host = host;
    this.nextOperationId = nextOperationId;
    if (
      grant.capability !== "artifact.read" || grant.parentTaskId !== task.id ||
      grant.parentAgentId !== task.assignedAgentId || grant.runId !== task.runId
    ) throw new Error("Parent artifact read bridge requires one exact parent-bound grant");
  }

  manifest() {
    return {
      schema: "studio.parent-artifact-read-tools.v1" as const,
      taskId: this.task.id,
      agentId: this.task.assignedAgentId,
      tool: {
        name: PARENT_ARTIFACT_READ_TOOL,
        capability: "artifact.read" as const,
        admittedContentIds: this.grant.contentScope.map((scope) => scope.contentId),
        maxBytes: this.grant.maxBytes,
        maxItems: this.grant.maxItems,
      },
    };
  }

  async call(value: unknown): Promise<ParentArtifactReadResult> {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("artifact_read accepts one object containing contentIds");
    }
    const item = value as Record<string, unknown>;
    if (Object.keys(item).length !== 1 || !Array.isArray(item.contentIds) || item.contentIds.length === 0 ||
        item.contentIds.some((id) => typeof id !== "string" || !id)) {
      throw new Error("artifact_read accepts only a non-empty contentIds list");
    }
    const request: ParentArtifactReadRequest = {
      operationId: this.nextOperationId(),
      parentTaskId: this.task.id,
      parentAgentId: this.task.assignedAgentId,
      grantId: this.grant.id,
      contentIds: [...item.contentIds] as string[],
    };
    const result = await this.host.read(request);
    if (result.operationId !== request.operationId || result.grantId !== this.grant.id ||
        result.artifacts.some((artifact) => !request.contentIds.includes(artifact.contentId))) {
      throw new Error("Parent artifact read host changed the bound tool request");
    }
    return result;
  }
}
