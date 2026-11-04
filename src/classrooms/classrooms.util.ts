export function stripPassword<T extends Record<string, any>>(
  entity: T,
): Omit<T, 'password'> {
  const copy = { ...entity };
  delete copy.password;
  return copy;
}
