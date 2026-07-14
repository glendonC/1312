import { assertTrace, type TraceIdentityScope } from "./traceValidation";

const scope: TraceIdentityScope = {
  agents: new Set(["orchestrator", "worker-01"]),
  cues: new Set(["cue-01"]),
  duration: 10,
};

const reference = {
  t: 1,
  agent: "worker-01",
  action: "inspect",
  target: "cue-01",
  detail: "inspected a registered cue",
  level: "info",
  clip_t: 2,
  effects: [{ type: "cue", id: "cue-01", state: "drafted" }],
};

/** Exact mutations that a live transport must reject before projection. */
export function checkTracePolicies(): void {
  assertTrace(reference, "Trace policy reference", scope, 0);

  const cases: Array<{ label: string; mutate: (trace: Record<string, unknown>) => void; previousT?: number }> = [
    {
      label: "fixture-only contract leakage",
      mutate: (trace) => {
        trace.fixtureOnly = true;
      },
    },
    {
      label: "unknown agent",
      mutate: (trace) => {
        trace.agent = "plausible-segment-worker";
      },
    },
    {
      label: "unknown cue",
      mutate: (trace) => {
        trace.effects = [{ type: "cue", id: "missing-cue", state: "committed" }];
      },
    },
    {
      label: "out-of-order time",
      previousT: 2,
      mutate: () => undefined,
    },
    {
      label: "out-of-scope media time",
      mutate: (trace) => {
        trace.clip_t = 11;
      },
    },
  ];

  for (const test of cases) {
    const candidate = structuredClone(reference) as unknown as Record<string, unknown>;
    test.mutate(candidate);
    let rejected = false;
    try {
      assertTrace(candidate, `Trace policy ${test.label}`, scope, test.previousT ?? 0);
    } catch {
      rejected = true;
    }
    if (!rejected) throw new Error(`Trace policy accepted ${test.label}`);
  }
}
