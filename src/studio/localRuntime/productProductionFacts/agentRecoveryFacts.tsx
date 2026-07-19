import type { ProductionStudioAgentRecoveryView } from "../../runtime/production/studioProjection";
import type { ProductionFactsContext } from "./context";
import {
  ProductionIdentityLink,
  productionIdentityTarget,
} from "./shared";

function allocation({ wallMs, toolCalls }: { wallMs: number; toolCalls: number }): string {
  return `${wallMs.toLocaleString("en-US")} ms / ${toolCalls} calls`;
}

function TaskIdentity({ identity, context }: { identity: string; context: ProductionFactsContext }) {
  return context.taskIds.has(identity)
    ? <ProductionIdentityLink kind="task" identity={identity} />
    : <>{identity}</>;
}

function WorkerIdentity({ identity, context }: { identity: string; context: ProductionFactsContext }) {
  return context.workerIds.has(identity)
    ? <ProductionIdentityLink kind="worker" identity={identity} />
    : <>{identity}</>;
}

function ExecutionIdentity({ identity, context }: { identity: string; context: ProductionFactsContext }) {
  return context.executionIds.has(identity)
    ? <ProductionIdentityLink kind="execution" identity={identity} />
    : <>{identity}</>;
}

function terminalCopy(recovery: ProductionStudioAgentRecoveryView): string {
  if (recovery.state === "authorized") {
    return "Authorized. Attempt 1 has its own reserved identity, but no terminal recovery receipt is present yet, so its outcome remains unavailable.";
  }
  if (recovery.state === "replacement_reported") {
    return "Replacement reported. The one authorized replacement produced one ordinary report; correctness and semantic quality remain unassessed.";
  }
  return "Exhausted. Both authorized attempts were consumed, zero remain, no replacement report exists, and the root is withheld by the runtime path.";
}

export function ProductionAgentRecoveryFacts({ context }: { context: ProductionFactsContext }) {
  const { projection } = context;
  return (
    <section
      data-production-region="agent-recovery"
      aria-labelledby="product-runtime-agent-recovery-title"
    >
      <h4 id="product-runtime-agent-recovery-title">Initial-coverage recovery</h4>
      <p>
        Host-classified executor failures and exact scheduler-authorized replacement lineage for
        generalized initial coverage. Classification policy alone is not replacement authority.
        Allocation values are ceilings, not forecasts or measured spend.
      </p>

      {projection.executorFailureClassifications.length === 0 && projection.agentRecoveries.length === 0 ? (
        <p className="product-runtime-unavailable" data-production-empty="agent-recovery">
          Unavailable because no validated <code>executor.failure_classified</code>, <code>agent.recovery_authorized</code>,
          or <code>agent.recovery_terminal_recorded</code> receipt exists. A failed task, worker label,
          plan, or animation does not imply replacement authority.
        </p>
      ) : (
        <>
          <div className="product-runtime-fact-list" data-production-recovery-classifications>
            {projection.executorFailureClassifications.map((classification) => (
              <article
                key={classification.receiptId}
                id={productionIdentityTarget("receipt", classification.receiptId)}
                data-production-failure-classification-id={classification.receiptId}
                data-retryability={classification.retryability}
              >
                <header><h5>Executor failure classified</h5><span>{classification.retryability}</span></header>
                <p>{classification.safeReason}</p>
                <dl>
                  <div><dt>Classification receipt</dt><dd>{classification.receiptId} · {classification.contentId}</dd></div>
                  <div><dt>Failure code</dt><dd>{classification.code}</dd></div>
                  <div>
                    <dt>Task / worker</dt>
                    <dd>
                      <TaskIdentity identity={classification.taskId} context={context} />
                      {" / "}
                      <WorkerIdentity identity={classification.agentId} context={context} />
                    </dd>
                  </div>
                  <div>
                    <dt>Execution</dt>
                    <dd><ExecutionIdentity identity={classification.executionId} context={context} /></dd>
                  </div>
                  <div><dt>Executor receipt</dt><dd>{classification.executorReceiptId}</dd></div>
                  <div><dt>Classifier</dt><dd>{classification.producer.id} {classification.producer.version}</dd></div>
                  <div><dt>Policy</dt><dd>{classification.producer.policy}</dd></div>
                  <div><dt>Authority</dt><dd>{classification.retryability === "replaceable" ? "Eligible for scheduler policy review only" : "Terminal; no replacement authority"}</dd></div>
                </dl>
              </article>
            ))}
          </div>

          {projection.agentRecoveries.length === 0 ? (
            <p className="product-runtime-unavailable" data-production-empty="agent-recovery-authorizations">
              No validated recovery authorization receipt exists. Classified failures remain visible,
              but no replacement is inferred.
            </p>
          ) : (
            <div className="product-runtime-fact-list" data-production-recovery-authorizations>
              {projection.agentRecoveries.map((recovery) => {
                const { authorization, terminal } = recovery;
                return (
                  <article
                    key={recovery.workId}
                    id={productionIdentityTarget("receipt", authorization.receiptId)}
                    data-production-agent-recovery-id={recovery.workId}
                    data-recovery-state={recovery.state}
                  >
                    <header><h5>Authorized replacement lineage</h5><span>{recovery.state}</span></header>
                    <p>{terminalCopy(recovery)}</p>
                    <dl>
                      <div><dt>Work</dt><dd>{recovery.workId}</dd></div>
                      <div><dt>Authorization receipt</dt><dd>{authorization.receiptId} · {authorization.contentId}</dd></div>
                      <div><dt>Policy</dt><dd>{authorization.policy.policyId} · {authorization.policy.scope}</dd></div>
                      <div><dt>Contract fingerprint</dt><dd>{authorization.work.contractFingerprint}</dd></div>
                      <div><dt>Initial spawn / job context</dt><dd>{authorization.work.initialSpawnRequestId} / {authorization.work.jobContextId}</dd></div>
                      <div><dt>Replacement allocation ceiling</dt><dd>{allocation(authorization.reservedSpend)}</dd></div>
                      <div><dt>Run recovery contingency ceiling</dt><dd>{allocation(authorization.policy.recoveryContingency)}</dd></div>
                      <div><dt>Per-work attempt ceiling</dt><dd>{authorization.policy.maxAttemptsPerWork} total attempts</dd></div>
                      <div><dt>Per-run replacement ceiling</dt><dd>{authorization.policy.maxReplacementsPerRun} replacements</dd></div>
                    </dl>

                    <div className="product-runtime-fact-list">
                      <article data-recovery-attempt="0" data-attempt-status="failed">
                        <header><h5>Attempt 0 · failed</h5><span>{authorization.failedAttempt.failureCode}</span></header>
                        <dl>
                          <div><dt>Attempt</dt><dd>{authorization.failedAttempt.attemptId}</dd></div>
                          <div>
                            <dt>Task / worker</dt>
                            <dd>
                              <TaskIdentity identity={authorization.failedAttempt.taskId} context={context} />
                              {" / "}
                              <WorkerIdentity identity={authorization.failedAttempt.agentId} context={context} />
                            </dd>
                          </div>
                          <div><dt>Execution</dt><dd><ExecutionIdentity identity={authorization.failedAttempt.executionId} context={context} /></dd></div>
                          <div><dt>Executor receipt</dt><dd>{authorization.failedAttempt.executorReceiptId}</dd></div>
                          <div>
                            <dt>Classification</dt>
                            <dd><ProductionIdentityLink kind="receipt" identity={authorization.failedAttempt.failureClassificationReceiptId} /></dd>
                          </div>
                        </dl>
                      </article>

                      <article data-recovery-attempt="1" data-attempt-status={recovery.state}>
                        <header><h5>Attempt 1 · exact replacement</h5><span>{recovery.state}</span></header>
                        <dl>
                          <div><dt>Attempt</dt><dd>{authorization.replacement.attemptId}</dd></div>
                          <div>
                            <dt>Task / worker</dt>
                            <dd>
                              <TaskIdentity identity={authorization.replacement.taskId} context={context} />
                              {" / "}
                              <WorkerIdentity identity={authorization.replacement.agentId} context={context} />
                            </dd>
                          </div>
                          <div><dt>Spawn request</dt><dd>{authorization.replacement.spawnRequestId}</dd></div>
                          <div><dt>Workload</dt><dd>{authorization.replacement.workloadKey}</dd></div>
                          <div><dt>Terminal execution</dt><dd>{terminal ? <ExecutionIdentity identity={terminal.replacementExecutionId} context={context} /> : "Unavailable until terminal receipt"}</dd></div>
                          <div>
                            <dt>Report</dt>
                            <dd>
                              {terminal?.replacementReportId
                                ? context.reportIds.has(terminal.replacementReportId)
                                  ? <ProductionIdentityLink kind="report" identity={terminal.replacementReportId} />
                                  : terminal.replacementReportId
                                : terminal?.outcome === "exhausted"
                                  ? "None; recovery exhausted"
                                  : "Unavailable until terminal receipt"}
                            </dd>
                          </div>
                        </dl>
                      </article>
                    </div>

                    <dl>
                      <div><dt>Terminal receipt</dt><dd>{terminal ? `${terminal.receiptId} · ${terminal.contentId}` : "Unavailable until agent.recovery_terminal_recorded is validated"}</dd></div>
                      <div><dt>Attempts consumed / remaining</dt><dd>{terminal ? `${terminal.attemptsConsumed} / ${terminal.remainingAttempts}` : "Unavailable / unavailable"}</dd></div>
                      <div><dt>Terminal reason</dt><dd>{terminal?.reason ?? "Unavailable until terminal receipt"}</dd></div>
                    </dl>
                  </article>
                );
              })}
            </div>
          )}
        </>
      )}

      <p data-production-recovery-boundary>
        This is one host-owned exact replacement lane for generalized initial-coverage execution
        faults. It performs no best-of-K selection, quality retry, or semantic preference. It does
        not recover root, caption, or Learning work, predict success, or authorize an attempt 2.
      </p>
    </section>
  );
}
