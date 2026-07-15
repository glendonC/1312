export function fail(context: string, path: string, message: string): never {
  throw new Error(`${context}: ${path} ${message}`);
}

export function object(value: unknown, context: string, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(context, path, "must be an object");
  }
  return value as Record<string, unknown>;
}

export function exact(
  item: Record<string, unknown>,
  keys: readonly string[],
  context: string,
  path: string,
): void {
  const allowed = new Set(keys);
  for (const key of Object.keys(item)) {
    if (!allowed.has(key)) fail(context, `${path}.${key}`, "is not allowed");
  }
  for (const key of keys) {
    if (!(key in item)) fail(context, `${path}.${key}`, "is required");
  }
}

export function array(value: unknown, context: string, path: string): unknown[] {
  if (!Array.isArray(value)) fail(context, path, "must be an array");
  return value;
}

export function string(value: unknown, context: string, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(context, path, "must be a non-empty string");
  }
  return value;
}

export function nullableString(value: unknown, context: string, path: string): string | null {
  return value === null ? null : string(value, context, path);
}

export function isoTimestamp(value: unknown, context: string, path: string): string {
  const timestamp = string(value, context, path);
  if (!Number.isFinite(Date.parse(timestamp))) fail(context, path, "must be an ISO timestamp");
  return timestamp;
}

export function integer(value: unknown, context: string, path: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    fail(context, path, `must be a safe integer at least ${minimum}`);
  }
  return value as number;
}

export function nullableInteger(
  value: unknown,
  context: string,
  path: string,
  minimum = 0,
): number | null {
  return value === null ? null : integer(value, context, path, minimum);
}

export function boolean(value: unknown, context: string, path: string): boolean {
  if (typeof value !== "boolean") fail(context, path, "must be a boolean");
  return value;
}

export function literal<T extends string>(
  value: unknown,
  expected: T,
  context: string,
  path: string,
): T {
  if (value !== expected) fail(context, path, `must equal ${expected}`);
  return expected;
}

export function oneOf<T extends string>(
  value: unknown,
  values: Set<string>,
  context: string,
  path: string,
): T {
  const selected = string(value, context, path);
  if (!values.has(selected)) fail(context, path, `has unknown value ${selected}`);
  return selected as T;
}

export function uniqueStrings(value: unknown, context: string, path: string): string[] {
  const values = array(value, context, path).map((item, index) =>
    string(item, context, `${path}[${index}]`),
  );
  if (new Set(values).size !== values.length) fail(context, path, "must not contain duplicates");
  return values;
}

export function hash(value: unknown, context: string, path: string): void {
  const item = object(value, context, path);
  exact(item, ["algorithm", "digest", "contentId", "bytes"], context, path);
  literal(item.algorithm, "sha256", context, `${path}.algorithm`);
  const digest = string(item.digest, context, `${path}.digest`);
  if (!/^[a-f0-9]{64}$/.test(digest)) {
    fail(context, `${path}.digest`, "must be a lowercase SHA-256 digest");
  }
  if (item.contentId !== `sha256:${digest}`) {
    fail(context, `${path}.contentId`, "must match the digest");
  }
  integer(item.bytes, context, `${path}.bytes`, 1);
}

export function contentId(value: unknown, context: string, path: string): string {
  const id = string(value, context, path);
  if (!/^sha256:[a-f0-9]{64}$/.test(id)) fail(context, path, "must be a SHA-256 content id");
  return id;
}
