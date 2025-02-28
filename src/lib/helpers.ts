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
