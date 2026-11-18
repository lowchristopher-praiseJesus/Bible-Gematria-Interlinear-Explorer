import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPlayer } from './youtubePlayer'

type Events = { onReady(): void; onStateChange(e: { data: number }): void; onError(): void }

let events: Events | null = null
const instance = { loadVideoById: vi.fn(), cueVideoById: vi.fn(), destroy: vi.fn() }

beforeEach(() => {
  events = null
  window.YT = {
    Player: vi.fn(function (_el: HTMLElement, opts: { events: Events }) {
      events = opts.events
      return instance
    }) as never,
    PlayerState: { ENDED: 0 },
  }
})

afterEach(() => {
  delete window.YT
  vi.useRealTimers()
})

describe('createPlayer', () => {
  it('resolves only once the player is ready', async () => {
    let resolved = false
    const p = createPlayer(document.createElement('div'), 'abc', { ended() {}, error() {} }).then((pl) => {
      resolved = true
      return pl
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(resolved).toBe(false)
    events!.onReady()
    const player = await p
    player.cue('def')
    expect(instance.cueVideoById).toHaveBeenCalledWith('def')
  })

  it('rejects when the player never becomes ready', async () => {
    vi.useFakeTimers()
    const p = createPlayer(document.createElement('div'), 'abc', { ended() {}, error() {} })
    const caught = p.catch((e: Error) => e.message)
    await vi.advanceTimersByTimeAsync(15_000)
    expect(await caught).toMatch(/ready/)
    expect(instance.destroy).toHaveBeenCalled()
  })

  it('reports ended and error', async () => {
    const on = { ended: vi.fn(), error: vi.fn() }
    const p = createPlayer(document.createElement('div'), 'abc', on)
    await Promise.resolve()
    events!.onReady()
    await p
    events!.onStateChange({ data: 0 })
    events!.onError()
    expect(on.ended).toHaveBeenCalledTimes(1)
    expect(on.error).toHaveBeenCalledTimes(1)
  })
})
