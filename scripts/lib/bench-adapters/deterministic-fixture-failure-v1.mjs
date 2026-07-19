/** Closed failure adapter used only by synthetic bench contract tests. */

export function executeDeterministicFixtureFailure() {
  throw new Error("host-owned deterministic fixture executor failed after charge");
}
