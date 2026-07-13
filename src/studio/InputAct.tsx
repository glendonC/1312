import { motion } from "motion/react";

/** A blank canvas. Everything the user can do lives in the dock. */
export default function InputAct() {
  return (
    <motion.section
      className="act act-input"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4 }}
    >
      <div className="canvas" aria-hidden="true" />
    </motion.section>
  );
}
