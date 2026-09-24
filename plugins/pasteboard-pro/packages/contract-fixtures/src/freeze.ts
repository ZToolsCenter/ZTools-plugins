export type ReadonlyDeep<T> = T extends (
  ...args: infer _Arguments
) => infer _Result
  ? T
  : T extends readonly unknown[]
    ? { readonly [Index in keyof T]: ReadonlyDeep<T[Index]> }
    : T extends object
      ? { readonly [Key in keyof T]: ReadonlyDeep<T[Key]> }
      : T;

function freezeRecursively(value: unknown, seen: WeakSet<object>): void {
  if (value === null || typeof value !== "object" || seen.has(value)) {
    return;
  }

  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    freezeRecursively(Reflect.get(value, key), seen);
  }

  if (!Object.isFrozen(value)) {
    Object.freeze(value);
  }
}

export function deepFreeze<T>(value: T): ReadonlyDeep<T> {
  freezeRecursively(value, new WeakSet<object>());

  return value as ReadonlyDeep<T>;
}
