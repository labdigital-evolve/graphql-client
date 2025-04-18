import type { ResponseWithErrors } from "./types";

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

// Helper to check for APQ "Not Found" errors
export function isPersistedQueryNotFoundError(
  responseData: ResponseWithErrors
): boolean {
  // Example check: Modify this based on how your GraphQL server signals this error
  return (
    Array.isArray(responseData?.errors) &&
    responseData.errors.some(
      (err: { message?: string; extensions?: { code?: string } }) =>
        err?.message?.includes("PersistedQueryNotFound") || // Apollo Server convention
        err?.extensions?.code === "PERSISTED_QUERY_NOT_FOUND" // Other possible convention
    )
  );
}
