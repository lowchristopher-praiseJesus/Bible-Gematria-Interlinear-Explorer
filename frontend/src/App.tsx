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

export default function App() {
  const theme = useThemeStore((s) => s.theme)
  const [sessionId, setSessionId] = useSessionIdParam()
  const sessions = useSessionsStore((s) => s.sessions)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  // Session switching (new session, select session, or a session created
  // from the mode picker) must reset artifact state together with chat
  // state — otherwise a stale artifact from the previous session lingers
  // in the panel.
  useEffect(() => {
    useArtifactStore.getState().close()
  }, [sessionId])

  const activeSession = sessionId ? sessions[sessionId] : undefined

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--color-surface)] text-[var(--color-text-primary)]">
      <div className="w-64 shrink-0 border-r border-[var(--color-theme-border)] flex flex-col">
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

      <div className="flex-1 min-w-0 border-r border-[var(--color-theme-border)]">
        <ErrorBoundary>
          {activeSession ? (
            <ChatPane sessionId={activeSession.id} />
          ) : (
            <ModePickerScreen onSessionStarted={setSessionId} />
          )}
        </ErrorBoundary>
      </div>

      <div className="w-96 shrink-0">
        <ErrorBoundary>
          <ArtifactPane />
        </ErrorBoundary>
      </div>
    </div>
  )
}
