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

      <ul className="recorded-evidence-stats">
        <li><span className="stat-n">{summary.artifacts}</span> hashed artifacts</li>
        <li><span className="stat-n">{summary.decisions.committed}</span> committed</li>
        <li><span className="stat-n">{summary.decisions.withheld}</span> withheld</li>
        {summary.decisions.dropped > 0 && (
          <li><span className="stat-n">{summary.decisions.dropped}</span> dropped</li>
        )}
      </ul>

      {decision && (
        <dl>
          <div>
            <dt>Current cue</dt>
            <dd className="ev-dd">
              <code>{decision.cue_id}</code>
              <span className="ev-state">{decision.terminal_state}</span>
            </dd>
          </div>
          <div>
            <dt>Terminal effect</dt>
            <dd className="ev-dd">
              <span className="ev-part">trace {decision.terminal_effect.trace_index}</span>
              <span className="ev-part">{decision.terminal_effect.agent_id}</span>
              <span className="ev-part">{clock(decision.terminal_effect.at, true)}</span>
            </dd>
          </div>
          <div>
            <dt>Caption owner label</dt>
            <dd>{decision.caption_owner_id}</dd>
          </div>
          {decision.gate && (
            <div>
              <dt>Recorded gate</dt>
              <dd className="ev-dd">
                <code>{decision.gate.id}</code>
                <span className="ev-reason">{decision.gate.reason}</span>
              </dd>
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
