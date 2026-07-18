export type LanguageExplanationExecutorConfiguration =
  | { mode: "unavailable"; model: null }
  | { mode: "openai"; model: string };

export function resolveLanguageExplanationExecutorConfiguration(input: {
  mode: string | null;
  allowReal: boolean;
  model: string | null;
}): LanguageExplanationExecutorConfiguration {
  const mode = input.mode ?? "unavailable";
  if (mode !== "unavailable" && mode !== "openai") {
    throw new Error("--language-explanation-executor must be unavailable or openai");
  }
  if (mode === "unavailable") return { mode, model: null };
  if (!input.allowReal) {
    throw new Error("Real language explanation generation requires --allow-real-language-explanation");
  }
  if (!input.model) {
    throw new Error("Real language explanation generation requires an explicit --language-explanation-model identity");
  }
  return { mode, model: input.model };
}
