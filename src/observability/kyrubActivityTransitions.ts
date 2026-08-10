export const enteredSemanticScreens = (
  previous: ReadonlySet<string>,
  current: Iterable<string>
): string[] => {
  const currentSet = new Set(current);
  return [...currentSet].filter(screenId => !previous.has(screenId));
};

export const rememberSemanticSelection = (
  memory: Map<string, string>,
  scope: string,
  screenId: string
): boolean => {
  if (memory.get(scope) === screenId) return false;
  memory.set(scope, screenId);
  return true;
};

export const forgetSemanticSelection = (
  memory: Map<string, string>,
  scope: string
): void => {
  memory.delete(scope);
};
