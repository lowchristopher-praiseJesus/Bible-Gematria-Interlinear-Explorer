// Thin wrapper over the YouTube IFrame Player API for Defend the Faith.
// The API script is injected once; a player is created on an element and
// reports when a video ends or fails to play.

interface YTPlayer {
  loadVideoById(id: string): void
  cueVideoById(id: string): void
  getCurrentTime(): number
  getDuration(): number
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
  PlayerState: { ENDED: number; PLAYING: number }
}

declare global {
  interface Window {
    YT?: YTApi
    onYouTubeIframeAPIReady?: () => void
  }
}

const API_SRC = 'https://www.youtube.com/iframe_api'
const LOAD_TIMEOUT_MS = 10_000
/** A short counts as watched once this share of it has actually played. */
export const WATCHED_FRACTION = 0.9
// Playback is sampled once a second; a bigger jump between samples is a seek
// and doesn't count as watching.
const SAMPLE_MS = 1000
const MAX_STEP_S = 2.5
// YouTube's Shorts player loops: it jumps from the last moments straight back
// to 0:00 without an ENDED event. A jump from within this many seconds of the
// end to within this many seconds of the start is treated as the end.
const END_WINDOW_S = 2

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
  destroy(): void
}

/** A player on `el` that calls `on.watched()` once per video, when 90% of
 * it has actually been played (seeking ahead doesn't count) or when it ends.
 * At the end it stops on the video's cover instead of looping. */
export async function createPlayer(
  el: HTMLElement,
  videoId: string,
  on: { watched(): void; error(): void }
): Promise<ShortPlayer> {
  const YT = await loadYouTubeApi()
  // Watch-time tracking for the video currently loaded.
  let currentVideo = videoId
  let played = 0
  let lastTime: number | null = null
  // Last sampled position; unlike lastTime it survives pauses and buffering,
  // so a loop back to the start can be recognised.
  let lastSeen: number | null = null
  let reported = false
  let sampler: number | null = null
  const stopSampling = () => {
    if (sampler !== null) window.clearInterval(sampler)
    sampler = null
    lastTime = null
  }
  const report = () => {
    if (reported) return
    reported = true
    on.watched()
  }
  const resetTracking = () => {
    stopSampling()
    played = 0
    lastSeen = null
    reported = false
  }

  // The player's methods exist only after its iframe has finished loading,
  // so resolve on onReady, not on construction. A player that never gets
  // ready (iframe blocked or too slow) is an error.
  return new Promise<ShortPlayer>((resolve, reject) => {
    let player: YTPlayer | null = null
    const sample = () => {
      if (!player) return
      const t = player.getCurrentTime()
      if (lastTime !== null) {
        const step = t - lastTime
        if (step > 0 && step <= MAX_STEP_S) played += step
      }
      lastTime = t
      lastSeen = t
      const d = player.getDuration()
      if (d > 0 && played >= WATCHED_FRACTION * d) report()
    }
    // The end of the short: it counts as watched, and the player goes back
    // to the cover (no replay) until the user presses play again.
    const stopAtEnd = () => {
      report()
      stopSampling()
      lastSeen = null
      player?.cueVideoById(currentVideo)
    }
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
            load: (id) => {
              resetTracking()
              currentVideo = id
              p.loadVideoById(id)
            },
            destroy: () => {
              stopSampling()
              p.destroy()
            },
          })
        },
        onStateChange: (e) => {
          if (e.data === YT.PlayerState.PLAYING) {
            const t = player!.getCurrentTime()
            const d = player!.getDuration()
            if (lastSeen !== null && d > 0 && lastSeen >= d - END_WINDOW_S && t < END_WINDOW_S) {
              stopAtEnd()
              return
            }
            if (sampler === null) {
              lastTime = player!.getCurrentTime()
              sampler = window.setInterval(sample, SAMPLE_MS)
            }
          } else {
            stopSampling()
          }
          if (e.data === YT.PlayerState.ENDED) stopAtEnd()
        },
        onError: () => on.error(),
      },
    })
  })
}
