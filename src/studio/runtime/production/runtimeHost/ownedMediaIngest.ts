import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readdir,
  realpath,
  rm,
  stat,
} from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { extname, isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";

import { RuntimeHostError } from "./errors.ts";
import type {
  OwnedMediaIngestFailure,
  OwnedMediaIngestRequest,
  OwnedMediaIngestState,
  OwnedMediaIngestStatus,
  RuntimeHostSourceSummary,
} from "./model.ts";
import { RuntimeSourceRegistry } from "./sourceRegistry.ts";

const executeFile = promisify(execFile);
export const DEFAULT_OWNED_MEDIA_INGEST_BYTES = 512 * 1024 * 1024;

interface OwnedMediaIngestJob {
  ingestId: string;
  runId: string;
  request: OwnedMediaIngestRequest;
  uploadPath: string;
  sourceDirectory: string;
  status: OwnedMediaIngestState;
  updatedAt: string;
  source: RuntimeHostSourceSummary | null;
  failure: OwnedMediaIngestFailure | null;
  uploadStarted: boolean;
}

export interface OwnedMediaIngestServiceOptions {
  root: string;
  repositoryRoot: string;
  sources: RuntimeSourceRegistry;
  maximumBytes?: number;
  now?: () => Date;
  ingestId?: () => string;
}

function exactObject(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new RuntimeHostError("invalid_ingest_request", "Owned-media ingest metadata must be an object.");
  }
  const item = value as Record<string, unknown>;
  const expected = new Set(fields);
  if (Object.keys(item).some((field) => !expected.has(field)) || fields.some((field) => !(field in item))) {
    throw new RuntimeHostError(
      "invalid_ingest_request",
      "Owned-media ingest metadata contains missing or unsupported fields.",
    );
  }
  return item;
}

function explicitText(value: unknown, label: string, maximum: number): string {
  if (
    typeof value !== "string" ||
    !value ||
    value.trim() !== value ||
    value.startsWith("-") ||
    value.length > maximum ||
    /[\u0000-\u001f\u007f]/.test(value) ||
    /^(?:[A-Za-z]:[\\/]|[\\/~])/.test(value)
  ) {
    throw new RuntimeHostError(
      "invalid_ingest_request",
      `${label} must be explicit text, not a filesystem path.`,
    );
  }
  return value;
}

function parseRequest(value: unknown, maximumBytes: number): OwnedMediaIngestRequest {
  const item = exactObject(value, [
    "filename",
    "declaredBytes",
    "label",
    "rightsHolder",
    "rightsScope",
    "ownershipAttested",
  ]);
  const filename = explicitText(item.filename, "Filename", 255);
  if (
    filename === "." ||
    filename === ".." ||
    filename.includes("/") ||
    filename.includes("\\") ||
    extname(filename) === "" ||
    !/^\.[A-Za-z0-9]{1,10}$/.test(extname(filename))
  ) {
    throw new RuntimeHostError(
      "invalid_ingest_request",
      "The browser file must have a basename and a simple media extension.",
    );
  }
  if (!Number.isSafeInteger(item.declaredBytes) || (item.declaredBytes as number) <= 0) {
    throw new RuntimeHostError("invalid_ingest_request", "Declared media bytes must be a positive integer.");
  }
  if ((item.declaredBytes as number) > maximumBytes) {
    throw new RuntimeHostError("ingest_body_too_large", "The owned media exceeds the host ingest limit.", 413);
  }
  if (item.rightsScope !== "local_processing") {
    throw new RuntimeHostError(
      "invalid_rights_attestation",
      "Browser ingest supports owned media for local processing only; redistribution is not authorized.",
    );
  }
  if (item.ownershipAttested !== true) {
    throw new RuntimeHostError(
      "invalid_rights_attestation",
      "An explicit ownership-or-control attestation is required before upload.",
    );
  }
  return {
    filename,
    declaredBytes: item.declaredBytes as number,
    label: explicitText(item.label, "Source label", 160),
    rightsHolder: explicitText(item.rightsHolder, "Rights holder", 160),
    rightsScope: "local_processing",
    ownershipAttested: true,
  };
}

function contained(root: string, candidate: string): boolean {
  const inside = relative(root, candidate);
  return inside.length > 0 && !inside.startsWith("..") && !isAbsolute(inside);
}

/** Development-only owned-byte upload, producer execution, and registry composition. */
export class OwnedMediaIngestService {
  readonly root: string;
  readonly maximumBytes: number;
  private readonly uploadRoot: string;
  private readonly repositoryRoot: string;
  private readonly sources: RuntimeSourceRegistry;
  private readonly now: () => Date;
  private readonly ingestId: () => string;
  private readonly jobs = new Map<string, OwnedMediaIngestJob>();
  private processingTail: Promise<void> = Promise.resolve();

  private constructor(options: OwnedMediaIngestServiceOptions, root: string) {
    this.root = root;
    this.uploadRoot = join(root, ".uploads");
    this.repositoryRoot = resolve(options.repositoryRoot);
    this.sources = options.sources;
    this.maximumBytes = options.maximumBytes ?? DEFAULT_OWNED_MEDIA_INGEST_BYTES;
    this.now = options.now ?? (() => new Date());
    this.ingestId = options.ingestId ?? (() => `owned-ingest:${randomUUID()}`);
  }

  static async open(options: OwnedMediaIngestServiceOptions): Promise<OwnedMediaIngestService> {
    const maximumBytes = options.maximumBytes ?? DEFAULT_OWNED_MEDIA_INGEST_BYTES;
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
      throw new RuntimeHostError("invalid_ingest_limit", "The owned-media ingest limit is invalid.");
    }
    await mkdir(resolve(options.root), { recursive: true, mode: 0o700 });
    const root = await realpath(resolve(options.root));
    const service = new OwnedMediaIngestService({ ...options, maximumBytes }, root);
    await mkdir(service.uploadRoot, { recursive: true, mode: 0o700 });
    await service.registerSealedDirectories();
    return service;
  }

  private async registerSealedDirectories(): Promise<void> {
    const entries = await readdir(this.root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === ".uploads") continue;
      const directory = join(this.root, entry.name);
      try {
        if (!(await stat(join(directory, "preflight.json"))).isFile()) continue;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      await this.sources.registerDirectory(directory, { sourceRoot: this.root });
    }
  }

  create(value: unknown): OwnedMediaIngestStatus {
    const request = parseRequest(value, this.maximumBytes);
    const ingestId = this.ingestId();
    if (!/^owned-ingest:[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(ingestId) || this.jobs.has(ingestId)) {
      throw new RuntimeHostError("ingest_identity_failed", "The host could not allocate a unique ingest identity.", 500);
    }
    const suffix = ingestId.slice("owned-ingest:".length);
    const runId = `owned-${suffix}`;
    const uploadDirectory = join(this.uploadRoot, suffix);
    const sourceDirectory = join(this.root, suffix);
    const uploadPath = join(uploadDirectory, `upload${extname(request.filename).toLowerCase()}`);
    if (!contained(this.uploadRoot, uploadPath) || !contained(this.root, sourceDirectory)) {
      throw new RuntimeHostError("ingest_identity_failed", "The host could not allocate private ingest storage.", 500);
    }
    const updatedAt = this.now().toISOString();
    const job: OwnedMediaIngestJob = {
      ingestId,
      runId,
      request,
      uploadPath,
      sourceDirectory,
      status: "queued",
      updatedAt,
      source: null,
      failure: null,
      uploadStarted: false,
    };
    this.jobs.set(ingestId, job);
    return this.publicStatus(job);
  }

  status(ingestId: string): OwnedMediaIngestStatus {
    const job = this.jobs.get(ingestId);
    if (!job) throw new RuntimeHostError("unknown_ingest", "The owned-media ingest job does not exist.", 404);
    return this.publicStatus(job);
  }

  async upload(ingestId: string, request: IncomingMessage): Promise<OwnedMediaIngestStatus> {
    const job = this.jobs.get(ingestId);
    if (!job) throw new RuntimeHostError("unknown_ingest", "The owned-media ingest job does not exist.", 404);
    if (job.uploadStarted || job.status !== "queued") {
      throw new RuntimeHostError("ingest_upload_conflict", "This ingest job has already accepted its media bytes.", 409);
    }
    if (request.headers["content-encoding"] && request.headers["content-encoding"] !== "identity") {
      throw new RuntimeHostError("unsupported_content_encoding", "Owned-media uploads do not accept content encoding.", 415);
    }
    const declared = request.headers["content-length"];
    const length = typeof declared === "string" ? Number(declared) : NaN;
    if (!Number.isSafeInteger(length) || length <= 0 || length !== job.request.declaredBytes) {
      throw new RuntimeHostError(
        "invalid_upload_length",
        "Upload Content-Length must exactly match the declared media byte count.",
        400,
      );
    }
    if (length > this.maximumBytes) {
      throw new RuntimeHostError("ingest_body_too_large", "The owned media exceeds the host ingest limit.", 413);
    }

    job.uploadStarted = true;
    let file;
    try {
      await mkdir(resolve(job.uploadPath, ".."), { recursive: true, mode: 0o700 });
      file = await open(job.uploadPath, "wx", 0o600);
    } catch (error) {
      this.fail(job, "upload_failed", "The host could not allocate private storage for the declared upload.");
      throw error;
    }
    let received = 0;
    try {
      for await (const chunk of request) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        received += buffer.length;
        if (received > job.request.declaredBytes || received > this.maximumBytes) {
          throw new RuntimeHostError("ingest_body_too_large", "The owned media exceeds the declared or host limit.", 413);
        }
        let written = 0;
        while (written < buffer.length) {
          const result = await file.write(buffer, written, buffer.length - written, null);
          if (result.bytesWritten <= 0) {
            throw new Error("The private upload file stopped accepting bytes.");
          }
          written += result.bytesWritten;
        }
      }
      if (received !== job.request.declaredBytes) {
        throw new RuntimeHostError("invalid_upload_length", "The upload ended before all declared media bytes arrived.");
      }
      this.transition(job, "queued");
    } catch (error) {
      this.fail(job, "upload_failed", "The host did not preserve the complete declared media upload.");
      await rm(resolve(job.uploadPath, ".."), { recursive: true, force: true });
      throw error;
    } finally {
      await file.close();
    }

    const queued = this.publicStatus(job);
    setImmediate(() => {
      const processing = this.processingTail
        .catch(() => undefined)
        .then(() => this.process(job));
      this.processingTail = processing;
      void processing.catch(() => undefined);
    });
    return queued;
  }

  private transition(job: OwnedMediaIngestJob, status: OwnedMediaIngestState): void {
    job.status = status;
    job.updatedAt = this.now().toISOString();
  }

  private fail(job: OwnedMediaIngestJob, code: OwnedMediaIngestFailure["code"], message: string): void {
    job.failure = { code, message };
    this.transition(job, "failed");
  }

  private async process(job: OwnedMediaIngestJob): Promise<void> {
    this.transition(job, "probing");
    try {
      await executeFile(process.execPath, [
        join(this.repositoryRoot, "scripts", "ingest-owned-media.mjs"),
        "--file", job.uploadPath,
        "--run", job.runId,
        "--directory", job.sourceDirectory,
        "--label", job.request.label,
        "--rights-holder", job.request.rightsHolder,
        "--rights-scope", "local",
        "--attest-rights",
      ], {
        cwd: this.repositoryRoot,
        timeout: 5 * 60_000,
        maxBuffer: 4 * 1024 * 1024,
      });
    } catch {
      this.fail(job, "probe_failed", "The owned bytes could not be probed into a valid media receipt.");
      await this.cleanupFailedJob(job);
      return;
    }

    this.transition(job, "sealing");
    try {
      await executeFile(process.execPath, [
        join(this.repositoryRoot, "scripts", "preflight-owned-media.mjs"),
        "--index-existing",
        "--run", job.runId,
        "--directory", job.sourceDirectory,
      ], {
        cwd: this.repositoryRoot,
        timeout: 60_000,
        maxBuffer: 2 * 1024 * 1024,
      });
    } catch {
      this.fail(job, "seal_failed", "The probed owned media could not be sealed into a V1 preflight receipt.");
      await this.cleanupFailedJob(job);
      return;
    }

    try {
      job.source = await this.sources.registerDirectory(job.sourceDirectory, { sourceRoot: this.root });
      this.transition(job, "registered");
    } catch {
      this.fail(job, "registration_failed", "The sealed source did not pass host registration validation.");
    } finally {
      await this.cleanupUpload(job);
      if (job.status === "failed") await rm(job.sourceDirectory, { recursive: true, force: true });
    }
  }

  private async cleanupFailedJob(job: OwnedMediaIngestJob): Promise<void> {
    await Promise.all([
      this.cleanupUpload(job),
      rm(job.sourceDirectory, { recursive: true, force: true }),
    ]);
  }

  private async cleanupUpload(job: OwnedMediaIngestJob): Promise<void> {
    await rm(resolve(job.uploadPath, ".."), { recursive: true, force: true });
  }

  private publicStatus(job: OwnedMediaIngestJob): OwnedMediaIngestStatus {
    return {
      schema: "studio.owned-media-ingest.v1",
      ingestId: job.ingestId,
      status: job.status,
      updatedAt: job.updatedAt,
      source: job.source ? structuredClone(job.source) : null,
      failure: job.failure ? { ...job.failure } : null,
    };
  }
}
