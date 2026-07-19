import type { ProductionFactsContext } from "./context";

export function ProductionReviewedMemoryFacts({ context }: { context: ProductionFactsContext }) {
  const { projection } = context;
  const bindings = uniqueReviewedMemoryBindings(projection.tasks.map((task) => task.jobContext.reviewedMemory));

  return (
    <section
      data-production-region="reviewed-memory"
      aria-labelledby="product-runtime-reviewed-memory-title"
    >
      <h4 id="product-runtime-reviewed-memory-title">Reviewed memory consumption</h4>
      {projection.tasks.length === 0 ? (
        <p className="product-runtime-unavailable" data-production-empty="reviewed-memory">
          Unavailable until a <code>task.created</code> event is validated.
        </p>
      ) : bindings.length === 0 ? (
        <p className="product-runtime-unavailable" data-production-empty="reviewed-memory">
          Unavailable. No run consumption receipt is bound on the validated tasks. A
          materialization alone does not prove that a run received memory.
        </p>
      ) : (
        <div className="product-runtime-fact-list">
          {bindings.map((binding) => (
            <article
              key={binding.consumptionId}
              data-production-reviewed-memory-consumption-id={binding.consumptionId}
            >
              <header>
                <h5>Host-injected reviewed memory</h5>
                <span>{binding.entryCount} entries</span>
              </header>
              <p>
                Present only after a durable consumption receipt. This is run-input binding,
                not a score win, glossary quality claim, or promotion theater.
              </p>
              <dl>
                <div>
                  <dt>Consumption receipt</dt>
                  <dd>{binding.consumptionId}</dd>
                </div>
                <div>
                  <dt>Materialization</dt>
                  <dd>{binding.materializationId}</dd>
                </div>
                <div>
                  <dt>Snapshot content</dt>
                  <dd>{binding.snapshotContentId}</dd>
                </div>
                <div>
                  <dt>Materialization receipt content</dt>
                  <dd>{binding.materializationReceiptContentId}</dd>
                </div>
                <div>
                  <dt>Policy</dt>
                  <dd>
                    {binding.policy.promotion} · legacy {binding.policy.legacy_unreviewed} ·
                    unavailable {binding.policy.unavailable}
                  </dd>
                </div>
                <div>
                  <dt>Bound entry keys</dt>
                  <dd>
                    {binding.entries.length === 0
                      ? "None in consumption receipt"
                      : binding.entries
                          .map((entry) => `${entry.kind}:${entry.namespace}/${entry.key}`)
                          .join("; ")}
                  </dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function uniqueReviewedMemoryBindings(
  candidates: ReadonlyArray<ProductionFactsContext["projection"]["tasks"][number]["jobContext"]["reviewedMemory"]>,
) {
  const seen = new Set<string>();
  const bindings = [];
  for (const candidate of candidates) {
    if (candidate === null || seen.has(candidate.consumptionId)) continue;
    seen.add(candidate.consumptionId);
    bindings.push(candidate);
  }
  return bindings;
}
