import type { LearningViewingSource } from "./model.ts";
import {
  bindLearningPrototypeFixtures,
  type LearningPrototypeFixtureV1,
} from "./prototypeFixture.ts";
import type { LearningPresentation } from "./presentation.ts";

export function projectPrototypeLearningPresentation(
  source: Extract<LearningViewingSource, { context: { origin: "recorded_fixture" } }>,
  fixtures: readonly LearningPrototypeFixtureV1[],
): Extract<LearningPresentation, { mode: "prototype" }> {
  return {
    mode: "prototype",
    source,
    explanations: bindLearningPrototypeFixtures(source, fixtures),
    savedItems: { state: "session" },
  };
}
