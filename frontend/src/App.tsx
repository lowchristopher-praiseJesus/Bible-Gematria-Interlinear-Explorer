import { useEffect, useState } from 'react'
import { ModePickerScreen } from '@/components/shell/ModePickerScreen'
import { ChatPane } from '@/components/shell/ChatPane'
import { ArtifactPane } from '@/components/shell/ArtifactPane'
import { SessionsPane } from '@/components/shell/SessionsPane'
import { SettingsPanel } from '@/components/shell/SettingsPanel'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { useSessionsStore } from '@/store/useSessionsStore'
import { useThemeStore } from '@/store/useThemeStore'
import { useArtifactStore } from '@/store/useArtifactStore'

function useSessionIdParam(): [string | null, (id: string | null) => void] {
  const [sessionId, setSessionIdState] = useState<string | null>(() =>
    new URLSearchParams(window.location.search).get('session')
  )

  function setSessionId(id: string | null) {
    const url = new URL(window.location.href)
    if (id) url.searchParams.set('session', id)
    else url.searchParams.delete('session')
    window.history.pushState({}, '', url)
    setSessionIdState(id)
  }

  return [sessionId, setSessionId]
}

type Pane = 'sessions' | 'chat' | 'artifact'

const PANE_TABS: { id: Pane; label: string }[] = [
  { id: 'sessions', label: 'Sessions' },
  { id: 'chat', label: 'Chat' },
  { id: 'artifact', label: 'Artifact' },
]

export default function App() {
  const theme = useThemeStore((s) => s.theme)
  const [sessionId, setSessionId] = useSessionIdParam()
  const sessions = useSessionsStore((s) => s.sessions)
  const activeArtifact = useArtifactStore((s) => s.activeArtifact)
  const [activePane, setActivePane] = useState<Pane>('chat')

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  // Session switching (new session, select session, or a session created
  // from the mode picker) must reset artifact state together with chat
  // state — otherwise a stale artifact from the previous session lingers
  // in the panel. On narrow viewports it also brings the chat pane
  // forward, since that's where the just-started/selected session lives.
  useEffect(() => {
    useArtifactStore.getState().close()
    setActivePane('chat')
  }, [sessionId])

  // On narrow viewports, opening an artifact link should bring the
  // artifact pane forward automatically rather than leaving the user to
  // find the tab themselves — this is a no-op at the lg+ breakpoint,
  // where all three panes are already visible.
  useEffect(() => {
    if (activeArtifact) setActivePane('artifact')
  }, [activeArtifact])

  const activeSession = sessionId ? sessions[sessionId] : undefined

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-[var(--color-surface)] text-[var(--color-text-primary)]">
      <div className="flex flex-1 min-h-0">
        <div
          className={`w-full lg:w-64 shrink-0 border-r border-[var(--color-theme-border)] flex-col ${activePane === 'sessions' ? 'flex' : 'hidden'} lg:flex`}
        >
          <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--color-theme-border)]">
            <span className="font-semibold text-sm">Bible Explorer</span>
            <SettingsPanel />
          </div>
          <div className="flex-1 min-h-0">
            <ErrorBoundary>
              <SessionsPane
                activeSessionId={sessionId}
                onSelectSession={setSessionId}
                onNewSession={() => setSessionId(null)}
              />
            </ErrorBoundary>
          </div>
        </div>

        <div
          className={`w-full lg:flex-1 lg:min-w-0 border-r border-[var(--color-theme-border)] ${activePane === 'chat' ? 'block' : 'hidden'} lg:block`}
        >
          <ErrorBoundary>
            {activeSession ? (
              <ChatPane sessionId={activeSession.id} />
            ) : (
              <ModePickerScreen onSessionStarted={setSessionId} />
            )}
          </ErrorBoundary>
        </div>

        <div className={`w-full lg:w-96 shrink-0 ${activePane === 'artifact' ? 'block' : 'hidden'} lg:block`}>
          <ErrorBoundary>
            <ArtifactPane />
          </ErrorBoundary>
        </div>
      </div>

      <nav className="lg:hidden flex shrink-0 border-t border-[var(--color-theme-border)]">
        {PANE_TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActivePane(tab.id)}
            aria-current={activePane === tab.id ? 'true' : undefined}
            className={`flex-1 py-2.5 text-sm ${
              activePane === tab.id
                ? 'text-[var(--color-theme-accent)] font-medium border-t-2 border-[var(--color-theme-accent)]'
                : 'text-[var(--color-text-secondary)] border-t-2 border-transparent'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </nav>
    </div>
  )
}
