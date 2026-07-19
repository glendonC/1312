import { useMemo } from "react";

import { useBundle, useStudio } from "../store";
import ConfirmationForm, { AdvancedFields } from "./ConfirmationForm";
import SubmittedPreparationForm from "./SubmittedPreparationForm";
import {
  assessRecordedRequest,
  assessSubmittedPreviewRequest,
  type PreflightSession,
} from "./model";

// Direct leaf imports so Vite invalidates each sheet; a CSS @import barrel can serve stale CSS until HMR.
import "./preflight.shell.css";
import "./preflight.preparation.css";
import "./preflight.inputs.css";
import "./preflight.forecast-ledger.css";
import "./preflight.output.css";
import "./preflight.stages.css";
import "./preflight.responsive.css";

export default function Preflight() {
  const bundle = useBundle();
  const session = useStudio((state) => state.preflight);
  const update = useStudio((state) => state.updatePreflightRequest);
  const dismiss = useStudio((state) => state.dismissPreflight);
  const confirm = useStudio((state) => state.confirmPreflight);
  const useRecorded = useStudio((state) => state.openRecordedPreflight);
  const retrySubmittedSource = useStudio((state) => state.retrySubmittedSource);
  const updateSubmittedSourceLanguage = useStudio((state) => state.updateSubmittedSourceLanguage);
  const previewSession = useStudio((state) => state.previewSession);

  const assessment = useMemo(
    () => {
      return previewSession?.resolution
        ? assessSubmittedPreviewRequest(session, previewSession.resolution.source.durationMs / 1_000)
        : bundle
          ? assessRecordedRequest(session, bundle, import.meta.env.DEV)
          : null;
    },
    [bundle, previewSession, session],
  );

  if (session.status === "idle") return null;

  if (previewSession?.resolution && session.status === "ready" && assessment) {
    const resolution = previewSession.resolution;
    return (
      <section
        className="preflight"
        data-preview-mode="submitted-source"
        aria-labelledby="preflight-stage-title"
      >
        <SubmittedPreparationForm
          resolution={resolution}
          previewSession={previewSession}
          session={session}
          assessment={assessment}
          update={update}
          updateSourceLanguage={updateSubmittedSourceLanguage}
          confirm={confirm}
        />
      </section>
    );
  }

  if (session.status !== "ready" || !session.facts || !bundle) {
    const fixture = session.provenance.kind === "contract_fixture";
    return (
      <section
        className="preflight"
        data-preview-mode={previewSession ? "submitted-source-status" : undefined}
        aria-labelledby="preflight-title"
      >
        <header className="preflight-head">
          <span className="preflight-kicker">Source preflight</span>
          <h1 id="preflight-title">{session.title}</h1>
          <p>{session.message}</p>
        </header>

        {fixture && (
          <p className="preflight-fixture" role="note">
            Development contract fixture only. No source measurement or worker event was produced.
          </p>
        )}

        <Provenance session={session} />
        <AdvancedFields request={session.request} update={update} relevance={session.relevance} />

        <div className="preflight-actions">
          <button type="button" className="ghost" onClick={dismiss}>
            {session.status === "cancelled" ? "Close" : "Try another source"}
          </button>
          {previewSession?.resolutionFailure?.retryable && (
            <button type="button" className="ghost" onClick={retrySubmittedSource}>
              Retry same source
            </button>
          )}
          {session.status !== "loading_source" && session.status !== "probing" && (
            <button type="button" className="cta" onClick={useRecorded}>
              Open recorded demo
            </button>
          )}
        </div>
      </section>
    );
  }

  const { facts } = session;

  return (
    <section
      className="preflight"
      data-preview-mode="recorded-demo"
      aria-labelledby="preflight-stage-title"
    >
      <ConfirmationForm
        bundle={bundle}
        session={session}
        facts={facts}
        assessment={assessment}
        update={update}
        confirm={confirm}
      />
    </section>
  );
}

function Provenance({ session }: { session: PreflightSession }) {
  return (
    <div className="preflight-provenance">
      <span>Producer</span>
      <b>{session.provenance.producer ?? "none"}</b>
      <p>{session.provenance.note}</p>
      {session.missing.map((gap) => (
        <p key={gap.id}>{gap.label}: {gap.consequence}</p>
      ))}
    </div>
  );
}
