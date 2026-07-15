import reportData from "../../../bench/examples/unscored-report.json";
import {
  annotationRequirements,
  artifactContract,
  benchmarkCopy,
  displayNumber,
  displayRate,
  evaluationLabels,
  metricGroups,
  outcomeStates,
  priorityLabels,
  supportLabels,
} from "./content";

export const report = reportData;

export {
  annotationRequirements,
  artifactContract,
  benchmarkCopy,
  displayNumber,
  displayRate,
  evaluationLabels,
  metricGroups,
  outcomeStates,
  priorityLabels,
  supportLabels,
};

export const statusLabels: Record<string, string> = {
  protocol_draft: "Protocol draft",
  gold_frozen: "Gold frozen",
  scored: "Scored report",
  planned: "Planned",
  sourced: "Source acquired",
  annotated: "Annotation in progress",
  gold_ready: "Gold ready",
  frozen: "Frozen",
  not_run: "Not run",
  captured: "Captured",
  reviewed: "Reviewed",
};

export const roleLabels: Record<string, string> = {
  subject: "System under test",
  internal_control: "Cold control",
  public_foil: "Public tool",
  optional_baseline: "Open baseline",
  control: "Control",
  hard: "Hard case",
};

export const tabs = [
  { id: "overview", label: "Overview", n: "00", color: "ink" },
  { id: "evidence", label: "Evidence", n: "01", color: "coral" },
  { id: "pack", label: "Test pack", n: "02", color: "citron" },
  { id: "compare", label: "Compare", n: "03", color: "blue" },
  { id: "results", label: "Results", n: "04", color: "lilac" },
  { id: "methods", label: "Methods", n: "05", color: "teal" },
  { id: "receipts", label: "Receipts", n: "06", color: "peach" },
] as const;

export const sourcedClips = report.pack.clips.filter((clip) => clip.source !== null).length;
export const goldReadyClips = report.pack.clips.filter(
  (clip) => clip.status === "gold_ready" || clip.status === "frozen",
).length;
export const completedRuns = report.results.filter((result) => result.status === "scored").length;
export const reviewedRuns = report.results.filter(
  (result) => result.status === "reviewed" || result.status === "scored",
).length;
export const totalAnnotationFields = report.pack.clips.reduce(
  (sum, clip) => sum + Object.keys(clip.annotations).length,
  0,
);
export const completeAnnotationFields = report.pack.clips.reduce(
  (sum, clip) => sum + Object.values(clip.annotations).filter(Boolean).length,
  0,
);
export const readyArtifacts = artifactContract.filter((artifact) => artifact.state === "ready").length;
export const missingArtifacts = artifactContract.length - readyArtifacts;
export const reportIsScored = report.status === "scored" && completedRuns === report.systems.length;
export const resultBySystem = new Map(report.results.map((result) => [result.system_id, result]));

const subjectSystem = report.systems.find((system) => system.role === "subject");
const subjectResult = subjectSystem ? resultBySystem.get(subjectSystem.id) : undefined;

export const heroValue = reportIsScored
  ? displayRate(subjectResult?.headline.critical_meaning.rate ?? null)
  : "";
export const heroValueLabel = reportIsScored ? "Critical meaning preserved" : "Not measured";

export const progressStages = [
  { label: "Draft", state: "current", meta: "Current" },
  { label: "Source", state: sourcedClips === report.pack.target_clip_count ? "complete" : "future", meta: `${sourcedClips}/${report.pack.target_clip_count}` },
  { label: "Freeze", state: goldReadyClips === report.pack.target_clip_count ? "complete" : "future", meta: `${goldReadyClips}/${report.pack.target_clip_count}` },
  { label: "Run", state: completedRuns === report.systems.length ? "complete" : "future", meta: `${completedRuns}/${report.systems.length}` },
  { label: "Review", state: reviewedRuns === report.systems.length ? "complete" : "future", meta: `${reviewedRuns}/${report.systems.length}` },
  { label: "Publish", state: reportIsScored ? "complete" : "future", meta: reportIsScored ? "Live" : "Locked" },
] as const;

export const difficultyGroups = [
  {
    index: "01",
    title: "Hear the speech",
    description: "Fast delivery, overlap, music, and dialect test whether the Korean can be recovered cleanly.",
    tags: ["fast-speech", "overlap", "music", "dialect"],
  },
  {
    index: "02",
    title: "Read the context",
    description: "Humor, implicature, honorifics, and relationships test what audio alone cannot explain.",
    tags: ["humor", "implicature", "honorifics", "relationships"],
  },
  {
    index: "03",
    title: "Keep specifics intact",
    description: "Names, numbers, fandom terms, code-switching, and on-screen text test exact meaning.",
    tags: ["names", "numbers", "fandom-terms", "code-switch", "on-screen-text"],
  },
] as const;

export const comparisonNotes = [
  {
    index: "01",
    title: "Preparation effect",
    copy: "Prepared versus cold keeps the 1321 stack comparable while changing the context it may use.",
  },
  {
    index: "02",
    title: "Public reference point",
    copy: "A date-stamped YouTube capture shows what a familiar public workflow produced on the same media.",
  },
  {
    index: "03",
    title: "Optional open baseline",
    copy: "A pinned ASR-to-translation pipeline can provide a reproducible baseline without becoming the headline.",
  },
] as const;

export const workItems = [
  {
    label: "Source the five media selections",
    meta: `${sourcedClips} of ${report.pack.target_clip_count} acquired`,
    state: sourcedClips === report.pack.target_clip_count ? "ready" : "missing",
    stateLabel: sourcedClips === report.pack.target_clip_count ? "Ready" : "Missing",
  },
  {
    label: "Lock the answer key and the key lines",
    meta: `${completeAnnotationFields} of ${totalAnnotationFields} clip checks complete`,
    state: goldReadyClips === report.pack.target_clip_count ? "ready" : "missing",
    stateLabel: goldReadyClips === report.pack.target_clip_count ? "Ready" : "Missing",
  },
  {
    label: "Capture and score every condition",
    meta: `${completedRuns} of ${report.systems.length} scored`,
    state: completedRuns === report.systems.length ? "measured" : "planned",
    stateLabel: completedRuns === report.systems.length ? "Measured" : "Planned",
  },
  {
    label: "Complete blinded review",
    meta: `${reviewedRuns} of ${report.systems.length} reviewed`,
    state: reviewedRuns === report.systems.length ? "ready" : "planned",
    stateLabel: reviewedRuns === report.systems.length ? "Ready" : "Planned",
  },
  {
    label: "Publish the scored report and receipts",
    meta: reportIsScored ? "Versioned report published" : "Unlocks only after review",
    state: reportIsScored ? "measured" : "planned",
    stateLabel: reportIsScored ? "Measured" : "Planned",
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
