import { type Span, SpanStatusCode } from "@opentelemetry/api";
import type { GraphQLError } from "graphql";

/**
 * Removes keys from an object if the value is empty
 */
export const pruneObject = <T>(object: T): Partial<T> => {
  const data: Record<string, unknown> = {};
  for (const key in object) {
    if (objectIsNotEmpty(object[key])) {
      data[key] = object[key];
    }
  }
  return JSON.parse(JSON.stringify(data ?? null));
};

const objectIsNotEmpty = (value: unknown) =>
  value && Object.keys(value).length > 0;

// Helper function to parse error body: tries JSON, falls back to text
export async function parseErrorBody(response: Response): Promise<unknown> {
  try {
    // Important: Clone before parsing to avoid consuming the body
    return await response.clone().json();
  } catch (jsonError) {
    try {
      // If JSON fails, try text
      return await response.clone().text();
    } catch (textError) {
      // If text also fails, log and return undefined
      console.error(
        "Failed to read error response body as JSON or text:",
        textError
      );
      return undefined;
    }
  }
}

/**
 * Checks if the response is a PersistedQueryNotFound error
 */
export function isPersistedQueryNotFoundError(response: unknown): boolean {
  if (
    typeof response === "object" &&
    response !== null &&
    Object.prototype.hasOwnProperty.call(response, "errors")
  ) {
    const errors = (response as { errors?: unknown }).errors;
    if (Array.isArray(errors)) {
      return errors.some((err: unknown) => {
        if (typeof err !== "object" || err === null) return false;
        const error = err as GraphQLError;
        return (
          error.message?.includes("PersistedQueryNotFound") ||
          error.extensions?.code === "PERSISTED_QUERY_NOT_FOUND"
        );
      });
    }
  }
  return false;
}

// Helper to set error status on span
export function setErrorStatus(span: Span, error: unknown): void {
  const errorMessage = error instanceof Error ? error.message : String(error);
  span.setStatus({ code: SpanStatusCode.ERROR, message: errorMessage });
}
