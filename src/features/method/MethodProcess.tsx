import ProcessCard from "./ProcessCard";
import { steps } from "./steps";

function ProcessHeadline({ text }: { text: string }) {
  return (
    <h2 className="process-detail-title" aria-label={text}>
      {text}
    </h2>
  );
}

export default function MethodProcess() {
  return (
    <section
      className="process-section"
      id="process"
      aria-labelledby="process-title"
      data-method-process
    >
      <div className="process-layout">
        <header className="process-intro">
          <p className="process-kicker">How 1321 understands media</p>
          <h1 id="process-title">Our method</h1>
          <p className="process-intro-copy">
            1321 gives autonomous agents a working environment for media. An orchestrator
            inspects the source, opens focused workspaces, and assigns unresolved questions to
            specialists.
          </p>
          <p className="process-intro-copy process-intro-copy-secondary">
            Each worker can revisit the media, use permitted tools, gather context, and return
            structured evidence for the system to reconcile. Korean-to-English media is the first
            proof case for a larger system that lets autonomous agents investigate and understand
            real media.{" "}
            <a className="process-proof-link" href="/journey/2026-07-13-why-1321/">
              <span>Why this proof case</span>
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M3 8h9M8.5 4.5 12 8l-3.5 3.5" />
              </svg>
            </a>
          </p>
          <div className="process-progress" aria-hidden="true">
            <span style={{ transform: "scaleX(0)" }} />
          </div>

          <div className="process-detail-stage">
            <div className="process-detail" aria-live="polite">
              <p className="process-detail-meta">
                <span>[01]</span>
                <span className="process-detail-principle">{steps[0].principle}</span>
              </p>
              <ProcessHeadline text={steps[0].headline} />
              <p className="process-detail-copy">{steps[0].detail}</p>
            </div>
          </div>
        </header>

        <div className="process-rail">
          <ol className="process-cards">
            {steps.map((step, index) => (
              <ProcessCard
                key={step.title}
                step={step}
                index={index}
                active={index === 0}
              />
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
