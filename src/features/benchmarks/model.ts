import { createHash } from "node:crypto";
import captureData from "../../../bench/runs/run-007/capture.json";
import captureRaw from "../../../bench/runs/run-007/capture.json?raw";
import freezeData from "../../../bench/packs/hard-ko-v1/freeze.json";
import freezeRaw from "../../../bench/packs/hard-ko-v1/freeze.json?raw";
import labelsData from "../../../bench/reviews/labels/run-007.json";
import labelsRaw from "../../../bench/reviews/labels/run-007.json?raw";
import scoreData from "../../../bench/scores/run-007/score.json";
import scoreRaw from "../../../bench/scores/run-007/score.json?raw";
import {
  benchmarkCopy,
  displayNumber,
  displayRate,
  evaluationLabels,
  metricGroups,
  outcomeStates,
  priorityLabels,
  supportLabels,
} from "./content";

export {
  benchmarkCopy,
  displayNumber,
  displayRate,
  evaluationLabels,
  metricGroups,
  outcomeStates,
  priorityLabels,
  supportLabels,
};

export const captureReceipt = captureData;
export const freezeReceipt = freezeData;
export const labelsReceipt = labelsData;
export const scoreReceipt = scoreData;

function fileContentId(raw: string): string {
  return `sha256:${createHash("sha256").update(raw).digest("hex")}`;
}

export const receiptContentIds = {
  capture: fileContentId(captureRaw),
  freeze: fileContentId(freezeRaw),
  labels: fileContentId(labelsRaw),
  score: fileContentId(scoreRaw),
} as const;

function requireReceiptLink(condition: boolean, message: string): void {
  if (!condition) throw new Error(`run-007 public evidence binding failed: ${message}`);
}

// These checks make the public page fail closed if any imported receipt stops
// pointing at the same pack, clip, run, capture bytes, or label bytes.
requireReceiptLink(scoreReceipt.run === captureReceipt.capture_id, "score and capture run IDs differ");
requireReceiptLink(scoreReceipt.run === labelsReceipt.run, "score and labels run IDs differ");
requireReceiptLink(scoreReceipt.pack_id === freezeReceipt.pack_id, "score and freeze pack IDs differ");
requireReceiptLink(scoreReceipt.pack_id === labelsReceipt.pack_id, "score and labels pack IDs differ");
requireReceiptLink(scoreReceipt.clip_id === captureReceipt.clip.id, "score and capture clip IDs differ");
requireReceiptLink(scoreReceipt.clip_id === labelsReceipt.clip_id, "score and labels clip IDs differ");
requireReceiptLink(
  scoreReceipt.bindings.capture.content_id === labelsReceipt.capture.content_id,
  "score and labels bind different capture bytes",
);
requireReceiptLink(
  scoreReceipt.bindings.capture.content_id === receiptContentIds.capture,
  "score capture binding does not match capture.json bytes",
);
requireReceiptLink(
  scoreReceipt.bindings.labels.content_id === receiptContentIds.labels,
  "score labels binding does not match run-007.json bytes",
);
requireReceiptLink(
  scoreReceipt.bindings.freeze.content_id === receiptContentIds.freeze,
  "score freeze binding does not match freeze.json bytes",
);
requireReceiptLink(
  scoreReceipt.bindings.capture.path === labelsReceipt.capture.path,
  "score and labels bind different capture paths",
);
requireReceiptLink(
  scoreReceipt.preregistration.frozen_at === freezeReceipt.frozen_at,
  "score preregistration timestamp differs from freeze",
);
requireReceiptLink(scoreReceipt.preregistration.capture_after_freeze, "capture is not declared post-freeze");
requireReceiptLink(labelsReceipt.blinded, "output labels are not blinded");
requireReceiptLink(
  scoreReceipt.delta_vs_cold.subject === "1321-prepped" &&
    scoreReceipt.delta_vs_cold.internal_control === "1321-cold",
  "delta system IDs do not match the published comparison",
);
requireReceiptLink(scoreReceipt.delta_vs_cold.critical_meaning_rate < 0, "receipt no longer shows cold leading");

export const tabs = [
  { id: "overview", label: "Overview", color: "ink" },
  { id: "evidence", label: "Coverage", color: "coral" },
  { id: "results", label: "Results", color: "lilac" },
  { id: "methods", label: "Method", color: "teal" },
  { id: "receipts", label: "Audit", color: "peach" },
] as const;

export const roleLabels: Record<string, string> = {
  subject: "System under test",
  internal_control: "Cold control",
  public_foil: "Public tool",
  control: "Control clip",
  hard: "Hard clip",
};

export const scoredSystems = Object.entries(scoreReceipt.systems).map(([id, result]) => ({
  id,
  label: id === "1321-prepped" ? "Prepared" : "No preparation",
  role: result.role,
  result,
  capture: captureReceipt.systems.find((system) => system.id === id),
}));

export const resultBySystem = new Map(scoredSystems.map((system) => [system.id, system.result]));

export const packClips = freezeReceipt.clips.map((clip, index) => {
  const isScoredClip = clip.clip_id === scoreReceipt.clip_id;
  return {
    ...clip,
    index: String(index + 1).padStart(2, "0"),
    isScoredClip,
    label: isScoredClip
      ? "Didi's Korean Culture Podcast"
      : `Local evaluation control ${String(index + 1).padStart(2, "0")}`,
    durationS: isScoredClip ? captureReceipt.clip.duration_s : null,
    captured: isScoredClip,
    outputLabeled: isScoredClip,
    scored: isScoredClip,
  };
});

export const evidenceRows = packClips.map((clip) => ({
  id: clip.clip_id,
  label: clip.isScoredClip ? "Scored clip" : `Control ${clip.index}`,
  source: true,
  gold: true,
  capture: clip.captured,
  labels: clip.outputLabeled,
  score: clip.scored,
}));

export const comparisonConditions = [
  ...scoredSystems.map((system) => ({
    id: system.id,
    label: system.label,
    role: system.role,
    status: "measured" as const,
    statusLabel: "Scored on run-007",
    inputs: system.id === "1321-prepped" ? ["prepared context", "cross-check ASR", "gates"] : ["audio", "shared windows", "no gates"],
    meta: `${captureReceipt.captured_at} · ${scoreReceipt.clip_id}`,
  })),
  {
    id: "local-eval-controls",
    label: "Local-eval controls",
    role: "control",
    status: "missing" as const,
    statusLabel: "Not run / not scored",
    inputs: ["2 frozen clips", "gold ready"],
    meta: "No output receipt",
  },
  {
    id: "youtube-auto",
    label: "YouTube auto condition",
    role: "public_foil",
    status: "missing" as const,
    statusLabel: "Not captured / not scored",
    inputs: ["same hard clip", "public condition"],
    meta: "No receipt",
  },
];

export const publicationNotes = [
  `This is one scored hard clip from ${scoreReceipt.run}, not a completed ${scoreReceipt.pack_id} pack result.`,
  `The ${freezeReceipt.clips.filter((clip) => clip.role === "control").length} local-eval controls are frozen, but neither has been run or scored.`,
  "No YouTube auto condition has been captured or scored.",
  "No Run 2+ series exists yet; run-007 is one non-deterministic sample.",
  "The Studio run-006 replay remains a synthetic planted-error demo and is not this pack's score.",
];

export const missingEvidence = [
  {
    label: "Local-eval controls",
    detail: "2 frozen control clips · 0 run · 0 scored",
  },
  {
    label: "YouTube auto condition",
    detail: "No dated output, labels, or score receipt",
  },
  {
    label: "Run 2+ series",
    detail: "No repeat-run receipt; variance is not measured",
  },
] as const;

export const receiptFiles = [
  {
    path: "bench/scores/run-007/score.json",
    role: "Published score receipt for both run-007 systems",
    identity: receiptContentIds.score,
    state: "ready" as const,
  },
  {
    path: scoreReceipt.bindings.capture.path,
    role: "Pinned real-media capture consumed by the score",
    identity: scoreReceipt.bindings.capture.content_id,
    state: "ready" as const,
  },
  {
    path: scoreReceipt.bindings.labels.path,
    role: "Blinded human output labels consumed by the score",
    identity: scoreReceipt.bindings.labels.content_id,
    state: "ready" as const,
  },
  {
    path: scoreReceipt.bindings.freeze.path,
    role: "Frozen hard-ko-v1 pack receipt",
    identity: scoreReceipt.bindings.freeze.content_id,
    state: "ready" as const,
  },
  {
    path: "bench/scores/<local-eval-run>/score.json",
    role: "Scores for both frozen local-eval control clips",
    identity: "No receipt",
    state: "missing" as const,
  },
  {
    path: "bench/runs/<youtube-auto-run>/",
    role: "Dated YouTube auto output, labels, and score",
    identity: "No receipt",
    state: "missing" as const,
  },
  {
    path: "bench/scores/<run-2-plus>/score.json",
    role: "Repeat-run series for run variance",
    identity: "No receipt",
    state: "missing" as const,
  },
] as const;

export const readyArtifacts = receiptFiles.filter((artifact) => artifact.state === "ready").length;
export const missingArtifacts = receiptFiles.length - readyArtifacts;

export const workItems = [
  {
    label: "Freeze hard-ko-v1",
    meta: `${freezeReceipt.clips.length} of ${freezeReceipt.clips.length} clip gold files bound · ${freezeReceipt.frozen_at}`,
    state: "ready",
    stateLabel: "Ready",
  },
  {
    label: "Capture the hard clip",
    meta: `${captureReceipt.capture_id} · ${captureReceipt.captured_at} · ${captureReceipt.clip.duration_s} seconds`,
    state: "measured",
    stateLabel: "Captured",
  },
  {
    label: "Complete blinded output review",
    meta: `${labelsReceipt.reviewers.length} reviewers · labels bound to exact capture bytes`,
    state: "ready",
    stateLabel: "Ready",
  },
  {
    label: "Score run-007",
    meta: `Both systems scored across ${scoreReceipt.systems["1321-prepped"].headline.critical_meaning.total} critical units`,
    state: "measured",
    stateLabel: "Measured",
  },
  {
    label: "Complete the comparison series",
    meta: "Local controls, YouTube auto, and Run 2+ remain absent",
    state: "missing",
    stateLabel: "Missing",
  },
] as const;

export const outcomeClass: Record<string, string> = {
  correct: "outcome-correct",
  wrong: "outcome-wrong",
  withheld: "outcome-withheld",
  missing: "outcome-missing",
};

export function outcomePercent(value: number | null, total: number | null): string {
  if (value === null || total === null || total === 0) return "0%";
  return `${Math.max(0, Math.min(100, (value / total) * 100))}%`;
}

export function shortIdentity(identity: string): string {
  const value = identity.replace(/^sha256:/, "");
  return value.length > 18 ? `${value.slice(0, 12)}…${value.slice(-6)}` : value;
}
