import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  benchAblationId,
  benchConfigId,
  materializeAblationRegistration,
  validateAblationRegistration,
} from "../scripts/lib/bench-ablation.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REGISTRATION_PATH = join(
  ROOT,
  "bench/ablations/hard-ko-v1-raw-vs-eligible-stem/registration.json",
);

async function registration() {
  return JSON.parse(await readFile(REGISTRATION_PATH, "utf8"));
}

function reseal(value) {
  value.subject.baseline.config_id = benchConfigId(value.subject.baseline.config);
  value.subject.variant.config_id = benchConfigId(value.subject.variant.config);
  value.ablation_id = benchAblationId(value);
  return value;
}

function draftFrom(value) {
  return {
    schema: value.schema,
    slug: value.slug,
    status: value.status,
    family: value.family,
    hypothesis: value.hypothesis,
    pack: { pack_id: value.pack.pack_id },
    subject: {
      system_id: value.subject.system_id,
      baseline: { config: value.subject.baseline.config },
      variant: { config: value.subject.variant.config },
    },
    delta: value.delta,
    capture_policy: value.capture_policy,
    lanes: value.lanes,
    results: value.results,
    notes: value.notes,
  };
}

test("committed raw-versus-eligible-stem registration re-derives from frozen bytes", async () => {
  const held = await registration();
  const validated = await validateAblationRegistration(held, { workspaceRoot: ROOT });
  assert.equal(validated.results, null);
  assert.equal(validated.lanes.semantic.judge, null);
  assert.equal(validated.lanes.structural.semantic_authority, false);
  assert.equal(validated.delta.path, "/audio/input_mode");

  const rematerialized = await materializeAblationRegistration(draftFrom(held), {
    workspaceRoot: ROOT,
    registeredAt: held.registered_at,
  });
  assert.deepEqual(rematerialized, held);
});

test("ablation registration fails closed on ids, pack bytes, timing, and multiple deltas", async (t) => {
  await t.test("forged ablation id", async () => {
    const held = await registration();
    held.ablation_id = `bench-ablation:sha256:${"0".repeat(64)}`;
    await assert.rejects(
      validateAblationRegistration(held, { workspaceRoot: ROOT }),
      /ablation_id does not match/,
    );
  });

  await t.test("forged configuration id", async () => {
    const held = await registration();
    held.subject.variant.config_id = `bench-config:sha256:${"0".repeat(64)}`;
    held.ablation_id = benchAblationId(held);
    await assert.rejects(
      validateAblationRegistration(held, { workspaceRoot: ROOT }),
      /variant config_id does not match/,
    );
  });

  await t.test("pack binding drift", async () => {
    const held = await registration();
    held.pack.manifest.content_id = `sha256:${"0".repeat(64)}`;
    held.ablation_id = benchAblationId(held);
    await assert.rejects(
      validateAblationRegistration(held, { workspaceRoot: ROOT }),
      /no longer matches its recorded bytes/,
    );
  });

  await t.test("registration before freeze", async () => {
    const held = await registration();
    held.registered_at = "2026-07-15T12:20:01.490Z";
    held.ablation_id = benchAblationId(held);
    await assert.rejects(
      validateAblationRegistration(held, { workspaceRoot: ROOT }),
      /strictly after the frozen pack/,
    );
  });

  await t.test("two changed configuration leaves", async () => {
    const held = await registration();
    held.subject.variant.config.separation.method_version = "2";
    reseal(held);
    await assert.rejects(
      validateAblationRegistration(held, { workspaceRoot: ROOT }),
      /exactly one scalar configuration leaf; found 2/,
    );
  });

  await t.test("delta that does not describe the changed leaf", async () => {
    const held = await registration();
    held.delta.path = "/comparison/recognizer_scope";
    held.ablation_id = benchAblationId(held);
    await assert.rejects(
      validateAblationRegistration(held, { workspaceRoot: ROOT }),
      /delta does not describe/,
    );
  });
});

test("ablation registration cannot grow semantic authority or result selection", async (t) => {
  const rejected = async (mutate, pattern) => {
    const held = await registration();
    mutate(held);
    held.ablation_id = benchAblationId(held);
    await assert.rejects(validateAblationRegistration(held, { workspaceRoot: ROOT }), pattern);
  };

  await t.test("non-null judge", () =>
    rejected((held) => {
      held.lanes.semantic.judge = { model: "self-grader" };
    }, /lanes\/semantic\/judge/));

  await t.test("non-null results", () =>
    rejected((held) => {
      held.results = { winner: "variant" };
    }, /results/));

  await t.test("structural semantic authority", () =>
    rejected((held) => {
      held.lanes.structural.semantic_authority = true;
    }, /semantic_authority/));

  await t.test("fewer than three repetitions", () =>
    rejected((held) => {
      held.capture_policy.minimum_repetitions_per_clip = 2;
    }, /minimum_repetitions_per_clip/));

  await t.test("dropping ineligible variant output", () =>
    rejected((held) => {
      held.capture_policy.ineligible_variant_outcome = "exclude";
    }, /ineligible_variant_outcome/));

  await t.test("best-stem selection", () =>
    rejected((held) => {
      held.capture_policy.variant_inputs = "best_stem_only";
    }, /variant_inputs/));
});

test("materializer owns registration time and keeps pack paths closed", async (t) => {
  const held = await registration();

  await t.test("draft cannot inject a registration timestamp", async () => {
    const draft = { ...draftFrom(held), registered_at: "2020-01-01T00:00:00.000Z" };
    await assert.rejects(
      materializeAblationRegistration(draft, { workspaceRoot: ROOT }),
      /shape is not closed; extra: registered_at/,
    );
  });

  await t.test("pack id cannot traverse outside the bench pack namespace", async () => {
    const draft = draftFrom(held);
    draft.pack.pack_id = "../../outside";
    await assert.rejects(
      materializeAblationRegistration(draft, { workspaceRoot: ROOT }),
      /pack_id must be a lowercase slug/,
    );
  });
});
