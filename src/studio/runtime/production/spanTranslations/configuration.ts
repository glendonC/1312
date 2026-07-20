export type SpanTranslationExecutorConfiguration =
  | { mode: "unavailable"; model: null; endpoint: null; think: null }
  | { mode: "ollama"; model: string; endpoint: string; think: "off" | "low" };

export const SPAN_TRANSLATION_DEFAULT_ENDPOINT = "http://127.0.0.1:11434";

export function resolveSpanTranslationExecutorConfiguration(input: {
  mode: string | null;
  allowReal: boolean;
  model: string | null;
  endpoint: string | null;
  think: string | null;
}): SpanTranslationExecutorConfiguration {
  const mode = input.mode ?? "unavailable";
  if (mode !== "unavailable" && mode !== "ollama") {
    throw new Error("--span-translation-executor must be unavailable or ollama");
  }
  if (mode === "unavailable") return { mode, model: null, endpoint: null, think: null };
  if (!input.allowReal) {
    throw new Error("Real span translation requires --allow-real-span-translation");
  }
  if (!input.model) {
    throw new Error("Real span translation requires an explicit --span-translation-model identity");
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
