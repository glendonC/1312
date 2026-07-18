import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  benchU7InputsId,
  u7CaptureUnits,
  u7CaptureDisposition,
  validateU7AblationInputs,
} from "../scripts/lib/bench-u7-ablation.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const INPUTS_PATH = join(
  ROOT,
  "bench/ablations/hard-ko-v1-raw-vs-eligible-stem/inputs.json",
);

async function inputs() {
  return JSON.parse(await readFile(INPUTS_PATH, "utf8"));
}

test("committed U7 input registry binds every frozen clip before capture", async () => {
  const held = await inputs();
  const validated = await validateU7AblationInputs(held, { workspaceRoot: ROOT });
  assert.equal(validated.registry.clips.length, 3);
  assert.equal(validated.registration.results, null);
  assert.equal(validated.registration.lanes.semantic.judge, null);
  assert.deepEqual(
    validated.registry.clips.map((entry) => entry.clip_id).sort(),
    ["Ux-TMWnmntM", "local-eval-ko-control-01", "local-eval-ko-control-02"].sort(),
  );
});

test("U7 input registry rejects source, clip-set, score, and identity drift", async (t) => {
  const rejected = async (mutate, pattern) => {
    const held = await inputs();
    mutate(held);
    held.inputs_id = benchU7InputsId(held);
    await assert.rejects(validateU7AblationInputs(held, { workspaceRoot: ROOT }), pattern);
  };

  await t.test("forged registry id", async () => {
    const held = await inputs();
    held.inputs_id = `bench-u7-inputs:sha256:${"0".repeat(64)}`;
    await assert.rejects(
      validateU7AblationInputs(held, { workspaceRoot: ROOT }),
      /inputs_id does not match/,
    );
  });

  await t.test("changed local source", () =>
    rejected((held) => {
      held.clips[0].source.content_id = `sha256:${"0".repeat(64)}`;
    }, /does not match its pack local-copy receipt/));

  await t.test("missing frozen clip", () =>
    rejected((held) => {
      held.clips.pop();
    }, /every frozen clip exactly once/));

  await t.test("changed scored capture binding", () =>
    rejected((held) => {
      held.clips[2].basis.capture.content_id = `sha256:${"0".repeat(64)}`;
    }, /no longer matches its recorded bytes/));

  await t.test("backdated before ablation", () =>
    rejected((held) => {
      held.registered_at = "2026-07-18T13:41:09.000Z";
    }, /strictly after the ablation/));
});

test("U7 recognizer availability maps only to emitted, missing, or withheld", () => {
  const result = (availability, segments = []) => ({ availability, reason: `fixture_${availability}`, segments });
  const text = [{ startMs: 1_000, endMs: 2_000, state: "available", text: "words" }];
  assert.equal(u7CaptureDisposition(result("available", text)), "emitted");
  assert.equal(u7CaptureDisposition(result("available", [])), "missing");
  assert.equal(u7CaptureDisposition(result("empty", [])), "missing");
  assert.equal(u7CaptureDisposition(result("unavailable", [])), "withheld");
  assert.equal(u7CaptureDisposition(result("unknown", [])), "withheld");
  assert.equal(u7CaptureDisposition(result("truncated", text)), "withheld");

  const rawSystemId = "u7:raw";
  const stemSystemId = "u7:stem";
  const range = { startMs: 1_000, endMs: 2_000 };
  const truncatedUnits = u7CaptureUnits(
    result("available", text),
    result("truncated", text),
    range,
    rawSystemId,
    stemSystemId,
  );
  assert.equal(truncatedUnits.length, 1);
  assert.equal(truncatedUnits[0].outputs[rawSystemId].text, "words");
  assert.equal(truncatedUnits[0].outputs[stemSystemId].text, null);
  assert.equal(truncatedUnits[0].outputs[stemSystemId].withheld.gate, "u7_recognizer_availability");

  const missingUnits = u7CaptureUnits(
    result("available", text),
    result("available", []),
    range,
    rawSystemId,
    stemSystemId,
  );
  assert.equal(missingUnits[0].outputs[stemSystemId].text, null);
  assert.equal(missingUnits[0].outputs[stemSystemId].withheld, null);
});
