// Public model for the provider-authorized rule-change campaign.
//
// This campaign produced no result. It registered 9 preregistered pairs, completed 6, and the
// qualification command refused the partial grid. Every count here resolves from a receipt or from
// a file that exists in the repository, so the page cannot outlive its evidence.

import providerFreeze from "../../../bench/packs/hard-ko-provider-authorized-v1/freeze.json";
import registration from "../../../bench/rule-changes/ko-kinship-address-context-provider-authorized/registration.json";

interface PairDelta {
  critical_meaning_rate: number;
  catastrophic_count: number;
  critical_outcomes: { correct: number; wrong: number; withheld: number; missing: number };
}

interface PairReceipt {
  pair_id: string;
  pack_id: string;
  clip_id: string;
  without: { run: string };
  with: { run: string; memory: unknown };
  delta: PairDelta;
  regressions: unknown[];
  catastrophic_regressions: unknown[];
  judge: null;
}

interface ProviderCall {
  outcome: string;
  started_at: string;
  http_status: number;
  failure_code: string | null;
  transport_invocations: number;
  retries: number;
}

// Globs count what the repository actually holds, so a deleted or added receipt moves the page.
const pairModules = import.meta.glob<{ default: PairReceipt }>("../../../bench/scores/pairs/*.json", {
  eager: true,
});

const campaignScoreModules = import.meta.glob(
  "../../../bench/scores/rule-change-ko-kinship-address-context-provider-authorized-*/score.json",
  { eager: true },
);

// One provider-call receipt per registered slot, including the slots whose calls failed.
const providerCallModules = import.meta.glob<{ default: ProviderCall }>(
  "../../../bench/attempts/rule-change-ko-kinship-address-context-provider-authorized-*/provider-call.json",
  { eager: true },
);

export const providerCalls = Object.entries(providerCallModules).map(([path, module]) => ({
  run: path.replace(/^.*\/attempts\//, "").replace(/\/provider-call\.json$/, ""),
  receipt: module.default,
}));

export const chargedSlots = providerCalls.length;
export const capturedRuns = providerCalls.filter((call) => call.receipt.outcome === "success").length;
export const failedCalls = providerCalls.filter((call) => call.receipt.outcome !== "success");
export const failureCodes = [...new Set(failedCalls.map((call) => call.receipt.failure_code ?? "unknown"))];
export const retriedCalls = providerCalls.filter((call) => call.receipt.retries > 0).length;

export const campaignPairs = Object.entries(pairModules)
  .map(([path, module]) => ({
    path: path.replace(/^(?:\.\.\/)+/, ""),
    receipt: module.default,
  }))
  .filter((entry) => entry.receipt.pack_id === registration.pack.pack_id)
  .sort((a, b) => a.path.localeCompare(b.path));

export const campaignRegistration = registration;
export const campaignFreeze = providerFreeze;

/** One registered pair per capture-plan entry; each pair needs a with run and a without run. */
export const requiredPairs = registration.capture_plan.length;
export const plannedRuns = requiredPairs * 2;
export const scoredRuns = Object.keys(campaignScoreModules).length;
export const spentFailures = failedCalls.length;
export const measuredPairs = campaignPairs.length;

function requireCampaignLink(condition: boolean, message: string): void {
  if (!condition) throw new Error(`rule-change campaign public evidence binding failed: ${message}`);
}

// The page states that this campaign has no result, that it stopped short of its registered grid,
// and that every completed pair went against the candidate rule. Each must stay true in the receipts.
requireCampaignLink(registration.results === null, "registration now carries a result");
requireCampaignLink(measuredPairs > 0, "no paired-score receipt is bound");
requireCampaignLink(measuredPairs < requiredPairs, "the campaign grid is no longer incomplete");
requireCampaignLink(scoredRuns < plannedRuns, "every registered slot now has a score");
requireCampaignLink(
  campaignPairs.every((entry) => entry.receipt.delta.critical_meaning_rate < 0),
  "a measured pair no longer shows the candidate rule hurting meaning",
);
requireCampaignLink(
  campaignPairs.every((entry) => entry.receipt.judge === null),
  "a pair receipt now names a judge, so these are no longer judge-free comparisons",
);
requireCampaignLink(
  chargedSlots === plannedRuns,
  "provider-call receipts do not cover every registered slot",
);
requireCampaignLink(capturedRuns === scoredRuns, "captured runs and scored runs disagree");
requireCampaignLink(spentFailures > 0, "no registered slot was spent on a failed call");
requireCampaignLink(retriedCalls === 0, "a registered slot was retried");
requireCampaignLink(
  new Set(registration.capture_plan.map((entry) => entry.clip_id)).size === providerFreeze.clips.length,
  "the capture plan and the frozen pack cover different clips",
);

// Clip order follows the registered capture plan, not freeze order, so a card labelled
// "Clip 2" is the same clip the campaign receipts call c2.
const plannedClipOrder = [...new Set(registration.capture_plan.map((entry) => entry.clip_id))];

/** Grid state per frozen clip, including the clip whose without-side calls all failed. */
export const campaignClips = plannedClipOrder.map((clipId, index) => {
  const clip = providerFreeze.clips.find((entry) => entry.clip_id === clipId)!;
  const pairs = campaignPairs.filter((entry) => entry.receipt.clip_id === clip.clip_id);
  const rateDeltas = [...new Set(pairs.map((entry) => entry.receipt.delta.critical_meaning_rate))];
  const catastrophicDeltas = [...new Set(pairs.map((entry) => entry.receipt.delta.catastrophic_count))];

  return {
    clipId: clip.clip_id,
    label: `Clip ${index + 1}`,
    planned: registration.capture_plan.filter((entry) => entry.clip_id === clip.clip_id).length,
    measured: pairs.length,
    pairs,
    rateDelta: rateDeltas.length === 1 ? rateDeltas[0] : null,
    catastrophicDelta: catastrophicDeltas.length === 1 ? catastrophicDeltas[0] : null,
    /** Repeat runs that return the same delta do not demonstrate run-to-run variation. */
    identicalAcrossRepetitions: pairs.length > 1 && rateDeltas.length === 1 && catastrophicDeltas.length === 1,
  };
});

export const clipsWithoutAnyPair = campaignClips.filter((clip) => clip.measured === 0);
export const repeatsAreIdentical = campaignClips
  .filter((clip) => clip.measured > 1)
  .every((clip) => clip.identicalAcrossRepetitions);

export function displaySignedRate(value: number): string {
  return `${value < 0 ? "−" : "+"}${Math.abs(value * 100).toFixed(1)}%`;
}

export function displaySignedCount(value: number): string {
  return `${value < 0 ? "−" : "+"}${Math.abs(value)}`;
}
