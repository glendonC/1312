import {
  PRODUCER_GAPS,
  idlePreflight,
  type PreflightSession,
  type PreflightStatus,
  type ProducerGap,
} from "../preflight/model";

export interface PreflightLabScenario {
  id: string;
  label: string;
  status: PreflightStatus;
  title: string;
  message: string;
  missing: ProducerGap[];
  relevance?: PreflightSession["relevance"];
}

const gap = (id: ProducerGap["id"]): ProducerGap => {
  const found = PRODUCER_GAPS.find((candidate) => candidate.id === id);
  return (
    found ?? {
      id: "hosted-ingest",
      label: "Hosted ingest service",
      consequence: "No source producer is connected.",
    }
  );
};

/**
 * UI contract fixtures only. They contain no measurements and cannot start a run.
 * A real producer must replace the fixture provenance before any state can ship as evidence.
 */
export const PREFLIGHT_SCENARIOS: readonly PreflightLabScenario[] = [
  {
    id: "loading-source",
    label: "Loading source",
    status: "loading_source",
    title: "Loading source contract",
    message: "The source shell is waiting for an ingest response. This fixture performs no request.",
    missing: [gap("hosted-ingest")],
  },
  {
    id: "probing",
    label: "Probing",
    status: "probing",
    title: "Probe in progress contract",
    message: "This state reserves UI for real probe events. No scout or media tool is running in this fixture.",
    missing: [...PRODUCER_GAPS],
  },
  {
    id: "invalid-source",
    label: "Invalid source",
    status: "invalid_source",
    title: "Invalid source contract",
    message: "Client validation rejected the fixture before any source request.",
    missing: [],
  },
  {
    id: "inaccessible",
    label: "Inaccessible",
    status: "inaccessible",
    title: "Inaccessible source contract",
    message: "The shell fails closed. This fixture has no access or licence measurement.",
    missing: [gap("hosted-ingest")],
  },
  {
    id: "no-korean",
    label: "No Korean",
    status: "no_target_language",
    title: "No Korean contract",
    message: "The fail-closed state is visible, but no language result is shown because no detector producer exists.",
    missing: [gap("language")],
  },
  {
    id: "mixed-language",
    label: "Mixed language",
    status: "mixed_language",
    title: "Mixed-language contract",
    message: "Range selection is withheld because this fixture has no measured language windows.",
    missing: [gap("language"), gap("overlap")],
    relevance: { backgroundSpeech: true, music: false, speakerFocus: true },
  },
  {
    id: "complex-media",
    label: "Music and overlap",
    status: "probing",
    title: "Complex-media controls contract",
    message: "Relevant controls are exercised without claiming that music, lyrics, or overlap was detected.",
    missing: [gap("acoustic"), gap("overlap")],
    relevance: { backgroundSpeech: true, music: true, speakerFocus: true },
  },
  {
    id: "excessive-duration",
    label: "Excessive duration",
    status: "excessive_duration",
    title: "Excessive-duration contract",
    message: "The range-required shell is visible, but this fixture supplies no invented duration.",
    missing: [gap("hosted-ingest"), gap("complexity")],
  },
  {
    id: "cancelled",
    label: "Cancelled",
    status: "cancelled",
    title: "Source confirmation cancelled",
    message: "No analysis was started and no result is being shown.",
    missing: [],
  },
] as const;

export function preflightFixture(scenario: PreflightLabScenario): PreflightSession {
  return {
    ...idlePreflight(),
    status: scenario.status,
    title: scenario.title,
    message: scenario.message,
    missing: scenario.missing,
    provenance: {
      kind: "contract_fixture",
      producer: null,
      note: "Exact development UI contract. It is not recorded evidence and cannot confirm a run.",
    },
    relevance: scenario.relevance ?? { backgroundSpeech: false, music: false, speakerFocus: false },
  };
}

export function validatePreflightScenario(scenario: PreflightLabScenario): void {
  const session = preflightFixture(scenario);
  if (session.facts !== null) throw new Error(`Preflight scenario ${scenario.id} must not contain measured facts`);
  if (session.provenance.kind !== "contract_fixture") {
    throw new Error(`Preflight scenario ${scenario.id} must retain fixture provenance`);
  }
  if (session.status === "ready" || session.status === "idle") {
    throw new Error(`Preflight scenario ${scenario.id} cannot claim ${session.status} without a producer`);
  }
}
