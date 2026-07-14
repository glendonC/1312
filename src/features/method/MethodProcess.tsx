import ProcessCard from "./ProcessCard";
import { steps } from "./steps";

function AnimatedHeadline({ text }: { text: string }) {
  return (
    <h2 className="process-detail-title" aria-label={text}>
      {Array.from(text).map((character, index) => (
        <span key={`${character}-${index}`} aria-hidden="true">
          {character === " " ? "\u00a0" : character}
        </span>
      ))}
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
          <h1 id="process-title">Our method</h1>
          <div className="process-progress" aria-hidden="true">
            <span style={{ transform: "scaleX(0)" }} />
          </div>

          <div className="process-detail-stage">
            <div className="process-detail" aria-live="polite">
              <p className="process-detail-meta">
                <span>[01]</span>
                <span className="process-detail-principle">{steps[0].principle}</span>
              </p>
              <AnimatedHeadline text={steps[0].headline} />
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
