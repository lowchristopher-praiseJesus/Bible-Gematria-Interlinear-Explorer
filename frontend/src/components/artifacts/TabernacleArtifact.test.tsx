import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TabernacleArtifact } from './TabernacleArtifact'
import { registerViewer, sendGoto, viewerSrc } from '@/lib/tabernacleBridge'
import { useSessionsStore } from '@/store/useSessionsStore'
import type { Session, SessionMode } from '@/types/session'

// The app knows the shown session from the `?session=` URL param (App.tsx).
function showSession(mode: SessionMode, tabernacleSpot?: string) {
  const session: Session = {
    id: 's1', createdAt: 0, updatedAt: 0, mode, title: 't', messages: [], notes: [],
    modeParams: tabernacleSpot ? { tabernacleSpot } : {},
  }
  useSessionsStore.setState({ sessions: { s1: session } })
  window.history.replaceState({}, '', '/?session=s1')
}

function mockMatchMedia(matches: boolean) {
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({
    matches, media: q, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    addListener: vi.fn(), removeListener: vi.fn(), onchange: null, dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia
}

function postReady(iframe: HTMLIFrameElement) {
  act(() => {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'tabernacle:ready' },
        origin: window.location.origin,
        source: iframe.contentWindow,
      })
    )
  })
}

describe('TabernacleArtifact', () => {
  beforeEach(() => mockMatchMedia(false))
  afterEach(() => {
    vi.useRealTimers()
    useSessionsStore.setState({ sessions: {}, activeSessionId: null })
    window.history.replaceState({}, '', '/')
  })

  it("opens at the shown tabernacle session's saved spot, over the artifact's own spot", () => {
    showSession('tabernacle', 'ark')
    const { container } = render(<TabernacleArtifact spot={null} />)
    expect(container.querySelector('iframe')?.getAttribute('src')).toBe('/tabernacle/index.html?embed=1#spot=ark')
  })

  it('a later spot change in the session never changes the iframe src', () => {
    showSession('tabernacle', 'ark')
    const { container } = render(<TabernacleArtifact spot={null} />)
    act(() => {
      useSessionsStore.getState().updateModeParams('s1', { tabernacleSpot: 'laver' })
    })
    expect(container.querySelector('iframe')?.getAttribute('src')).toBe('/tabernacle/index.html?embed=1#spot=ark')
  })

  it("ignores another mode's session and uses the artifact's spot", () => {
    showSession('freeform', 'ark')
    const { container } = render(<TabernacleArtifact spot="laver" />)
    expect(container.querySelector('iframe')?.getAttribute('src')).toBe(viewerSrc('laver'))
  })

  it('points the iframe at the viewer for the spot and shows the title while loading', () => {
    const { container } = render(<TabernacleArtifact spot="ark" />)
    expect(container.querySelector('iframe')?.getAttribute('src')).toBe(viewerSrc('ark'))
    expect(screen.getAllByText('The Tabernacle').length).toBeGreaterThan(0)
  })

  it('shows a fallback link after 15s without a ready message', () => {
    vi.useFakeTimers()
    render(<TabernacleArtifact spot={null} />)
    act(() => {
      vi.advanceTimersByTime(15000)
    })
    expect(screen.getByText(/3D view couldn't load/)).toBeInTheDocument()
    expect(screen.getByRole('link')).toHaveAttribute('href', '/tabernacle/index.html')
  })

  it('clears the loading skeleton on ready', () => {
    vi.useFakeTimers()
    const { container } = render(<TabernacleArtifact spot={null} />)
    postReady(container.querySelector('iframe')!)
    act(() => {
      vi.advanceTimersByTime(15000)
    })
    expect(screen.queryByText(/couldn't load/)).not.toBeInTheDocument()
    // only the heading remains
    expect(screen.getAllByText('The Tabernacle')).toHaveLength(1)
  })

  it('full screen keeps the very same iframe element, and shows the fallback there', () => {
    vi.useFakeTimers()
    const { container } = render(<TabernacleArtifact spot={null} />)
    const iframe = container.querySelector('iframe')
    fireEvent.click(screen.getByRole('button', { name: 'Full screen' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(document.querySelectorAll('iframe')).toHaveLength(1)
    expect(document.querySelector('iframe')).toBe(iframe)
    expect(screen.getByRole('dialog').contains(iframe)).toBe(true)
    act(() => {
      vi.advanceTimersByTime(15000)
    })
    expect(screen.getByRole('dialog')).toHaveTextContent(/3D view couldn't load/)
    expect(screen.getByRole('link')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Exit full screen' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(document.querySelectorAll('iframe')).toHaveLength(1)
    expect(document.querySelector('iframe')).toBe(iframe)
  })

  it('names the way out of full screen in words, not just a cross that reads as "close"', () => {
    render(<TabernacleArtifact spot={null} />)
    fireEvent.click(screen.getByRole('button', { name: 'Full screen' }))
    const exit = screen.getByRole('button', { name: 'Exit full screen' })
    expect(exit).toHaveTextContent('Exit full screen')
    fireEvent.click(exit)
    // back in the side panel, the viewer is still there to maximize again
    expect(screen.getByRole('button', { name: 'Full screen' })).toBeInTheDocument()
    expect(document.querySelectorAll('iframe')).toHaveLength(1)
  })

  it('Escape closes full screen', () => {
    render(<TabernacleArtifact spot={null} />)
    fireEvent.click(screen.getByRole('button', { name: 'Full screen' }))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('a ready that arrives before iframe load still flushes a pending goto', () => {
    const { container } = render(<TabernacleArtifact spot={null} />)
    const iframe = container.querySelector('iframe')!
    const post = vi.spyOn(iframe.contentWindow!, 'postMessage').mockImplementation(() => {})
    sendGoto({ spot: 'ark' })
    postReady(iframe)
    expect(post).toHaveBeenCalledTimes(1)
    fireEvent.load(iframe)
    sendGoto({ spot: 'veil' })
    expect(post).toHaveBeenCalledTimes(2)
  })

  it('unmount removes the message listener and clears the timer', () => {
    vi.useFakeTimers()
    const remove = vi.spyOn(window, 'removeEventListener')
    const { container, unmount } = render(<TabernacleArtifact spot={null} />)
    const win = container.querySelector('iframe')!.contentWindow
    unmount()
    expect(remove).toHaveBeenCalledWith('message', expect.any(Function))
    expect(vi.getTimerCount()).toBe(0)
    const post = vi.fn()
    registerViewer({ postMessage: post } as unknown as Window)
    sendGoto({ spot: 'ark' })
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', { data: { type: 'tabernacle:ready' }, origin: window.location.origin, source: win })
      )
    })
    expect(post).not.toHaveBeenCalled()
    registerViewer(null)
  })

  it('opens full screen on mount on a narrow viewport', () => {
    mockMatchMedia(true)
    render(<TabernacleArtifact spot={null} />)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(document.querySelectorAll('iframe')).toHaveLength(1)
  })
})
