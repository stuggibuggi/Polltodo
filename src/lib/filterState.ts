export function loadUserScopedState<T extends Record<string, unknown>>(userId: string | undefined, scope: string, fallback: T): T {
  if (!userId) return fallback
  try {
    const raw = localStorage.getItem(`filters:${scope}:${userId}`)
    if (!raw) return fallback
    return { ...fallback, ...(JSON.parse(raw) as Partial<T>) }
  } catch {
    return fallback
  }
}

export function saveUserScopedState<T extends Record<string, unknown>>(userId: string | undefined, scope: string, value: T) {
  if (!userId) return
  try {
    localStorage.setItem(`filters:${scope}:${userId}`, JSON.stringify(value))
  } catch {
    // ignore storage errors
  }
}
