import type { RunBundle } from "../transport";
import { RecordedMedia } from "../Workspace";

export default function AgentVisualEvidence({ bundle }: { bundle: RunBundle }) {
  return (
    <section
      className="agent-focus-visual-evidence"
      aria-label={`${bundle.run.clip.title} recorded visual evidence`}
    >
      <RecordedMedia bundle={bundle} />
    </section>
  );
}
