import { describe, expect, it, vi } from 'vitest'
import { initBridge, isEmbedded, parseHash } from '../../public/tabernacle/js/bridge.js'

const ORIGIN = 'https://app.test'

function fakeWin(search: string, hash = '', sameParent = false) {
  const parent = { postMessage: vi.fn() }
  const listeners: Record<string, (e: unknown) => void> = {}
  const doc = document.implementation.createHTMLDocument('x')
  doc.body.innerHTML = '<aside class="info"><div class="info-body"></div></aside>'
  const win: any = {
    location: { search, hash, origin: ORIGIN },
    addEventListener: (t: string, fn: (e: unknown) => void) => { listeners[t] = fn },
    document: doc,
  }
  win.parent = sameParent ? win : parent
  return { win, parent, listeners, doc }
}

describe('parseHash', () => {
  it('accepts spots and stations, rejects the rest', () => {
    expect(parseHash('#spot=ark')).toEqual({ spot: 'ark' })
    expect(parseHash('#station=3')).toEqual({ station: 3 })
    expect(parseHash('#station=9')).toBeNull()
    expect(parseHash('#spot=nope')).toBeNull()
    expect(parseHash('')).toBeNull()
  })
})

describe('isEmbedded', () => {
  it('needs ?embed=1 and a distinct parent', () => {
    expect(isEmbedded(fakeWin('').win)).toBe(false)
    expect(isEmbedded(fakeWin('?embed=1', '', true).win)).toBe(false)
    expect(isEmbedded(fakeWin('?embed=1').win)).toBe(true)
  })
})

describe('initBridge', () => {
  it('does nothing when standalone', () => {
    const { win, parent, listeners, doc } = fakeWin('')
    const api = initBridge({ win, goToSpot: vi.fn(), goToStation: vi.fn() })
    expect(parent.postMessage).not.toHaveBeenCalled()
    expect(Object.keys(listeners)).toHaveLength(0)
    api.notifySpotOpened('ark')
    expect(doc.querySelector('.info-ask')).toBeNull()
  })

  it('posts ready, applies the hash, and obeys only the parent', () => {
    const { win, parent, listeners } = fakeWin('?embed=1', '#spot=ark')
    const goToSpot = vi.fn(), goToStation = vi.fn()
    initBridge({ win, goToSpot, goToStation })
    expect(parent.postMessage).toHaveBeenCalledWith({ type: 'tabernacle:ready' }, ORIGIN)
    expect(goToSpot).toHaveBeenCalledWith('ark')
    goToSpot.mockClear()
    const send = (e: object) => listeners.message(e)
    send({ origin: ORIGIN, source: parent, data: { type: 'tabernacle:goto', spot: 'laver' } })
    expect(goToSpot).toHaveBeenCalledWith('laver')
    send({ origin: 'https://evil.test', source: parent, data: { type: 'tabernacle:goto', spot: 'door' } })
    send({ origin: ORIGIN, source: {}, data: { type: 'tabernacle:goto', spot: 'door' } })
    send({ origin: ORIGIN, source: parent, data: { type: 'tabernacle:goto', spot: 'nope' } })
    expect(goToSpot).toHaveBeenCalledTimes(1)
    send({ origin: ORIGIN, source: parent, data: { type: 'tabernacle:goto', station: 4 } })
    expect(goToStation).toHaveBeenCalledWith(4)
  })

  it('posts spot, adds an Ask button, and posts ref clicks', () => {
    const { win, parent, doc } = fakeWin('?embed=1')
    const api = initBridge({ win, goToSpot: vi.fn(), goToStation: vi.fn() })
    doc.querySelector('.info-body')!.innerHTML = '<p class="refs"><span class="ref">Exodus 30:18–19</span></p><h2>Laver</h2>'
    api.notifySpotOpened('laver')
    expect(parent.postMessage).toHaveBeenCalledWith({ type: 'tabernacle:spot', spot: 'laver' }, ORIGIN)
    const ask = doc.querySelector('.info-ask') as HTMLButtonElement
    expect(ask.textContent).toBe('Ask about this')
    ask.click()
    expect(parent.postMessage).toHaveBeenCalledWith({ type: 'tabernacle:ask', spot: 'laver' }, ORIGIN)
    ;(doc.querySelector('.ref') as HTMLElement).click()
    expect(parent.postMessage).toHaveBeenCalledWith({ type: 'tabernacle:ref', ref: 'Exodus 30:18–19' }, ORIGIN)
  })
})
