/**
 * Registers an explicitly owned local file for preflight without publishing it.
 *
 * The default destination is .studio/runs/<run>/, which is gitignored. The producer requires an
 * explicit label, rights holder, rights scope, and --attest-rights. A filename supplies none of
 * those facts. The exact input bytes are SHA-256 identified, preserved byte-for-byte, probed by
 * ffprobe, and connected to the derived probe receipt.
 *
 *   node scripts/ingest-owned-media.mjs \
 *     --file /path/to/media.mov --run local-001 --label "Interview excerpt" \
 *     --rights-holder "Example Studio" --rights-scope local --attest-rights
 *
 * Use --directory only for an intentional alternate local workspace. A directory under public/
 * requires --allow-public and rights-scope redistribute; local-only media fails closed.
 */

import { execFileSync } from "node:child_process";
import { constants, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { fingerprintFile } from "./lib/content-id.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 || index === process.argv.length - 1 ? null : process.argv[index + 1];
}

function flag(name) {
  return process.argv.includes(`--${name}`);
}

function fail(message) {
  console.error(`owned media ingest: ${message}`);
  process.exit(1);
}

const inputArg = arg("file");
const runId = arg("run");
const label = arg("label");
const rightsHolder = arg("rights-holder");
const rightsScopeArg = arg("rights-scope");

if (!inputArg || !runId || !label || !rightsHolder || !rightsScopeArg || !flag("attest-rights")) {
  fail(
    "provide --file, --run, --label, --rights-holder, --rights-scope <local|redistribute>, and --attest-rights",
  );
}
if (!/^[a-z0-9-]+$/i.test(runId)) fail("run id may contain only letters, numbers, and hyphens");
if (!label.trim() || !rightsHolder.trim()) fail("label and rights holder must be non-empty explicit values");
if (rightsScopeArg !== "local" && rightsScopeArg !== "redistribute") {
  fail("rights scope must be local or redistribute");
}

const rightsScope = rightsScopeArg === "redistribute" ? "redistribution" : "local_processing";
const input = resolve(inputArg);
let sourceFingerprint;
try {
  sourceFingerprint = await fingerprintFile(input);
} catch (error) {
  fail(error instanceof Error ? error.message : "could not fingerprint input media");
}

const requestedDirectory = arg("directory");
const intendedDirectory = requestedDirectory
  ? resolve(requestedDirectory)
  : join(ROOT, ".studio", "runs", runId);
const publicRoot = realpathSync(join(ROOT, "public"));
const isInside = (parent, child) => {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
};
if (isInside(publicRoot, intendedDirectory) && (!flag("allow-public") || rightsScope !== "redistribution")) {
  fail("a public destination requires --allow-public and --rights-scope redistribute");
}
const directoryExisted = existsSync(intendedDirectory);
mkdirSync(intendedDirectory, { recursive: true });
const directory = realpathSync(intendedDirectory);
if (isInside(publicRoot, directory) && (!flag("allow-public") || rightsScope !== "redistribution")) {
  if (!directoryExisted) rmSync(intendedDirectory, { recursive: true, force: true });
  fail("a symlinked public destination requires --allow-public and --rights-scope redistribute");
}
for (const receipt of ["source.json", "media-probe.json"]) {
  if (existsSync(join(directory, receipt))) fail(`${join(directory, receipt)} already exists; refusing to replace evidence`);
}

const runPath = join(directory, "run.json");
const run = existsSync(runPath) ? JSON.parse(readFileSync(runPath, "utf8")) : null;
if (run && run.id !== runId) fail(`${runPath} does not declare run ${runId}`);

const extension = extname(input).toLowerCase();
if (!/^\.[a-z0-9]{1,10}$/.test(extension)) fail("input needs a simple media file extension");
const rawMedia = run?.clip?.media ?? `raw-${sourceFingerprint.digest.slice(0, 16)}${extension}`;
if (typeof rawMedia !== "string" || !rawMedia || isAbsolute(rawMedia) || rawMedia.split(/[\\/]/).includes("..")) {
  fail("raw media path must stay inside the run directory");
}

const target = join(directory, rawMedia);
mkdirSync(dirname(target), { recursive: true });
let preservation;
let createdRaw = false;
if (existsSync(target)) {
  if (lstatSync(target).isSymbolicLink()) fail("raw media target must not be a symbolic link");
  if (realpathSync(input) !== realpathSync(target)) fail(`${target} already exists; refusing to replace raw media`);
  preservation = "adopted_existing_bytes";
} else {
  copyFileSync(input, target, constants.COPYFILE_EXCL);
  createdRaw = true;
  preservation = "byte_identical_copy";
}

const preservedFingerprint = await fingerprintFile(target);
if (
  preservedFingerprint.contentId !== sourceFingerprint.contentId ||
  preservedFingerprint.bytes !== sourceFingerprint.bytes
) {
  fail("preserved media does not match the input bytes");
}

const probePath = join(directory, "media-probe.json");
const rollback = () => {
  rmSync(probePath, { force: true });
  if (createdRaw) rmSync(target, { force: true });
};

let probe;
let probeFingerprint;
try {
  execFileSync(
    process.execPath,
    [
      join(ROOT, "scripts", "probe-media.mjs"),
      "--run",
      runId,
      "--directory",
      directory,
      "--media",
      rawMedia,
    ],
    { stdio: "inherit" },
  );
  probe = JSON.parse(readFileSync(probePath, "utf8"));
  probeFingerprint = await fingerprintFile(probePath);
  if (probe.input?.content_id !== sourceFingerprint.contentId) {
    throw new Error("media probe is not bound to the preserved bytes");
  }
} catch (error) {
  rollback();
  fail(error instanceof Error ? error.message : "media probe failed");
}

const statement =
  rightsScope === "redistribution"
    ? `${rightsHolder.trim()} attests that it owns or controls the media rights and authorizes local processing and redistribution of this copy.`
    : `${rightsHolder.trim()} attests that it owns or controls the media rights and authorizes local processing of this copy.`;

const receipt = {
  schema: "studio.ingest.owned-local.v1",
  kind: "owned_local",
  producer: "scripts/ingest-owned-media.mjs",
  receipt_id: `owned-local:${sourceFingerprint.digest}`,
  label: label.trim(),
  origin: {
    kind: "local_file",
    filename: basename(input),
    path_disclosure: "basename_only",
  },
  content: {
    id: sourceFingerprint.contentId,
    hash: { algorithm: sourceFingerprint.algorithm, digest: sourceFingerprint.digest },
    bytes: sourceFingerprint.bytes,
  },
  rights: {
    basis: "ownership_attestation",
    asserted_by: rightsHolder.trim(),
    asserted_at: new Date().toISOString(),
    scope: rightsScope,
    statement,
  },
  selection: { start: 0, end: probe.duration, duration: probe.duration },
  raw_media: {
    path: rawMedia,
    content_id: sourceFingerprint.contentId,
    bytes: sourceFingerprint.bytes,
    preservation,
  },
  derived_artifacts: [
    {
      kind: "media_probe",
      path: "media-probe.json",
      schema: probe.schema,
      producer: probe.producer,
      source_content_ids: [sourceFingerprint.contentId],
      content_hash: probeFingerprint.contentId,
    },
  ],
  note:
    "Ownership and processing scope are explicit user attestations. The filename is retained only as raw provenance; it supplied no language, music, identity, overlap, ownership, or title fact.",
};

try {
  writeFileSync(join(directory, "source.json"), `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx" });
} catch (error) {
  rollback();
  fail(error instanceof Error ? error.message : "could not write the source receipt");
}

console.log(`
owned media ingest wrote ${relative(ROOT, directory) || directory}
  raw bytes       ${rawMedia} (${sourceFingerprint.contentId})
  rights receipt  source.json (${rightsScope})
  derived receipt media-probe.json (${probe.tracks.length} track(s))
`);
