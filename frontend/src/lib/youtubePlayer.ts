// Thin wrapper over the YouTube IFrame Player API for Defend the Faith.
// The API script is injected once; a player is created on an element and
// reports when a video ends or fails to play.

interface YTPlayer {
  loadVideoById(id: string): void
  cueVideoById(id: string): void
  destroy(): void
}

interface YTApi {
  Player: new (
    el: HTMLElement,
    opts: {
      videoId: string
      host: string
      playerVars: Record<string, number>
      events: { onReady(): void; onStateChange(e: { data: number }): void; onError(): void }
    }
  ) => YTPlayer
  PlayerState: { ENDED: number }
}

declare global {
  interface Window {
    YT?: YTApi
    onYouTubeIframeAPIReady?: () => void
  }
}

const API_SRC = 'https://www.youtube.com/iframe_api'
const LOAD_TIMEOUT_MS = 10_000

let apiPromise: Promise<YTApi> | null = null

/** The IFrame API, loaded once. Rejects (and is retried next call) if the
 * script fails or doesn't become ready within 10 s. */
export function loadYouTubeApi(): Promise<YTApi> {
  if (window.YT?.Player) return Promise.resolve(window.YT)
  if (!apiPromise) {
    const p = new Promise<YTApi>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('YouTube player timed out')), LOAD_TIMEOUT_MS)
      const previous = window.onYouTubeIframeAPIReady
      window.onYouTubeIframeAPIReady = () => {
        previous?.()
        window.clearTimeout(timer)
        if (window.YT) resolve(window.YT)
        else reject(new Error('YouTube player unavailable'))
      }
      const script = document.createElement('script')
      script.src = API_SRC
      script.async = true
      script.onerror = () => {
        window.clearTimeout(timer)
        reject(new Error('YouTube player failed to load'))
      }
      document.head.appendChild(script)
    })
    apiPromise = p
    p.catch(() => {
      if (apiPromise === p) apiPromise = null
    })
  }
  return apiPromise
}

export interface ShortPlayer {
  /** Switch to a video and play it (the user picked it). */
  load(videoId: string): void
  /** Switch to a video without playing it (auto-advance). */
  cue(videoId: string): void
  destroy(): void
}

export async function createPlayer(
  el: HTMLElement,
  videoId: string,
  on: { ended(): void; error(): void }
): Promise<ShortPlayer> {
  const YT = await loadYouTubeApi()
  // The player's methods (loadVideoById, cueVideoById) exist only after its
  // iframe has finished loading, so resolve on onReady, not on construction.
  // A player that never gets ready (iframe blocked or too slow) is an error.
  return new Promise<ShortPlayer>((resolve, reject) => {
    let player: YTPlayer | null = null
    const timer = window.setTimeout(() => {
      player?.destroy()
      reject(new Error('YouTube player never became ready'))
    }, LOAD_TIMEOUT_MS)
    player = new YT.Player(el, {
      videoId,
      host: 'https://www.youtube-nocookie.com',
      playerVars: { rel: 0, playsinline: 1 },
      events: {
        onReady: () => {
          window.clearTimeout(timer)
          const p = player!
          resolve({
            load: (id) => p.loadVideoById(id),
            cue: (id) => p.cueVideoById(id),
            destroy: () => p.destroy(),
          })
        },
        onStateChange: (e) => {
          if (e.data === YT.PlayerState.ENDED) on.ended()
        },
        onError: () => on.error(),
      },
    })
  })
}
