export type SpanTranslationExecutorConfiguration =
  | { mode: "unavailable"; model: null; endpoint: null; think: null }
  | { mode: "ollama"; model: string; endpoint: string; think: "off" | "low" }
  | { mode: "openai"; model: string; endpoint: null; think: null };

export const SPAN_TRANSLATION_DEFAULT_ENDPOINT = "http://127.0.0.1:11434";

export function resolveSpanTranslationExecutorConfiguration(input: {
  mode: string | null;
  allowReal: boolean;
  model: string | null;
  endpoint: string | null;
  think: string | null;
}): SpanTranslationExecutorConfiguration {
  const mode = input.mode ?? "unavailable";
  if (mode !== "unavailable" && mode !== "ollama" && mode !== "openai") {
    throw new Error("--span-translation-executor must be unavailable, ollama, or openai");
  }
  if (mode === "unavailable") return { mode, model: null, endpoint: null, think: null };
  if (!input.allowReal) {
    throw new Error("Real span translation requires --allow-real-span-translation");
  }
  if (!input.model) {
    throw new Error("Real span translation requires an explicit --span-translation-model identity");
  }
  if (mode === "openai") {
    if (input.endpoint !== null) {
      throw new Error("--span-translation-endpoint applies only to the ollama executor");
    }
    if (input.think !== null) {
      throw new Error("--span-translation-think applies only to the ollama executor");
    }
    return { mode, model: input.model, endpoint: null, think: null };
  }
  const think = input.think ?? "off";
  if (think !== "off" && think !== "low") {
    throw new Error("--span-translation-think must be off or low");
  }
  return {
    mode,
    model: input.model,
    endpoint: input.endpoint ?? SPAN_TRANSLATION_DEFAULT_ENDPOINT,
    think,
  };
}
