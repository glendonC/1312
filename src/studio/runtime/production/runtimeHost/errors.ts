export class RuntimeHostError extends Error {
  readonly code: string;
  readonly httpStatus: number;

  constructor(code: string, message: string, httpStatus = 400, options: ErrorOptions = {}) {
    super(message, options);
    this.name = "RuntimeHostError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export function safeRuntimeHostError(error: unknown): RuntimeHostError {
  if (error instanceof RuntimeHostError) return error;
  return new RuntimeHostError(
    "internal_failure",
    "The local runtime host could not complete the request. Inspect its durable command state.",
    500,
    { cause: error },
  );
}
