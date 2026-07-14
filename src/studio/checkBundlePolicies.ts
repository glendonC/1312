import { assertRunBundle } from "./bundle";
import type { RunBundle } from "./transport";

interface BundlePolicyCase {
  label: string;
  expected: string;
  mutate: (bundle: RunBundle) => void;
}

/** Exact mutations proving malformed recorded evidence cannot become a plausible result. */
export function checkBundlePolicies(reference: RunBundle): void {
  assertRunBundle(reference, "Bundle policy reference");

  const cases: BundlePolicyCase[] = [
    {
      label: "zero traces",
      expected: "traces must contain recorded evidence",
      mutate: (bundle) => {
        bundle.traces = [];
      },
    },
    {
      label: "premature terminal trace",
      expected: "traces[0] terminal done trace must be the final orchestrator event",
      mutate: (bundle) => {
        bundle.traces[0].action = "done";
      },
    },
    {
      label: "non-orchestrator terminal trace",
      expected: "terminal done trace must be the final orchestrator event",
      mutate: (bundle) => {
        bundle.traces[bundle.traces.length - 1].agent = bundle.run.agents[0].id;
      },
    },
    {
      label: "unknown trace agent",
      expected: "trace.agent references unknown agent missing-worker",
      mutate: (bundle) => {
        bundle.traces[0].agent = "missing-worker";
      },
    },
    {
      label: "unknown cue effect",
      expected: "references unknown cue missing-cue",
      mutate: (bundle) => {
        const trace = bundle.traces.find((candidate) =>
          candidate.effects?.some((effect) => effect.type === "cue"),
        );
        const effect = trace?.effects?.find((candidate) => candidate.type === "cue");
        if (!effect || effect.type !== "cue") throw new Error("bundle policy reference has no cue effect");
        effect.id = "missing-cue";
      },
    },
    {
      label: "missing artifact declaration",
      expected: "run.artifacts must declare required artifact captions.json",
      mutate: (bundle) => {
        bundle.run.artifacts = bundle.run.artifacts.filter((artifact) => artifact !== "captions.json");
      },
    },
    {
      label: "unscored numeric contradiction",
      expected: "must keep points and hard_line null while score.status is unscored",
      mutate: (bundle) => {
        bundle.score.status = "unscored";
        bundle.score.paths[bundle.run.id].hard_line = 0;
      },
    },
  ];

  for (const test of cases) {
    const bundle = structuredClone(reference);
    test.mutate(bundle);
    let message: string | null = null;
    try {
      assertRunBundle(bundle, `Bundle policy ${test.label}`);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    if (!message?.includes(test.expected)) {
      throw new Error(`Bundle policy ${test.label}: expected ${test.expected}, received ${message ?? "acceptance"}`);
    }
  }
}
