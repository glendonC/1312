export type LearningPrepExecutorConfiguration = { mode: "unavailable"; model: null };

export function resolveLearningPrepExecutorConfiguration(input: {
  mode: string | null;
}): LearningPrepExecutorConfiguration {
  const mode = input.mode ?? "unavailable";
  if (mode !== "unavailable") {
    throw new Error(
      "--learning-prep-executor must be unavailable; a real learning-prep executor is a separate explicit slice",
    );
  }
  return { mode, model: null };
}
