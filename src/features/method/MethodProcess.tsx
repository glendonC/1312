import {
  AnimatePresence,
  motion,
  useMotionValueEvent,
  useScroll,
  useTransform,
} from "motion/react";
import { useEffect, useRef, useState } from "react";
import ProcessCard from "./ProcessCard";
import { steps } from "./steps";

function AnimatedHeadline({ text }: { text: string }) {
  return (
    <h2 className="process-detail-title" aria-label={text}>
      {Array.from(text).map((character, index) => (
        <motion.span
          key={`${character}-${index}`}
          aria-hidden="true"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.32, delay: index * 0.012, ease: [0.22, 1, 0.36, 1] }}
        >
          {character === " " ? "\u00a0" : character}
        </motion.span>
      ))}
    </h2>
  );
}

export default function MethodProcess() {
  const rail = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [desktop, setDesktop] = useState(true);
  const { scrollYProgress } = useScroll({
    target: rail,
    offset: ["start start", "end end"],
  });
  const progressScale = useTransform(scrollYProgress, [0, 1], [0, 1]);

  useEffect(() => {
    const query = window.matchMedia("(min-width: 901px)");
    const update = () => setDesktop(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useMotionValueEvent(scrollYProgress, "change", (value) => {
    if (desktop) setActiveIndex(Math.round(value * (steps.length - 1)));
  });

  const select = (index: number) => {
    setActiveIndex(index);
    if (!desktop || !rail.current) return;

    const rect = rail.current.getBoundingClientRect();
    const railTop = window.scrollY + rect.top;
    const travel = rail.current.offsetHeight - window.innerHeight;
    window.scrollTo({
      top: railTop + travel * (index / (steps.length - 1)),
      behavior: "smooth",
    });
  };

  return (
    <section className="process-section" id="process" aria-labelledby="process-title">
      <div className="process-layout">
        <header className="process-intro">
          <p className="process-eyebrow">Our process</p>
          <h1 id="process-title">How we work</h1>
          <div className="process-progress" aria-hidden="true">
            <motion.span style={{ scaleX: desktop ? progressScale : 1 }} />
          </div>

          <div className="process-detail-stage">
            <AnimatePresence mode="sync" initial={false}>
              <motion.div
                className="process-detail"
                key={steps[activeIndex].title}
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                aria-live="polite"
              >
                <p className="process-detail-meta">
                  <span>[{String(activeIndex + 1).padStart(2, "0")}]</span>
                  {steps[activeIndex].principle}
                </p>
                <AnimatedHeadline text={steps[activeIndex].headline} />
                <p className="process-detail-copy">{steps[activeIndex].detail}</p>
              </motion.div>
            </AnimatePresence>
          </div>
        </header>

        <div className="process-rail" ref={rail}>
          <ol className="process-cards">
            {steps.map((step, index) => (
              <ProcessCard
                key={step.title}
                step={step}
                index={index}
                progress={scrollYProgress}
                active={index === activeIndex}
                desktop={desktop}
                onSelect={() => select(index)}
              />
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
