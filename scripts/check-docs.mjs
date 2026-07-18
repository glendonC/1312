import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DOCS_ROOT = resolve(ROOT, "docs");
const LOCAL_DOCS_ROOT = resolve(DOCS_ROOT, "local");
const MAX_AGENTS_BYTES = 8_192;
const SKIP_DIRECTORIES = new Set([
  ".astro",
  ".git",
  "coverage",
  "dist",
  "node_modules",
  "playwright-report",
  "test-results",
]);
const LEGACY_HARD_BREAKS = new Set([
  "docs/ARCHITECTURE.md:1. **Inject** glossary/corrections/rules into the next prompt/tool context.",
  "docs/ARCHITECTURE.md:2. **Grade** any model on the bench.",
  "docs/ARCHITECTURE.md:- Exact computer-use host for squircles (Codex CUA vs embedded browser/player).",
  "docs/PRODUCT.md:**Codename:** 1321 (Build Week Jul 13–21, 2026)",
  "docs/PRODUCT.md:**Category:** Language intelligence for real-world media",
]);

const REQUIRED_FILES = [
  "README.md",
  "AGENTS.md",
  "docs/README.md",
  "docs/PRODUCT.md",
  "docs/build-week/STATUS.md",
  "docs/build-week/CAPABILITY_LADDER.md",
  "docs/ARCHITECTURE.md",
  "docs/RUNTIME_CONTRACTS.md",
  "docs/STUDIO_PRODUCT_CONTRACT.md",
  "docs/STUDIO_AUTONOMY.md",
  "docs/CODEX.md",
  "docs/rfcs/0001-miss-to-gold-conveyor.md",
  "bench/README.md",
  "bench/ADJUDICATION.md",
];

const errors = [];
let checkedLocalLinks = 0;
const legacyHardBreakUses = new Map();

function displayPath(path) {
  return relative(ROOT, path).split(sep).join("/") || ".";
}

function addError(message) {
  errors.push(message);
}

function isInside(path, directory) {
  const child = relative(directory, path);
  return child === "" || (!child.startsWith(`..${sep}`) && child !== "..");
}

function walkFiles(directory) {
  if (!existsSync(directory)) return [];

  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory() && SKIP_DIRECTORIES.has(entry.name)) continue;

    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(path));
    if (entry.isFile()) files.push(path);
  }
  return files;
}

function repositoryFiles() {
  try {
    return execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
      cwd: ROOT,
      encoding: "utf8",
    })
      .split("\0")
      .filter(Boolean)
      .map((path) => resolve(ROOT, path));
  } catch {
    addError("could not enumerate repository files with git ls-files");
    return [];
  }
}

function githubSlug(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/<[^>]*>/g, "")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

function markdownAnchors(path) {
  const anchors = new Set();
  const counts = new Map();
  const text = readFileSync(path, "utf8");

  for (const line of text.split("\n")) {
    const heading = line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/)?.[1];
    if (heading) {
      const base = githubSlug(heading);
      const count = counts.get(base) ?? 0;
      anchors.add(count === 0 ? base : `${base}-${count}`);
      counts.set(base, count + 1);
    }

    for (const match of line.matchAll(/<a\s+(?:[^>]*?\s)?(?:id|name)=["']([^"']+)["'][^>]*>/gi)) {
      anchors.add(match[1].toLowerCase());
    }
  }
  return anchors;
}

function parseDestination(text, startIndex) {
  let index = startIndex;
  while (/\s/.test(text[index] ?? "")) index += 1;

  if (text[index] === "<") {
    let target = "";
    for (index += 1; index < text.length; index += 1) {
      if (text[index] === ">") return { target, endIndex: index + 1 };
      target += text[index];
    }
    return null;
  }

  let depth = 0;
  let target = "";
  for (; index < text.length; index += 1) {
    const character = text[index];
    if (character === "\\" && index + 1 < text.length) {
      target += text[index + 1];
      index += 1;
      continue;
    }
    if (character === "(") {
      depth += 1;
      target += character;
      continue;
    }
    if (character === ")") {
      if (depth === 0) return { target, endIndex: index };
      depth -= 1;
      target += character;
      continue;
    }
    if (/\s/.test(character) && depth === 0) return { target, endIndex: index };
    target += character;
  }
  return target ? { target, endIndex: index } : null;
}

function referenceId(value) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function markdownLinkTargets(text, sourcePath) {
  const targets = [];
  const definitions = new Map();

  for (const line of text.split("\n")) {
    const definition = line.match(/^ {0,3}\[([^\]]+)\]:\s*(.*)$/);
    if (!definition) continue;
    const destination = parseDestination(definition[2], 0);
    if (!destination?.target) {
      addError(`${displayPath(sourcePath)} has an invalid reference link definition: ${line.trim()}`);
      continue;
    }
    definitions.set(referenceId(definition[1]), destination.target);
    targets.push(destination.target);
  }

  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== "]" || text[index + 1] !== "(") continue;
    const destination = parseDestination(text, index + 2);
    if (!destination?.target) {
      addError(`${displayPath(sourcePath)} has an invalid inline Markdown link near character ${index}`);
      continue;
    }
    targets.push(destination.target);
    index = destination.endIndex;
  }

  for (const match of text.matchAll(/!?\[([^\]\n]+)\]\[([^\]\n]*)\]/g)) {
    const id = referenceId(match[2] || match[1]);
    const target = definitions.get(id);
    if (!target) {
      addError(`${displayPath(sourcePath)} has an unresolved reference link: ${match[0]}`);
      continue;
    }
  }

  for (const match of text.matchAll(/<(?:a|img)\s+[^>]*?(?:href|src)=["']([^"']+)["'][^>]*>/gi)) {
    targets.push(match[1]);
  }

  return targets;
}

function resolveLocalTarget(sourcePath, rawTarget) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(rawTarget) || rawTarget.startsWith("//")) return null;

  let decoded;
  try {
    decoded = decodeURIComponent(rawTarget);
  } catch {
    addError(`${displayPath(sourcePath)} has an invalid encoded link: ${rawTarget}`);
    return null;
  }

  const hashIndex = decoded.indexOf("#");
  const pathPart = hashIndex === -1 ? decoded : decoded.slice(0, hashIndex);
  const fragment = hashIndex === -1 ? "" : decoded.slice(hashIndex + 1).toLowerCase();
  const queryFreePath = pathPart.split("?")[0];
  if (queryFreePath.startsWith("/") && !queryFreePath.startsWith("/Users/")) {
    const repositoryPath = resolve(ROOT, `.${queryFreePath}`);
    const looksLikeFile = /\.[a-z0-9]+$/i.test(queryFreePath);
    if (!existsSync(repositoryPath) && !looksLikeFile) return null;
    return { fragment, targetPath: repositoryPath };
  }

  const targetPath = queryFreePath ? resolve(dirname(sourcePath), queryFreePath) : sourcePath;
  return { fragment, targetPath };
}

for (const file of REQUIRED_FILES) {
  if (!existsSync(resolve(ROOT, file))) addError(`required file is missing: ${file}`);
}

const repositoryAgents = repositoryFiles().filter((path) => path.endsWith(`${sep}AGENTS.md`));
if (repositoryAgents.length !== 1 || repositoryAgents[0] !== resolve(ROOT, "AGENTS.md")) {
  addError(
    `expected only root AGENTS.md, found: ${repositoryAgents.map(displayPath).join(", ") || "none"}`,
  );
}

const agentsPath = resolve(ROOT, "AGENTS.md");
if (existsSync(agentsPath)) {
  const agentsText = readFileSync(agentsPath, "utf8");
  const agentsBytes = Buffer.byteLength(agentsText);
  if (agentsBytes > MAX_AGENTS_BYTES) {
    addError(`AGENTS.md is ${agentsBytes} bytes; limit is ${MAX_AGENTS_BYTES}`);
  }
}

const docsMarkdown = walkFiles(DOCS_ROOT)
  .filter((path) => path.endsWith(".md") && !isInside(path, LOCAL_DOCS_ROOT))
  .sort();
const publicMarkdown = [
  resolve(ROOT, "README.md"),
  agentsPath,
  resolve(ROOT, "bench/README.md"),
  resolve(ROOT, "bench/ADJUDICATION.md"),
  ...docsMarkdown,
].filter(existsSync);

for (const path of publicMarkdown) {
  const text = readFileSync(path, "utf8");
  if (!text.endsWith("\n")) addError(`${displayPath(path)} must end with a newline`);

  text.split("\n").forEach((line, index) => {
    const trailing = line.match(/[ \t]+$/)?.[0];
    const legacyKey = `${displayPath(path)}:${line.trimEnd()}`;
    if (trailing === "  " && LEGACY_HARD_BREAKS.has(legacyKey)) {
      legacyHardBreakUses.set(legacyKey, (legacyHardBreakUses.get(legacyKey) ?? 0) + 1);
    } else if (trailing) {
      addError(`${displayPath(path)}:${index + 1} has trailing whitespace`);
    }
  });

  for (const rawTarget of markdownLinkTargets(text, path)) {
    const resolved = resolveLocalTarget(path, rawTarget);
    if (!resolved) continue;
    checkedLocalLinks += 1;

    if (!isInside(resolved.targetPath, ROOT)) {
      addError(`${displayPath(path)} links outside the repository: ${rawTarget}`);
      continue;
    }
    if (isInside(resolved.targetPath, LOCAL_DOCS_ROOT)) {
      addError(`${displayPath(path)} depends on ignored local docs: ${rawTarget}`);
      continue;
    }
    if (!existsSync(resolved.targetPath)) {
      addError(`${displayPath(path)} has a missing local link: ${rawTarget}`);
      continue;
    }
    if (resolved.fragment && statSync(resolved.targetPath).isFile() && resolved.targetPath.endsWith(".md")) {
      const anchors = markdownAnchors(resolved.targetPath);
      if (!anchors.has(resolved.fragment)) {
        addError(`${displayPath(path)} has a missing Markdown anchor: ${rawTarget}`);
      }
    }
  }
}

for (const legacyKey of LEGACY_HARD_BREAKS) {
  const uses = legacyHardBreakUses.get(legacyKey) ?? 0;
  if (uses !== 1) addError(`legacy hard-break exception has ${uses} matches: ${legacyKey}`);
}

for (const policyPath of [agentsPath, resolve(DOCS_ROOT, "README.md")]) {
  if (existsSync(policyPath) && readFileSync(policyPath, "utf8").includes("\u2014")) {
    addError(`${displayPath(policyPath)} contains an em dash`);
  }
}

const registryPath = resolve(DOCS_ROOT, "README.md");
if (existsSync(registryPath)) {
  const registryTargets = new Set();
  const registryText = readFileSync(registryPath, "utf8");
  for (const rawTarget of markdownLinkTargets(registryText, registryPath)) {
    const resolved = resolveLocalTarget(registryPath, rawTarget);
    if (resolved) registryTargets.add(resolved.targetPath);
  }

  for (const path of docsMarkdown) {
    if (path !== registryPath && !registryTargets.has(path)) {
      addError(`docs/README.md does not register ${displayPath(path)}`);
    }
  }
}

if (errors.length > 0) {
  console.error(`docs check failed with ${errors.length} error${errors.length === 1 ? "" : "s"}:`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(
  `docs check passed: ${publicMarkdown.length} public Markdown files, ${docsMarkdown.length - 1} registered docs, ${checkedLocalLinks} local links`,
);
