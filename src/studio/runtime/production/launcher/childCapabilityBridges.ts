import { fileURLToPath } from "node:url";

import type { CapabilityGrant, TaskRecord } from "../model.ts";
import {
  BoundedChildEvidenceBridge,
  openChildEvidenceBridge,
  type ChildEvidenceReadHost,
  type OpenChildEvidenceBridge,
} from "../executor/childEvidenceBridge.ts";
import {
  BoundedChildEvidenceAssessmentBridge,
  openChildEvidenceAssessmentBridge,
  type ChildEvidenceAssessmentHost,
  type OpenChildEvidenceAssessmentBridge,
} from "../executor/childEvidenceAssessmentBridge.ts";
import {
  BoundedChildEvidenceDecisionBridge,
  openChildEvidenceDecisionBridge,
  type ChildEvidenceDecisionHost,
  type OpenChildEvidenceDecisionBridge,
} from "../executor/childEvidenceDecisionBridge.ts";
import {
  BoundedChildFrameBridge,
  openChildFrameBridge,
  type ChildFrameSamplingHost,
  type OpenChildFrameBridge,
} from "../executor/childFrameBridge.ts";
import {
  BoundedChildOcrBridge,
  openChildOcrBridge,
  type ChildOcrHost,
  type OpenChildOcrBridge,
} from "../executor/childOcrBridge.ts";
import {
  BoundedChildSpeakerBridge,
  openChildSpeakerBridge,
  type ChildSpeakerHost,
  type OpenChildSpeakerBridge,
} from "../executor/childSpeakerBridge.ts";
import {
  BoundedChildMediaBridge,
  openChildMediaBridge,
  type ChildMediaCapabilityHost,
  type OpenChildMediaBridge,
} from "../executor/childMediaBridge.ts";
import {
  BoundedChildSemanticEvidenceBridge,
  openChildSemanticEvidenceBridge,
  type ChildSemanticEvidenceHost,
  type OpenChildSemanticEvidenceBridge,
} from "../executor/childSemanticEvidenceBridge.ts";

export interface LauncherChildCapabilityOptions {
  maximumWallMs: number;
  nextMediaOperationId?: (capability: "media.extract" | "media.seek") => string;
  nextEvidenceOperationId?: () => string;
  nextAssessmentOperationId?: () => string;
  nextDecisionOperationId?: () => string;
  nextSemanticEvidenceOperationId?: () => string;
  nextFrameOperationId?: () => string;
  nextOcrOperationId?: () => string;
  nextSpeakerOperationId?: () => string;
  mediaMcpServerPath?: string;
  frameMcpServerPath?: string;
  ocrMcpServerPath?: string;
  speakerMcpServerPath?: string;
  evidenceMcpServerPath?: string;
  assessmentMcpServerPath?: string;
  decisionMcpServerPath?: string;
  semanticEvidenceMcpServerPath?: string;
}

export interface LauncherChildCapabilityHosts {
  media: ChildMediaCapabilityHost;
  frame: ChildFrameSamplingHost;
  ocr: ChildOcrHost;
  speaker: ChildSpeakerHost;
  evidence: ChildEvidenceReadHost;
  assessment: ChildEvidenceAssessmentHost;
  decision: ChildEvidenceDecisionHost;
  semanticEvidence: ChildSemanticEvidenceHost;
}

export interface LauncherChildCapabilityContext {
  mediaCapabilities: Array<"media.extract" | "media.seek">;
  evidenceGrant: CapabilityGrant | undefined;
  semanticEvidenceGrant: CapabilityGrant | undefined;
  frameGrant: CapabilityGrant | undefined;
  ocrGrant: CapabilityGrant | undefined;
  speakerGrant: CapabilityGrant | undefined;
  assessmentGrant: CapabilityGrant | undefined;
  decisionGrant: CapabilityGrant | undefined;
  mediaBridge: OpenChildMediaBridge | null;
  frameBridge: OpenChildFrameBridge | null;
  ocrBridge: OpenChildOcrBridge | null;
  speakerBridge: OpenChildSpeakerBridge | null;
  evidenceBridge: OpenChildEvidenceBridge | null;
  assessmentBridge: OpenChildEvidenceAssessmentBridge | null;
  decisionBridge: OpenChildEvidenceDecisionBridge | null;
  semanticEvidenceBridge: OpenChildSemanticEvidenceBridge | null;
}

export function launcherChildCapabilityContext(task: TaskRecord): LauncherChildCapabilityContext {
  return {
    mediaCapabilities: task.grants
      .map((grant) => grant.capability)
      .filter((capability): capability is "media.extract" | "media.seek" =>
        capability === "media.extract" || capability === "media.seek"),
    evidenceGrant: task.grants.find((grant) => grant.capability === "evidence.read"),
    semanticEvidenceGrant: task.grants.find((grant) => grant.capability === "speech.transcribe"),
    frameGrant: task.grants.find((grant) => grant.capability === "media.frames.sample"),
    ocrGrant: task.grants.find((grant) => grant.capability === "media.frames.ocr"),
    speakerGrant: task.grants.find((grant) => grant.capability === "media.speakers.analyze"),
    assessmentGrant: task.grants.find((grant) => grant.capability === "analysis.evidence.assess"),
    decisionGrant: task.grants.find((grant) => grant.capability === "analysis.evidence.decide"),
    mediaBridge: null,
    frameBridge: null,
    ocrBridge: null,
    speakerBridge: null,
    evidenceBridge: null,
    assessmentBridge: null,
    decisionBridge: null,
    semanticEvidenceBridge: null,
  };
}

export async function openLauncherChildCapabilityBridges(
  task: TaskRecord,
  hosts: LauncherChildCapabilityHosts,
  options: LauncherChildCapabilityOptions,
  context: LauncherChildCapabilityContext,
): Promise<void> {
  if (context.mediaCapabilities.length > 0) {
    context.mediaBridge = await openChildMediaBridge(new BoundedChildMediaBridge(task, hosts.media, {
      nextOperationId: options.nextMediaOperationId,
    }));
  }
  if (context.frameGrant) {
    context.frameBridge = await openChildFrameBridge(new BoundedChildFrameBridge(task, hosts.frame, {
      nextOperationId: options.nextFrameOperationId,
    }));
  }
  if (context.ocrGrant) {
    context.ocrBridge = await openChildOcrBridge(new BoundedChildOcrBridge(task, hosts.ocr, {
      nextOperationId: options.nextOcrOperationId,
    }));
  }
  if (context.speakerGrant) {
    context.speakerBridge = await openChildSpeakerBridge(new BoundedChildSpeakerBridge(task, hosts.speaker, {
      nextOperationId: options.nextSpeakerOperationId,
    }));
  }
  if (context.semanticEvidenceGrant) {
    context.semanticEvidenceBridge = await openChildSemanticEvidenceBridge(new BoundedChildSemanticEvidenceBridge(
      task,
      hosts.semanticEvidence,
      { nextOperationId: options.nextSemanticEvidenceOperationId },
    ));
  }
  if (context.evidenceGrant) {
    context.evidenceBridge = await openChildEvidenceBridge(new BoundedChildEvidenceBridge(task, hosts.evidence, {
      nextOperationId: options.nextEvidenceOperationId,
    }));
  }
  if (context.assessmentGrant) {
    context.assessmentBridge = await openChildEvidenceAssessmentBridge(new BoundedChildEvidenceAssessmentBridge(
      task,
      hosts.assessment,
      { nextOperationId: options.nextAssessmentOperationId },
    ));
  }
  if (context.decisionGrant) {
    context.decisionBridge = await openChildEvidenceDecisionBridge(new BoundedChildEvidenceDecisionBridge(
      task,
      hosts.decision,
      { nextOperationId: options.nextDecisionOperationId },
    ));
  }
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function tomlStrings(values: readonly string[]): string {
  return `[${values.map(tomlString).join(",")}]`;
}

export function configureLauncherChildCapabilityMcp(
  args: string[],
  task: TaskRecord,
  options: LauncherChildCapabilityOptions,
  context: LauncherChildCapabilityContext,
): void {
  if (context.mediaBridge) {
    const toolNames = context.mediaBridge.manifest.tools.map((tool) => tool.name);
    const serverPath = options.mediaMcpServerPath ?? fileURLToPath(
      new URL("../executor/mediaMcpServer.ts", import.meta.url),
    );
    args.push(
      "-c",
      `mcp_servers.studio_media.command=${tomlString(process.execPath)}`,
      "-c",
      `mcp_servers.studio_media.args=${tomlStrings([serverPath])}`,
      "-c",
      "mcp_servers.studio_media.required=true",
      "-c",
      `mcp_servers.studio_media.enabled_tools=${tomlStrings(toolNames)}`,
      "-c",
      "mcp_servers.studio_media.startup_timeout_sec=5",
      "-c",
      `mcp_servers.studio_media.tool_timeout_sec=${Math.max(1, Math.ceil(Math.min(task.budget.wallMs, options.maximumWallMs) / 1_000))}`,
      "-c",
      `mcp_servers.studio_media.env_vars=${tomlStrings([
        "STUDIO_CHILD_MEDIA_BRIDGE_URL",
        "STUDIO_CHILD_MEDIA_BRIDGE_TOKEN",
      ])}`,
    );
  }
  if (context.frameBridge) {
    const serverPath = options.frameMcpServerPath ?? fileURLToPath(
      new URL("../executor/frameMcpServer.ts", import.meta.url),
    );
    args.push(
      "-c",
      `mcp_servers.studio_frames.command=${tomlString(process.execPath)}`,
      "-c",
      `mcp_servers.studio_frames.args=${tomlStrings([serverPath])}`,
      "-c",
      "mcp_servers.studio_frames.required=true",
      "-c",
      `mcp_servers.studio_frames.enabled_tools=${tomlStrings([context.frameBridge.manifest.tool.name])}`,
      "-c",
      "mcp_servers.studio_frames.startup_timeout_sec=5",
      "-c",
      `mcp_servers.studio_frames.tool_timeout_sec=${Math.max(1, Math.ceil(Math.min(task.budget.wallMs, options.maximumWallMs) / 1_000))}`,
      "-c",
      `mcp_servers.studio_frames.env_vars=${tomlStrings([
        "STUDIO_CHILD_FRAME_BRIDGE_URL",
        "STUDIO_CHILD_FRAME_BRIDGE_TOKEN",
      ])}`,
    );
  }
  if (context.ocrBridge) {
    const serverPath = options.ocrMcpServerPath ?? fileURLToPath(
      new URL("../executor/ocrMcpServer.ts", import.meta.url),
    );
    args.push(
      "-c",
      `mcp_servers.studio_ocr.command=${tomlString(process.execPath)}`,
      "-c",
      `mcp_servers.studio_ocr.args=${tomlStrings([serverPath])}`,
      "-c",
      "mcp_servers.studio_ocr.required=true",
      "-c",
      `mcp_servers.studio_ocr.enabled_tools=${tomlStrings([context.ocrBridge.manifest.tool.name])}`,
      "-c",
      "mcp_servers.studio_ocr.startup_timeout_sec=5",
      "-c",
      `mcp_servers.studio_ocr.tool_timeout_sec=${Math.max(1, Math.ceil(Math.min(task.budget.wallMs, options.maximumWallMs) / 1_000))}`,
      "-c",
      `mcp_servers.studio_ocr.env_vars=${tomlStrings(["STUDIO_CHILD_OCR_BRIDGE_URL", "STUDIO_CHILD_OCR_BRIDGE_TOKEN"])}`,
    );
  }
  if (context.speakerBridge) {
    const serverPath = options.speakerMcpServerPath ?? fileURLToPath(
      new URL("../executor/speakerMcpServer.ts", import.meta.url),
    );
    args.push(
      "-c",
      `mcp_servers.studio_speakers.command=${tomlString(process.execPath)}`,
      "-c",
      `mcp_servers.studio_speakers.args=${tomlStrings([serverPath])}`,
      "-c",
      "mcp_servers.studio_speakers.required=true",
      "-c",
      `mcp_servers.studio_speakers.enabled_tools=${tomlStrings([context.speakerBridge.manifest.tool.name])}`,
      "-c",
      "mcp_servers.studio_speakers.startup_timeout_sec=5",
      "-c",
      `mcp_servers.studio_speakers.tool_timeout_sec=${Math.max(1, Math.ceil(Math.min(task.budget.wallMs, options.maximumWallMs) / 1_000))}`,
      "-c",
      `mcp_servers.studio_speakers.env_vars=${tomlStrings(["STUDIO_CHILD_SPEAKER_BRIDGE_URL", "STUDIO_CHILD_SPEAKER_BRIDGE_TOKEN"])}`,
    );
  }
  if (context.evidenceBridge) {
    const serverPath = options.evidenceMcpServerPath ?? fileURLToPath(
      new URL("../executor/evidenceMcpServer.ts", import.meta.url),
    );
    args.push(
      "-c",
      `mcp_servers.studio_evidence.command=${tomlString(process.execPath)}`,
      "-c",
      `mcp_servers.studio_evidence.args=${tomlStrings([serverPath])}`,
      "-c",
      "mcp_servers.studio_evidence.required=true",
      "-c",
      `mcp_servers.studio_evidence.enabled_tools=${tomlStrings([context.evidenceBridge.manifest.tool.name])}`,
      "-c",
      "mcp_servers.studio_evidence.startup_timeout_sec=5",
      "-c",
      `mcp_servers.studio_evidence.tool_timeout_sec=${Math.max(1, Math.ceil(Math.min(task.budget.wallMs, options.maximumWallMs) / 1_000))}`,
      "-c",
      `mcp_servers.studio_evidence.env_vars=${tomlStrings([
        "STUDIO_CHILD_EVIDENCE_BRIDGE_URL",
        "STUDIO_CHILD_EVIDENCE_BRIDGE_TOKEN",
      ])}`,
    );
  }
  if (context.semanticEvidenceBridge) {
    const serverPath = options.semanticEvidenceMcpServerPath ?? fileURLToPath(
      new URL("../executor/semanticEvidenceMcpServer.ts", import.meta.url),
    );
    args.push(
      "-c",
      `mcp_servers.studio_semantic_evidence.command=${tomlString(process.execPath)}`,
      "-c",
      `mcp_servers.studio_semantic_evidence.args=${tomlStrings([serverPath])}`,
      "-c",
      "mcp_servers.studio_semantic_evidence.required=true",
      "-c",
      `mcp_servers.studio_semantic_evidence.enabled_tools=${tomlStrings([context.semanticEvidenceBridge.manifest.tool.name])}`,
      "-c",
      "mcp_servers.studio_semantic_evidence.startup_timeout_sec=5",
      "-c",
      `mcp_servers.studio_semantic_evidence.tool_timeout_sec=${Math.max(1, Math.ceil(Math.min(task.budget.wallMs, options.maximumWallMs) / 1_000))}`,
      "-c",
      `mcp_servers.studio_semantic_evidence.env_vars=${tomlStrings([
        "STUDIO_CHILD_SEMANTIC_EVIDENCE_BRIDGE_URL",
        "STUDIO_CHILD_SEMANTIC_EVIDENCE_BRIDGE_TOKEN",
      ])}`,
    );
  }
  if (context.assessmentBridge) {
    const serverPath = options.assessmentMcpServerPath ?? fileURLToPath(
      new URL("../executor/evidenceAssessmentMcpServer.ts", import.meta.url),
    );
    args.push(
      "-c",
      `mcp_servers.studio_evidence_assessment.command=${tomlString(process.execPath)}`,
      "-c",
      `mcp_servers.studio_evidence_assessment.args=${tomlStrings([serverPath])}`,
      "-c",
      "mcp_servers.studio_evidence_assessment.required=true",
      "-c",
      `mcp_servers.studio_evidence_assessment.enabled_tools=${tomlStrings([context.assessmentBridge.manifest.tool.name])}`,
      "-c",
      "mcp_servers.studio_evidence_assessment.startup_timeout_sec=5",
      "-c",
      `mcp_servers.studio_evidence_assessment.tool_timeout_sec=${Math.max(1, Math.ceil(Math.min(task.budget.wallMs, options.maximumWallMs) / 1_000))}`,
      "-c",
      `mcp_servers.studio_evidence_assessment.env_vars=${tomlStrings([
        "STUDIO_CHILD_EVIDENCE_ASSESSMENT_BRIDGE_URL",
        "STUDIO_CHILD_EVIDENCE_ASSESSMENT_BRIDGE_TOKEN",
      ])}`,
    );
  }
  if (context.decisionBridge) {
    const serverPath = options.decisionMcpServerPath ?? fileURLToPath(
      new URL("../executor/evidenceDecisionMcpServer.ts", import.meta.url),
    );
    args.push(
      "-c",
      `mcp_servers.studio_evidence_decision.command=${tomlString(process.execPath)}`,
      "-c",
      `mcp_servers.studio_evidence_decision.args=${tomlStrings([serverPath])}`,
      "-c",
      "mcp_servers.studio_evidence_decision.required=true",
      "-c",
      `mcp_servers.studio_evidence_decision.enabled_tools=${tomlStrings([context.decisionBridge.manifest.tool.name])}`,
      "-c",
      "mcp_servers.studio_evidence_decision.startup_timeout_sec=5",
      "-c",
      `mcp_servers.studio_evidence_decision.tool_timeout_sec=${Math.max(1, Math.ceil(Math.min(task.budget.wallMs, options.maximumWallMs) / 1_000))}`,
      "-c",
      `mcp_servers.studio_evidence_decision.env_vars=${tomlStrings([
        "STUDIO_CHILD_EVIDENCE_DECISION_BRIDGE_URL",
        "STUDIO_CHILD_EVIDENCE_DECISION_BRIDGE_TOKEN",
      ])}`,
    );
  }
}

export function launcherChildCapabilityEnvironment(
  context: LauncherChildCapabilityContext,
): NodeJS.ProcessEnv {
  return context.mediaBridge || context.frameBridge || context.ocrBridge || context.speakerBridge || context.semanticEvidenceBridge || context.evidenceBridge || context.assessmentBridge || context.decisionBridge ? {
    ...process.env,
    ...(context.mediaBridge ? {
      STUDIO_CHILD_MEDIA_BRIDGE_URL: context.mediaBridge.endpoint,
      STUDIO_CHILD_MEDIA_BRIDGE_TOKEN: context.mediaBridge.token,
    } : {}),
    ...(context.frameBridge ? {
      STUDIO_CHILD_FRAME_BRIDGE_URL: context.frameBridge.endpoint,
      STUDIO_CHILD_FRAME_BRIDGE_TOKEN: context.frameBridge.token,
    } : {}),
    ...(context.ocrBridge ? {
      STUDIO_CHILD_OCR_BRIDGE_URL: context.ocrBridge.endpoint,
      STUDIO_CHILD_OCR_BRIDGE_TOKEN: context.ocrBridge.token,
    } : {}),
    ...(context.speakerBridge ? {
      STUDIO_CHILD_SPEAKER_BRIDGE_URL: context.speakerBridge.endpoint,
      STUDIO_CHILD_SPEAKER_BRIDGE_TOKEN: context.speakerBridge.token,
    } : {}),
    ...(context.evidenceBridge ? {
      STUDIO_CHILD_EVIDENCE_BRIDGE_URL: context.evidenceBridge.endpoint,
      STUDIO_CHILD_EVIDENCE_BRIDGE_TOKEN: context.evidenceBridge.token,
    } : {}),
    ...(context.semanticEvidenceBridge ? {
      STUDIO_CHILD_SEMANTIC_EVIDENCE_BRIDGE_URL: context.semanticEvidenceBridge.endpoint,
      STUDIO_CHILD_SEMANTIC_EVIDENCE_BRIDGE_TOKEN: context.semanticEvidenceBridge.token,
    } : {}),
    ...(context.assessmentBridge ? {
      STUDIO_CHILD_EVIDENCE_ASSESSMENT_BRIDGE_URL: context.assessmentBridge.endpoint,
      STUDIO_CHILD_EVIDENCE_ASSESSMENT_BRIDGE_TOKEN: context.assessmentBridge.token,
    } : {}),
    ...(context.decisionBridge ? {
      STUDIO_CHILD_EVIDENCE_DECISION_BRIDGE_URL: context.decisionBridge.endpoint,
      STUDIO_CHILD_EVIDENCE_DECISION_BRIDGE_TOKEN: context.decisionBridge.token,
    } : {}),
  } : process.env;
}

export async function closeLauncherChildCapabilityBridges(
  context: LauncherChildCapabilityContext,
): Promise<void> {
  if (context.mediaBridge) await context.mediaBridge.close();
  if (context.frameBridge) await context.frameBridge.close();
  if (context.ocrBridge) await context.ocrBridge.close();
  if (context.speakerBridge) await context.speakerBridge.close();
  if (context.semanticEvidenceBridge) await context.semanticEvidenceBridge.close();
  if (context.evidenceBridge) await context.evidenceBridge.close();
  if (context.assessmentBridge) await context.assessmentBridge.close();
  if (context.decisionBridge) await context.decisionBridge.close();
}
