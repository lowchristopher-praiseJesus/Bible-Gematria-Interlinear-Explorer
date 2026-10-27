import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  firstVerse, loadSpotLabels, markViewerReady, resetSpotLabels, parseViewerMessage, registerViewer, sendGoto, viewerSrc,
} from './tabernacleBridge'

const msg = (data: unknown, init: Partial<MessageEventInit> = {}) =>
  new MessageEvent('message', { data, origin: window.location.origin, ...init })

describe('tabernacleBridge', () => {
  afterEach(() => registerViewer(null))

  it('viewerSrc', () => {
    expect(viewerSrc(null)).toBe('/tabernacle/index.html?embed=1')
    expect(viewerSrc('ark')).toBe('/tabernacle/index.html?embed=1#spot=ark')
    expect(viewerSrc('nope')).toBe('/tabernacle/index.html?embed=1')
  })

  it('parseViewerMessage validates origin, source, type and spot', () => {
    const win = {} as Window
    expect(parseViewerMessage(msg({ type: 'tabernacle:ready' }, { origin: 'https://evil.test', source: win as unknown as MessageEventSource }), win)).toBeNull()
    expect(parseViewerMessage(msg({ type: 'tabernacle:ready' }, { source: {} as unknown as MessageEventSource }), win)).toBeNull()
    expect(parseViewerMessage(msg({ type: 'other' }, { source: win as unknown as MessageEventSource }), win)).toBeNull()
    expect(parseViewerMessage(msg({ type: 'tabernacle:spot', spot: 'nope' }, { source: win as unknown as MessageEventSource }), win)).toBeNull()
    expect(parseViewerMessage(msg({ type: 'tabernacle:ready' }, { source: win as unknown as MessageEventSource }), win)).toEqual({ type: 'tabernacle:ready' })
    expect(parseViewerMessage(msg({ type: 'tabernacle:ask', spot: 'laver' }, { source: win as unknown as MessageEventSource }), win)).toEqual({ type: 'tabernacle:ask', spot: 'laver' })
    expect(parseViewerMessage(msg({ type: 'tabernacle:ref', ref: 'Exodus 30:18' }, { source: win as unknown as MessageEventSource }), win)).toEqual({ type: 'tabernacle:ref', ref: 'Exodus 30:18' })
  })

  it('firstVerse', () => {
    expect(firstVerse('Exodus 30:18–19')).toBe('Exodus 30:18')
    expect(firstVerse('Exodus 25:31, 37')).toBe('Exodus 25:31')
  })

  it('holds the latest goto until ready, then posts once', () => {
    const postMessage = vi.fn()
    registerViewer({ postMessage } as unknown as Window)
    sendGoto({ spot: 'ark' })
    sendGoto({ spot: 'veil' })
    expect(postMessage).not.toHaveBeenCalled()
    markViewerReady()
    expect(postMessage).toHaveBeenCalledTimes(1)
    expect(postMessage).toHaveBeenCalledWith({ type: 'tabernacle:goto', spot: 'veil' }, window.location.origin)
    sendGoto({ station: 3 })
    expect(postMessage).toHaveBeenCalledTimes(2)
  })

  it('registering a new viewer resets readiness', () => {
    const a = vi.fn()
    const b = vi.fn()
    registerViewer({ postMessage: a } as unknown as Window)
    markViewerReady()
    registerViewer({ postMessage: b } as unknown as Window)
    sendGoto({ spot: 'ark' })
    expect(b).not.toHaveBeenCalled()
    markViewerReady()
    expect(b).toHaveBeenCalledTimes(1)
  })

  it('sendGoto with no viewer is a no-op', () => {
    expect(() => sendGoto({ spot: 'ark' })).not.toThrow()
  })

  it('loadSpotLabels fetches once and maps ids to labels', async () => {
    resetSpotLabels()
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ark: { label: 'The ark of the covenant' } }) })
    vi.stubGlobal('fetch', f)
    expect(await loadSpotLabels()).toEqual({ ark: 'The ark of the covenant' })
    await loadSpotLabels()
    expect(f).toHaveBeenCalledTimes(1)
    vi.unstubAllGlobals()
  })

  it('loadSpotLabels resolves {} on failure and retries next time', async () => {
    resetSpotLabels()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('x')))
    expect(await loadSpotLabels()).toEqual({})
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ark: { label: 'A' } }) })
    vi.stubGlobal('fetch', f)
    expect(await loadSpotLabels()).toEqual({ ark: 'A' })
    vi.unstubAllGlobals()
  })
})
