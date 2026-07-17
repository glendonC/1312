import { readFile } from "node:fs/promises";

import type { AcousticTriageReceipt } from "../../../acoustic/contracts.ts";
import { deriveDialogueScopePolicy, type DialogueScopePolicy, validateDialogueScopePolicy } from "../../../acoustic/dialogueScopePolicy.ts";
import { validateAcousticObservations, validateAcousticReceipt } from "../../../acoustic/validation.ts";
import type { SpeechActivityReceipt } from "../../../preflight/contracts.ts";
import type { RuntimeProjection } from "../model.ts";
import { ContentAddressedArtifactStore } from "../artifactStore.ts";

async function jsonFile(path: string, label: string, maxBytes: number): Promise<unknown> {
  const bytes = await readFile(path); if (bytes.byteLength <= 0 || bytes.byteLength > maxBytes) throw new Error(`${label} exceeds its bounded byte envelope`);
  try { return JSON.parse(bytes.toString("utf8")); } catch { throw new Error(`${label} is no longer valid JSON`); }
}

/** Additive consumer seam for U3 report admission; U1 producer/receipt behavior remains closed. */
export async function deriveTaskDialogueScopePolicy(
  state: RuntimeProjection,
  artifacts: ContentAddressedArtifactStore,
  taskId: string,
): Promise<DialogueScopePolicy | null> {
  const root = state.tasks[taskId]; if (!root) throw new Error("Dialogue-scope policy lost its task context");
  const source = state.artifacts[root.jobContext.source.artifactId];
  if (!source || source.origin.kind !== "ingest" || source.content.contentId !== root.jobContext.source.contentId) throw new Error("Dialogue-scope policy lost its exact source artifact");
  await artifacts.resolveVerified(source);
  const evidence = root.jobContext.detectorEvidence.map((identity) => state.artifacts[identity.artifactId]).filter(Boolean);
  const speechArtifact = evidence.find((artifact) => artifact.origin.kind === "preflight_evidence" && artifact.origin.evidenceKind === "speech_activity") ?? null;
  const acousticArtifact = evidence.find((artifact) => artifact.origin.kind === "preflight_evidence" && artifact.origin.evidenceKind === "acoustic_ranges") ?? null;
  if (!acousticArtifact) return null;
  if (!speechArtifact || speechArtifact.origin.kind !== "preflight_evidence" || acousticArtifact.origin.kind !== "preflight_evidence" || !acousticArtifact.origin.producerReceiptContentId) throw new Error("Acoustic dialogue-scope policy requires exact VAD, acoustic, and producer-receipt lineage");
  if (speechArtifact.sourceArtifactIds[0] !== source.id || acousticArtifact.sourceArtifactIds[0] !== source.id) throw new Error("Dialogue-scope evidence changed source lineage");
  const [speechValue, acousticValue, receiptBytes] = await Promise.all([
    jsonFile(await artifacts.resolveVerified(speechArtifact), "Speech evidence", 1024 * 1024),
    jsonFile(await artifacts.resolveVerified(acousticArtifact), "Acoustic observations", 256 * 1024),
    artifacts.receiptBytes(acousticArtifact.origin.producerReceiptContentId),
  ]);
  let receiptValue: unknown; try { receiptValue = JSON.parse(receiptBytes.toString("utf8")); } catch { throw new Error("Acoustic producer receipt is no longer valid JSON"); }
  const observations = validateAcousticObservations(acousticValue);
  validateAcousticReceipt(receiptValue, observations);
  const speech = speechValue as SpeechActivityReceipt;
  if (speech.schema !== "studio.speech-activity.v1" || speech.input.content_id !== source.content.contentId) throw new Error("Speech evidence no longer closes over the source");
  const track = source.tracks.find((candidate) => candidate.kind === "audio" && candidate.index === (receiptValue as AcousticTriageReceipt).input.media.trackIndex);
  if (!track) throw new Error("Acoustic evidence selected an unsupported or changed audio track");
  return validateDialogueScopePolicy(deriveDialogueScopePolicy({ sourceArtifactId: source.id, sourceContentId: source.content.contentId, trackId: track.id, includeLyrics: root.jobContext.analysisRequest.options.includeLyrics, requestedRange: root.jobContext.analysisRequest.requestedRange, speechEvidence: { artifactId: speechArtifact.id, contentId: speechArtifact.content.contentId, value: speech }, acousticEvidence: { artifactId: acousticArtifact.id, contentId: acousticArtifact.content.contentId, producerReceiptContentId: acousticArtifact.origin.producerReceiptContentId, value: observations } }));
}

/** Reopens both producer bodies plus the separate acoustic receipt and derives policy from bytes. */
export async function deriveRuntimeDialogueScopePolicy(
  state: RuntimeProjection,
  artifacts: ContentAddressedArtifactStore,
  studyId: string,
): Promise<DialogueScopePolicy | null> {
  const study = state.ownedMediaStudies[studyId]; if (!study) throw new Error(`Owned-media study ${studyId} is absent`);
  return deriveTaskDialogueScopePolicy(state, artifacts, study.rootTaskId);
}
