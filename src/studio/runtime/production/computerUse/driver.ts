import type {
  ComputerUseDriverIdentity,
  ComputerUseFixtureManifest,
  ComputerUseIsolation,
  ComputerUseLimits,
  ComputerUseReadonlyAction,
  ComputerUseStopReason,
  ComputerUseSurface,
} from "../model/computerUse.ts";

export interface ExternalScreenDriverState {
  stateId: string;
  ordinal: number;
  surfaceId: string;
  origin: string;
  url: string;
  title: string;
  visibleText: string;
  declaredTransitionIds: string[];
  viewport: { width: number; height: number };
  screenshotPng: Buffer;
}

export interface ExternalScreenDriverAction {
  index: number;
  beforeStateId: string;
  action: ComputerUseReadonlyAction;
  afterStateId: string;
  result: "visible_state_changed";
}

export interface ExternalScreenDriverTrace {
  driver: ComputerUseDriverIdentity;
  isolation: ComputerUseIsolation;
  states: ExternalScreenDriverState[];
  actions: ExternalScreenDriverAction[];
  stopReason: ComputerUseStopReason;
  accounting: {
    driverCalls: number;
    sessions: number;
    egressRequests: number;
    egressBytes: number;
    downloads: number;
    downloadBytes: number;
  };
}

export interface ReadOnlyExternalScreenDriver {
  readonly identity: ComputerUseDriverIdentity;
  readonly fixtureManifest: ComputerUseFixtureManifest;
  inspect(input: {
    sessionId: string;
    surface: ComputerUseSurface;
    limits: ComputerUseLimits;
    deadlineAtMs: number;
  }): Promise<ExternalScreenDriverTrace>;
}
