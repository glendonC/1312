import { spawn } from "node:child_process";

export interface ProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  outputOverflow: boolean;
}

export interface BoundedProcessInput {
  executable: string;
  args: string[];
  cwd: string;
  stdin: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs: number;
  maxStdoutBytes: number;
  maxStderrBytes: number;
}

export function runBoundedProcess(input: BoundedProcessInput): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(input.executable, input.args, {
      cwd: input.cwd,
      env: input.env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    let outputOverflow = false;
    let spawnError: Error | null = null;
    let forceKill: NodeJS.Timeout | null = null;

    const stop = (): void => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill("SIGTERM");
      if (!forceKill) {
        forceKill = setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
        }, 1_000);
        forceKill.unref();
      }
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      stop();
    }, input.timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > input.maxStdoutBytes) {
        outputOverflow = true;
        stop();
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.length;
      if (stderrBytes > input.maxStderrBytes) {
        outputOverflow = true;
        stop();
        return;
      }
      stderr.push(chunk);
    });
    child.once("error", (error) => {
      spawnError = error;
    });
    child.once("close", (exitCode, signal) => {
      clearTimeout(timeout);
      if (forceKill) clearTimeout(forceKill);
      if (spawnError) {
        reject(spawnError);
        return;
      }
      resolve({
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        exitCode,
        signal,
        timedOut,
        outputOverflow,
      });
    });
    child.stdin.end(input.stdin, "utf8");
  });
}
