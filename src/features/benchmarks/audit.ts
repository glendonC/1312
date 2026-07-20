// Self-grading audit for the benchmark page.
//
// Every check here is computed from the receipts at build time, not asserted by hand. A failing
// check throws, so this page cannot be published with a broken chain of evidence. That is why the
// failure count is always zero: a page with a failing check does not exist.
//
// Scope limits (clips not yet run, baselines not yet captured) are NOT audit checks. They are
// stated where they belong, on Coverage and on the rule-change section.

import { campaignRegistration, chargedSlots, providerCalls } from "./campaign";
import {
  captureReceipt,
  freezeReceipt,
  labelsReceipt,
  receiptContentIds,
  scoreReceipt,
} from "./model";

export interface AuditCheck {
  label: string;
  passed: boolean;
}

export interface AuditGroup {
  title: string;
  checks: AuditCheck[];
}

const prepared = scoreReceipt.systems["1321-prepped"].headline;
const cold = scoreReceipt.systems["1321-cold"].headline;

function outcomeSum(headline: typeof prepared): number {
  const outcomes = headline.critical_outcomes;
  return outcomes.correct + outcomes.wrong + outcomes.withheld + outcomes.missing;
}

function arithmeticHolds(headline: typeof prepared): boolean {
  const meaning = headline.critical_meaning;
  return (
    outcomeSum(headline) === headline.critical_outcomes.total &&
    meaning.passes === headline.critical_outcomes.correct &&
    Math.abs(meaning.rate - meaning.passes / meaning.total) < 1e-9
  );
}

function sumLabel(name: string, headline: typeof prepared): string {
  const outcomes = headline.critical_outcomes;
  return `${name}: ${outcomes.correct} right plus ${outcomes.wrong} wrong plus ${outcomes.withheld} held back plus ${outcomes.missing} missed makes ${outcomes.total}`;
}

const earliestRunStart = providerCalls
  .map((call) => Date.parse(call.receipt.started_at))
  .reduce((earliest, value) => Math.min(earliest, value), Number.POSITIVE_INFINITY);

export const auditGroups: AuditGroup[] = [
  {
    title: "Before anything ran",
    checks: [
      {
        label: "The test set was locked before the recording was made",
        passed: scoreReceipt.preregistration.capture_after_freeze === true,
      },
      {
        label: "The lock time on the score matches the lock time on the test set",
        passed: scoreReceipt.preregistration.frozen_at === freezeReceipt.frozen_at,
      },
      {
        label: "The rule change was registered before its first run started",
        passed: Date.parse(campaignRegistration.registered_at) < earliestRunStart,
      },
      {
        label: "The rule change wrote down its pass mark and left the result blank",
        passed: campaignRegistration.results === null,
      },
    ],
  },
  {
    title: "How it ran",
    checks: [
      {
        label: "Both systems were judged on the same clip",
        passed: scoreReceipt.clip_id === captureReceipt.clip.id && scoreReceipt.clip_id === labelsReceipt.clip_id,
      },
      {
        label: `All ${chargedSlots} booked runs left a call receipt, including the ones that failed`,
        passed: chargedSlots === providerCalls.length && providerCalls.length > 0,
      },
      {
        label: "Every booked run made exactly one call, with no retries",
        passed: providerCalls.every((call) => call.receipt.transport_invocations === 1 && call.receipt.retries === 0),
      },
    ],
  },
  {
    title: "How it was graded",
    checks: [
      {
        label: "Reviewers did not know which system produced what they graded",
        passed: labelsReceipt.blinded === true,
      },
      {
        label: "No model graded any output",
        passed: scoreReceipt.judge === null,
      },
    ],
  },
  {
    title: "The numbers add up",
    checks: [
      { label: sumLabel("No preparation", cold), passed: arithmeticHolds(cold) },
      { label: sumLabel("Prepared", prepared), passed: arithmeticHolds(prepared) },
    ],
  },
  {
    title: "The files cannot be swapped",
    checks: [
      {
        label: "The recording matches the fingerprint the score points at",
        passed: receiptContentIds.capture === scoreReceipt.bindings.capture.content_id,
      },
      {
        label: "The reviewer grades match the fingerprint the score points at",
        passed: receiptContentIds.labels === scoreReceipt.bindings.labels.content_id,
      },
      {
        label: "The locked test set matches the fingerprint the score points at",
        passed: receiptContentIds.freeze === scoreReceipt.bindings.freeze.content_id,
      },
      {
        label: "The grades were made against that exact recording, not a later one",
        passed: labelsReceipt.capture.content_id === scoreReceipt.bindings.capture.content_id,
      },
    ],
  },
];

export const auditChecks = auditGroups.flatMap((group) => group.checks);
export const auditPassed = auditChecks.filter((check) => check.passed).length;
export const auditFailed = auditChecks.length - auditPassed;
export const pinnedReceipts = Object.keys(receiptContentIds).length;

const failed = auditChecks.filter((check) => !check.passed);
if (failed.length > 0) {
  throw new Error(
    `benchmark audit failed, so the page must not publish: ${failed.map((check) => check.label).join("; ")}`,
  );
}
