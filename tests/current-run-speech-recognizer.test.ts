import assert from "node:assert/strict";
import test from "node:test";

import { SerialCurrentRunTranscriptionQueue } from "../src/studio/runtime/production/semantic/currentRunSpeechRecognizer.ts";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

test("current-run transcription provider calls are admitted serially without retrying", async () => {
  const queue = new SerialCurrentRunTranscriptionQueue();
  const firstGate = deferred();
  const secondGate = deferred();
  const firstStarted = deferred();
  const secondStarted = deferred();
  let active = 0;
  let maximumActive = 0;
  let calls = 0;

  const request = (started: ReturnType<typeof deferred>, gate: ReturnType<typeof deferred>, result: string) =>
    queue.run(new AbortController().signal, async () => {
      calls += 1;
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      started.resolve();
      await gate.promise;
      active -= 1;
      return result;
    });

  const first = request(firstStarted, firstGate, "first");
  const second = request(secondStarted, secondGate, "second");
  await firstStarted.promise;
  assert.equal(calls, 1);
  assert.equal(active, 1);

  firstGate.resolve();
  assert.equal(await first, "first");
  await secondStarted.promise;
  assert.equal(calls, 2);
  assert.equal(active, 1);

  secondGate.resolve();
  assert.equal(await second, "second");
  assert.equal(active, 0);
  assert.equal(maximumActive, 1);
});
