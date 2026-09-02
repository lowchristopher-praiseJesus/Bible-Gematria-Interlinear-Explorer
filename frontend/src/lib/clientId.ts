const STORAGE_KEY = 'bible-explorer-client-id'

let memoryFallback: string | null = null

function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  // RFC4122-ish fallback for very old runtimes
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

export function getClientId(): string {
  try {
    const existing = localStorage.getItem(STORAGE_KEY)
    if (existing) return existing
    const fresh = uuid()
    localStorage.setItem(STORAGE_KEY, fresh)
    return fresh
  } catch {
    if (!memoryFallback) memoryFallback = uuid()
    return memoryFallback
  }
}
