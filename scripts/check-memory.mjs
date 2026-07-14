import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { receiptIdFor } from "./lib/bench-gold.mjs";
import {
  loadLedger,
  materializeMemory,
  recordDecision,
  recordLegacySnapshot,
  recordProposal,
  validateRunProposalManifest,
} from "./lib/memory-review.mjs";
import { fingerprintFile } from "./lib/content-id.mjs";
import { contentIdForJson, fileReceipt } from "./lib/immutable-receipts.mjs";

const LEGACY = new URL("../memory/glossary/ko.json", import.meta.url);
const LEGACY_RECEIPT = new URL(
  "../memory/review/legacy/711a843e8e4fa4f31d46ec6938b3250a9912b4b40ed303fc47e60eb16e0db7c3.json",
  import.meta.url,
);
const RUN_SCRIPT = new URL("./run-clip.mjs", import.meta.url);
const UNSCORED_REPORT = new URL("../bench/examples/unscored-report.json", import.meta.url);
const RUNS = new URL("../public/demo/runs/", import.meta.url);

function assert(condition, message) {
  if (!condition) throw new Error(`memory check failed: ${message}`);
}

async function rejects(operation, pattern, message) {
  try {
    await operation();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (pattern.test(detail)) return;
    throw new Error(`memory check failed: ${message}; received: ${detail}`);
  }
  throw new Error(`memory check failed: ${message}; operation was accepted`);
}

async function scoredReport(
  path,
  { runPrefix = "memory-policy", subjectRules = [], subjectMeaning = null, subjectOutcomes = null, subjectCatastrophic = null } = {},
) {
  const report = JSON.parse(await readFile(UNSCORED_REPORT, "utf8"));
  report.status = "scored";
  report.generated_at = "2026-07-13T12:00:00.000Z";
  report.pack.frozen = true;
  for (const clip of report.pack.clips) {
    clip.status = "frozen";
    clip.source = {
      kind: "owned",
      label: `${clip.id} review source`,
      channel: "review fixture owner",
      url: null,
      video_id: null,
      licence: "Owned review fixture",
      window: { start: "00:00", end: "00:30" },
      duration: 30,
      attribution: "Review fixture owner",
      note: "Exact memory-policy check only.",
    };
    for (const key of Object.keys(clip.annotations)) clip.annotations[key] = true;
  }
  const subjectId = report.systems.find((system) => system.role === "subject").id;
  for (const system of report.systems) {
    system.status = "scored";
    system.version = "memory-policy-check";
    system.capture_date = "2026-07-13";
  }
  for (const [index, result] of report.results.entries()) {
    result.run_id = `${runPrefix}-run-${index + 1}`;
    result.status = "scored";
    result.config =
      result.system_id === subjectId
        ? { fixture: "memory-policy-check", rules: subjectRules }
        : { fixture: "memory-policy-check" };
    result.headline = {
      critical_meaning:
        result.system_id === subjectId && subjectMeaning !== null
          ? subjectMeaning
          : { passes: 1, total: 1, rate: 1 },
      critical_outcomes:
        result.system_id === subjectId && subjectOutcomes !== null
          ? subjectOutcomes
          : { correct: 1, wrong: 0, withheld: 0, missing: 0, total: 1 },
      catastrophic:
        result.system_id === subjectId && subjectCatastrophic !== null
          ? subjectCatastrophic
          : { count: 0, rate: 0, denominator: 1 },
      latency: { first_usable_s: 1, complete_s: 2 },
    };
    result.artifacts = {
      output: `output-${index}.json`,
      runtime: `runtime-${index}.json`,
      score: `bench/scores/${result.run_id}/score.json`,
      review: `review-${index}.json`,
    };
  }
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

/**
 * A "scored" report is no longer self-supporting: the rule gate binds it to a frozen pack and
 * per-result score receipts on disk. This builds that synthetic conveyor inside the temp
 * workspace — a frozen pack manifest, its freeze receipt, and one immutable-shaped score
 * receipt per report result whose headline matches the report exactly. Everything is labelled
 * fixture and lives in the temp dir; nothing here is evidence about any real clip.
 */
async function syntheticConveyor(temp) {
  const packDir = join(temp, "bench/packs/hard-ko-v1");
  await mkdir(packDir, { recursive: true });
  const clips = [
    { slot: "slot-control-01", role: "control", clip_id: "fixture-control-1" },
    { slot: "slot-control-02", role: "control", clip_id: "fixture-control-2" },
    { slot: "slot-hard-01", role: "hard", clip_id: "fixture-hard-1" },
  ];
  const pack = {
    schema: "studio.bench.pack.v1",
    pack_id: "hard-ko-v1",
    label: "Memory-policy fixture pack (synthetic; never evidence)",
    frozen: true,
    target_clip_count: clips.length,
    clips: clips.map((clip) => ({
      slot: clip.slot,
      role: clip.role,
      status: "frozen",
      clip_id: clip.clip_id,
      source: { kind: "owned", note: "memory-policy fixture" },
      gold_path: `${clip.clip_id}.gold.json`,
      candidates_manifest: null,
    })),
    freeze_receipt: "freeze.json",
  };
  const freezeBody = {
    schema: "studio.bench.freeze.v1",
    pack_id: "hard-ko-v1",
    frozen_at: "2026-07-12T00:00:00.000Z",
    protocol: { minimum_reviewers: 2, blinded_review: true, adjudication_required: true },
    clips: clips.map((clip, index) => ({
      clip_id: clip.clip_id,
      role: clip.role,
      source_url: null,
      gold: {
        path: `bench/packs/hard-ko-v1/${clip.clip_id}.gold.json`,
        content_id: `sha256:${String(index).repeat(64)}`,
        bytes: 1,
      },
      candidates_manifest: null,
      adjudications: [
        {
          path: `bench/reviews/fixture-${clip.clip_id}-1.json`,
          content_id: `sha256:${"a".repeat(64)}`,
          bytes: 1,
          review_id: `bench-review:sha256:${"a".repeat(64)}`,
          reviewer_name: "Fixture Reviewer One",
          reviewer_git_identity: "fixture-one <one@example.test>",
        },
        {
          path: `bench/reviews/fixture-${clip.clip_id}-2.json`,
          content_id: `sha256:${"b".repeat(64)}`,
          bytes: 1,
          review_id: `bench-review:sha256:${"b".repeat(64)}`,
          reviewer_name: "Fixture Reviewer Two",
          reviewer_git_identity: "fixture-two <two@example.test>",
        },
      ],
    })),
  };
  const freeze = { freeze_id: receiptIdFor("bench-freeze", { freeze_id: null, ...freezeBody }, "freeze_id"), ...freezeBody };
  await writeFile(join(packDir, "pack.json"), `${JSON.stringify(pack, null, 2)}\n`);
  await writeFile(join(packDir, "freeze.json"), `${JSON.stringify(freeze, null, 2)}\n`);
  const freezeFile = await fileReceipt(join(packDir, "freeze.json"), "bench/packs/hard-ko-v1/freeze.json");
  await mkdir(join(temp, "memory/glossary"), { recursive: true });
  await copyFile(LEGACY, join(temp, "memory/glossary/ko.json"));
  return { freeze, freezeFile };
}

async function writeScoreReceipts(temp, report, freeze, freezeFile) {
  for (const result of report.results) {
    const system = report.systems.find((candidate) => candidate.id === result.system_id);
    const h = result.headline;
    const line = {
      t_start: 0,
      t_end: 2,
      disposition: "emitted",
      meaning_preserved: h.critical_meaning.passes === 1,
      critical_units: [
        {
          id: "fixture-u1",
          outcome: h.critical_outcomes.correct === 1 ? "correct" : "wrong",
          catastrophic: h.catastrophic.count === 1,
        },
      ],
      basis: "human_label",
    };
    const body = {
      schema: "studio.bench.score.v1",
      pack_id: report.pack_id,
      clip_id: "fixture-hard-1",
      run: result.run_id,
      scored_at: "2026-07-13T11:00:00.000Z",
      judge: null,
      bindings: {
        gold: { path: "bench/packs/hard-ko-v1/fixture-hard-1.gold.json", content_id: `sha256:${"2".repeat(64)}`, bytes: 1 },
        freeze: { path: freezeFile.path, content_id: freezeFile.content_id, bytes: freezeFile.bytes },
        capture: { path: `bench/runs/${result.run_id}/capture.json`, content_id: `sha256:${"c".repeat(64)}`, bytes: 1 },
        labels: { path: `bench/reviews/labels/${result.run_id}.json`, content_id: `sha256:${"d".repeat(64)}`, bytes: 1 },
      },
      preregistration: { frozen_at: freeze.frozen_at, captured_at: "2026-07-13", capture_after_freeze: true },
      systems: { [result.system_id]: { role: system.role, per_line: [line], headline: h } },
      delta_vs_cold: null,
      notes: "Synthetic memory-policy fixture; never evidence about any real clip.",
    };
    const receipt = { score_id: receiptIdFor("bench-score", { score_id: null, ...body }, "score_id"), ...body };
    await mkdir(join(temp, "bench/scores", result.run_id), { recursive: true });
    await writeFile(join(temp, "bench/scores", result.run_id, "score.json"), `${JSON.stringify(receipt, null, 2)}\n`);
  }
}

const temp = await mkdtemp(join(tmpdir(), "studio-memory-check-"));
const store = join(temp, "review");
const evidence = join(temp, "evidence.json");
const evidenceTwo = join(temp, "evidence-two.json");
const scoredWith = join(temp, "scored-with-rule.json");
const scoredWithout = join(temp, "scored-without-rule.json");
const scoredWithoutButIncludes = join(temp, "scored-without-but-includes.json");
const wrongPack = join(temp, "wrong-pack-report.json");

try {
  await writeFile(evidence, '{"measured":"evidence-a"}\n');
  await writeFile(evidenceTwo, '{"measured":"evidence-b"}\n');

  const legacyBefore = await fingerprintFile(LEGACY);
  const legacy = await recordLegacySnapshot({
    store,
    sourcePath: "memory/glossary/ko.json",
    namespace: "language/ko/glossary",
    createdAt: "2026-07-13T00:00:00.000Z",
    workspaceRoot: new URL("../", import.meta.url).pathname,
  });
  const committedLegacy = JSON.parse(await readFile(LEGACY_RECEIPT, "utf8"));
  assert(JSON.stringify(legacy.snapshot) === JSON.stringify(committedLegacy), "committed legacy receipt drifted");
  assert(legacy.snapshot.status === "legacy_unreviewed", "legacy input was treated as accepted memory");
  const legacyAfter = await fingerprintFile(LEGACY);
  assert(legacyBefore.contentId === legacyAfter.contentId, "legacy memory source was rewritten");

  const legacyOnly = await materializeMemory({
    store,
    createdAt: "2026-07-13T00:00:01.000Z",
    workspaceRoot: new URL("../", import.meta.url).pathname,
  });
  assert(legacyOnly.materialization.entries.length === 0, "legacy input leaked into accepted memory");
  assert(legacyOnly.materialization.legacy_inputs.length === 1, "legacy input receipt was dropped");

  await rejects(
    () =>
      recordProposal({
        store,
        namespace: "language/ko/glossary",
        kind: "glossary",
        key: "term-a",
        value: { gloss: "A" },
        proposedBy: "context-01",
        evidencePaths: [],
      }),
    /without evidence/i,
    "proposal without evidence did not fail closed",
  );

  const first = await recordProposal({
    store,
    namespace: "language/ko/glossary",
    kind: "glossary",
    key: "term-a",
    value: { gloss: "A", language: "ko" },
    proposedBy: "context-01",
    evidencePaths: [evidence],
    source: { run_id: "policy-check", cue_ids: ["c01"] },
    createdAt: "2026-07-13T00:01:00.000Z",
  });

  await rejects(
    () =>
      recordDecision({
        store,
        proposalId: first.proposal.proposal_id,
        action: "accept",
        decidedBy: "context-01",
        reason: "Self review must fail.",
        createdAt: "2026-07-13T00:02:00.000Z",
      }),
    /cannot decide its own/i,
    "proposer was allowed to decide its own proposal",
  );
  await rejects(
    () =>
      recordDecision({
        store,
        proposalId: first.proposal.proposal_id,
        action: "accept",
        decidedBy: "reviewer-01",
        reason: "",
        createdAt: "2026-07-13T00:02:00.000Z",
      }),
    /reason.*non-empty/i,
    "empty decision reason did not fail closed",
  );

  await recordDecision({
    store,
    proposalId: first.proposal.proposal_id,
    action: "accept",
    decidedBy: "reviewer-01",
    reason: "Evidence supports this exact run-scoped term.",
    createdAt: "2026-07-13T00:02:00.000Z",
  });
  await rejects(
    () =>
      recordDecision({
        store,
        proposalId: first.proposal.proposal_id,
        action: "reject",
        decidedBy: "reviewer-02",
        reason: "A second primary decision must fail.",
        createdAt: "2026-07-13T00:02:01.000Z",
      }),
    /already has a primary decision/i,
    "proposal received two primary decisions",
  );

  const firstMaterialization = await materializeMemory({
    store,
    createdAt: "2026-07-13T00:03:00.000Z",
    workspaceRoot: new URL("../", import.meta.url).pathname,
  });
  assert(firstMaterialization.materialization.entries.length === 1, "accepted proposal was not materialized");
  assert(
    firstMaterialization.materialization.entries[0].proposal_id === first.proposal.proposal_id,
    "materialized entry lost proposal provenance",
  );

  await rejects(
    () =>
      recordProposal({
        store,
        namespace: "language/ko/glossary",
        kind: "glossary",
        key: "different-key",
        value: { gloss: "B" },
        proposedBy: "context-02",
        evidencePaths: [evidence],
        supersedes: first.proposal.proposal_id,
        createdAt: "2026-07-13T00:04:00.000Z",
      }),
    /preserve namespace, kind, and key/i,
    "supersession changed the semantic key",
  );

  const replacement = await recordProposal({
    store,
    namespace: "language/ko/glossary",
    kind: "glossary",
    key: "term-a",
    value: { gloss: "A revised", language: "ko" },
    proposedBy: "context-02",
    evidencePaths: [evidenceTwo],
    supersedes: first.proposal.proposal_id,
    createdAt: "2026-07-13T00:04:00.000Z",
  });
  await recordDecision({
    store,
    proposalId: replacement.proposal.proposal_id,
    action: "accept",
    decidedBy: "reviewer-02",
    reason: "New evidence supersedes the earlier value.",
    createdAt: "2026-07-13T00:05:00.000Z",
  });
  const replaced = await materializeMemory({
    store,
    createdAt: "2026-07-13T00:06:00.000Z",
    workspaceRoot: new URL("../", import.meta.url).pathname,
  });
  assert(replaced.materialization.entries.length === 1, "supersession produced multiple active values");
  assert(
    replaced.materialization.entries[0].proposal_id === replacement.proposal.proposal_id,
    "supersession did not replace the accepted head",
  );

  await recordDecision({
    store,
    proposalId: replacement.proposal.proposal_id,
    action: "revoke",
    decidedBy: "reviewer-03",
    reason: "Rollback restores the prior reviewed head.",
    createdAt: "2026-07-13T00:07:00.000Z",
  });
  const rolledBack = await materializeMemory({
    store,
    createdAt: "2026-07-13T00:08:00.000Z",
    workspaceRoot: new URL("../", import.meta.url).pathname,
  });
  assert(
    rolledBack.materialization.entries[0].proposal_id === first.proposal.proposal_id,
    "revocation did not restore the prior accepted head",
  );
  await rejects(
    () =>
      recordDecision({
        store,
        proposalId: replacement.proposal.proposal_id,
        action: "revoke",
        decidedBy: "reviewer-04",
        reason: "Duplicate revocation must fail.",
        createdAt: "2026-07-13T00:09:00.000Z",
      }),
    /only an accepted, non-revoked/i,
    "proposal was revoked twice",
  );

  const pending = await recordProposal({
    store,
    namespace: "language/ko/glossary",
    kind: "glossary",
    key: "term-b",
    value: { gloss: "B" },
    proposedBy: "context-03",
    evidencePaths: [evidenceTwo],
    createdAt: "2026-07-13T00:10:00.000Z",
  });
  await rejects(
    () =>
      recordDecision({
        store,
        proposalId: pending.proposal.proposal_id,
        action: "revoke",
        decidedBy: "reviewer-04",
        reason: "Pending values cannot be revoked.",
        createdAt: "2026-07-13T00:11:00.000Z",
      }),
    /only an accepted/i,
    "pending proposal was revoked",
  );

  const rule = await recordProposal({
    store,
    namespace: "language-neutral/rules",
    kind: "rule",
    key: "universal.example-gate",
    value: { threshold: 0.5 },
    proposedBy: "qc-01",
    evidencePaths: [evidence],
    benchmarkPackId: "hard-ko-v1",
    createdAt: "2026-07-13T00:12:00.000Z",
  });
  const ruleContentId = contentIdForJson(rule.proposal.value);
  await rejects(
    () =>
      recordDecision({
        store,
        proposalId: rule.proposal.proposal_id,
        action: "accept",
        decidedBy: "memory-gate-01",
        reason: "A rule needs scored evidence.",
        createdAt: "2026-07-13T00:13:00.000Z",
        workspaceRoot: temp,
      }),
    /requires a scored benchmark ablation pair/i,
    "behavioral rule was accepted without a benchmark",
  );

  // The skeleton-key hole: ONE scored report must never accept a rule again. Build the honest
  // ablation pair — and the synthetic conveyor (frozen pack, freeze receipt, score receipts)
  // the gate now binds every report to — so every negative below differs from a working
  // positive by exactly one thing.
  const conveyor = await syntheticConveyor(temp);
  const withReport = await scoredReport(scoredWith, {
    runPrefix: "with",
    subjectRules: ["sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", ruleContentId],
    subjectMeaning: { passes: 1, total: 1, rate: 1 },
    subjectOutcomes: { correct: 1, wrong: 0, withheld: 0, missing: 0, total: 1 },
    subjectCatastrophic: { count: 0, rate: 0, denominator: 1 },
  });
  const withoutReport = await scoredReport(scoredWithout, {
    runPrefix: "without",
    subjectRules: ["sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
    subjectMeaning: { passes: 0, total: 1, rate: 0 },
    subjectOutcomes: { correct: 0, wrong: 1, withheld: 0, missing: 0, total: 1 },
    subjectCatastrophic: { count: 1, rate: 1, denominator: 1 },
  });
  await writeScoreReceipts(temp, withReport, conveyor.freeze, conveyor.freezeFile);
  await writeScoreReceipts(temp, withoutReport, conveyor.freeze, conveyor.freezeFile);

  await rejects(
    () =>
      recordDecision({
        store,
        proposalId: rule.proposal.proposal_id,
        action: "accept",
        decidedBy: "memory-gate-01",
        reason: "A single scored report must no longer open the gate.",
        benchReports: { withRule: scoredWith },
        createdAt: "2026-07-13T00:13:00.000Z",
        workspaceRoot: temp,
      }),
    /skeleton key|both ablation reports/i,
    "a single scored report accepted a rule",
  );
  await rejects(
    () =>
      recordDecision({
        store,
        proposalId: rule.proposal.proposal_id,
        action: "accept",
        decidedBy: "memory-gate-01",
        reason: "The current protocol draft must fail closed.",
        benchReports: { withRule: UNSCORED_REPORT.pathname, withoutRule: scoredWithout },
        createdAt: "2026-07-13T00:13:00.000Z",
        workspaceRoot: temp,
      }),
    /requires scored frozen benchmark/i,
    "protocol draft was accepted as a scored benchmark",
  );

  const mismatched = JSON.parse(await readFile(scoredWith, "utf8"));
  mismatched.pack_id = "different-pack";
  await writeFile(wrongPack, `${JSON.stringify(mismatched, null, 2)}\n`);
  await rejects(
    () =>
      recordDecision({
        store,
        proposalId: rule.proposal.proposal_id,
        action: "accept",
        decidedBy: "memory-gate-01",
        reason: "The wrong pack must fail.",
        benchReports: { withRule: wrongPack, withoutRule: scoredWithout },
        createdAt: "2026-07-13T00:13:00.000Z",
        workspaceRoot: temp,
      }),
    /requires scored frozen benchmark pack hard-ko-v1/i,
    "mismatched benchmark pack was accepted",
  );
  await rejects(
    () =>
      recordDecision({
        store,
        proposalId: rule.proposal.proposal_id,
        action: "accept",
        decidedBy: "memory-gate-01",
        reason: "One report cannot be its own control.",
        benchReports: { withRule: scoredWith, withoutRule: scoredWith },
        createdAt: "2026-07-13T00:13:00.000Z",
        workspaceRoot: temp,
      }),
    /cannot be its own control/i,
    "one report served as both ablation sides",
  );
  await rejects(
    () =>
      recordDecision({
        store,
        proposalId: rule.proposal.proposal_id,
        action: "accept",
        decidedBy: "memory-gate-01",
        reason: "The with-report must actually include the rule.",
        benchReports: { withRule: scoredWithout, withoutRule: scoredWith },
        createdAt: "2026-07-13T00:13:00.000Z",
        workspaceRoot: temp,
      }),
    /does not include the proposed rule/i,
    "a with-report that excludes the rule was accepted",
  );
  const wbiReport = await scoredReport(scoredWithoutButIncludes, {
    runPrefix: "wbi",
    subjectRules: ["sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", ruleContentId],
    subjectMeaning: { passes: 0, total: 1, rate: 0 },
    subjectOutcomes: { correct: 0, wrong: 1, withheld: 0, missing: 0, total: 1 },
    subjectCatastrophic: { count: 1, rate: 1, denominator: 1 },
  });
  await writeScoreReceipts(temp, wbiReport, conveyor.freeze, conveyor.freezeFile);
  await rejects(
    () =>
      recordDecision({
        store,
        proposalId: rule.proposal.proposal_id,
        action: "accept",
        decidedBy: "memory-gate-01",
        reason: "A control that contains the rule is not a control.",
        benchReports: { withRule: scoredWith, withoutRule: scoredWithoutButIncludes },
        createdAt: "2026-07-13T00:13:00.000Z",
        workspaceRoot: temp,
      }),
    /is not a control/i,
    "a non-ablation pair was accepted",
  );

  const ruleDecision = await recordDecision({
    store,
    proposalId: rule.proposal.proposal_id,
    action: "accept",
    decidedBy: "memory-gate-01",
    reason: "Exact scored ablation pair satisfies the rule gate.",
    benchReports: { withRule: scoredWith, withoutRule: scoredWithout },
    createdAt: "2026-07-13T00:13:00.000Z",
        workspaceRoot: temp,
  });
  assert(
    ruleDecision.decision.benchmark_receipt.rule_content_id === ruleContentId,
    "rule decision does not bind the exact rule value",
  );
  assert(
    Math.abs(ruleDecision.decision.benchmark_receipt.delta.critical_meaning_rate - 1) < 1e-9 &&
      ruleDecision.decision.benchmark_receipt.delta.catastrophic_count === -1,
    "rule decision does not record the measured ablation delta",
  );
  const withRule = await materializeMemory({
    store,
    createdAt: "2026-07-13T00:14:00.000Z",
    workspaceRoot: temp,
  });
  assert(withRule.materialization.entries.some((entry) => entry.kind === "rule"), "scored rule was not materialized");

  const manifestItem = {
    proposal_id: pending.proposal.proposal_id,
    proposal_content_id: contentIdForJson(pending.proposal),
    namespace: pending.proposal.namespace,
    kind: pending.proposal.kind,
    key: pending.proposal.key,
    status: "pending_review",
  };
  const manifestBody = {
    schema: "studio.memory.run-proposals.v1",
    run: "policy-check",
    clip: "clip-policy-check",
    status: "pending_review",
    proposals: [manifestItem],
  };
  const manifest = {
    manifest_id: `memory-proposal-manifest:${contentIdForJson(manifestBody)}`,
    ...manifestBody,
  };
  validateRunProposalManifest(manifest, {
    runId: manifest.run,
    clipId: manifest.clip,
    proposals: [pending.proposal],
  });
  await rejects(
    async () =>
      validateRunProposalManifest(
        { ...manifest, extra: "unregistered" },
        { proposals: [pending.proposal] },
      ),
    /shape is not closed/i,
    "run proposal manifest accepted an unregistered field",
  );
  await rejects(
    async () =>
      validateRunProposalManifest(
        {
          ...manifest,
          manifest_id: `${manifest.manifest_id.slice(0, -1)}${manifest.manifest_id.endsWith("0") ? "1" : "0"}`,
        },
        { proposals: [pending.proposal] },
      ),
    /id does not match/i,
    "run proposal manifest accepted the wrong content id",
  );

  const evidenceTwoOriginal = await readFile(evidenceTwo, "utf8");
  await writeFile(evidenceTwo, '{"measured":"tampered"}\n');
  await rejects(
    () => loadLedger({ store, workspaceRoot: temp }),
    /no longer matches its recorded bytes/i,
    "evidence hash drift was accepted",
  );
  await writeFile(evidenceTwo, evidenceTwoOriginal);

  const scoredOriginal = await readFile(scoredWith, "utf8");
  await writeFile(scoredWith, `${scoredOriginal.trim()} `);
  await rejects(
    () => loadLedger({ store, workspaceRoot: temp }),
    /no longer matches its recorded bytes/i,
    "benchmark receipt hash drift was accepted",
  );
  await writeFile(scoredWith, scoredOriginal);

  const runSource = await readFile(RUN_SCRIPT, "utf8");
  assert(!runSource.includes("writeFileSync(MEM"), "run-clip still writes cross-run memory directly");
  assert(runSource.includes('status: "pending_review"'), "run glossary is not explicitly pending review");
  assert(runSource.includes("promoted_to: null"), "run glossary still claims automatic promotion");
  assert(runSource.includes("recordProposal({"), "run glossary does not create immutable proposals");
  assert(runSource.includes('write("memory-proposals.json"'), "run proposal manifest is not recorded");

  // Historical bundles remain valid. Any future proposal-first bundle is closed over the
  // manifest it declares and must match immutable proposal records in the review ledger.
  const reviewLedger = await loadLedger({ store: new URL("../memory/review", import.meta.url).pathname });
  for (const entry of await readdir(RUNS, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const base = new URL(`${entry.name}/`, RUNS);
    const glossary = JSON.parse(await readFile(new URL("glossary.json", base), "utf8"));
    if (glossary.promotion === undefined) continue;
    const run = JSON.parse(await readFile(new URL("run.json", base), "utf8"));
    assert(glossary.promoted_to === null, `${entry.name} pending glossary claims promotion`);
    assert(
      run.artifacts.includes(glossary.promotion.proposal_manifest),
      `${entry.name} proposal manifest is absent from run.artifacts`,
    );
    const recordedManifest = JSON.parse(
      await readFile(new URL(glossary.promotion.proposal_manifest, base), "utf8"),
    );
    validateRunProposalManifest(recordedManifest, {
      runId: run.id,
      clipId: run.clip.id,
      proposals: reviewLedger.proposals,
    });
  }

  console.log(
    `memory check passed: immutable legacy input, evidence hashes, separate review, supersession, rollback, and ablation-bound rule gate (single scored report refused)`,
  );
} finally {
  await rm(temp, { recursive: true, force: true });
}
