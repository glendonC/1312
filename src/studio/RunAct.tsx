import { motion } from "motion/react";

import AgentPanel from "./AgentPanel";
import Results from "./Results";
import SwarmGraph from "./SwarmGraph";
import { useComplete, useStudio } from "./store";

export default function RunAct() {
  const complete = useComplete();
  const focused = useStudio((state) => state.selected !== null);

  return (
    <motion.section
      className="act act-run"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="stage" data-agent-focus={focused ? "true" : undefined}>
        <SwarmGraph />
        <AgentPanel />
      </div>

      {complete && <Results />}
    </motion.section>
  );
}
