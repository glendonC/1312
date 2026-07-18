import type { LearningViewingSource } from "../learning/model.ts";
import { validateLearningViewingSource } from "../learning/sourceAdapters.ts";
import type {
  PrivatePlaybackExpectation,
  PrivatePlaybackHandle,
} from "./client.ts";

type ProductionSource = Extract<
  LearningViewingSource,
  { context: { origin: "verified_production_caption" } }
>;

export interface ProductionPlaybackClient {
  createPrivatePlaybackHandle(expected: PrivatePlaybackExpectation): Promise<PrivatePlaybackHandle>;
}

export interface ProductionPlaybackInput {
  runtimeId: string;
  sourceRevisionId: string;
  source: ProductionSource;
  caption: {
    jobId: string;
    artifactId: string;
    contentId: string;
  };
}

export interface ProductionPlaybackBinding {
  bindingKey: string;
  handle: PrivatePlaybackHandle;
  runtimeId: string;
  sourceRevisionId: string;
  sourceArtifactId: string;
  sourceContentId: string;
  captionJobId: string;
  captionArtifactId: string;
  captionContentId: string;
  analysisRange: { startMs: number; endMs: number };
  timestampOrigin: { kind: "source_media_zero"; offsetMs: 0 };
}

export type ProductionPlaybackLoadResult =
  | { state: "available"; binding: ProductionPlaybackBinding }
  | { state: "unavailable"; reasonCode: "invalid_playback_binding" | "private_playback_unavailable"; detail: string }
  | { state: "invalidated" };

function disposeHandle(handle: PrivatePlaybackHandle | null): void {
  if (!handle) return;
  void handle.dispose().catch(() => undefined);
}

function stableIdentity(value: string): boolean {
  return value.length > 0 && value.trim() === value && value.length <= 160 &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
}

function expectation(input: ProductionPlaybackInput): PrivatePlaybackExpectation | null {
  if (!stableIdentity(input.runtimeId) || !stableIdentity(input.sourceRevisionId)) return null;
  try {
    validateLearningViewingSource(input.source);
  } catch {
    return null;
  }
  const { context } = input.source;
  if (
    context.authorityState !== "unrevoked" ||
    context.identities.runId !== input.runtimeId ||
    !stableIdentity(input.caption.jobId) ||
    !stableIdentity(input.caption.artifactId) ||
    !stableIdentity(input.caption.contentId) ||
    context.identities.captionJobId !== input.caption.jobId ||
    context.identities.captionArtifactId !== input.caption.artifactId ||
    context.identities.captionContentId !== input.caption.contentId ||
    context.timeline.timestampOrigin.kind !== "source_media_zero" ||
    context.timeline.timestampOrigin.offsetMs !== 0
  ) return null;
  return {
    runtimeId: input.runtimeId,
    sourceRevisionId: input.sourceRevisionId,
    sourceArtifactId: context.identities.sourceArtifactId,
    sourceContentId: context.identities.sourceContentId,
  };
}

function closeHandle(
  input: ProductionPlaybackInput,
  handle: PrivatePlaybackHandle,
  now: Date,
): ProductionPlaybackBinding | null {
  const expected = expectation(input);
  if (!expected) return null;
  const identity = input.source.context.identities;
  const range = input.source.context.timeline.analysisRange;
  if (
    handle.disposed || handle.src === null || Date.parse(handle.expiresAt) <= now.getTime() ||
    handle.runtimeId !== expected.runtimeId ||
    handle.source.revisionId !== expected.sourceRevisionId ||
    handle.source.artifactId !== expected.sourceArtifactId ||
    handle.source.contentId !== expected.sourceContentId ||
    handle.source.durationMs < range.startMs ||
    handle.source.durationMs < range.endMs ||
    handle.timestampOrigin.kind !== "source_media_zero" || handle.timestampOrigin.offsetMs !== 0
  ) return null;
  const bindingKey = [
    input.runtimeId,
    input.sourceRevisionId,
    identity.sourceArtifactId,
    identity.sourceContentId,
    identity.captionJobId,
    identity.captionArtifactId,
    identity.captionContentId,
    "source_media_zero",
  ].join("\u001f");
  return {
    bindingKey,
    handle,
    runtimeId: input.runtimeId,
    sourceRevisionId: input.sourceRevisionId,
    sourceArtifactId: identity.sourceArtifactId,
    sourceContentId: identity.sourceContentId,
    captionJobId: identity.captionJobId,
    captionArtifactId: identity.captionArtifactId,
    captionContentId: identity.captionContentId,
    analysisRange: structuredClone(range),
    timestampOrigin: { kind: "source_media_zero", offsetMs: 0 },
  };
}

/** One active private handle, invalidated on any runtime, source, or caption replacement. */
export class ProductionPlaybackController {
  private readonly now: () => Date;
  private generation = 0;
  private current: PrivatePlaybackHandle | null = null;

  constructor(options: { now?: () => Date } = {}) {
    this.now = options.now ?? (() => new Date());
  }

  async load(
    input: ProductionPlaybackInput,
    client: ProductionPlaybackClient,
  ): Promise<ProductionPlaybackLoadResult> {
    const generation = ++this.generation;
    disposeHandle(this.current);
    this.current = null;
    const expected = expectation(input);
    if (!expected) {
      return {
        state: "unavailable",
        reasonCode: "invalid_playback_binding",
        detail: "The production caption source does not close to one exact runtime and source timeline.",
      };
    }
    let handle: PrivatePlaybackHandle;
    try {
      handle = await client.createPrivatePlaybackHandle(expected);
    } catch (error) {
      return generation === this.generation
        ? {
            state: "unavailable",
            reasonCode: "private_playback_unavailable",
            detail: error instanceof Error ? error.message : "Private playback grant acquisition failed closed.",
          }
        : { state: "invalidated" };
    }
    if (generation !== this.generation) {
      disposeHandle(handle);
      return { state: "invalidated" };
    }
    const binding = closeHandle(input, handle, this.now());
    if (!binding) {
      disposeHandle(handle);
      return {
        state: "unavailable",
        reasonCode: "invalid_playback_binding",
        detail: "The private playback handle does not match the active runtime, source, caption, or timestamp origin.",
      };
    }
    this.current = handle;
    return { state: "available", binding };
  }

  invalidate(): void {
    this.generation += 1;
    disposeHandle(this.current);
    this.current = null;
  }
}
