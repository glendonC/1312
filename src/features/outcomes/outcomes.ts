// Content model for the public Outcomes page.
//
// A positioning page, not an essay or a blog. Each section states the value and
// how it is delivered, the problem it solves (urgent now or a blocker for what
// comes later), and what it enables going forward, with enough explanation to
// be convincing. Claims stay honest: the difference from conversion tools is
// architectural, not a benchmark result; learning is a foundation being built
// toward, not a shipped product.

export type OutcomeSection = {
  id: string;
  index: string; // "01" - mono marker, echoes Method
  palette: "teal" | "coral" | "citron" | "blue" | "lilac" | "peach";
  title: string;
  body: string[]; // one entry per paragraph
};

export const hero = {
  title: "Outcomes",
  standfirst:
    "What changes when a system investigates real media instead of only converting it: output you can trust, correct, and reuse, and the start of a way to learn from it.",
};

export const sections: OutcomeSection[] = [
  {
    id: "investigation",
    index: "01",
    palette: "teal",
    title: "Investigate before converting.",
    body: [
      "Most media tools run one fixed route: transcribe, translate, time, output. Every line takes the same path, and the transcript is treated as the truth. That holds until the media is hard, and real media usually is: overlapping voices, dropped subjects, honorifics, names that only resolve in context, meaning that lives in a frame instead of the audio.",
      "1321 treats the source as something to investigate before it is converted. When a line is uncertain, the system opens focused workers, gathers evidence, and reconciles it before anything is accepted. The value is not a faster caption. It is an answer the system can stand behind and a record that shows why, which is the thing every outcome below depends on.",
    ],
  },
  {
    id: "media-first",
    index: "02",
    palette: "coral",
    title: "Start from the media.",
    body: [
      "A transcript-first pipeline inherits every error in the transcript. Once a name is misheard or a subject is dropped, translation, timing, and review all build on the mistake, and nothing downstream can see the sound or the frame that would have caught it.",
      "1321 opens the audio, the frames, and the source provenance as a working environment, and its agents read from the media itself. This is the blocker that has to be solved first: a system that cannot return to the evidence cannot recover meaning it lost on the first pass. Starting from the media is what makes everything else here possible.",
    ],
  },
  {
    id: "adaptive-effort",
    index: "03",
    palette: "citron",
    title: "Spend effort where it's hard.",
    body: [
      "A fixed pipeline gives a clear sentence and a garbled, overlapping, honorific-heavy line exactly the same treatment. The easy line wastes work and the hard line never gets enough, so neither the cost nor the accuracy lands where it should.",
      "1321 lets uncertainty decide where to investigate. Clear lines take the short route; difficult ones earn a narrower specialist, another pass on the audio, a frame inspection, or an outside check. The near-term value is recovering the lines a cold pass misses. The value going forward is a system that learns which investigations are worth their cost, so effort scales with difficulty instead of with volume.",
    ],
  },
  {
    id: "traceable",
    index: "04",
    palette: "blue",
    title: "Show the evidence for every answer.",
    body: [
      "A single confident sentence hides where a name, a number, or a meaning came from. When it is wrong, there is no way to see how and no way to trust the next one. For anything past casual viewing that is a blocker: you cannot review, correct, or safely build on output you cannot trace.",
      "In 1321, names, numbers, and meanings keep the evidence behind them. Disagreements between workers stay visible instead of being flattened into false confidence, and a line the system cannot support is withheld rather than guessed. That makes the output reviewable today, and it is the precondition for letting the system improve from its own corrections later.",
    ],
  },
  {
    id: "reusable",
    index: "05",
    palette: "lilac",
    title: "Investigate once, reuse everywhere.",
    body: [
      "When understanding is locked inside a caption file, every other use starts over. A study tool, a search index, or another agent has to re-derive what was already worked out, usually with less context than the run that produced it.",
      "Because 1321 keeps a reconciled, checked record, the same understanding can leave as captions, structured facts, or evidence a downstream system acts on. Corrections and scored failures become reusable cases that inform later runs. One investigation pays off in many places, which is what turns a single good result into a system that compounds instead of resetting.",
    ],
  },
  {
    id: "learning",
    index: "06",
    palette: "peach",
    title: "Turn understanding into learning.",
    body: [
      "Translation converts a video so you can watch it. It also drops most of what there is to learn: the register, the honorific, the reference, the on-screen text, the reason a line means what it means. Understanding the media keeps that context instead of flattening it into one English sentence.",
      "That opens a way to learn that translation alone never can. The same evidence that resolved a hard line can explain it: timed Korean, what was said, and why. Korean to English is the first proof case, not the boundary; the larger target is a system that can investigate any real media and use that understanding as the foundation for learning from it. Today the work runs on short Korean clips and owned files, and the learning environment is a direction being built toward, not a finished product.",
    ],
  },
];

export const ctas = [
  { label: "See how it works", href: "/method/", kind: "primary" as const },
  { label: "Watch it on a clip", href: "/studio/", kind: "secondary" as const },
];
