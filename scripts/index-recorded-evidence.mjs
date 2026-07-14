/**
 * Hash the declared artifacts of an already-recorded run and derive a terminal cue-decision
 * ledger from captions.json plus the last recorded cue effect in traces.json.
 *
 * This is a deterministic post-run indexer. It does not reconstruct original worker lineage,
 * tool receipts, artifact derivation, report-up handoffs, or merge decisions from freeform text.
 *
 *   node scripts/index-recorded-evidence.mjs --run run-006
 *   node scripts/index-recorded-evidence.mjs --run run-006 --check
 *   node scripts/index-recorded-evidence.mjs --run run-006 --replace
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

import { fingerprintFile } from "./lib/content-id.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ARTIFACTS = new Map([
  ["captions.json", { id: "captions", kind: "captions" }],
  ["corrections.json", { id: "corrections", kind: "corrections" }],
  ["glossary.json", { id: "glossary", kind: "glossary" }],
  ["score.json", { id: "score", kind: "score" }],
  ["traces.json", { id: "traces", kind: "traces" }],
  // Future proposal artifacts may be hashed here; this does not promote or accept them.
  ["memory-proposals.json", { id: "memory-proposals", kind: "memory_proposals" }],
]);

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 || index === process.argv.length - 1 ? null : process.argv[index + 1];
}

function flag(name) {
  return process.argv.includes(`--${name}`);
}

function fail(message) {
  console.error(`recorded evidence index: ${message}`);
  process.exit(1);
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`${path} could not be read as JSON`, { cause: error });
  }
}

function content(identity) {
  return {
    id: identity.contentId,
    hash: { algorithm: "sha256", digest: identity.digest },
    bytes: identity.bytes,
  };
}

function safeArtifactPath(path) {
  if (typeof path !== "string" || !path || isAbsolute(path) || path.split(/[\\/]/).includes("..")) {
    throw new Error(`run artifact ${String(path)} must stay inside the recorded run directory`);
  }
  return path;
}

function captionState(cue, targetLanguage) {
  const target = cue.targets?.find((line) => line.lang === targetLanguage);
  if (!target) throw new Error(`cue ${cue.id} has no ${targetLanguage} caption`);
  if (target.withheld) {
    if (target.text !== null) throw new Error(`cue ${cue.id} claims withholding and emitted text`);
    return "withheld";
  }
  if (typeof target.text === "string") return "committed";
  if (target.text === null && cue.silence === true) return "dropped";
  throw new Error(`cue ${cue.id} has no terminal caption decision`);
}

const runId = arg("run");
if (!runId || !/^[a-z0-9-]+$/i.test(runId)) fail("provide --run <recorded-run-id>");
if (flag("check") && flag("replace")) fail("--check and --replace are mutually exclusive");

const directory = join(ROOT, "public", "demo", "runs", runId);
const outputPath = join(directory, "evidence.json");

try {
  const run = readJson(join(directory, "run.json"));
  const captions = readJson(join(directory, "captions.json"));
  const traceFile = readJson(join(directory, "traces.json"));
  if (run.id !== runId || captions.run !== runId || traceFile.run !== runId) {
    throw new Error("run, captions, and traces identities do not match --run");
  }
  if (captions.clip !== run.clip?.id || traceFile.clip !== run.clip?.id) {
    throw new Error("captions or traces clip identity does not match run.json");
  }
  if (!Array.isArray(run.artifacts) || !Array.isArray(captions.cues) || !Array.isArray(traceFile.traces)) {
    throw new Error("run artifacts, caption cues, and traces must be arrays");
  }

  const artifactPaths = run.artifacts.map(safeArtifactPath);
  if (new Set(artifactPaths).size !== artifactPaths.length) throw new Error("run artifacts contain duplicate paths");
  const artifacts = await Promise.all(
    artifactPaths.map(async (path) => {
      const registered = ARTIFACTS.get(path);
      if (!registered) throw new Error(`run artifact ${path} has no registered evidence-index kind`);
      const identity = await fingerprintFile(join(directory, path));
      return {
        artifact_id: registered.id,
        kind: registered.kind,
        path,
        content: content(identity),
        source_artifact_ids: [],
      };
    }),
  );

  const knownCues = new Set(captions.cues.map((cue) => cue.id));
  const knownAgents = new Set(["orchestrator", ...run.agents.map((agent) => agent.id)]);
  const terminal = new Map();
  traceFile.traces.forEach((trace, traceIndex) => {
    for (const effect of trace.effects ?? []) {
      if (effect.type !== "cue") continue;
      if (!knownCues.has(effect.id)) throw new Error(`trace ${traceIndex} references unknown cue ${effect.id}`);
      terminal.set(effect.id, { state: effect.state, trace, traceIndex });
    }
  });

  const cueDecisions = captions.cues.map((cue) => {
    if (!knownAgents.has(cue.owner)) throw new Error(`cue ${cue.id} references unknown owner ${String(cue.owner)}`);
    const recorded = terminal.get(cue.id);
    if (!recorded || !["committed", "withheld", "dropped"].includes(recorded.state)) {
      throw new Error(`cue ${cue.id} has no recorded terminal trace effect`);
    }
    const state = captionState(cue, run.pair.target);
    if (state !== recorded.state) {
      throw new Error(`cue ${cue.id} caption decision ${state} disagrees with terminal trace effect ${recorded.state}`);
    }
    const target = cue.targets.find((line) => line.lang === run.pair.target);
    return {
      cue_id: cue.id,
      terminal_state: state,
      caption_owner_id: cue.owner,
      gate: state === "withheld" ? { id: target.withheld.gate, reason: target.withheld.reason } : null,
      evidence_artifact_ids: ["captions", "traces"],
      terminal_effect: {
        trace_index: recorded.traceIndex,
        at: recorded.trace.t,
        agent_id: recorded.trace.agent,
        action: recorded.trace.action,
      },
    };
  });

  const index = {
    schema: "studio.recorded-evidence-index.v1",
    producer: "scripts/index-recorded-evidence.mjs",
    mode: "post_run_index",
    run: run.id,
    clip: run.clip.id,
    claims: {
      artifact_byte_identity: true,
      terminal_caption_decisions: true,
      original_worker_lineage: false,
      structured_handoffs: false,
    },
    artifacts,
    cue_decisions: cueDecisions,
    note:
      "Deterministic post-run index over recorded artifact bytes and terminal cue effects. Caption owner and event agent ids are copied labels; original worker lineage and structured handoffs are not reconstructed.",
  };
  const rendered = `${JSON.stringify(index, null, 2)}\n`;

  if (flag("check")) {
    if (!existsSync(outputPath) || readFileSync(outputPath, "utf8") !== rendered) {
      throw new Error(`${outputPath} is missing or differs from deterministic producer output`);
    }
    console.log(`recorded evidence index check passed: ${runId}`);
  } else if (existsSync(outputPath) && !flag("replace")) {
    if (readFileSync(outputPath, "utf8") !== rendered) {
      throw new Error(`${outputPath} already exists with different bytes; pass --replace after reviewing artifact changes`);
    }
    console.log(`recorded evidence index already current: ${runId}`);
  } else {
    writeFileSync(outputPath, rendered, { flag: flag("replace") ? "w" : "wx" });
    console.log(`recorded evidence index wrote ${outputPath}`);
  }
} catch (error) {
  fail(error instanceof Error ? error.message : "could not index recorded evidence");
}
