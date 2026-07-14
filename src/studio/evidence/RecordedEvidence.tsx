import { clock } from "../format";
import { useBundle, useStudio } from "../store";
import { selectCueDecision, summarizeRecordedEvidence } from "./selectors";

import "./evidence.css";

/** Compact projection of the retrospective index; no runtime lineage is implied. */
export default function RecordedEvidence() {
  const bundle = useBundle();
  const clipT = useStudio((state) => state.clipT);
  const evidence = bundle?.evidence;
  if (!bundle || !evidence) return null;

  const summary = summarizeRecordedEvidence(evidence);
  const cue = bundle.captions.cues.find((candidate) => clipT >= candidate.t_start && clipT < candidate.t_end);
  const decision = cue ? selectCueDecision(evidence, cue.id) : null;

  return (
    <section className="recorded-evidence" aria-labelledby="recorded-evidence-title">
      <header>
        <div>
          <span>Post-run evidence index</span>
          <h3 id="recorded-evidence-title">Recorded bytes and terminal decisions</h3>
        </div>
        <a href={`/demo/runs/${bundle.run.id}/evidence.json`}>evidence.json</a>
      </header>

      <p className="recorded-evidence-summary">
        {summary.artifacts} hashed artifacts · {summary.decisions.committed} committed · {summary.decisions.withheld} withheld
        {summary.decisions.dropped > 0 ? ` · ${summary.decisions.dropped} dropped` : ""}
      </p>

      {decision && (
        <dl>
          <div>
            <dt>Current cue</dt>
            <dd>{decision.cue_id} · {decision.terminal_state}</dd>
          </div>
          <div>
            <dt>Terminal effect</dt>
            <dd>
              trace {decision.terminal_effect.trace_index} · {decision.terminal_effect.agent_id} · {clock(decision.terminal_effect.at, true)}
            </dd>
          </div>
          <div>
            <dt>Caption owner label</dt>
            <dd>{decision.caption_owner_id}</dd>
          </div>
          {decision.gate && (
            <div>
              <dt>Recorded gate</dt>
              <dd>{decision.gate.id} · {decision.gate.reason}</dd>
            </div>
          )}
        </dl>
      )}

      <p className="recorded-evidence-limit">
        Indexed after the run. Event agents and caption owners are copied recorded labels, not reconstructed authorship, worker lineage, or handoff receipts.
      </p>
    </section>
  );
}
