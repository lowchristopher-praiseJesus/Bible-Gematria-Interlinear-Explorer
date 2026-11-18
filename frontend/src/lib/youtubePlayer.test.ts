import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPlayer } from './youtubePlayer'

type Events = { onReady(): void; onStateChange(e: { data: number }): void; onError(): void }

const PLAYING = 1
const ENDED = 0

let events: Events | null = null
let time = 0
let duration = 60
const instance = {
  loadVideoById: vi.fn(),
  destroy: vi.fn(),
  getCurrentTime: () => time,
  getDuration: () => duration,
}

beforeEach(() => {
  events = null
  time = 0
  duration = 60
  instance.loadVideoById.mockClear()
  instance.destroy.mockClear()
  window.YT = {
    Player: vi.fn(function (_el: HTMLElement, opts: { events: Events }) {
      events = opts.events
      return instance
    }) as never,
    PlayerState: { ENDED, PLAYING },
  }
})

afterEach(() => {
  delete window.YT
  vi.useRealTimers()
})

async function readyPlayer(on = { watched: vi.fn(), error: vi.fn() }) {
  const p = createPlayer(document.createElement('div'), 'abc', on)
  await Promise.resolve()
  await Promise.resolve()
  events!.onReady()
  return { player: await p, on }
}

/** Play normally for `seconds`, one second per tick. */
async function play(seconds: number) {
  for (let i = 0; i < seconds; i++) {
    time += 1
    await vi.advanceTimersByTimeAsync(1000)
  }
}

describe('createPlayer', () => {
  it('resolves only once the player is ready', async () => {
    let resolved = false
    const p = createPlayer(document.createElement('div'), 'abc', { watched() {}, error() {} }).then((pl) => {
      resolved = true
      return pl
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(resolved).toBe(false)
    events!.onReady()
    const player = await p
    player.load('def')
    expect(instance.loadVideoById).toHaveBeenCalledWith('def')
  })

  it('rejects when the player never becomes ready', async () => {
    vi.useFakeTimers()
    const p = createPlayer(document.createElement('div'), 'abc', { watched() {}, error() {} })
    const caught = p.catch((e: Error) => e.message)
    await vi.advanceTimersByTimeAsync(15_000)
    expect(await caught).toMatch(/ready/)
    expect(instance.destroy).toHaveBeenCalled()
  })

  it('reports watched once 90% has actually been played, and only once', async () => {
    vi.useFakeTimers()
    const { on } = await readyPlayer()
    events!.onStateChange({ data: PLAYING })
    await play(53)
    expect(on.watched).not.toHaveBeenCalled()
    await play(2)
    expect(on.watched).toHaveBeenCalledTimes(1)
    await play(5)
    events!.onStateChange({ data: ENDED })
    expect(on.watched).toHaveBeenCalledTimes(1)
  })

  it('does not count seeking ahead as watching', async () => {
    vi.useFakeTimers()
    const { on } = await readyPlayer()
    events!.onStateChange({ data: PLAYING })
    await play(3)
    time = 58 // jump near the end
    await vi.advanceTimersByTimeAsync(1000)
    await play(1)
    expect(on.watched).not.toHaveBeenCalled()
  })

  it('reports watched on ended even without progress samples', async () => {
    const { on } = await readyPlayer()
    events!.onStateChange({ data: ENDED })
    expect(on.watched).toHaveBeenCalledTimes(1)
  })

  it('starts counting again for the next video', async () => {
    vi.useFakeTimers()
    const { player, on } = await readyPlayer()
    events!.onStateChange({ data: ENDED })
    player.load('def')
    time = 0
    events!.onStateChange({ data: PLAYING })
    await play(55)
    expect(on.watched).toHaveBeenCalledTimes(2)
  })

  it('reports errors', async () => {
    const { on } = await readyPlayer()
    events!.onError()
    expect(on.error).toHaveBeenCalledTimes(1)
  })
})
