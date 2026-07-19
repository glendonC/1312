import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  CAPTURE_ADAPTER_IMPLEMENTATIONS,
  CAPTURE_HOST_IMPLEMENTATION_PATH,
  captureExecutorPath,
  materializeCaptureExecutor,
} from "../scripts/lib/bench-capture-executor.mjs";
import {
  certifiedReleasePath,
  materializeCertifiedRelease,
  resolveCertifiedEvaluationSources,
  resolveCertifiedRelease,
  validateCertifiedPromptMedia,
} from "../scripts/lib/bench-certified-release.mjs";
import {
  auditSingleAttemptCharges,
  runSingleAttempt,
  singleAttemptPaths,
  verifyExecutionAttribution,
} from "../scripts/lib/bench-single-attempt.mjs";
import {
  materializeRuleChangeRegistration,
  materializeRuleChangeResult,
  RULE_CHANGE_SCHEMAS,
  validateRuleChangeRegistration,
  validateRuleChangeResult,
  verifyRuleChangeResult,
} from "../scripts/lib/bench-rule-change.mjs";
import {
  candidatesManifestId,
  receiptIdFor,
  scoreCapture,
} from "../scripts/lib/bench-gold.mjs";
import { compareSubjectScores } from "../scripts/lib/bench-paired-score.mjs";
import {
  contentIdForJson,
  fileReceipt,
  writeImmutableJson,
} from "../scripts/lib/immutable-receipts.mjs";
import {
  assertCommitDescends,
  immutableArtifactAfter,
  immutableArtifactCommit,
} from "../scripts/lib/bench-git-evidence.mjs";
import { recordProposal } from "../scripts/lib/memory-review.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

async function json(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

function resealRegistration(registration) {
  const { registration_id: _id, ...body } = registration;
  registration.registration_id = `bench-rule-change-registration:${contentIdForJson({
    registration_id: null,
    ...body,
  })}`;
  return registration;
}

function resealResult(result) {
  const { result_id: _id, ...body } = result;
  result.result_id = `bench-rule-change-result:${contentIdForJson({ result_id: null, ...body })}`;
  return result;
}

async function fixture({
  variantRates = [1, 1, 1],
  variantCatastrophic = [0, 0, 0],
  buildGrid = true,
} = {}) {
  const workspace = await mkdtemp(join(tmpdir(), "studio-rule-change-"));
  const runId = "training-origin-run";
  const originClip = "Trn0r1g1nID";
  const mediaName = "clip.mp4";
  const runPath = `public/demo/runs/${runId}/run.json`;
  await writeJson(join(workspace, runPath), {
    id: runId,
    clip: { id: originClip, duration: 30, media: mediaName },
  });
  const runBinding = await fileReceipt(join(workspace, runPath), runPath);
  const sourcePath = `public/demo/runs/${runId}/source.json`;
  await writeJson(join(workspace, sourcePath), {
    kind: "youtube",
    label: "Synthetic YouTube contract fixture",
    channel: "Fixture channel",
    url: `https://www.youtube.com/watch?v=${originClip}`,
    video_id: originClip,
    licence: "Creative Commons Attribution license (reuse allowed)",
    window: { start: "00:00:00", end: "00:00:30" },
    duration: 30,
    attribution: "Synthetic fixture by Fixture channel.",
    note: "Synthetic source shape for contract tests only. Never real benchmark evidence.",
  });
  const sourceBinding = await fileReceipt(join(workspace, sourcePath), sourcePath);
  const mediaPath = `public/demo/runs/${runId}/${mediaName}`;
  await mkdir(dirname(join(workspace, mediaPath)), { recursive: true });
  await writeFile(join(workspace, mediaPath), "synthetic media bytes for contract tests\n");
  const mediaBinding = await fileReceipt(join(workspace, mediaPath), mediaPath);
  const manifestBody = {
    schema: "studio.bench.candidates.v1",
    run: runId,
    clip: { id: originClip, lang: "ko", duration_s: 30 },
    routing: { route: "training", reason: "Synthetic test origin is isolated from evaluation." },
    status: "candidate",
    scorable: false,
    source_artifacts: [runBinding, sourceBinding, mediaBinding],
    candidates: [
      {
        t_start: 0,
        t_end: 1,
        source_text: "검증",
        speakers: ["A"],
        signals: ["withheld"],
        gate: { id: "fixture", reason: "Synthetic test miss." },
        corroboration: null,
        phenomenon: "fixture.rule",
        outputs: {
          "1321-rule-subject": { text: null, withheld: { gate: "fixture", reason: "Synthetic test miss." } },
        },
        korean_gold: null,
        status: "candidate",
      },
    ],
    notes: "Synthetic rule-change test fixture. Never benchmark evidence.",
  };
  const manifest = { manifest_id: candidatesManifestId(manifestBody), ...manifestBody };
  const manifestPath = `bench/candidates/${runId}/candidates.json`;
  await writeJson(join(workspace, manifestPath), manifest);

  const packId = "fixture-pack";
  const evaluationClip = "evaluation-clip";
  const evaluationSourcePath = "bench/inputs/evaluation-clip.bin";
  await mkdir(dirname(join(workspace, evaluationSourcePath)), { recursive: true });
  await writeFile(join(workspace, evaluationSourcePath), "synthetic evaluation media bytes\n");
  const evaluationSourceBinding = await fileReceipt(
    join(workspace, evaluationSourcePath),
    evaluationSourcePath,
  );
  const gold = {
    schema: "studio.bench.gold.v1",
    pack_id: packId,
    clip_id: evaluationClip,
    status: "candidate",
    drafter: "agent:fixture-gold-drafter",
    source: {
      kind: "owned",
      url: "https://example.test/evaluation-fixture",
      channel: "fixture",
      licence: "Owned fixture",
      attribution: "Fixture owner",
    },
    mined_from: null,
    units: [
      {
        t_start: 0,
        t_end: 1,
        korean_gold: "검증",
        english_guidance: "Verification.",
        critical_units: [
          {
            id: "fixture-critical-unit",
            phenomenon: "none",
            facts: ["The output preserves the fixture meaning."],
            catastrophic_if: ["The output reverses the fixture meaning."],
          },
        ],
      },
    ],
    notes: "Synthetic frozen-gold fixture. Never real benchmark evidence.",
  };
  const goldPath = `bench/packs/${packId}/fixture-gold.json`;
  await writeJson(join(workspace, goldPath), gold);
  const goldBinding = await fileReceipt(join(workspace, goldPath), goldPath);
  const freezeBody = {
    schema: "studio.bench.freeze.v1",
    pack_id: packId,
    frozen_at: "2026-07-17T00:00:00.000Z",
    protocol: { minimum_reviewers: 2, blinded_review: true, adjudication_required: true },
    clips: [
      {
        clip_id: evaluationClip,
        role: "hard",
        source_url: null,
        gold: goldBinding,
        candidates_manifest: null,
        adjudications: [
          {
            path: "review-one.json",
            content_id: `sha256:${"2".repeat(64)}`,
            bytes: 1,
            review_id: `bench-review:sha256:${"2".repeat(64)}`,
            reviewer_name: "Fixture Reviewer One",
            reviewer_git_identity: "fixture-one <one@example.test>",
          },
          {
            path: "review-two.json",
            content_id: `sha256:${"3".repeat(64)}`,
            bytes: 1,
            review_id: `bench-review:sha256:${"3".repeat(64)}`,
            reviewer_name: "Fixture Reviewer Two",
            reviewer_git_identity: "fixture-two <two@example.test>",
          },
        ],
      },
    ],
  };
  const freeze = {
    freeze_id: receiptIdFor("bench-freeze", { freeze_id: null, ...freezeBody }, "freeze_id"),
    ...freezeBody,
  };
  const pack = {
    schema: "studio.bench.pack.v1",
    pack_id: packId,
    label: "Synthetic rule-change test pack",
    frozen: true,
    target_clip_count: 1,
    clips: [
      {
        slot: "slot-hard-01",
        role: "hard",
        status: "frozen",
        clip_id: evaluationClip,
        source: {
          kind: "owned",
          note: "Synthetic test source.",
          local_copy: evaluationSourceBinding,
        },
        gold_path: "fixture-gold.json",
        candidates_manifest: null,
      },
    ],
    freeze_receipt: "freeze.json",
  };
  await writeJson(join(workspace, `bench/packs/${packId}/pack.json`), pack);
  await writeJson(join(workspace, `bench/packs/${packId}/freeze.json`), freeze);

  const reviewStore = join(workspace, "memory/review");
  const proposalState = await recordProposal({
    store: reviewStore,
    namespace: "language-neutral/rules",
    kind: "rule",
    key: "fixture.exact-change",
    value: { instruction: "Require corroboration before commitment." },
    proposedBy: "agent:fixture-proposer",
    evidencePaths: [runPath],
    source: { run_id: runId, clip_id: originClip },
    benchmarkPackId: packId,
    createdAt: "2026-07-18T00:00:00.000Z",
    workspaceRoot: workspace,
  });
  const proposalPath = relative(workspace, proposalState.path);
  const ruleContentId = contentIdForJson(proposalState.proposal.value);
  const baselineConfig = {
    model: "deterministic-fixture",
    reviewed_memory: { rule_content_id: null },
  };
  const variantConfig = {
    model: "deterministic-fixture",
    reviewed_memory: { rule_content_id: ruleContentId },
  };
  const draft = {
    schema: RULE_CHANGE_SCHEMAS.registration,
    slug: "fixture-rule-change",
    status: "registered",
    hypothesis: "The exact reviewed rule improves critical meaning beyond repeated-run spread.",
    proposal_path: proposalPath,
    candidates_manifest_path: manifestPath,
    pack_id: packId,
    subject: {
      system_id: "1321-rule-subject",
      baseline: { config: baselineConfig },
      variant: { config: variantConfig },
    },
    capture_policy: {
      selection: "all_frozen_pack_clips",
      repetitions_per_clip: 3,
      pairing: "same_clip_and_preregistered_repetition",
      capture_after_registration_day: true,
      score_every_capture: true,
    },
    qualification_policy: {
      semantic_authority: "human_labels_only",
      score_schema: "studio.bench.score.v1",
      judge: null,
      primary_metric: "critical_meaning_rate",
      minimum_effect: 0.25,
      variance_method: "max_within_condition_clip_range",
      require_effect_exceeds_variance: true,
      catastrophic_policy: "no_new_units_and_non_increasing_total",
      outcomes: ["correct", "wrong", "withheld", "missing"],
    },
    results: null,
    notes: "Synthetic preregistration fixture. No result and no promotion authority.",
  };
  const registration = await materializeRuleChangeRegistration(draft, {
    workspaceRoot: workspace,
    registeredAt: "2026-07-19T00:00:00.000Z",
  });
  const registrationPath = "bench/rule-changes/fixture-rule-change/registration.json";
  await writeImmutableJson(join(workspace, registrationPath), registration);
  const freezeBinding = await fileReceipt(
    join(workspace, `bench/packs/${packId}/freeze.json`),
    `bench/packs/${packId}/freeze.json`,
  );

  function makeCapture(run, config) {
    return {
      schema_version: "0.1.0",
      kind: "capture",
      capture_id: run,
      captured_at: "2026-07-20",
      scored: false,
      pack_evidence: false,
      clip: {
        id: evaluationClip,
        duration_s: 30,
        lang: "ko",
        pair: "ko->en",
        source: {
          kind: "owned",
          url: "https://example.test/fixture",
          channel: "fixture",
          licence: "Owned fixture",
          attribution: "Fixture owner",
        },
      },
      reproducible: { deterministic: true, note: "Synthetic deterministic fixture." },
      systems: [{ id: "1321-rule-subject", role: "subject", config }],
      measured: {
        "1321-rule-subject": {
          units_total: 1,
          units_emitted: 1,
          units_withheld: 0,
          coverage: 1,
          latency: { first_usable_s: 1, complete_s: 2 },
        },
      },
      unscored: {
        critical_meaning: null,
        critical_outcomes: null,
        catastrophic: null,
        reason: "Capture has no semantic authority.",
      },
      units: [
        {
          t_start: 0,
          t_end: 1,
          source: "검증",
          outputs: {
            "1321-rule-subject": { text: "Verification.", withheld: null },
          },
          gold: null,
        },
      ],
      notes: "Synthetic capture fixture. Semantic labels live in the score receipt.",
    };
  }

  async function captureAndScore(run, config, rate, catastrophic, { reuseCapture = false } = {}) {
    const capturePath = `bench/runs/${run}/capture.json`;
    const capture = reuseCapture
      ? await json(join(workspace, capturePath))
      : makeCapture(run, config);
    if (!reuseCapture) await writeJson(join(workspace, capturePath), capture);
    const correct = rate === 1;
    const captureBinding = await fileReceipt(join(workspace, capturePath), capturePath);
    const labelsBody = {
      schema: "studio.bench.output-labels.v1",
      pack_id: packId,
      clip_id: evaluationClip,
      run,
      capture: captureBinding,
      blinded: true,
      reviewers: [
        { name: "Fixture Label Reviewer One", git_identity: "label-one <one@example.test>" },
        { name: "Fixture Label Reviewer Two", git_identity: "label-two <two@example.test>" },
      ],
      labels: [
        {
          t_start: 0,
          t_end: 1,
          system_id: "1321-rule-subject",
          meaning_preserved: correct,
          critical_units: [
            { id: "fixture-critical-unit", correct, catastrophic: catastrophic === 1 },
          ],
          note: null,
        },
      ],
      notes: "Synthetic blinded human-label fixture. Never real benchmark evidence.",
    };
    const labels = {
      labels_id: receiptIdFor("bench-labels", { labels_id: null, ...labelsBody }, "labels_id"),
      ...labelsBody,
    };
    const labelsPath = `bench/reviews/labels/${run}.json`;
    await writeJson(join(workspace, labelsPath), labels);
    const score = scoreCapture({
      gold,
      freeze,
      capture,
      labels,
      bindings: {
        gold: goldBinding,
        freeze: freezeBinding,
        capture: captureBinding,
        labels: await fileReceipt(join(workspace, labelsPath), labelsPath),
      },
      scoredAt: "2026-07-20T12:00:00.000Z",
    });
    const scorePath = `bench/scores/${run}/score.json`;
    await writeJson(join(workspace, scorePath), score);
    return { score, scorePath };
  }

  const pairPaths = [];
  if (buildGrid) {
    for (const [index, plan] of registration.capture_plan.entries()) {
      const without = await captureAndScore(plan.without_run, baselineConfig, 0, 0);
      const withSide = await captureAndScore(
        plan.with_run,
        variantConfig,
        variantRates[index],
        variantCatastrophic[index],
      );
      const pair = compareSubjectScores({
        withoutScore: without.score,
        withScore: withSide.score,
        withoutBinding: await fileReceipt(join(workspace, without.scorePath), without.scorePath),
        withBinding: await fileReceipt(join(workspace, withSide.scorePath), withSide.scorePath),
        subjectSystemId: "1321-rule-subject",
        comparedAt: "2026-07-21T00:00:00.000Z",
      });
      const pairPath = `bench/scores/pairs/${plan.without_run}.json`;
      await writeJson(join(workspace, pairPath), pair);
      pairPaths.push(pairPath);
    }
  }

  for (const implementationPath of [
    CAPTURE_HOST_IMPLEMENTATION_PATH,
    ...Object.values(CAPTURE_ADAPTER_IMPLEMENTATIONS),
  ]) {
    await mkdir(dirname(join(workspace, implementationPath)), { recursive: true });
    await writeFile(
      join(workspace, implementationPath),
      await readFile(join(ROOT, implementationPath)),
    );
  }
  const executor = await materializeCaptureExecutor(
    {
      adapterId: "deterministic_fixture_v1",
      notes: "Synthetic executor for deterministic contract tests only.",
    },
    { workspaceRoot: workspace },
  );
  const executorPath = captureExecutorPath(executor);
  await writeImmutableJson(join(workspace, executorPath), executor);

  const fixtureGit = (...args) => execFileSync("git", args, { cwd: workspace, stdio: "pipe" }).toString().trim();
  fixtureGit("init");
  fixtureGit("config", "user.name", "Rule Change Fixture");
  fixtureGit("config", "user.email", "rule-change@example.test");
  fixtureGit("config", "commit.gpgsign", "false");
  fixtureGit("add", "--", "bench", "memory", "public", "scripts");
  fixtureGit("commit", "-m", "Create fixture prerequisites");

  return {
    workspace,
    draft,
    registration,
    registrationPath,
    pairPaths,
    baselineConfig,
    variantConfig,
    captureAndScore,
    makeCapture,
    executorPath,
    git: fixtureGit,
  };
}

async function certifyFixtureSide(held, side, createdAt = "2026-07-19T01:00:00.000Z") {
  const release = await materializeCertifiedRelease(
    { registrationPath: held.registrationPath, side },
    {
      workspaceRoot: held.workspace,
      createdAt,
      validateRegistration: validateRuleChangeRegistration,
    },
  );
  const path = certifiedReleasePath(release);
  await writeImmutableJson(join(held.workspace, path), release);
  held.git("add", "--", path);
  held.git("commit", "-m", `Certify ${side} fixture release`);
  return { release, path };
}

async function installFixtureExecutor(held, adapterId, name) {
  const executor = await materializeCaptureExecutor(
    { adapterId, notes: `Synthetic ${name} adapter for hostile contract tests.` },
    { workspaceRoot: held.workspace },
  );
  const path = captureExecutorPath(executor);
  await writeImmutableJson(join(held.workspace, path), executor);
  held.git("add", "--", path);
  held.git("commit", "-m", `Install ${name} fixture executor`);
  return path;
}

test("certified releases cold-reopen exact candidate rule and path-free host context", async (t) => {
  const held = await fixture({ buildGrid: false });
  t.after(() => rm(held.workspace, { recursive: true, force: true }));
  const without = await certifyFixtureSide(held, "without");
  const withSide = await certifyFixtureSide(held, "with", "2026-07-19T01:01:00.000Z");

  assert.equal(without.release.reviewed_memory.candidate_rule, null);
  assert.deepEqual(without.release.host_context.reviewed_memory.entries, []);
  assert.equal(withSide.release.runtime_deployable, false);
  assert.equal(
    withSide.release.reviewed_memory.candidate_rule.rule_content_id,
    held.registration.change.rule_content_id,
  );
  assert.equal(withSide.release.host_context.reviewed_memory.entries.length, 1);
  assert.doesNotMatch(JSON.stringify(withSide.release.host_context), /"(?:path|file|directory|root|cwd|workspace)"/i);

  const reopened = await resolveCertifiedRelease(withSide.path, {
    workspaceRoot: held.workspace,
    validateRegistration: validateRuleChangeRegistration,
  });
  assert.deepEqual(reopened.hostContext, withSide.release.host_context);

  const tampered = structuredClone(withSide.release);
  tampered.host_context.reviewed_memory.entries[0].value.instruction = "Substituted rule bytes.";
  await writeJson(join(held.workspace, withSide.path), tampered);
  await assert.rejects(
    resolveCertifiedRelease(withSide.path, {
      workspaceRoot: held.workspace,
      validateRegistration: validateRuleChangeRegistration,
    }),
    /release_id does not match|host context id does not match/,
  );
});

test("certified source resolution reopens hard-ko-v1 redistributed media", async () => {
  const packPath = "bench/packs/hard-ko-v1/pack.json";
  const freezePath = "bench/packs/hard-ko-v1/freeze.json";
  const sources = await resolveCertifiedEvaluationSources(
    {
      pack: {
        manifest: await fileReceipt(join(ROOT, packPath), packPath),
        freeze: await fileReceipt(join(ROOT, freezePath), freezePath),
      },
      capture_plan: [{ clip_id: "Ux-TMWnmntM" }],
    },
    ROOT,
  );
  assert.deepEqual(sources, [
    {
      clip_id: "Ux-TMWnmntM",
      authority: await fileReceipt(
        join(ROOT, "bench/prompts/gold-drafter-v1/manifest.json"),
        "bench/prompts/gold-drafter-v1/manifest.json",
      ),
      artifact: await fileReceipt(
        join(ROOT, "public/demo/runs/run-006/clip.mp4"),
        "public/demo/runs/run-006/clip.mp4",
      ),
    },
  ]);

  const promptPath = "bench/prompts/gold-drafter-v1/manifest.json";
  const candidatesPath = "bench/candidates/run-006/candidates.json";
  const candidatesManifest = await json(join(ROOT, candidatesPath));
  const prompt = await json(join(ROOT, promptPath));
  const mediaIndex = prompt.inputs.findIndex((input) => input.role === "media");
  prompt.inputs[mediaIndex] = {
    role: "media",
    ...await fileReceipt(
      join(ROOT, "public/demo/runs/run-007/clip.mp4"),
      "public/demo/runs/run-007/clip.mp4",
    ),
  };
  prompt.prompt_id = receiptIdFor("bench-gold-prompt", prompt, "prompt_id");
  await assert.rejects(
    validateCertifiedPromptMedia(prompt, {
      clipId: "Ux-TMWnmntM",
      packId: "hard-ko-v1",
      candidates: await fileReceipt(join(ROOT, candidatesPath), candidatesPath),
      candidatesManifest,
      workspaceRoot: ROOT,
    }),
    /media differs from the frozen candidates run receipt/,
  );
});

test("single-attempt host commits its exact outcome and makes retry or overwrite impossible", async (t) => {
  const held = await fixture({ buildGrid: false });
  t.after(() => rm(held.workspace, { recursive: true, force: true }));
  const without = await certifyFixtureSide(held, "without");
  const plan = held.registration.capture_plan[0];
  const run = plan.without_run;
  const state = await runSingleAttempt(
    {
      registrationPath: held.registrationPath,
      releasePath: without.path,
      executorManifestPath: held.executorPath,
      run,
      side: "without",
    },
    {
      workspaceRoot: held.workspace,
      chargedAt: "2026-07-20T00:00:00.000Z",
      completedAt: "2026-07-20T00:01:00.000Z",
      validateRegistration: validateRuleChangeRegistration,
    },
  );
  await access(join(held.workspace, singleAttemptPaths(run).charge));
  const proof = await verifyExecutionAttribution(state.paths.attribution, {
    workspaceRoot: held.workspace,
    registration: held.registration,
    expectedRegistration: await fileReceipt(
      join(held.workspace, held.registrationPath),
      held.registrationPath,
    ),
    expectedRun: run,
    expectedSide: "without",
    expectedCapture: await fileReceipt(join(held.workspace, state.paths.capture), state.paths.capture),
    validateRegistration: validateRuleChangeRegistration,
  });
  assert.equal(proof.attempt_id, state.attribution.attempt_id);

  await assert.rejects(
    runSingleAttempt(
      {
        registrationPath: held.registrationPath,
        releasePath: without.path,
        executorManifestPath: held.executorPath,
        run,
        side: "without",
      },
      { workspaceRoot: held.workspace, validateRegistration: validateRuleChangeRegistration },
    ),
    /slot is spent|already charged/,
  );

  const overwriteRun = held.registration.capture_plan[1].without_run;
  const overwritePaths = singleAttemptPaths(overwriteRun);
  await writeJson(join(held.workspace, overwritePaths.capture), { sentinel: true });
  await assert.rejects(
    runSingleAttempt(
      {
        registrationPath: held.registrationPath,
        releasePath: without.path,
        executorManifestPath: held.executorPath,
        run: overwriteRun,
        side: "without",
      },
      { workspaceRoot: held.workspace, validateRegistration: validateRuleChangeRegistration },
    ),
    /capture already exists/,
  );
  assert.deepEqual(await json(join(held.workspace, overwritePaths.capture)), { sentinel: true });

  await writeFile(
    join(held.workspace, CAPTURE_HOST_IMPLEMENTATION_PATH),
    `${await readFile(join(ROOT, CAPTURE_HOST_IMPLEMENTATION_PATH), "utf8")}\n// later compatible host version\n`,
  );
  held.git("add", "--", CAPTURE_HOST_IMPLEMENTATION_PATH);
  held.git("commit", "-m", "Upgrade fixture capture host");
  const reopenedAfterHostUpgrade = await verifyExecutionAttribution(state.paths.attribution, {
    workspaceRoot: held.workspace,
    registration: held.registration,
    expectedRegistration: await fileReceipt(
      join(held.workspace, held.registrationPath),
      held.registrationPath,
    ),
    expectedRun: run,
    expectedSide: "without",
    expectedCapture: await fileReceipt(join(held.workspace, state.paths.capture), state.paths.capture),
    validateRegistration: validateRuleChangeRegistration,
  });
  assert.equal(reopenedAfterHostUpgrade.attempt_id, state.attribution.attempt_id);

  const forgedCapture = await json(join(held.workspace, state.paths.capture));
  forgedCapture.units[0].outputs[held.registration.subject.system_id].text = "Forged after invocation.";
  await writeJson(join(held.workspace, state.paths.capture), forgedCapture);
  const forgedCaptureBinding = await fileReceipt(join(held.workspace, state.paths.capture), state.paths.capture);
  const forgedAttribution = await json(join(held.workspace, state.paths.attribution));
  forgedAttribution.capture = { ...forgedCaptureBinding, id: forgedCapture.capture_id };
  const { attribution_id: _forgedId, ...forgedAttributionBody } = forgedAttribution;
  forgedAttribution.attribution_id = `bench-execution-attribution:${contentIdForJson({
    attribution_id: null,
    ...forgedAttributionBody,
  })}`;
  await writeJson(join(held.workspace, state.paths.attribution), forgedAttribution);
  await assert.rejects(
    verifyExecutionAttribution(state.paths.attribution, {
      workspaceRoot: held.workspace,
      registration: held.registration,
      expectedRegistration: await fileReceipt(
        join(held.workspace, held.registrationPath),
        held.registrationPath,
      ),
      expectedRun: run,
      expectedSide: "without",
      expectedCapture: forgedCaptureBinding,
      validateRegistration: validateRuleChangeRegistration,
    }),
    /uncommitted or changed after its evidence commit/,
  );

});

test("failed single attempt remains charged and duplicate attempt ids fail closed", async (t) => {
  const held = await fixture({ buildGrid: false });
  t.after(() => rm(held.workspace, { recursive: true, force: true }));
  const without = await certifyFixtureSide(held, "without");
  const failingExecutorPath = await installFixtureExecutor(
    held,
    "deterministic_fixture_failure_v1",
    "failing-single-attempt",
  );
  const run = held.registration.capture_plan[0].without_run;
  await assert.rejects(
    runSingleAttempt(
      {
        registrationPath: held.registrationPath,
        releasePath: without.path,
        executorManifestPath: failingExecutorPath,
        run,
        side: "without",
      },
      {
        workspaceRoot: held.workspace,
        chargedAt: "2026-07-20T00:00:00.000Z",
        completedAt: "2026-07-20T00:01:00.000Z",
        validateRegistration: validateRuleChangeRegistration,
      },
    ),
    /deterministic fixture executor failed after charge/,
  );
  const paths = singleAttemptPaths(run);
  await access(join(held.workspace, paths.charge));
  await assert.rejects(access(join(held.workspace, paths.attribution)));
  await assert.rejects(
    runSingleAttempt(
      {
        registrationPath: held.registrationPath,
        releasePath: without.path,
        executorManifestPath: held.executorPath,
        run,
        side: "without",
      },
      { workspaceRoot: held.workspace, validateRegistration: validateRuleChangeRegistration },
    ),
    /slot is spent|already charged/,
  );

  const duplicateRun = `${run}-duplicate`;
  const duplicatePath = singleAttemptPaths(duplicateRun).charge;
  await writeJson(join(held.workspace, duplicatePath), await json(join(held.workspace, paths.charge)));
  await assert.rejects(
    auditSingleAttemptCharges({ workspaceRoot: held.workspace }),
    /duplicate attempt id/,
  );
  await rm(join(held.workspace, dirname(duplicatePath)), { recursive: true, force: true });
  await rm(join(held.workspace, dirname(paths.charge)), { recursive: true, force: true });
  await assert.rejects(
    runSingleAttempt(
      {
        registrationPath: held.registrationPath,
        releasePath: without.path,
        executorManifestPath: held.executorPath,
        run,
        side: "without",
      },
      { workspaceRoot: held.workspace, validateRegistration: validateRuleChangeRegistration },
    ),
    /names a deleted charge/,
  );
});

test("single-attempt host refuses tampered frozen media, host, and adapter bytes before invocation", async (t) => {
  const held = await fixture({ buildGrid: false });
  t.after(() => rm(held.workspace, { recursive: true, force: true }));
  const without = await certifyFixtureSide(held, "without");
  const sourcePath = "bench/inputs/evaluation-clip.bin";
  const firstRun = held.registration.capture_plan[0].without_run;
  const unrelatedPath = "bench/inputs/unrelated.bin";
  await writeFile(join(held.workspace, unrelatedPath), "unrelated bytes\n");
  await assert.rejects(
    runSingleAttempt(
      {
        registrationPath: held.registrationPath,
        releasePath: without.path,
        executorManifestPath: held.executorPath,
        run: firstRun,
        side: "without",
        sourcePath: unrelatedPath,
      },
      { workspaceRoot: held.workspace, validateRegistration: validateRuleChangeRegistration },
    ),
    /keys must be exactly/,
  );
  await writeFile(join(held.workspace, sourcePath), "substituted evaluation media bytes\n");
  await assert.rejects(
    runSingleAttempt(
      {
        registrationPath: held.registrationPath,
        releasePath: without.path,
        executorManifestPath: held.executorPath,
        run: firstRun,
        side: "without",
      },
      { workspaceRoot: held.workspace, validateRegistration: validateRuleChangeRegistration },
    ),
    /evaluation source|no longer matches its recorded bytes/,
  );
  await assert.rejects(access(join(held.workspace, singleAttemptPaths(firstRun).charge)));

  await writeFile(join(held.workspace, sourcePath), "synthetic evaluation media bytes\n");
  await writeFile(
    join(held.workspace, CAPTURE_HOST_IMPLEMENTATION_PATH),
    `${await readFile(join(ROOT, CAPTURE_HOST_IMPLEMENTATION_PATH), "utf8")}\n// substituted after certification\n`,
  );
  const secondRun = held.registration.capture_plan[1].without_run;
  await assert.rejects(
    runSingleAttempt(
      {
        registrationPath: held.registrationPath,
        releasePath: without.path,
        executorManifestPath: held.executorPath,
        run: secondRun,
        side: "without",
      },
      { workspaceRoot: held.workspace, validateRegistration: validateRuleChangeRegistration },
    ),
    /capture executor host|no longer matches its recorded bytes/,
  );
  await assert.rejects(access(join(held.workspace, singleAttemptPaths(secondRun).charge)));
  await writeFile(
    join(held.workspace, CAPTURE_HOST_IMPLEMENTATION_PATH),
    await readFile(join(ROOT, CAPTURE_HOST_IMPLEMENTATION_PATH)),
  );

  const fixtureAdapterPath = CAPTURE_ADAPTER_IMPLEMENTATIONS.deterministic_fixture_v1;
  await writeFile(
    join(held.workspace, fixtureAdapterPath),
    `${await readFile(join(ROOT, fixtureAdapterPath), "utf8")}\n// substituted after certification\n`,
  );
  const thirdRun = held.registration.capture_plan[2].without_run;
  await assert.rejects(
    runSingleAttempt(
      {
        registrationPath: held.registrationPath,
        releasePath: without.path,
        executorManifestPath: held.executorPath,
        run: thirdRun,
        side: "without",
      },
      { workspaceRoot: held.workspace, validateRegistration: validateRuleChangeRegistration },
    ),
    /capture executor implementation|no longer matches its recorded bytes/,
  );
  await assert.rejects(access(join(held.workspace, singleAttemptPaths(thirdRun).charge)));
});

test("single-attempt host refuses caller-supplied executable authority", async (t) => {
  const held = await fixture({ buildGrid: false });
  t.after(() => rm(held.workspace, { recursive: true, force: true }));
  const without = await certifyFixtureSide(held, "without");
  const hostileExecutor = await json(join(held.workspace, held.executorPath));
  hostileExecutor.module = {
    path: "scripts/bench-executors/hostile.mjs",
    content_id: `sha256:${"f".repeat(64)}`,
    bytes: 1,
  };
  await writeJson(join(held.workspace, held.executorPath), hostileExecutor);
  const run = held.registration.capture_plan[0].without_run;
  await assert.rejects(
    runSingleAttempt(
      {
        registrationPath: held.registrationPath,
        releasePath: without.path,
        executorManifestPath: held.executorPath,
        run,
        side: "without",
      },
      {
        workspaceRoot: held.workspace,
        chargedAt: "2026-07-20T00:00:00.000Z",
        completedAt: "2026-07-20T00:01:00.000Z",
        validateRegistration: validateRuleChangeRegistration,
      },
    ),
    /additional properties|capture executor/i,
  );
  await assert.rejects(access(join(held.workspace, singleAttemptPaths(run).charge)));
});

test("execution attribution refuses a missing charge", async (t) => {
  const held = await fixture({ buildGrid: false });
  t.after(() => rm(held.workspace, { recursive: true, force: true }));
  const without = await certifyFixtureSide(held, "without");
  const run = held.registration.capture_plan[0].without_run;
  const state = await runSingleAttempt(
    {
      registrationPath: held.registrationPath,
      releasePath: without.path,
      executorManifestPath: held.executorPath,
      run,
      side: "without",
    },
    {
      workspaceRoot: held.workspace,
      chargedAt: "2026-07-20T00:00:00.000Z",
      completedAt: "2026-07-20T00:01:00.000Z",
      validateRegistration: validateRuleChangeRegistration,
    },
  );
  await rm(join(held.workspace, state.paths.charge));
  await assert.rejects(
    verifyExecutionAttribution(state.paths.attribution, {
      workspaceRoot: held.workspace,
      registration: held.registration,
      expectedRegistration: await fileReceipt(
        join(held.workspace, held.registrationPath),
        held.registrationPath,
      ),
      expectedRun: run,
      expectedSide: "without",
      expectedCapture: await fileReceipt(join(held.workspace, state.paths.capture), state.paths.capture),
      validateRegistration: validateRuleChangeRegistration,
    }),
    /not readable JSON|ENOENT|single-attempt charge/,
  );
});

test("rule change V2 qualifies only when every capture has certified execution proof", async (t) => {
  const held = await fixture({ buildGrid: false });
  t.after(() => rm(held.workspace, { recursive: true, force: true }));
  const withoutRelease = await certifyFixtureSide(held, "without");
  const withRelease = await certifyFixtureSide(held, "with", "2026-07-19T01:01:00.000Z");
  const proofPaths = [];
  const pairPaths = [];

  for (const plan of held.registration.capture_plan) {
    const withoutState = await runSingleAttempt(
      {
        registrationPath: held.registrationPath,
        releasePath: withoutRelease.path,
        executorManifestPath: held.executorPath,
        run: plan.without_run,
        side: "without",
      },
      {
        workspaceRoot: held.workspace,
        chargedAt: "2026-07-20T00:00:00.000Z",
        completedAt: "2026-07-20T00:01:00.000Z",
        validateRegistration: validateRuleChangeRegistration,
      },
    );
    const withState = await runSingleAttempt(
      {
        registrationPath: held.registrationPath,
        releasePath: withRelease.path,
        executorManifestPath: held.executorPath,
        run: plan.with_run,
        side: "with",
      },
      {
        workspaceRoot: held.workspace,
        chargedAt: "2026-07-20T00:02:00.000Z",
        completedAt: "2026-07-20T00:03:00.000Z",
        validateRegistration: validateRuleChangeRegistration,
      },
    );
    proofPaths.push(withoutState.paths.attribution, withState.paths.attribution);
    const without = await held.captureAndScore(
      plan.without_run,
      held.baselineConfig,
      0,
      0,
      { reuseCapture: true },
    );
    const withSide = await held.captureAndScore(
      plan.with_run,
      held.variantConfig,
      1,
      0,
      { reuseCapture: true },
    );
    const pair = compareSubjectScores({
      withoutScore: without.score,
      withScore: withSide.score,
      withoutBinding: await fileReceipt(join(held.workspace, without.scorePath), without.scorePath),
      withBinding: await fileReceipt(join(held.workspace, withSide.scorePath), withSide.scorePath),
      subjectSystemId: "1321-rule-subject",
      comparedAt: "2026-07-21T00:00:00.000Z",
    });
    const pairPath = `bench/scores/pairs/${plan.without_run}.json`;
    await writeJson(join(held.workspace, pairPath), pair);
    pairPaths.push(pairPath);
  }

  const incomplete = await materializeRuleChangeResult(
    {
      registrationPath: held.registrationPath,
      pairPaths,
      proofPaths: proofPaths.slice(0, -1),
    },
    { workspaceRoot: held.workspace, evaluatedAt: "2026-07-22T00:00:00.000Z" },
  );
  assert.equal(incomplete.qualification.status, "refused");
  assert.equal(incomplete.qualification.checks.single_attempt_proven, false);
  assert.equal(incomplete.qualification.checks.execution_attribution_proven, false);

  const result = await materializeRuleChangeResult(
    { registrationPath: held.registrationPath, pairPaths, proofPaths },
    { workspaceRoot: held.workspace, evaluatedAt: "2026-07-22T00:00:00.000Z" },
  );
  assert.equal(result.schema, RULE_CHANGE_SCHEMAS.result);
  assert.equal(result.qualification.status, "qualified");
  assert.equal(result.qualification.promotion_eligibility, "eligible_for_human_review");
  assert.equal(result.qualification.checks.single_attempt_proven, true);
  assert.equal(result.qualification.checks.execution_attribution_proven, true);
  assert.equal(result.judge, null);
  await verifyRuleChangeResult(result, { workspaceRoot: held.workspace });

  const firstCapture = join(held.workspace, `bench/runs/${held.registration.capture_plan[0].without_run}/capture.json`);
  const tamperedCapture = await json(firstCapture);
  tamperedCapture.notes = "Tampered after qualification.";
  await writeJson(firstCapture, tamperedCapture);
  await assert.rejects(
    verifyRuleChangeResult(result, { workspaceRoot: held.workspace }),
    /no longer matches its recorded bytes/,
  );
});

test("single-attempt host refuses a capture carrying a stale configuration", async (t) => {
  const held = await fixture({ buildGrid: false });
  t.after(() => rm(held.workspace, { recursive: true, force: true }));
  const without = await certifyFixtureSide(held, "without");
  const staleExecutorPath = await installFixtureExecutor(
    held,
    "deterministic_fixture_stale_config_v1",
    "stale-config-single-attempt",
  );
  const run = held.registration.capture_plan[0].without_run;
  await assert.rejects(
    runSingleAttempt(
      {
        registrationPath: held.registrationPath,
        releasePath: without.path,
        executorManifestPath: staleExecutorPath,
        run,
        side: "without",
      },
      {
        workspaceRoot: held.workspace,
        chargedAt: "2026-07-20T00:00:00.000Z",
        completedAt: "2026-07-20T00:01:00.000Z",
        validateRegistration: validateRuleChangeRegistration,
      },
    ),
    /does not carry the certified without configuration/,
  );
  await access(join(held.workspace, singleAttemptPaths(run).charge));
  await assert.rejects(access(join(held.workspace, singleAttemptPaths(run).capture)));
});

test("historical V1 rule-change results cold-rederive with their original bytes", async (t) => {
  const held = await fixture();
  t.after(() => rm(held.workspace, { recursive: true, force: true }));
  const result = await materializeRuleChangeResult(
    {
      registrationPath: held.registrationPath,
      pairPaths: held.pairPaths,
      resultSchema: RULE_CHANGE_SCHEMAS.resultV1,
    },
    { workspaceRoot: held.workspace, evaluatedAt: "2026-07-22T00:00:00.000Z" },
  );
  assert.equal(
    result.notes,
    "Mechanical evaluation only. V1 refuses promotion because no host-owned single-attempt and execution-attribution receipt exists. This receipt does not prove a later run consumed the rule.",
  );
  assert.equal(result.qualification.checks.single_attempt_proven, false);
  await verifyRuleChangeResult(result, { workspaceRoot: held.workspace });
});

test("rule change registration is result-free, contamination-guarded, and exact-change bound", async (t) => {
  const held = await fixture();
  t.after(() => rm(held.workspace, { recursive: true, force: true }));
  await validateRuleChangeRegistration(held.registration, { workspaceRoot: held.workspace });
  assert.equal(held.registration.results, null);
  assert.equal(held.registration.change.origin.route, "training");
  assert.equal(held.registration.capture_plan.length, 3);
  assert.equal(held.registration.delta.baseline, null);
  assert.equal(held.registration.delta.variant, held.registration.change.rule_content_id);

  const postHoc = structuredClone(held.registration);
  postHoc.results = { winner: "with" };
  resealRegistration(postHoc);
  await assert.rejects(
    validateRuleChangeRegistration(postHoc, { workspaceRoot: held.workspace }),
    /results/,
  );

  const multiChange = structuredClone(held.draft);
  multiChange.subject.variant.config.model = "different-model";
  await assert.rejects(
    materializeRuleChangeRegistration(multiChange, {
      workspaceRoot: held.workspace,
      registeredAt: "2026-07-19T00:00:00.000Z",
    }),
    /exactly one scalar config leaf/,
  );

  const tooFew = structuredClone(held.draft);
  tooFew.capture_policy.repetitions_per_clip = 2;
  await assert.rejects(
    materializeRuleChangeRegistration(tooFew, {
      workspaceRoot: held.workspace,
      registeredAt: "2026-07-19T00:00:00.000Z",
    }),
    /repetitions_per_clip/,
  );

  const negligibleFloor = structuredClone(held.draft);
  negligibleFloor.qualification_policy.minimum_effect = 0.01;
  await assert.rejects(
    materializeRuleChangeRegistration(negligibleFloor, {
      workspaceRoot: held.workspace,
      registeredAt: "2026-07-19T00:00:00.000Z",
    }),
    /minimum_effect/,
  );

  const manifest = await json(join(held.workspace, held.draft.candidates_manifest_path));
  const sourcePath = `public/demo/runs/${manifest.run}/source.json`;
  const source = await json(join(held.workspace, sourcePath));
  source.url = "https://example.test/not-youtube";
  await writeJson(join(held.workspace, sourcePath), source);
  manifest.source_artifacts = manifest.source_artifacts.map((artifact) =>
    artifact.path === sourcePath
      ? null
      : artifact,
  );
  manifest.source_artifacts = [
    ...manifest.source_artifacts.filter(Boolean),
    await fileReceipt(join(held.workspace, sourcePath), sourcePath),
  ];
  let { manifest_id: _manifestId, ...manifestBody } = manifest;
  manifest.manifest_id = candidatesManifestId(manifestBody);
  await writeJson(join(held.workspace, held.draft.candidates_manifest_path), manifest);
  await assert.rejects(
    materializeRuleChangeRegistration(held.draft, {
      workspaceRoot: held.workspace,
      registeredAt: "2026-07-19T00:00:00.000Z",
    }),
    /HTTPS YouTube URL/,
  );

  source.url = `https://www.youtube.com/watch?v=${manifest.clip.id}`;
  await writeJson(join(held.workspace, sourcePath), source);
  manifest.source_artifacts = manifest.source_artifacts.map((artifact) =>
    artifact.path === sourcePath
      ? null
      : artifact,
  );
  manifest.source_artifacts = [
    ...manifest.source_artifacts.filter(Boolean),
    await fileReceipt(join(held.workspace, sourcePath), sourcePath),
  ];
  ({ manifest_id: _manifestId, ...manifestBody } = manifest);
  manifest.manifest_id = candidatesManifestId(manifestBody);
  await writeJson(join(held.workspace, held.draft.candidates_manifest_path), manifest);

  const mediaArtifact = manifest.source_artifacts.find((artifact) => artifact.path.endsWith("/clip.mp4"));
  manifest.source_artifacts = manifest.source_artifacts.filter((artifact) => artifact !== mediaArtifact);
  ({ manifest_id: _manifestId, ...manifestBody } = manifest);
  manifest.manifest_id = candidatesManifestId(manifestBody);
  await writeJson(join(held.workspace, held.draft.candidates_manifest_path), manifest);
  await assert.rejects(
    materializeRuleChangeRegistration(held.draft, {
      workspaceRoot: held.workspace,
      registeredAt: "2026-07-19T00:00:00.000Z",
    }),
    /does not bind .*clip\.mp4/,
  );

  manifest.source_artifacts.push(mediaArtifact);
  ({ manifest_id: _manifestId, ...manifestBody } = manifest);
  manifest.manifest_id = candidatesManifestId(manifestBody);
  await writeJson(join(held.workspace, held.draft.candidates_manifest_path), manifest);

  source.kind = "owned_local";
  await writeJson(join(held.workspace, sourcePath), source);
  manifest.source_artifacts = manifest.source_artifacts.map((artifact) =>
    artifact.path === sourcePath
      ? null
      : artifact,
  );
  manifest.source_artifacts = [
    ...manifest.source_artifacts.filter(Boolean),
    await fileReceipt(join(held.workspace, sourcePath), sourcePath),
  ];
  ({ manifest_id: _manifestId, ...manifestBody } = manifest);
  manifest.manifest_id = candidatesManifestId(manifestBody);
  await writeJson(join(held.workspace, held.draft.candidates_manifest_path), manifest);
  await assert.rejects(
    materializeRuleChangeRegistration(held.draft, {
      workspaceRoot: held.workspace,
      registeredAt: "2026-07-19T00:00:00.000Z",
    }),
    /valid redistributable YouTube source|matching YouTube source identity/,
  );

  source.kind = "youtube";
  source.url = `https://www.youtube.com/watch?v=${manifest.clip.id}`;
  source.video_id = manifest.clip.id;
  source.licence = "Creative Commons Attribution license (reuse allowed)";
  source.window = { start: "00:00:00", end: "00:00:30" };
  source.duration = 30;
  source.attribution = "Synthetic fixture by Fixture channel.";
  await writeJson(join(held.workspace, sourcePath), source);
  manifest.source_artifacts = manifest.source_artifacts.map((artifact) =>
    artifact.path === sourcePath
      ? null
      : artifact,
  );
  manifest.source_artifacts = [
    ...manifest.source_artifacts.filter(Boolean),
    await fileReceipt(join(held.workspace, sourcePath), sourcePath),
  ];
  manifest.routing.route = "gold";
  ({ manifest_id: _manifestId, ...manifestBody } = manifest);
  manifest.manifest_id = candidatesManifestId(manifestBody);
  await writeJson(join(held.workspace, held.draft.candidates_manifest_path), manifest);
  await assert.rejects(
    materializeRuleChangeRegistration(held.draft, {
      workspaceRoot: held.workspace,
      registeredAt: "2026-07-19T00:00:00.000Z",
    }),
    /route|training/,
  );
});

test("rule change result evaluates the complete grid but refuses unproven execution", async (t) => {
  const held = await fixture();
  t.after(() => rm(held.workspace, { recursive: true, force: true }));
  const result = await materializeRuleChangeResult(
    { registrationPath: held.registrationPath, pairPaths: held.pairPaths },
    { workspaceRoot: held.workspace, evaluatedAt: "2026-07-22T00:00:00.000Z" },
  );
  assert.equal(result.qualification.status, "refused");
  assert.equal(result.qualification.promotion_eligibility, "ineligible");
  assert.equal(result.summary.delta.critical_meaning_rate, 1);
  assert.equal(result.summary.variance.observed_floor, 0);
  assert.equal(result.qualification.checks.minimum_effect_met, true);
  assert.equal(result.qualification.checks.single_attempt_proven, false);
  assert.equal(result.qualification.checks.execution_attribution_proven, false);
  assert.match(result.qualification.reasons.join("\n"), /best-of-K|execution receipt/);
  assert.equal(result.judge, null);
  await verifyRuleChangeResult(result, { workspaceRoot: held.workspace });

  await assert.rejects(
    materializeRuleChangeResult(
      { registrationPath: held.registrationPath, pairPaths: held.pairPaths.slice(1) },
      { workspaceRoot: held.workspace, evaluatedAt: "2026-07-22T00:00:00.000Z" },
    ),
    /requires 3 preregistered pairs/,
  );

  const forged = structuredClone(result);
  forged.summary.delta.critical_meaning_rate = 999;
  resealResult(forged);
  await validateRuleChangeResult(forged);
  await assert.rejects(
    verifyRuleChangeResult(forged, { workspaceRoot: held.workspace }),
    /does not rederive/,
  );

  await held.captureAndScore("unplanned-matching-run", held.baselineConfig, 0, 0);
  await assert.rejects(
    materializeRuleChangeResult(
      { registrationPath: held.registrationPath, pairPaths: held.pairPaths },
      { workspaceRoot: held.workspace, evaluatedAt: "2026-07-22T00:00:00.000Z" },
    ),
    /unplanned matching capture/,
  );
});

test("rule change result refuses weak, high-variance, and catastrophic changes", async (t) => {
  await t.test("weak effect", async (inner) => {
    const held = await fixture({ variantRates: [0, 0, 0] });
    inner.after(() => rm(held.workspace, { recursive: true, force: true }));
    const result = await materializeRuleChangeResult(
      { registrationPath: held.registrationPath, pairPaths: held.pairPaths },
      { workspaceRoot: held.workspace, evaluatedAt: "2026-07-22T00:00:00.000Z" },
    );
    assert.equal(result.qualification.status, "refused");
    assert.equal(result.qualification.checks.minimum_effect_met, false);
  });

  await t.test("effect below observed variance", async (inner) => {
    const held = await fixture({ variantRates: [1, 0, 1] });
    inner.after(() => rm(held.workspace, { recursive: true, force: true }));
    const result = await materializeRuleChangeResult(
      { registrationPath: held.registrationPath, pairPaths: held.pairPaths },
      { workspaceRoot: held.workspace, evaluatedAt: "2026-07-22T00:00:00.000Z" },
    );
    assert.equal(result.summary.variance.observed_floor, 1);
    assert.equal(result.qualification.checks.minimum_effect_met, true);
    assert.equal(result.qualification.checks.effect_exceeds_observed_variance, false);
    assert.equal(result.qualification.status, "refused");
  });

  await t.test("catastrophic increase", async (inner) => {
    const held = await fixture({ variantRates: [0, 1, 1], variantCatastrophic: [1, 0, 0] });
    inner.after(() => rm(held.workspace, { recursive: true, force: true }));
    const result = await materializeRuleChangeResult(
      { registrationPath: held.registrationPath, pairPaths: held.pairPaths },
      { workspaceRoot: held.workspace, evaluatedAt: "2026-07-22T00:00:00.000Z" },
    );
    assert.equal(result.qualification.checks.catastrophic_non_increase, false);
    assert.equal(result.qualification.checks.no_new_catastrophic_units, false);
    assert.equal(result.summary.new_catastrophic_units, 1);
    assert.equal(result.qualification.status, "refused");
  });
});

test("rule change git ancestry orders capture, labels, score, pair, and result", async (t) => {
  const workspace = await mkdtemp(join(tmpdir(), "studio-rule-change-git-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd: workspace, stdio: "pipe" }).toString().trim();
  git("init");
  git("config", "user.name", "Rule Change Fixture");
  git("config", "user.email", "rule-change@example.test");
  git("config", "commit.gpgsign", "false");

  async function commit(pathValues, message) {
    for (const [path, value] of pathValues) await writeJson(join(workspace, path), value);
    git("add", "--", ...pathValues.map(([path]) => path));
    git("commit", "-m", message);
    return git("rev-parse", "HEAD");
  }

  const registrationPath = "bench/rule-changes/fixture/registration.json";
  const capturePath = "bench/runs/fixture/capture.json";
  const labelsPath = "bench/reviews/labels/fixture.json";
  const scorePath = "bench/scores/fixture/score.json";
  const pairPath = "bench/scores/pairs/fixture.json";
  const resultPath = "bench/rule-changes/fixture/result.json";
  const registrationCommit = await commit([[registrationPath, { kind: "registration" }]], "register");
  const captureCommit = await commit([[capturePath, { kind: "capture" }]], "capture");
  const labelsCommit = await commit([[labelsPath, { kind: "labels" }]], "labels");
  const scoreCommit = await commit([[scorePath, { kind: "score" }]], "score");
  const pairCommit = await commit([[pairPath, { kind: "pair" }]], "pair");
  const resultCommit = await commit([[resultPath, { kind: "result" }]], "result");

  assert.equal(
    immutableArtifactAfter(registrationCommit, capturePath, { workspaceRoot: workspace }),
    captureCommit,
  );
  assert.equal(
    immutableArtifactAfter(captureCommit, labelsPath, { workspaceRoot: workspace }),
    labelsCommit,
  );
  assert.equal(immutableArtifactAfter(labelsCommit, scorePath, { workspaceRoot: workspace }), scoreCommit);
  assert.equal(immutableArtifactAfter(scoreCommit, pairPath, { workspaceRoot: workspace }), pairCommit);
  assert.equal(
    assertCommitDescends(pairCommit, resultCommit, { workspaceRoot: workspace }),
    resultCommit,
  );

  const sameCommitWorkspace = await mkdtemp(join(tmpdir(), "studio-rule-change-git-same-"));
  t.after(() => rm(sameCommitWorkspace, { recursive: true, force: true }));
  const sameGit = (...args) => execFileSync("git", args, { cwd: sameCommitWorkspace, stdio: "pipe" });
  sameGit("init");
  sameGit("config", "user.name", "Rule Change Fixture");
  sameGit("config", "user.email", "rule-change@example.test");
  sameGit("config", "commit.gpgsign", "false");
  await writeJson(join(sameCommitWorkspace, capturePath), { kind: "capture" });
  await writeJson(join(sameCommitWorkspace, labelsPath), { kind: "labels" });
  sameGit("add", "--", capturePath, labelsPath);
  sameGit("commit", "-m", "capture and labels");
  const sameCommit = sameGit("rev-parse", "HEAD").toString().trim();
  assert.throws(
    () => immutableArtifactAfter(sameCommit, labelsPath, { workspaceRoot: sameCommitWorkspace }),
    /shares a commit/,
  );

  const preLabelWorkspace = await mkdtemp(join(tmpdir(), "studio-rule-change-git-prelabel-"));
  t.after(() => rm(preLabelWorkspace, { recursive: true, force: true }));
  const preGit = (...args) => execFileSync("git", args, { cwd: preLabelWorkspace, stdio: "pipe" });
  preGit("init");
  preGit("config", "user.name", "Rule Change Fixture");
  preGit("config", "user.email", "rule-change@example.test");
  preGit("config", "commit.gpgsign", "false");
  await writeJson(join(preLabelWorkspace, labelsPath), { kind: "labels" });
  preGit("add", "--", labelsPath);
  preGit("commit", "-m", "labels first");
  await writeJson(join(preLabelWorkspace, registrationPath), { kind: "registration" });
  preGit("add", "--", registrationPath);
  preGit("commit", "-m", "registration later");
  const laterRegistrationCommit = preGit("rev-parse", "HEAD").toString().trim();
  assert.throws(
    () => immutableArtifactAfter(laterRegistrationCommit, labelsPath, { workspaceRoot: preLabelWorkspace }),
    /does not descend/,
  );

  await writeJson(join(workspace, resultPath), { kind: "mutated-result" });
  assert.throws(
    () => immutableArtifactCommit(resultPath, { workspaceRoot: workspace }),
    /changed after its evidence commit/,
  );
  await rm(join(workspace, pairPath));
  assert.throws(
    () => immutableArtifactCommit(pairPath, { workspaceRoot: workspace }),
    /changed after its evidence commit/,
  );
});
