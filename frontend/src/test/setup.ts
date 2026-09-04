import '@testing-library/jest-dom/vitest'

/**
 * In-memory Web Storage shim.
 *
 * Node 25 ships a built-in `localStorage` global (experimental WebStorage)
 * that is non-functional without `--localstorage-file`, and vitest's jsdom
 * global-population skips keys already present on the Node global — so jsdom's
 * working Storage never gets installed. To keep tests deterministic and
 * cross-platform we install a Map-backed Storage onto `globalThis` for both
 * `localStorage` and `sessionStorage` whenever the existing global is missing
 * or non-functional. Runs before any test module imports a store, so zustand
 * `persist` hydrates from a clean in-memory store every run.
 */

interface StorageShim {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
  clear(): void
  key(index: number): string | null
  readonly length: number
}

function createStorageShim(): StorageShim {
  const store = new Map<string, string>()
  return {
    getItem(key: string): string | null {
      return store.has(key) ? (store.get(key) as string) : null
    },
    setItem(key: string, value: string): void {
      store.set(key, String(value))
    },
    removeItem(key: string): void {
      store.delete(key)
    },
    clear(): void {
      store.clear()
    },
    key(index: number): string | null {
      if (index < 0 || index >= store.size) return null
      let i = 0
      for (const k of store.keys()) {
        if (i === index) return k
        i += 1
      }
      return null
    },
    get length(): number {
      return store.size
    },
  }
}

function isFunctionalStorage(value: unknown): value is StorageShim {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as StorageShim).getItem === 'function' &&
    typeof (value as StorageShim).setItem === 'function' &&
    typeof (value as StorageShim).removeItem === 'function' &&
    typeof (value as StorageShim).clear === 'function' &&
    typeof (value as StorageShim).key === 'function'
  )
}

function ensureStorage(name: 'localStorage' | 'sessionStorage'): void {
  const current = (globalThis as Record<string, unknown>)[name]
  if (isFunctionalStorage(current)) return
  Object.defineProperty(globalThis, name, {
    value: createStorageShim(),
    writable: true,
    configurable: true,
  })
}

ensureStorage('localStorage')
ensureStorage('sessionStorage')

// jsdom ships no `matchMedia`; the shell's viewport-adaptive behaviour
// (mobile drawer / sheet vs. desktop columns) needs it. Default to the
// desktop branch (`matches: false`); a test that needs the compact branch
// can override `window.matchMedia` for its duration.
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList
}