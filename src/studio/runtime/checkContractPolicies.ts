import type { RuntimeContractFixture, SpawnDecidedEvent, SpawnRequestedEvent } from "./contracts";
import { validateRuntimeContractFixture } from "./validateContractFixture";

function request(fixture: RuntimeContractFixture): SpawnRequestedEvent {
  const event = fixture.events.find((candidate): candidate is SpawnRequestedEvent => candidate.type === "spawn_requested");
  if (!event) throw new Error(`Runtime contract fixture ${fixture.id} has no spawn request`);
  return event;
}

function decision(fixture: RuntimeContractFixture): SpawnDecidedEvent {
  const event = fixture.events.find((candidate): candidate is SpawnDecidedEvent => candidate.type === "spawn_decided");
  if (!event) throw new Error(`Runtime contract fixture ${fixture.id} has no spawn decision`);
  return event;
}

/** Prove the approved reference fixture fails closed when each scheduler bound is violated. */
export function checkRuntimeContractPolicies(reference: RuntimeContractFixture): void {
  const cases: Array<{ label: string; mutate: (fixture: RuntimeContractFixture) => void }> = [
    {
      label: "maximum depth",
      mutate: (fixture) => {
        request(fixture).task.depth = fixture.limits.maxDepth + 1;
      },
    },
    {
      label: "maximum active workers",
      mutate: (fixture) => {
        fixture.limits.maxActiveWorkers = 1;
      },
    },
    {
      label: "run budget",
      mutate: (fixture) => {
        fixture.limits.runBudget.wallMs = 70_000;
      },
    },
    {
      label: "required output contract",
      mutate: (fixture) => {
        request(fixture).task.requiredOutputs = [];
      },
    },
    {
      label: "least privilege capability",
      mutate: (fixture) => {
        decision(fixture).grants.push({ capability: "output.withhold", mediaScope: [] });
      },
    },
    {
      label: "least privilege media scope",
      mutate: (fixture) => {
        request(fixture).task.mediaScope[0].range = [0, 50];
      },
    },
  ];

  for (const test of cases) {
    const fixture = structuredClone(reference);
    test.mutate(fixture);
    let rejected = false;
    try {
      validateRuntimeContractFixture(fixture);
    } catch {
      rejected = true;
    }
    if (!rejected) throw new Error(`Runtime contract policy did not reject ${test.label}`);
  }
}
