import { performance } from "node:perf_hooks";
import { createHash } from "node:crypto";

import { canonicalJson, canonicalJsonContentId } from "../artifactStore/contentIdentity.ts";
import type { ComputerUseFixtureManifest, ComputerUseSurface } from "../model/computerUse.ts";
import type {
  ExternalScreenDriverAction,
  ExternalScreenDriverState,
  ExternalScreenDriverTrace,
  ReadOnlyExternalScreenDriver,
} from "./driver.ts";

export interface FixtureExternalScreenState {
  stateId: string;
  url: string;
  title: string;
  visibleText: string;
  viewport: { width: number; height: number };
  screenshotPng: Buffer;
  transitions: Record<string, string>;
}

export function buildFixtureExternalScreenManifest(input: {
  fixtureId: string;
  surfaceId: string;
  origin: string;
  entryUrl: string;
  states: FixtureExternalScreenState[];
  initialStateId: string;
  transitionScript: string[];
}): ComputerUseFixtureManifest {
  return {
    schema: "studio.external-screen-fixture.v1",
    fixtureId: input.fixtureId,
    surfaceId: input.surfaceId,
    origin: input.origin,
    entryUrl: input.entryUrl,
    initialStateId: input.initialStateId,
    transitionScript: [...input.transitionScript],
    states: input.states.map((state) => ({
      stateId: state.stateId,
      url: state.url,
      title: state.title,
      visibleText: state.visibleText,
      viewport: state.viewport,
      screenshotContentId: `sha256:${createHash("sha256").update(state.screenshotPng).digest("hex")}`,
      transitions: Object.entries(state.transitions)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([transitionId, nextStateId]) => ({ transitionId, nextStateId })),
    })),
  };
}

export function fixtureExternalScreenContentId(
  input: Parameters<typeof buildFixtureExternalScreenManifest>[0],
): string {
  return canonicalJsonContentId(buildFixtureExternalScreenManifest(input));
}

/**
 * Deterministic in-memory fixture. It has no network, filesystem, cookie, credential, or mutation
 * API. Its script follows only transition ids declared by its closed state graph.
 */
export class FixtureExternalScreenDriver implements ReadOnlyExternalScreenDriver {
  readonly identity = { id: "fixture-external-screen-driver", version: "1", mode: "offline_fixture" } as const;
  readonly fixtureManifest: ComputerUseFixtureManifest;
  private readonly surface: ComputerUseSurface;
  private readonly states: Map<string, FixtureExternalScreenState>;
  private readonly initialStateId: string;
  private readonly transitionScript: string[];

  constructor(input: {
    surface: ComputerUseSurface;
    states: FixtureExternalScreenState[];
    initialStateId: string;
    transitionScript: string[];
  }) {
    this.fixtureManifest = buildFixtureExternalScreenManifest({
      fixtureId: input.surface.source.fixtureId,
      surfaceId: input.surface.surfaceId,
      origin: input.surface.origin,
      entryUrl: input.surface.entryUrl,
      states: input.states,
      initialStateId: input.initialStateId,
      transitionScript: input.transitionScript,
    });
    if (input.surface.source.fixtureContentId !== canonicalJsonContentId(this.fixtureManifest)) {
      throw new Error("Computer-use fixture graph does not match its sealed fixture content identity");
    }
    this.surface = structuredClone(input.surface);
    this.states = new Map(input.states.map((state) => [state.stateId, {
      stateId: state.stateId,
      url: state.url,
      title: state.title,
      visibleText: state.visibleText,
      viewport: structuredClone(state.viewport),
      screenshotPng: Buffer.from(state.screenshotPng),
      transitions: structuredClone(state.transitions),
    }]));
    if (this.states.size !== input.states.length || !this.states.has(input.initialStateId)) {
      throw new Error("Computer-use fixture graph has duplicate states or no initial state");
    }
    this.initialStateId = input.initialStateId;
    this.transitionScript = [...input.transitionScript];
  }

  async inspect(input: {
    sessionId: string;
    surface: ComputerUseSurface;
    limits: import("../model/computerUse.ts").ComputerUseLimits;
    deadlineAtMs: number;
  }): Promise<ExternalScreenDriverTrace> {
    if (!input.sessionId || canonicalJson(input.surface) !== canonicalJson(this.surface)) {
      throw new Error("Computer-use fixture received a surface outside its sealed graph");
    }
    const states: ExternalScreenDriverState[] = [];
    const actions: ExternalScreenDriverAction[] = [];
    const appendState = (state: FixtureExternalScreenState): void => {
      if (performance.now() >= input.deadlineAtMs) throw new Error("Computer-use fixture exceeded its deadline");
      states.push({
        stateId: state.stateId,
        ordinal: states.length,
        surfaceId: input.surface.surfaceId,
        origin: input.surface.origin,
        url: state.url,
        title: state.title,
        visibleText: state.visibleText,
        declaredTransitionIds: Object.keys(state.transitions).sort(),
        viewport: structuredClone(state.viewport),
        screenshotPng: Buffer.from(state.screenshotPng),
      });
    };

    let current = this.states.get(this.initialStateId)!;
    appendState(current);
    for (const transitionId of this.transitionScript) {
      if (actions.length >= input.limits.maxActions || states.length >= input.limits.maxSteps) break;
      const nextStateId = current.transitions[transitionId];
      const next = nextStateId ? this.states.get(nextStateId) : undefined;
      if (!next) throw new Error(`Computer-use fixture transition ${transitionId} is not declared in the sealed graph`);
      const beforeStateId = current.stateId;
      appendState(next);
      actions.push({
        index: actions.length,
        beforeStateId,
        action: { kind: "follow_readonly_transition", transitionId },
        afterStateId: next.stateId,
        result: "visible_state_changed",
      });
      current = next;
    }
    const stopReason = actions.length < this.transitionScript.length
      ? "action_limit_reached"
      : this.transitionScript.length === 0
        ? "no_readonly_transition"
        : "fixture_complete";
    return {
      driver: structuredClone(this.identity),
      isolation: {
        session: "ephemeral_in_memory",
        network: "disabled",
        cookies: "unavailable",
        credentials: "unavailable",
        filesystem: "no_access",
        externalMutations: "unavailable",
      },
      states,
      actions,
      stopReason,
      accounting: {
        driverCalls: 1,
        sessions: 1,
        egressRequests: 0,
        egressBytes: 0,
        downloads: 0,
        downloadBytes: 0,
      },
    };
  }
}
