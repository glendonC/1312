/** Closed stale-config adapter used only by synthetic bench hostile tests. */

import { executeDeterministicFixture } from "./deterministic-fixture-v1.mjs";

export function executeDeterministicFixtureStaleConfig(invocation, completedAt) {
  const capture = executeDeterministicFixture(invocation, completedAt);
  capture.systems[0].config = {
    model: "stale-fixture",
    reviewed_memory: { rule_content_id: null },
  };
  return capture;
}
