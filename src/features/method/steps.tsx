import type { ReactNode } from "react";

export type MethodStep = {
  title: string;
  principle: string;
  headline: string;
  detail: string;
  description: string;
  className: string;
  graphic: ReactNode;
  mobileDiagram: {
    label: string;
    nodes: string[];
  };
};

export const steps: MethodStep[] = [
  {
    title: "Ingest",
    principle: "Media becomes evidence",
    headline: "Make the source inspectable.",
    detail:
      "A link or owned file becomes one bounded run with audio to hear, frames to inspect, and source information to preserve. Agents begin from the media itself instead of treating a transcript as the whole truth.",
    description:
      "One source becomes an inspectable workspace with its media, boundaries, and provenance intact.",
    className: "card-ingest",
    mobileDiagram: {
      label: "A source becomes an isolated, inspectable run",
      nodes: ["Source media", "Audio + frames", "Run context"],
    },
    graphic: (
      <svg className="card-graphic" viewBox="0 0 720 300" role="img" aria-label="A media clip is opened and inspected">
        <g className="diagram-stroke">
          <rect x="28" y="58" width="214" height="164" rx="9" />
          <path d="m101 101 66 38-66 38Z" />
          <path d="M58 197h154" />
          <path d="M270 140h68m-15-14 15 14-15 14" />
          <rect x="370" y="34" width="322" height="216" rx="10" />
          <path d="M370 101h322M370 170h322" />
          <path d="M466 68h14l9-15 13 31 13-22 12 10 12-18 13 14h104" />
          <rect x="466" y="122" width="54" height="30" rx="3" />
          <rect x="530" y="122" width="54" height="30" rx="3" />
          <rect x="594" y="122" width="54" height="30" rx="3" />
          <path d="M466 198h178M466 218h130" />
        </g>
        <g className="diagram-labels">
          <text x="28" y="45">YOUTUBE URL / OWNED FILE</text>
          <text x="58" y="246">SOURCE MEDIA</text>
          <text x="390" y="72">AUDIO</text>
          <text x="390" y="141">FRAMES</text>
          <text x="390" y="210">METADATA</text>
          <text className="diagram-small" x="596" y="238">ISOLATED RUN</text>
        </g>
      </svg>
    ),
  },
  {
    title: "Investigate",
    principle: "Let uncertainty shape the work",
    headline: "Spawn the investigation the media needs.",
    detail:
      "The orchestrator identifies unresolved questions, then creates and retires isolated workers as needed. Within their granted scope, workers can revisit a moment, inspect audio or frames, use tools, gather outside context, and request a narrower specialist.",
    description:
      "The evidence determines which workers and tools are needed. Actions, sources, drafts, and handoffs remain inspectable.",
    className: "card-analyze",
    mobileDiagram: {
      label: "Uncertainty determines the next investigation",
      nodes: ["Orchestrator", "Focused workspaces", "Tools + sources", "Evidence"],
    },
    graphic: (
      <svg className="card-graphic" viewBox="0 0 720 300" role="img" aria-label="Specialists inspect audio, visuals, context, and outside sources in parallel">
        <g className="diagram-stroke">
          <circle cx="360" cy="31" r="23" />
          <path d="M360 54v22M106 76h508M106 76v18M360 76v18M614 76v18" />
          <rect x="30" y="94" width="152" height="72" rx="14" />
          <rect x="284" y="94" width="152" height="72" rx="14" />
          <rect x="538" y="94" width="152" height="72" rx="14" />
          <path d="M54 138h104M54 151h70M308 138h104M308 151h82M562 138h104M562 151h74" />
          <path d="M106 94V84m254 10V84m254 10V84" />
        </g>
        <g className="diagram-dashed">
          <rect x="78" y="192" width="142" height="36" rx="18" />
          <rect x="289" y="192" width="142" height="36" rx="18" />
          <rect x="500" y="192" width="142" height="36" rx="18" />
        </g>
        <g className="diagram-labels label-centered">
          <text x="360" y="35">ORCH</text>
          <text x="106" y="119">AUDIO</text>
          <text x="360" y="119">VISUAL</text>
          <text x="614" y="119">CONTEXT</text>
          <text className="diagram-small" x="106" y="181">ACTIVE WORKSPACES · REPORT UP ↑</text>
          <text x="149" y="215">OCR</text>
          <text x="360" y="215">ENTITY</text>
          <text x="571" y="215">RESEARCH</text>
          <text className="diagram-small" x="360" y="243">SPECIALISTS SPAWNED ONLY AS NEEDED</text>
          <text x="360" y="278">OPEN WORKSPACE · MEDIA ACTIONS · SOURCES · DRAFTS · HANDOFF</text>
        </g>
      </svg>
    ),
  },
  {
    title: "Reconcile",
    principle: "Claims need receipts",
    headline: "Reconcile every finding.",
    detail:
      "Worker reports are compared with one another, the source media, and any outside evidence they used. Conflicts stay visible. Unsupported names, events, numbers, or meanings are revised, withheld, or sent back for another pass.",
    description:
      "Trace each claim to its evidence, resolve disagreements, then accept, revise, or withhold it.",
    className: "card-verify",
    mobileDiagram: {
      label: "Every finding is checked against its support",
      nodes: ["Worker reports", "Trace + compare", "Accept / revise / withhold"],
    },
    graphic: (
      <svg className="card-graphic" viewBox="0 0 720 300" role="img" aria-label="Worker observations and claims are traced, compared, and reconciled">
        <g className="diagram-stroke">
          <rect x="30" y="72" width="150" height="142" rx="10" />
          <path d="M54 111h102M54 145h78M54 179h94" />
          <path d="M198 143h62m-14-14 14 14-14 14" />
          <rect x="282" y="72" width="154" height="142" rx="10" />
          <path d="M307 112h104M307 144h82M307 176h96" />
          <path d="M454 143h58m-14-14 14 14-14 14" />
          <path d="m565 92 45 51-45 51-45-51Z" />
          <path d="M610 118h82M610 168h82" />
          <path d="m662 107 9 9 17-20" />
          <path d="M661 168h29" />
        </g>
        <g className="diagram-labels">
          <text x="30" y="55">WORKER REPORTS</text>
          <text x="54" y="104">OBSERVE</text>
          <text x="54" y="138">CONTEXT</text>
          <text x="54" y="172">CLAIM</text>
          <text x="282" y="55">TRACE + RECONCILE</text>
          <text x="307" y="105">COMPARE</text>
          <text x="307" y="137">VERIFY</text>
          <text x="307" y="169">MERGE</text>
          <text x="545" y="147">QC</text>
          <text x="620" y="109">PASS</text>
          <text x="620" y="159">WITHHOLD</text>
          <text className="diagram-small" x="360" y="252">SOURCE · CONFLICT · PROVENANCE · SUPPORT</text>
        </g>
      </svg>
    ),
  },
  {
    title: "Apply",
    principle: "Understanding is reusable",
    headline: "Turn evidence into useful outputs.",
    detail:
      "One checked investigation can support captions, translations, explanations, structured facts, learning material, or evidence for another system. Corrections and scored failures become reusable cases that improve later work.",
    description:
      "Use the same checked understanding for the task at hand, then preserve what should inform the next one.",
    className: "card-deliver",
    mobileDiagram: {
      label: "Checked understanding supports many outputs",
      nodes: ["Checked claims", "Useful outputs", "Reusable cases"],
    },
    graphic: (
      <svg className="card-graphic" viewBox="0 0 720 300" role="img" aria-label="Checked evidence becomes useful outputs and reusable cases">
        <g className="diagram-stroke">
          <rect x="298" y="26" width="124" height="54" rx="10" />
          <path d="M360 80v36M110 116h500M110 116v28M360 116v28M610 116v28" />
          <rect x="22" y="144" width="176" height="100" rx="12" />
          <rect x="272" y="144" width="176" height="100" rx="12" />
          <rect x="522" y="144" width="176" height="100" rx="12" />
          <path d="M48 196h124M48 216h86M298 196h124M298 216h98M548 196h124M548 216h104" />
        </g>
        <path className="diagram-dashed" d="M610 244c0 35-182 42-210 5m-13 8 13-8 8 13" />
        <g className="diagram-labels">
          <text x="311" y="59">CHECKED CLAIMS</text>
          <text x="48" y="174">WATCH</text>
          <text className="diagram-small" x="48" y="188">CAPTIONS + TRANSLATION</text>
          <text x="298" y="174">UNDERSTAND</text>
          <text className="diagram-small" x="298" y="188">EXPLANATIONS + FACTS</text>
          <text x="548" y="174">REUSE</text>
          <text className="diagram-small" x="548" y="188">CASES + EVIDENCE</text>
          <text className="diagram-small" x="442" y="282">INFORM + GRADE LATER WORK</text>
        </g>
      </svg>
    ),
  },
];
