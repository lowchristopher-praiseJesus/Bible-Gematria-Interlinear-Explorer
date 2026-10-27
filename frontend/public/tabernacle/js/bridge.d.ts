export const SPOT_IDS: string[]
export function isEmbedded(win: Window): boolean
export function parseHash(hash: string): { spot: string } | { station: number } | null
export function initBridge(opts: {
  win: Window
  goToSpot: (id: string) => void
  goToStation: (n: number) => void
}): { notifySpotOpened(id: string): void }
