import type { LearningViewingSource } from "./model.ts";
import {
  bindLearningPrototypeFixture,
  type LearningPrototypeFixtureV1,
} from "./prototypeFixture.ts";
import type { LearningPresentation } from "./presentation.ts";

export function projectPrototypeLearningPresentation(
  source: Extract<LearningViewingSource, { context: { origin: "recorded_fixture" } }>,
  fixture: LearningPrototypeFixtureV1,
): Extract<LearningPresentation, { mode: "prototype" }> {
  return {
    mode: "prototype",
    source,
    explanations: bindLearningPrototypeFixture(source, fixture),
    savedItems: { state: "session" },
  };
}
