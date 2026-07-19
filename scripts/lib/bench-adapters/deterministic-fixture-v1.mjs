/** Closed deterministic adapter used only by synthetic bench contract tests. */

export function executeDeterministicFixture(invocation, completedAt) {
  return {
    schema_version: "0.1.0",
    kind: "capture",
    capture_id: invocation.run,
    captured_at: completedAt.slice(0, 10),
    scored: false,
    pack_evidence: false,
    clip: {
      id: invocation.clipId,
      duration_s: 30,
      lang: "ko",
      pair: "ko->en",
      source: {
        kind: "owned",
        url: "https://example.test/fixture",
        channel: "fixture",
        licence: "Owned fixture",
        attribution: "Fixture owner",
      },
    },
    reproducible: { deterministic: true, note: "Synthetic deterministic fixture." },
    systems: [{
      id: invocation.hostContext.system_id,
      role: "subject",
      config: structuredClone(invocation.hostContext.config),
    }],
    measured: {
      [invocation.hostContext.system_id]: {
        units_total: 1,
        units_emitted: 1,
        units_withheld: 0,
        coverage: 1,
        latency: { first_usable_s: 1, complete_s: 2 },
      },
    },
    unscored: {
      critical_meaning: null,
      critical_outcomes: null,
      catastrophic: null,
      reason: "Capture has no semantic authority.",
    },
    units: [{
      t_start: 0,
      t_end: 1,
      source: "검증",
      outputs: {
        [invocation.hostContext.system_id]: { text: "Verification.", withheld: null },
      },
      gold: null,
    }],
    notes: "Synthetic capture fixture. Semantic labels live in the score receipt.",
  };
}
