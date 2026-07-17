import type { SeparationProducerLineage } from "../model.ts";
import { SourceSeparatorFailure, type SourceSeparationResult, type SourceSeparator } from "./separator.ts";

/** Honest fallback when the separately bootstrapped, pinned local runtime is absent. */
export class UnavailableSourceSeparator implements SourceSeparator {
  async currentLineage(): Promise<SeparationProducerLineage> {
    throw new SourceSeparatorFailure("model_unavailable", "The pinned local separation runtime is not installed");
  }

  async separate(): Promise<SourceSeparationResult> {
    throw new SourceSeparatorFailure("model_unavailable", "The pinned local separation runtime is not installed");
  }
}
