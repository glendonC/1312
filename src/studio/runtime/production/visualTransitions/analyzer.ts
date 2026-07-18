import { performance } from "node:perf_hooks";

import { canonicalSha256 } from "../artifactStore/contentIdentity.ts";
import { decodeBoundedRgbPng } from "../frames/png.ts";
import {
  VISUAL_TRANSITION_LIMITS,
  VISUAL_TRANSITION_PRODUCER,
  type VisualTransitionFrameIdentity,
  type VisualTransitionInterval,
  type VisualTransitionProducer,
} from "../model/visualTransitions.ts";

export interface VisualTransitionAnalyzerFrame {
  identity: VisualTransitionFrameIdentity;
  bytes: Buffer;
}

export interface VisualTransitionAnalysisInput {
  operationId: string;
  grantedRange: { startMs: number; endMs: number };
  frames: VisualTransitionAnalyzerFrame[];
}

export interface VisualTransitionAnalysisResult {
  producer: VisualTransitionProducer;
  intervals: VisualTransitionInterval[];
  sampledRgbValues: number;
}

export interface VisualTransitionAnalyzer {
  analyze(input: VisualTransitionAnalysisInput, deadlineAtMs: number): VisualTransitionAnalysisResult;
}

function ensureBefore(deadlineAtMs: number): void {
  if (performance.now() >= deadlineAtMs) throw new Error("Visual-transition analysis exceeded its wall limit");
}

function sampledRgb(pixels: Buffer, width: number, height: number): Uint8Array {
  const sampled = new Uint8Array(VISUAL_TRANSITION_LIMITS.gridWidth * VISUAL_TRANSITION_LIMITS.gridHeight * 3);
  let write = 0;
  for (let gridY = 0; gridY < VISUAL_TRANSITION_LIMITS.gridHeight; gridY += 1) {
    const y = Math.min(height - 1, Math.floor(((gridY * 2 + 1) * height) / (VISUAL_TRANSITION_LIMITS.gridHeight * 2)));
    for (let gridX = 0; gridX < VISUAL_TRANSITION_LIMITS.gridWidth; gridX += 1) {
      const x = Math.min(width - 1, Math.floor(((gridX * 2 + 1) * width) / (VISUAL_TRANSITION_LIMITS.gridWidth * 2)));
      const read = (y * width + x) * 3;
      sampled[write] = pixels[read];
      sampled[write + 1] = pixels[read + 1];
      sampled[write + 2] = pixels[read + 2];
      write += 3;
    }
  }
  return sampled;
}

function pixelDifferencePpm(before: Uint8Array, after: Uint8Array): number {
  if (before.length !== after.length || before.length === 0) throw new Error("Visual-transition RGB grids changed shape");
  let difference = 0;
  for (let index = 0; index < before.length; index += 1) difference += Math.abs(before[index] - after[index]);
  return Math.round((difference * 1_000_000) / (before.length * 255));
}

function ocrComparison(
  before: VisualTransitionFrameIdentity,
  after: VisualTransitionFrameIdentity,
): VisualTransitionInterval["ocrHypotheses"] {
  const beforeCount = before.availableOcrHypothesisCount;
  const afterCount = after.availableOcrHypothesisCount;
  const comparison = beforeCount === 0 && afterCount === 0
    ? "unavailable" as const
    : before.availableOcrHypothesisSetFingerprint === after.availableOcrHypothesisSetFingerprint
      ? "unchanged" as const
      : "changed" as const;
  return {
    comparison,
    beforeAvailableCount: beforeCount,
    afterAvailableCount: afterCount,
    beforeSetFingerprint: before.availableOcrHypothesisSetFingerprint,
    afterSetFingerprint: after.availableOcrHypothesisSetFingerprint,
  };
}

export class DeterministicRgbGridVisualTransitionAnalyzer implements VisualTransitionAnalyzer {
  analyze(input: VisualTransitionAnalysisInput, deadlineAtMs: number): VisualTransitionAnalysisResult {
    if (input.frames.length < VISUAL_TRANSITION_LIMITS.minFrames || input.frames.length > VISUAL_TRANSITION_LIMITS.maxFrames) {
      throw new Error("Visual-transition analysis requires the registered bounded frame count");
    }
    const grids = input.frames.map((frame) => {
      ensureBefore(deadlineAtMs);
      const decoded = decodeBoundedRgbPng(frame.bytes, {
        maxWidthPx: 1_024,
        maxHeightPx: 1_024,
        maxPixels: 1_048_576,
      });
      if (decoded.width !== frame.identity.width || decoded.height !== frame.identity.height) {
        throw new Error("Visual-transition input dimensions changed from U2 lineage");
      }
      return sampledRgb(decoded.pixels, decoded.width, decoded.height);
    });
    const intervals = input.frames.slice(0, -1).map((before, index): VisualTransitionInterval => {
      ensureBefore(deadlineAtMs);
      const after = input.frames[index + 1];
      if (after.identity.actualTimestampUs <= before.identity.actualTimestampUs) {
        throw new Error("Visual-transition frames are not ordered by actual presentation time");
      }
      const startMs = Math.max(input.grantedRange.startMs, Math.floor(before.identity.actualTimestampUs / 1_000));
      const endMs = Math.min(
        input.grantedRange.endMs,
        Math.max(startMs + 1, Math.ceil(after.identity.actualTimestampUs / 1_000)),
      );
      if (endMs <= startMs) throw new Error("Visual-transition interval does not fit the granted range");
      const difference = pixelDifferencePpm(grids[index], grids[index + 1]);
      const body = {
        operationId: input.operationId,
        index,
        fromFrameId: before.identity.frameId,
        toFrameId: after.identity.frameId,
        startMs,
        endMs,
        pixelDifferencePpm: difference,
        candidateThresholdPpm: VISUAL_TRANSITION_LIMITS.candidateThresholdPpm,
        ocrHypotheses: ocrComparison(before.identity, after.identity),
      };
      return {
        intervalId: `visual-transition-interval:${canonicalSha256(body)}`,
        index,
        fromFrameId: before.identity.frameId,
        toFrameId: after.identity.frameId,
        startMs,
        endMs,
        pixelDifferencePpm: difference,
        classification: difference >= VISUAL_TRANSITION_LIMITS.candidateThresholdPpm
          ? "visual_change_candidate"
          : "below_visual_change_threshold",
        ocrHypotheses: body.ocrHypotheses,
      };
    });
    return {
      producer: structuredClone(VISUAL_TRANSITION_PRODUCER),
      intervals,
      sampledRgbValues: grids.reduce((sum, grid) => sum + grid.length, 0),
    };
  }
}
