import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { RuntimeHostError, safeRuntimeHostError } from "./errors.ts";
import { validatePollCursor } from "./journalPolling.ts";
import { OwnedMediaIngestService } from "./ownedMediaIngest.ts";
import { RuntimeStartService } from "./service.ts";

export const DEFAULT_RUNTIME_HOST_BODY_BYTES = 64 * 1024;

export interface RuntimeHostHttpOptions {
  service: RuntimeStartService;
  ownedMediaIngest?: OwnedMediaIngestService;
  token: string;
  allowedOrigins: string[];
  maximumBodyBytes?: number;
}

export interface RuntimeHostListenOptions {
  host?: string;
  port?: number;
  unsafeDevelopmentBind?: boolean;
}

function normalizeOrigin(originValue: string): string {
  if (originValue === "*") {
    throw new RuntimeHostError("wildcard_origin_rejected", "Wildcard Studio origins are not allowed.");
  }
  let url: URL;
  try {
    url = new URL(originValue);
  } catch (error) {
    throw new RuntimeHostError("invalid_origin", "An allowed Studio origin is invalid.", 400, { cause: error });
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.origin !== originValue || url.username || url.password) {
    throw new RuntimeHostError("invalid_origin", "An allowed Studio origin must be an exact HTTP origin.");
  }
  return url.origin;
}

export function assertRuntimeHostBindAddress(host: string, unsafeDevelopmentBind = false): void {
  const loopback = host === "127.0.0.1" || host === "::1" || host === "localhost";
  if (!loopback && !unsafeDevelopmentBind) {
    throw new RuntimeHostError(
      "non_loopback_bind_rejected",
      "Non-loopback binding requires the explicit unsafe-development flag.",
    );
  }
}

function sendJson(
  response: ServerResponse,
  status: number,
  value: unknown,
  origin: string | null,
  extraHeaders: Record<string, string> = {},
): void {
  const body = `${JSON.stringify(value)}\n`;
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body).toString(),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...(origin ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {}),
    ...extraHeaders,
  });
  response.end(body);
}

function sendNoContent(
  response: ServerResponse,
  origin: string,
  extraHeaders: Record<string, string>,
): void {
  response.writeHead(204, {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Access-Control-Allow-Origin": origin,
    Vary: "Origin",
    ...extraHeaders,
  });
  response.end();
}

async function readJsonBody(request: IncomingMessage, maximumBytes: number): Promise<unknown> {
  const declared = request.headers["content-length"];
  if (declared !== undefined) {
    const length = Number(declared);
    if (!Number.isSafeInteger(length) || length < 0) {
      throw new RuntimeHostError("invalid_content_length", "Content-Length is invalid.");
    }
    if (length > maximumBytes) {
      throw new RuntimeHostError("request_body_too_large", "The request body exceeds the host limit.", 413);
    }
  }
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > maximumBytes) {
      throw new RuntimeHostError("request_body_too_large", "The request body exceeds the host limit.", 413);
    }
    chunks.push(buffer);
  }
  if (bytes === 0) throw new RuntimeHostError("empty_request_body", "A JSON request body is required.");
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch (error) {
    throw new RuntimeHostError("invalid_json", "The request body is not valid JSON.", 400, { cause: error });
  }
}

function routeIdentity(pathname: string, expression: RegExp): string | null {
  const match = expression.exec(pathname);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch (error) {
    throw new RuntimeHostError("invalid_identity", "The route identity is malformed.", 400, { cause: error });
  }
}

export function createRuntimeHostHttpServer(options: RuntimeHostHttpOptions): Server {
  if (options.token.length < 32 || options.token.length > 512) {
    throw new RuntimeHostError("invalid_host_token", "The local host token must contain 32 to 512 characters.");
  }
  if (options.allowedOrigins.length === 0) {
    throw new RuntimeHostError("missing_allowed_origin", "At least one Studio origin must be configured.");
  }
  const allowedOrigins = new Set(options.allowedOrigins.map(normalizeOrigin));
  const maximumBytes = options.maximumBodyBytes ?? DEFAULT_RUNTIME_HOST_BODY_BYTES;
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > 1024 * 1024) {
    throw new RuntimeHostError("invalid_body_limit", "The request body limit is invalid.");
  }

  return createServer((request, response) => {
    void (async () => {
      const originHeader = request.headers.origin ?? null;
      const origin = originHeader && allowedOrigins.has(originHeader) ? originHeader : null;
      if (originHeader && !origin) {
        throw new RuntimeHostError("origin_not_allowed", "The request origin is not allowed.", 403);
      }
      if (request.method === "OPTIONS") {
        if (!origin) throw new RuntimeHostError("origin_required", "CORS preflight requires an allowed origin.", 403);
        sendNoContent(response, origin, {
          "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
          "Access-Control-Allow-Headers": "Authorization, Content-Type",
          "Access-Control-Max-Age": "600",
        });
        return;
      }
      if (request.headers.authorization !== `Bearer ${options.token}`) {
        throw new RuntimeHostError("unauthorized", "A valid local runtime-host token is required.", 401);
      }
      const url = new URL(request.url ?? "/", "http://runtime-host.local");

      if (url.pathname === "/v1/owned-media-ingests") {
        if (!options.ownedMediaIngest) {
          throw new RuntimeHostError("owned_ingest_unavailable", "Browser owned-media ingest is not enabled.", 404);
        }
        if (request.method !== "POST") {
          throw new RuntimeHostError("method_not_allowed", "Only POST is supported for this endpoint.", 405);
        }
        if (url.search) throw new RuntimeHostError("unknown_query", "This endpoint accepts no query parameters.");
        if ((request.headers["content-type"] ?? "").split(";", 1)[0].trim().toLowerCase() !== "application/json") {
          throw new RuntimeHostError(
            "unsupported_content_type",
            "Owned-media ingest metadata requires Content-Type: application/json.",
            415,
          );
        }
        sendJson(
          response,
          202,
          options.ownedMediaIngest.create(await readJsonBody(request, maximumBytes)),
          origin,
        );
        return;
      }

      const ingestMediaId = routeIdentity(url.pathname, /^\/v1\/owned-media-ingests\/([^/]+)\/media$/);
      if (ingestMediaId !== null) {
        if (!options.ownedMediaIngest) {
          throw new RuntimeHostError("owned_ingest_unavailable", "Browser owned-media ingest is not enabled.", 404);
        }
        if (request.method !== "PUT") {
          throw new RuntimeHostError("method_not_allowed", "Only PUT is supported for this endpoint.", 405);
        }
        if (url.search) throw new RuntimeHostError("unknown_query", "This endpoint accepts no query parameters.");
        if ((request.headers["content-type"] ?? "").split(";", 1)[0].trim().toLowerCase() !== "application/octet-stream") {
          throw new RuntimeHostError(
            "unsupported_content_type",
            "Owned-media bytes require Content-Type: application/octet-stream.",
            415,
          );
        }
        sendJson(response, 202, await options.ownedMediaIngest.upload(ingestMediaId, request), origin);
        return;
      }

      const ingestId = routeIdentity(url.pathname, /^\/v1\/owned-media-ingests\/([^/]+)$/);
      if (ingestId !== null) {
        if (!options.ownedMediaIngest) {
          throw new RuntimeHostError("owned_ingest_unavailable", "Browser owned-media ingest is not enabled.", 404);
        }
        if (request.method !== "GET") {
          throw new RuntimeHostError("method_not_allowed", "Only GET is supported for this endpoint.", 405);
        }
        if (url.search) throw new RuntimeHostError("unknown_query", "This endpoint accepts no query parameters.");
        sendJson(response, 200, options.ownedMediaIngest.status(ingestId), origin);
        return;
      }

      if (url.pathname === "/v1/source-sessions") {
        if (request.method !== "GET") {
          throw new RuntimeHostError("method_not_allowed", "Only GET is supported for this endpoint.", 405);
        }
        if (url.search) throw new RuntimeHostError("unknown_query", "This endpoint accepts no query parameters.");
        sendJson(response, 200, {
          schema: "studio.local-source-session-list.v1",
          sourceSessions: options.service.listSources(),
        }, origin);
        return;
      }

      if (url.pathname === "/v1/runtime-starts") {
        if (request.method !== "POST") {
          throw new RuntimeHostError("method_not_allowed", "Only POST is supported for this endpoint.", 405);
        }
        if (url.search) throw new RuntimeHostError("unknown_query", "This endpoint accepts no query parameters.");
        if ((request.headers["content-type"] ?? "").split(";", 1)[0].trim().toLowerCase() !== "application/json") {
          throw new RuntimeHostError(
            "unsupported_content_type",
            "Runtime starts require Content-Type: application/json.",
            415,
          );
        }
        const acknowledgement = await options.service.start(await readJsonBody(request, maximumBytes));
        sendJson(response, 202, acknowledgement, origin);
        return;
      }

      if (url.pathname === "/v1/runtime-plans") {
        if (request.method !== "POST") {
          throw new RuntimeHostError("method_not_allowed", "Only POST is supported for this endpoint.", 405);
        }
        if (url.search) throw new RuntimeHostError("unknown_query", "This endpoint accepts no query parameters.");
        if ((request.headers["content-type"] ?? "").split(";", 1)[0].trim().toLowerCase() !== "application/json") {
          throw new RuntimeHostError(
            "unsupported_content_type",
            "Runtime plans require Content-Type: application/json.",
            415,
          );
        }
        sendJson(response, 200, await options.service.plan(await readJsonBody(request, maximumBytes)), origin);
        return;
      }

      const commandId = routeIdentity(url.pathname, /^\/v1\/runtime-starts\/([^/]+)$/);
      if (commandId !== null) {
        if (request.method !== "GET") throw new RuntimeHostError("method_not_allowed", "Only GET is supported for this endpoint.", 405);
        if (url.search) throw new RuntimeHostError("unknown_query", "This endpoint accepts no query parameters.");
        sendJson(response, 200, await options.service.statusByCommand(commandId), origin);
        return;
      }

      const eventRuntimeId = routeIdentity(url.pathname, /^\/v1\/runtimes\/([^/]+)\/events$/);
      if (eventRuntimeId !== null) {
        if (request.method !== "GET") throw new RuntimeHostError("method_not_allowed", "Only GET is supported for this endpoint.", 405);
        for (const key of url.searchParams.keys()) {
          if (key !== "after" && key !== "limit") throw new RuntimeHostError("unknown_query", `Query field ${key} is not allowed.`);
        }
        if (url.searchParams.getAll("after").length > 1 || url.searchParams.getAll("limit").length > 1) {
          throw new RuntimeHostError("duplicate_query", "Cursor query fields may appear only once.");
        }
        const cursor = validatePollCursor(url.searchParams.get("after"), url.searchParams.get("limit"));
        sendJson(response, 200, await options.service.poll(eventRuntimeId, cursor.after, cursor.limit), origin);
        return;
      }

      const auditRuntimeId = routeIdentity(url.pathname, /^\/v1\/runtimes\/([^/]+)\/assessment-audits$/);
      if (auditRuntimeId !== null) {
        if (request.method !== "GET") throw new RuntimeHostError("method_not_allowed", "Only GET is supported for this endpoint.", 405);
        if (url.search) throw new RuntimeHostError("unknown_query", "This endpoint accepts no query parameters.");
        sendJson(response, 200, await options.service.assessmentAudits(auditRuntimeId), origin);
        return;
      }

      const runtimeId = routeIdentity(url.pathname, /^\/v1\/runtimes\/([^/]+)$/);
      if (runtimeId !== null) {
        if (request.method !== "GET") throw new RuntimeHostError("method_not_allowed", "Only GET is supported for this endpoint.", 405);
        if (url.search) throw new RuntimeHostError("unknown_query", "This endpoint accepts no query parameters.");
        sendJson(response, 200, await options.service.statusByRuntime(runtimeId), origin);
        return;
      }

      throw new RuntimeHostError("not_found", "The runtime-host endpoint does not exist.", 404);
    })().catch((error) => {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      const safe = safeRuntimeHostError(error);
      const originHeader = request.headers.origin ?? null;
      const origin = originHeader && allowedOrigins.has(originHeader) ? originHeader : null;
      sendJson(response, safe.httpStatus, {
        schema: "studio.local-runtime-error.v1",
        error: { code: safe.code, message: safe.message },
      }, origin);
    });
  });
}

export async function listenRuntimeHost(
  server: Server,
  options: RuntimeHostListenOptions = {},
): Promise<{ host: string; port: number }> {
  const host = options.host ?? "127.0.0.1";
  assertRuntimeHostBindAddress(host, options.unsafeDevelopmentBind ?? false);
  const port = options.port ?? 4312;
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) {
    throw new RuntimeHostError("invalid_port", "The runtime-host port is invalid.");
  }
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => reject(error);
    server.once("error", onError);
    server.listen(port, host, () => {
      server.off("error", onError);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new RuntimeHostError("listen_failed", "The runtime host did not receive a TCP address.", 500);
  }
  return { host, port: address.port };
}
