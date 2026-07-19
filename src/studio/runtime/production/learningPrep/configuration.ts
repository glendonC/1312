export type LearningPrepExecutorConfiguration =
  | { mode: "unavailable"; model: null }
  | { mode: "openai"; model: string };

export function resolveLearningPrepExecutorConfiguration(input: {
  mode: string | null;
  allowReal: boolean;
  model: string | null;
}): LearningPrepExecutorConfiguration {
  const mode = input.mode ?? "unavailable";
  if (mode !== "unavailable" && mode !== "openai") {
    throw new Error("--learning-prep-executor must be unavailable or openai");
  }
  if (mode === "unavailable") return { mode, model: null };
  if (!input.allowReal) {
    throw new Error("Real learning-prep generation requires --allow-real-learning-prep");
  }
  if (!input.model) {
    throw new Error("Real learning-prep generation requires an explicit --learning-prep-model identity");
  }
  return { mode, model: input.model };
}
