/** Git ancestry checks for immutable benchmark experiment evidence. */

import { execFileSync } from "node:child_process";

function fail(message) {
  throw new Error(`bench git evidence: ${message}`);
}

export function firstAdditionCommit(path, { workspaceRoot = process.cwd() } = {}) {
  try {
    return execFileSync(
      "git",
      ["log", "--diff-filter=A", "--format=%H", "--", path],
      { cwd: workspaceRoot, stdio: "pipe" },
    )
      .toString()
      .trim()
      .split("\n")
      .filter(Boolean)
      .at(-1) ?? null;
  } catch {
    return null;
  }
}

export function immutableArtifactCommit(
  path,
  { workspaceRoot = process.cwd(), context = path } = {},
) {
  let commits;
  try {
    commits = execFileSync("git", ["log", "--format=%H", "--", path], {
      cwd: workspaceRoot,
      stdio: "pipe",
    })
      .toString()
      .trim()
      .split("\n")
      .filter(Boolean);
    execFileSync("git", ["diff", "--quiet", "HEAD", "--", path], {
      cwd: workspaceRoot,
      stdio: "pipe",
    });
  } catch {
    fail(`${context} is uncommitted or changed after its evidence commit`);
  }
  if (commits.length !== 1) fail(`${context} changed after its immutable creation commit`);
  return commits[0];
}

export function assertCommitDescends(
  earlierCommit,
  laterCommit,
  { workspaceRoot = process.cwd(), context = "evidence" } = {},
) {
  if (laterCommit === earlierCommit) fail(`${context} shares a commit with its prerequisite`);
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", earlierCommit, laterCommit], {
      cwd: workspaceRoot,
      stdio: "pipe",
    });
  } catch {
    fail(`${context} does not descend from its prerequisite commit`);
  }
  return laterCommit;
}

export function immutableArtifactAfter(
  earlierCommit,
  path,
  { workspaceRoot = process.cwd(), context = path } = {},
) {
  const laterCommit = immutableArtifactCommit(path, { workspaceRoot, context });
  return assertCommitDescends(earlierCommit, laterCommit, { workspaceRoot, context });
}
