import type { ReactNode } from "react";

export type MethodStep = {
  title: string;
  principle: string;
  headline: string;
  detail: string;
  description: string;
  className: string;
  graphic: ReactNode;
};

export const steps: MethodStep[] = [
  {
    title: "Ingest",
    principle: "Source before transcript",
    headline: "Normalize the source.",
    detail:
      "A YouTube URL or owned file becomes one isolated run: audio to hear, frames to inspect, and source metadata to preserve. Context is discovered later; it is not treated like a media track.",
    description:
      "One source becomes a clean run package with audio, frames, and provenance intact.",
    className: "card-ingest",
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
    title: "Analyze",
    principle: "Adaptive, not fixed",
    headline: "Spawn what the clip needs.",
    detail:
      "The orchestrator inspects first, then creates and retires isolated workers as needed. Open any workspace during or after the run to inspect its actions, drafts, failures, and final handoff.",
    description:
      "Every worker acts in its own workspace and reports structured evidence up. The trace stays open for inspection.",
    className: "card-analyze",
    graphic: (
      <svg className="card-graphic" viewBox="0 0 720 300" role="img" aria-label="Specialists analyze timing, context, and language in parallel">
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
          <text x="106" y="119">SEGMENT</text>
          <text x="360" y="119">CONTEXT</text>
          <text x="614" y="119">TRANSLATE</text>
          <text className="diagram-small" x="106" y="181">ACTIVE WORKSPACES · REPORT UP ↑</text>
          <text x="149" y="215">OCR</text>
          <text x="360" y="215">ENTITY</text>
          <text x="571" y="215">DIALECT</text>
          <text className="diagram-small" x="360" y="243">SPECIALISTS SPAWNED ONLY AS NEEDED</text>
          <text x="360" y="278">OPEN WORKSPACE · ACTIONS · DRAFTS · FAILURES · HANDOFF</text>
        </g>
      </svg>
    ),
  },
  {
    title: "Validate",
    principle: "Clean before confidence",
    headline: "Reconcile, clean, validate.",
    detail:
      "Worker reports are merged, timing and language are cleaned, and hard lines are checked against the source. Unsupported entities, numbers, or meanings are withheld instead of polished.",
    description:
      "Clean timing and wording, reconcile the reports, then pass or withhold each hard line.",
    className: "card-verify",
    graphic: (
      <svg className="card-graphic" viewBox="0 0 720 300" role="img" aria-label="Draft reports are cleaned, reconciled, and validated">
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
          <text x="54" y="104">TIMING</text>
          <text x="54" y="138">KOREAN</text>
          <text x="54" y="172">ENGLISH</text>
          <text x="282" y="55">CLEAN + RECONCILE</text>
          <text x="307" y="105">ALIGN</text>
          <text x="307" y="137">REPAIR</text>
          <text x="307" y="169">MERGE</text>
          <text x="545" y="147">QC</text>
          <text x="620" y="109">PASS</text>
          <text x="620" y="159">WITHHOLD</text>
          <text className="diagram-small" x="360" y="252">ENTITY · MEANING · SYNC · HONESTY</text>
        </g>
      </svg>
    ),
  },
  {
    title: "Deliver",
    principle: "One run, three useful outputs",
    headline: "Watch, learn, improve.",
    detail:
      "Prepared captions make the media usable; hard lines and glossary entries become transferable learning material; corrections, rules, and scores condition and evaluate later runs.",
    description:
      "Playback-ready captions, transferable learning material, and structured improvement artifacts from the same checked run.",
    className: "card-deliver",
    graphic: (
      <svg className="card-graphic" viewBox="0 0 720 300" role="img" aria-label="Checked captions, hard lines, and corrections are delivered">
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
          <text x="323" y="59">CHECKED RUN</text>
          <text x="48" y="174">WATCH</text>
          <text className="diagram-small" x="48" y="188">TIMED KO + EN</text>
          <text x="298" y="174">LEARN</text>
          <text className="diagram-small" x="298" y="188">HARD LINES + GLOSSARY</text>
          <text x="548" y="174">IMPROVE</text>
          <text className="diagram-small" x="548" y="188">CORRECTIONS + SCORES</text>
          <text className="diagram-small" x="442" y="282">CONDITION + GRADE THE NEXT RUN</text>
        </g>
      </svg>
    ),
  },
];
