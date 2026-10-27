import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TabernacleArtifact } from './TabernacleArtifact'
import { viewerSrc } from '@/lib/tabernacleBridge'

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
  afterEach(() => vi.useRealTimers())

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
    expect(screen.getByRole('link')).toHaveAttribute('href', '/tabernacle/')
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

  it('full screen opens the overlay with still exactly one iframe', () => {
    render(<TabernacleArtifact spot={null} />)
    fireEvent.click(screen.getByRole('button', { name: 'Full screen' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(document.querySelectorAll('iframe')).toHaveLength(1)
    expect(screen.getByRole('dialog').querySelector('iframe')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Close full screen' }))
    expect(document.querySelectorAll('iframe')).toHaveLength(1)
  })

  it('opens full screen on mount on a narrow viewport', () => {
    mockMatchMedia(true)
    render(<TabernacleArtifact spot={null} />)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(document.querySelectorAll('iframe')).toHaveLength(1)
  })
})
