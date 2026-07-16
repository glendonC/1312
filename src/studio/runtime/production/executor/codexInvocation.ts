export function tomlString(value: string): string {
  return JSON.stringify(value);
}

export function tomlStrings(values: readonly string[]): string {
  return `[${values.map(tomlString).join(",")}]`;
}

/** Ignore ambient customization and disable every documented open/default tool family. */
export function closedCodexExecArgs(): string[] {
  return [
    "exec",
    "--json",
    "--ephemeral",
    "--ignore-user-config",
    "--ignore-rules",
    "--strict-config",
    "--sandbox",
    "read-only",
    "--skip-git-repo-check",
    "-c", "approval_policy=\"never\"",
    "-c", "shell_environment_policy.inherit=none",
    "-c", "web_search=\"disabled\"",
    "-c", "features.shell_tool=false",
    "-c", "features.unified_exec=false",
    "-c", "features.shell_snapshot=false",
    "-c", "features.apps=false",
    "-c", "features.hooks=false",
    "-c", "features.goals=false",
    "-c", "features.memories=false",
    "-c", "features.multi_agent=false",
    "-c", "features.remote_plugin=false",
  ];
}
