// A native store sheet can briefly make iOS report inactive without the app
// being backgrounded. Tokens cover only the native SDK call, never app setup.
const activePrompts = new Set<symbol>();

export function beginNativeStorePrompt(): () => void {
  const token = Symbol('native-store-prompt');
  activePrompts.add(token);
  return () => { activePrompts.delete(token); };
}

export function isNativeStorePromptActive(): boolean {
  return activePrompts.size > 0;
}
