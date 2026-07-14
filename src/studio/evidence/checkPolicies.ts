import type { RunBundle } from "../transport";
import type { RecordedEvidenceIndex } from "./types";
import { assertRecordedEvidenceIndex } from "./validation";

type MutableEvidenceIndex = RecordedEvidenceIndex & Record<string, unknown>;

interface EvidencePolicyCase {
  label: string;
  expected: string;
  mutate: (index: MutableEvidenceIndex) => void;
}

/** Exact mutations proving a retrospective index cannot grow unsupported evidence claims. */
export function checkRecordedEvidencePolicies(reference: RecordedEvidenceIndex, bundle: RunBundle): void {
  assertRecordedEvidenceIndex(reference, bundle, "Recorded evidence policy reference");

  const cases: EvidencePolicyCase[] = [
    {
      label: "duplicate artifact id",
      expected: "index.artifacts must not contain duplicate artifact ids",
      mutate: (index) => {
        index.artifacts[1].artifact_id = index.artifacts[0].artifact_id;
      },
    },
    {
      label: "missing artifact",
      expected: "index.artifacts must index every declared run artifact exactly once",
      mutate: (index) => {
        index.artifacts.pop();
      },
    },
    {
      label: "lineage cycle",
      expected: "artifacts contains a lineage cycle",
      mutate: (index) => {
        const captions = index.artifacts.find((artifact) => artifact.artifact_id === "captions");
        const traces = index.artifacts.find((artifact) => artifact.artifact_id === "traces");
        if (!captions || !traces) throw new Error("recorded evidence reference is missing captions or traces");
        captions.source_artifact_ids = ["traces"];
        traces.source_artifact_ids = ["captions"];
      },
    },
    {
      label: "unknown cue",
      expected: "references unknown cue missing-cue",
      mutate: (index) => {
        index.cue_decisions[0].cue_id = "missing-cue";
      },
    },
    {
      label: "unknown owner",
      expected: "references unknown owner missing-worker",
      mutate: (index) => {
        index.cue_decisions[0].caption_owner_id = "missing-worker";
      },
    },
    {
      label: "unknown gate",
      expected: "references unknown gate missing-gate",
      mutate: (index) => {
        const decision = index.cue_decisions.find((candidate) => candidate.terminal_state === "withheld");
        if (!decision?.gate) throw new Error("recorded evidence reference has no withheld gate");
        decision.gate.id = "missing-gate";
      },
    },
    {
      label: "unknown decision artifact",
      expected: "references unknown artifact missing-artifact",
      mutate: (index) => {
        index.cue_decisions[0].evidence_artifact_ids[0] = "missing-artifact";
      },
    },
    {
      label: "caption terminal mismatch",
      expected: "terminal_state contradicts the withheld caption",
      mutate: (index) => {
        const decision = index.cue_decisions.find((candidate) => candidate.terminal_state === "committed");
        if (!decision) throw new Error("recorded evidence reference has no committed cue");
        decision.terminal_state = "withheld";
      },
    },
    {
      label: "artifact digest mismatch",
      expected: "index.artifacts[0].content.id does not match its digest",
      mutate: (index) => {
        index.artifacts[0].content.id = `sha256:${"f".repeat(64)}`;
      },
    },
    {
      label: "fixture-only leakage",
      expected: "index must contain exactly",
      mutate: (index) => {
        index.fixtureOnly = true;
      },
    },
    {
      label: "provider-field leakage",
      expected: "index must contain exactly",
      mutate: (index) => {
        index.channel = "inferred provider field";
      },
    },
    {
      label: "invented original lineage",
      expected: "must not claim original worker lineage or structured handoffs",
      mutate: (index) => {
        index.claims.original_worker_lineage = true as false;
      },
    },
    {
      label: "invented structured handoffs",
      expected: "must not claim original worker lineage or structured handoffs",
      mutate: (index) => {
        index.claims.structured_handoffs = true as false;
      },
    },
  ];

  for (const test of cases) {
    const index = structuredClone(reference) as MutableEvidenceIndex;
    test.mutate(index);
    let message: string | null = null;
    try {
      assertRecordedEvidenceIndex(index, bundle, `Recorded evidence policy ${test.label}`);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    if (!message?.includes(test.expected)) {
      throw new Error(
        `Recorded evidence policy ${test.label}: expected ${test.expected}, received ${message ?? "acceptance"}`,
      );
    }
  }
}
