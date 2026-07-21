import { useMemo } from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";

import { Arrow } from "../glyphs";
import { useBundle, useStudio } from "../store";
import ConfirmationForm, { AdvancedFields } from "./ConfirmationForm";
import {
  assessRecordedRequest,
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

  const assessment = useMemo(
    () => (bundle ? assessRecordedRequest(session, bundle, import.meta.env.DEV) : null),
    [bundle, session],
  );

  if (session.status === "idle") return null;

  if (session.status !== "ready" || !session.facts || !bundle) {
    const fixture = session.provenance.kind === "contract_fixture";
    return (
      <section
        className="preflight"
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
      {assessment?.canReplay && session.status === "ready" && typeof document !== "undefined" &&
        createPortal(
          // Portaled to the body so the fixed position resolves against the viewport, not the
          // preflight's transform-animated ancestors, which would otherwise capture it. The plain
          // wrapper owns positioning/centering so the inner pill's entrance transform can't drop it.
          <div className="preflight-skip">
            <motion.div
              className="rail"
              initial={{ opacity: 0, y: 7, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ type: "spring", stiffness: 280, damping: 32, mass: 0.7 }}
            >
              <button
                type="button"
                className="rail-btn"
                onClick={confirm}
                title="Skip the guided setup and replay with the recorded defaults"
              >
                <span className="rail-glyph">
                  <Arrow />
                </span>
                <span>Skip setup</span>
              </button>
            </motion.div>
          </div>,
          document.body,
        )}
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
