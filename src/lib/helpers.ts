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
