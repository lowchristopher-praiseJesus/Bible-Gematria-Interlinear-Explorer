import { describe, expect, it, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SettingsPanel } from './SettingsPanel'
import { useThemeStore } from '@/store/useThemeStore'
import { useSessionsStore } from '@/store/useSessionsStore'
import { useArtifactStore } from '@/store/useArtifactStore'
import { useReadingPlanStore } from '@/store/useReadingPlanStore'

describe('SettingsPanel', () => {
  beforeEach(() => {
    localStorage.clear()
    useThemeStore.setState({ theme: 'scholarly' })
    document.documentElement.removeAttribute('data-theme')
    useSessionsStore.setState({ sessions: {}, activeSessionId: null })
    useArtifactStore.setState({ activeArtifact: null, history: [], status: 'idle', data: null, error: null })
    useReadingPlanStore.setState({ progress: null })
  })

  it('opens and lists all four themes', async () => {
    render(<SettingsPanel />)
    await userEvent.click(screen.getByRole('button', { name: /settings/i }))
    expect(screen.getByRole('button', { name: /illuminated manuscript/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /modern scholarly/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /midnight study/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /papyrus editorial/i })).toBeInTheDocument()
  })

  it('selecting a theme updates the store and the document attribute', async () => {
    render(<SettingsPanel />)
    await userEvent.click(screen.getByRole('button', { name: /settings/i }))
    await userEvent.click(screen.getByRole('button', { name: /midnight study/i }))
    expect(useThemeStore.getState().theme).toBe('midnight')
    expect(document.documentElement.getAttribute('data-theme')).toBe('midnight')
  })

  it('disables "Clear all chat history" when there are no sessions', async () => {
    render(<SettingsPanel />)
    await userEvent.click(screen.getByRole('button', { name: /settings/i }))
    expect(screen.getByRole('button', { name: /clear all chat history/i })).toBeDisabled()
  })

  it('requires a second click to actually clear all sessions', async () => {
    useSessionsStore.getState().createSession('freeform', {})
    useSessionsStore.getState().createSession('parable', { parableId: 'prodigal_son' })
    render(<SettingsPanel />)
    await userEvent.click(screen.getByRole('button', { name: /settings/i }))

    const clearButton = screen.getByRole('button', { name: /clear all chat history/i })
    await userEvent.click(clearButton)

    // Armed, not yet cleared.
    expect(Object.keys(useSessionsStore.getState().sessions)).toHaveLength(2)
    expect(screen.getByRole('button', { name: /click again to confirm/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /click again to confirm/i }))

    expect(useSessionsStore.getState().sessions).toEqual({})
    expect(useSessionsStore.getState().activeSessionId).toBeNull()
  })

  it('also resets the artifact panel when clearing all history', async () => {
    useSessionsStore.getState().createSession('freeform', {})
    useArtifactStore.setState({
      activeArtifact: { type: 'strongs', label: "Strong's ▸", params: { id: 'G26' } },
      status: 'ready',
      data: { definition: null, verses: [], resultSummary: '' },
      error: null,
    })
    render(<SettingsPanel />)
    await userEvent.click(screen.getByRole('button', { name: /settings/i }))
    await userEvent.click(screen.getByRole('button', { name: /clear all chat history/i }))
    await userEvent.click(screen.getByRole('button', { name: /click again to confirm/i }))

    expect(useArtifactStore.getState().activeArtifact).toBeNull()
    expect(useArtifactStore.getState().status).toBe('idle')
  })

  it('cancel backs out of the confirm step without clearing anything', async () => {
    useSessionsStore.getState().createSession('freeform', {})
    render(<SettingsPanel />)
    await userEvent.click(screen.getByRole('button', { name: /settings/i }))
    await userEvent.click(screen.getByRole('button', { name: /clear all chat history/i }))
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }))

    expect(screen.getByRole('button', { name: /clear all chat history/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /click again to confirm/i })).not.toBeInTheDocument()
    expect(Object.keys(useSessionsStore.getState().sessions)).toHaveLength(1)
  })

  it('hides the Bible in a Year controls until a plan has been started', async () => {
    render(<SettingsPanel />)
    await userEvent.click(screen.getByRole('button', { name: /settings/i }))
    expect(screen.queryByText(/bible in a year/i)).not.toBeInTheDocument()
  })

  it('shows the current plan once one has been started', async () => {
    useReadingPlanStore.setState({ progress: { plan: 'chronological', dayIndex: 3, completedDays: [0, 1, 2] } })
    render(<SettingsPanel />)
    await userEvent.click(screen.getByRole('button', { name: /settings/i }))
    expect(screen.getByText(/bible in a year/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^chronological/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^canonical/i })).toBeInTheDocument()
  })

  it('requires a second click to switch plan, then restarts at day 1', async () => {
    useReadingPlanStore.setState({ progress: { plan: 'chronological', dayIndex: 5, completedDays: [0, 1, 2, 3, 4] } })
    render(<SettingsPanel />)
    await userEvent.click(screen.getByRole('button', { name: /settings/i }))

    await userEvent.click(screen.getByRole('button', { name: /^canonical/i }))
    // Armed, not yet switched.
    expect(useReadingPlanStore.getState().progress?.plan).toBe('chronological')

    await userEvent.click(screen.getByRole('button', { name: /click again to confirm/i }))
    expect(useReadingPlanStore.getState().progress).toEqual({ plan: 'canonical', dayIndex: 0, completedDays: [] })
  })

  it('requires a second click to reset the day count, keeping the plan', async () => {
    useReadingPlanStore.setState({ progress: { plan: 'canonical', dayIndex: 8, completedDays: [0, 1, 2] } })
    render(<SettingsPanel />)
    await userEvent.click(screen.getByRole('button', { name: /settings/i }))

    await userEvent.click(screen.getByRole('button', { name: /reset to day 1/i }))
    expect(useReadingPlanStore.getState().progress?.dayIndex).toBe(8)

    await userEvent.click(screen.getByRole('button', { name: /click again to confirm/i }))
    expect(useReadingPlanStore.getState().progress).toEqual({ plan: 'canonical', dayIndex: 0, completedDays: [] })
  })

  it('forgets an armed confirm once the panel is closed and reopened', async () => {
    useSessionsStore.getState().createSession('freeform', {})
    render(<SettingsPanel />)
    const settingsButton = screen.getByRole('button', { name: /settings/i })
    await userEvent.click(settingsButton)
    await userEvent.click(screen.getByRole('button', { name: /clear all chat history/i }))
    expect(screen.getByRole('button', { name: /click again to confirm/i })).toBeInTheDocument()

    await userEvent.keyboard('{Escape}')
    await userEvent.click(settingsButton)

    expect(screen.getByRole('button', { name: /clear all chat history/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /click again to confirm/i })).not.toBeInTheDocument()
  })
})
