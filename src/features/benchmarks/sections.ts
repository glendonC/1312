// Plain-English section copy for the Benchmarks page.
// Left rail mirrors the Method page: title + lede + one muted secondary line.
// House style: no em dashes.

export interface SectionCopy {
  id: string;
  title: string;
  /** plain-language lede under the title */
  lede: string;
  /** one short muted follow-on line */
  secondary: string;
}

export const sectionCopy: Record<string, SectionCopy> = {
  overview: {
    id: "overview",
    title: "Benchmarks",
    lede: "Does preparation keep the lines that matter? We test a prepped 1321 run against the same system run cold, and against YouTube’s auto-translation, on the same frozen Korean clips.",
    secondary: "The test is whether meaning survives, not whether captions sound fluent. No results yet: this page shows the plan and the receipts.",
  },
  evidence: {
    id: "evidence",
    title: "Where the evidence stands",
    lede: "Every empty cell is intentional. It shows exactly what has to exist before any number can appear.",
    secondary: "Sourced clips, a frozen answer key, captured runs, then blind review. You can audit the gap yourself instead of trusting a number.",
  },
  pack: {
    id: "pack",
    title: "The clips we test on",
    lede: "Five hard Korean clips, chosen to break easy cases: fast speech, overlap, honorifics, names and numbers.",
    secondary: "Clear controls mixed with real-media failure modes. If it holds up here, it holds up on real video.",
  },
  compare: {
    id: "compare",
    title: "What we compare against",
    lede: "Same frozen clips, different allowed inputs, so a comparison can never hide what actually changed.",
    secondary: "The clips and answer key stay fixed. Only the system and its prep change, because the gap between prepped and cold is the whole point.",
  },
  results: {
    id: "results",
    title: "The headline result",
    lede: "The one number that decides it: of the lines that matter, how many reached English with their meaning intact?",
    secondary: "Four outcomes stay separate, shown and right, shown and wrong, held back, missed, so caution can’t pass for correctness.",
  },
  methods: {
    id: "methods",
    title: "How we score it",
    lede: "One headline judgment, backed by standard diagnostics. Nothing becomes a claim without the evidence to earn it.",
    secondary: "Diagnostics like CER, chrF and COMET locate where it broke. Research-only methods wait for the right data.",
  },
  receipts: {
    id: "receipts",
    title: "The audit trail",
    lede: "Every score traces back to files anyone can check: source, config, output, runtime, and review.",
    secondary: "Raw outputs, blinded review labels, and the exact answer key, versioned. You can re-derive our number, or catch us if it’s wrong.",
  },
};
