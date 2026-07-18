import { NextResponse } from "next/server";
import { ZodError } from "zod";

export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};

export type ApiSuccessBody<T> = {
  data: T;
  meta?: {
    page?: number;
    pageSize?: number;
    total?: number;
  };
};

export function ok<T>(data: T, init?: ResponseInit, meta?: ApiSuccessBody<T>["meta"]) {
  return NextResponse.json({ data, meta } satisfies ApiSuccessBody<T>, {
    status: 200,
    ...init,
  });
}

export function created<T>(data: T) {
  return NextResponse.json({ data } satisfies ApiSuccessBody<T>, { status: 201 });
}

export function fail(
  message: string,
  status = 400,
  code = "BAD_REQUEST",
  details?: unknown
) {
  return NextResponse.json(
    { error: { code, message, details } } satisfies ApiErrorBody,
    { status }
  );
}

export function fromZod(error: ZodError) {
  return fail("Validation failed", 422, "VALIDATION_ERROR", error.flatten());
}

export function unauthorized(message = "Unauthorized") {
  return fail(message, 401, "UNAUTHORIZED");
}

export function forbidden(message = "Forbidden") {
  return fail(message, 403, "FORBIDDEN");
}

export function notFound(message = "Not found") {
  return fail(message, 404, "NOT_FOUND");
}

export function serverError(message = "Internal server error", details?: unknown) {
  const isProd = process.env.NODE_ENV === "production";
  return fail(
    message,
    500,
    "INTERNAL_ERROR",
    isProd ? undefined : details
  );
}

export function tooManyRequests(retryAfterSec = 60) {
  return NextResponse.json(
    {
      error: {
        code: "RATE_LIMITED",
        message: "Too many requests. Please try again shortly.",
      },
    } satisfies ApiErrorBody,
    {
      status: 429,
      headers: { "Retry-After": String(retryAfterSec) },
    }
  );
}
