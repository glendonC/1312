import { useEffect, useMemo, useState } from "react";

import type { LearningViewingSource } from "./model.ts";
import type { LearningPrototypeFixtureV1 } from "./prototypeFixture.ts";
import {
  projectRecordedLearningPrep,
  recordedLearningPrepKey,
} from "./recordedLearningPrepAdapter.ts";
import {
  LEARNING_LENS_KINDS,
  type LearningFineTuneDraft,
  type LearningPrepInteraction,
  type LearningPrepProjection,
} from "./presentation.ts";

type RecordedSource = Extract<LearningViewingSource, { context: { origin: "recorded_fixture" } }>;

const RECORDED_DEFAULT: LearningFineTuneDraft = {
  armedLenses: ["grammar_salience", "situating"],
  temperature: "medium",
};

/** Session-local controls over run-bound design-fixture prep. The demo opens prepared so its shared
 * overlay is visible immediately; changing any control returns it to an explicit unprepared state. */
export function useRecordedLearningPrep(
  source: RecordedSource,
  fixture: LearningPrototypeFixtureV1,
): LearningPrepInteraction {
  const sourceKey = `${source.context.identities.runId}:${source.context.identities.captionContentId ?? "none"}`;
  const [draft, setDraft] = useState<LearningFineTuneDraft>(RECORDED_DEFAULT);
  const [prep, setPrep] = useState<LearningPrepProjection>(() =>
    projectRecordedLearningPrep(source, fixture, RECORDED_DEFAULT));

  useEffect(() => {
    setDraft(RECORDED_DEFAULT);
    setPrep(projectRecordedLearningPrep(source, fixture, RECORDED_DEFAULT));
  }, [sourceKey, fixture.fixtureId]);

  return useMemo(() => {
    const updateDraft = (next: LearningFineTuneDraft) => {
      setDraft(next);
      setPrep({ state: "not_requested" });
    };
    return {
      sourceAuthority: "recorded_fixture",
      draft,
      prep,
      availability: { state: "available" },
      onToggleLens: (lens) => updateDraft({
        armedLenses: LEARNING_LENS_KINDS.filter((candidate) =>
          candidate === lens
            ? !draft.armedLenses.includes(lens)
            : draft.armedLenses.includes(candidate)),
        temperature: draft.temperature,
      }),
      onTemperature: (temperature) => updateDraft({ armedLenses: draft.armedLenses, temperature }),
      onPrepare: () => setPrep(projectRecordedLearningPrep(source, fixture, draft)),
      onRetry: () => {
        const prepKey = recordedLearningPrepKey(source, fixture, draft);
        setPrep((current) => current.state === "failed" && current.prepKey === prepKey
          ? projectRecordedLearningPrep(source, fixture, draft)
          : current);
      },
    } satisfies LearningPrepInteraction;
  }, [draft, fixture, prep, source]);
}
