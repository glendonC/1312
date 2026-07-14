import type { MethodStep } from "./steps";

export default function ProcessCard({
  step,
  index,
  active,
}: {
  step: MethodStep;
  index: number;
  active: boolean;
}) {
  return (
    <li
      className={`process-card ${step.className}${active ? " is-active" : ""}`}
      data-method-card
      data-index={index}
      data-principle={step.principle}
      data-headline={step.headline}
      data-detail={step.detail}
      style={{ flexGrow: active ? 1 : 0.001 }}
    >
      <button
        className="card-heading"
        type="button"
        aria-expanded={active}
        aria-controls={`process-panel-${index + 1}`}
      >
        <span>
          <span className="card-index">[{String(index + 1).padStart(2, "0")}]</span>
          <span className="card-title">{step.title}</span>
        </span>
        <span className="card-state" aria-hidden="true">
          <span />
          <span style={{ transform: `rotate(${active ? 0 : 90}deg)` }} />
        </span>
      </button>

      <div
        className="card-panel"
        id={`process-panel-${index + 1}`}
        aria-hidden={!active}
        style={{
          opacity: active ? 1 : 0,
          transform: `translateY(${active ? 0 : 22}px)`,
        }}
      >
        <div className="card-detail-mobile">
          <p className="card-detail-principle">{step.principle}</p>
          <p className="card-detail-title">{step.headline}</p>
          <p className="card-detail-copy">{step.detail}</p>
        </div>

        {step.graphic}

        <div
          className="card-mobile-diagram"
          role="img"
          aria-label={step.mobileDiagram.label}
        >
          <p aria-hidden="true">{step.mobileDiagram.label}</p>
          <div className="card-mobile-flow" aria-hidden="true">
            {step.mobileDiagram.nodes.map((node, nodeIndex) => (
              <span key={node}>
                <span>{node}</span>
                {nodeIndex < step.mobileDiagram.nodes.length - 1 && (
                  <span className="card-mobile-arrow">↓</span>
                )}
              </span>
            ))}
          </div>
        </div>

        <footer>{step.description}</footer>
      </div>
    </li>
  );
}
