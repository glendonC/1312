export const PREPARATION_STAGES = [
  { id: "source", label: "Source", palette: "coral" },
  { id: "range", label: "Range", palette: "citron" },
  { id: "language", label: "Language", palette: "blue" },
  { id: "output", label: "Output", palette: "lilac" },
  { id: "forecast", label: "Forecast", palette: "peach" },
  { id: "confirm", label: "Review", palette: "teal" },
] as const;

export type PreparationStage = (typeof PREPARATION_STAGES)[number]["id"];

export function preparationStageIndex(stage: PreparationStage): number {
  return PREPARATION_STAGES.findIndex((item) => item.id === stage);
}

export default function PreparationStageNavigation({
  currentStage,
  furthestStage,
  selectStage,
}: {
  currentStage: PreparationStage;
  furthestStage: number;
  selectStage: (stage: PreparationStage) => void;
}) {
  return (
    <nav className="preflight-stage-nav" aria-label="Preparation stages">
      <ol>
        {PREPARATION_STAGES.map((item, index) => {
          const current = item.id === currentStage;
          const reached = index <= furthestStage;
          return (
            <li key={item.id}>
              <button
                type="button"
                data-stage={item.id}
                data-palette={item.palette}
                data-state={current ? "current" : reached ? "reached" : "locked"}
                aria-current={current ? "step" : undefined}
                disabled={!reached}
                onClick={() => selectStage(item.id)}
              >
                <span>{String(index + 1).padStart(2, "0")}</span>
                <strong>{item.label}</strong>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
