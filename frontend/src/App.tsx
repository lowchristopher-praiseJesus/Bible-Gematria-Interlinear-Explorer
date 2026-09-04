import { useCallback, useEffect, useRef, useState } from 'react'
import { BookOpen, PanelLeft, Plus, X } from 'lucide-react'
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

// Below `lg` the Sessions list and the detail panel are modal overlays (a
// slide-in drawer and a bottom sheet); at `lg`+ they're permanent columns.
// Drives the ARIA that only makes sense for the overlay form.
function useIsCompact(): boolean {
  const [compact, setCompact] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 1023.98px)').matches
  )
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1023.98px)')
    const sync = () => setCompact(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])
  return compact
}

export default function App() {
  const theme = useThemeStore((s) => s.theme)
  const [sessionId, setSessionId] = useSessionIdParam()
  const sessions = useSessionsStore((s) => s.sessions)
  const activeArtifact = useArtifactStore((s) => s.activeArtifact)
  const activeNote = useArtifactStore((s) => s.activeNote)
  const closeArtifact = useArtifactStore((s) => s.close)

  // On mobile the Conversations list is a slide-in drawer and the detail
  // panel is a bottom sheet; on desktop (lg+) both are always-visible
  // columns and these flags are inert.
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [artifactOpen, setArtifactOpen] = useState(false)
  const compact = useIsCompact()

  const menuBtnRef = useRef<HTMLButtonElement>(null)
  const drawerRef = useRef<HTMLElement>(null)
  const sheetRef = useRef<HTMLElement>(null)
  const dragStartY = useRef<number | null>(null)

  const activeSession = sessionId ? sessions[sessionId] : undefined
  const hasDetail = !!(activeArtifact || activeNote)
  const sheetOpen = artifactOpen && hasDetail

  useEffect(() => {
    const root = document.documentElement
    root.setAttribute('data-theme', theme)
    // Keep the mobile browser chrome in step with the active reader theme.
    const surface = getComputedStyle(root).getPropertyValue('--surface').trim()
    if (surface) {
      let meta = document.querySelector('meta[name="theme-color"]')
      if (!meta) {
        meta = document.createElement('meta')
        meta.setAttribute('name', 'theme-color')
        document.head.appendChild(meta)
      }
      meta.setAttribute('content', surface)
    }
  }, [theme])

  // Session switching (new session, select session, or a session created
  // from the mode picker) must reset artifact state together with chat
  // state — otherwise a stale artifact from the previous session lingers
  // in the panel — and it dismisses the mobile drawer / sheet so the user
  // lands on the freshly selected conversation.
  useEffect(() => {
    const artifact = useArtifactStore.getState()
    if (!artifact.activeNote || artifact.activeNote.sessionId !== sessionId) {
      artifact.close()
    }
    setArtifactOpen(false)
    setDrawerOpen(false)
  }, [sessionId])

  // Opening an artifact/note link brings the detail sheet forward on
  // mobile (a no-op at lg+, where it's already a visible column).
  useEffect(() => {
    if (hasDetail) setArtifactOpen(true)
  }, [hasDetail])

  const closeSheet = useCallback(() => {
    closeArtifact()
    setArtifactOpen(false)
  }, [closeArtifact])

  // Escape dismisses whichever mobile overlay is open.
  useEffect(() => {
    if (!drawerOpen && !sheetOpen) return
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      if (drawerOpen) setDrawerOpen(false)
      else closeSheet()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [drawerOpen, sheetOpen, closeSheet])

  // Move focus into the drawer when it opens; hand it back to the trigger
  // when it closes, but only if focus is still stranded inside the drawer.
  // Only relevant while it's a modal overlay (compact widths).
  useEffect(() => {
    if (!compact) return
    if (drawerOpen) {
      drawerRef.current?.querySelector<HTMLElement>('button, a[href], input')?.focus()
    } else if (drawerRef.current?.contains(document.activeElement)) {
      menuBtnRef.current?.focus()
    }
  }, [drawerOpen, compact])

  useEffect(() => {
    if (sheetOpen) {
      if (compact) sheetRef.current?.querySelector<HTMLElement>('button')?.focus()
    } else if (sheetRef.current) {
      // Clear any leftover drag offset once the sheet is off-screen.
      sheetRef.current.style.transform = ''
      sheetRef.current.style.transition = ''
    }
  }, [sheetOpen, compact])

  function startNewChat() {
    setSessionId(null)
    setDrawerOpen(false)
  }

  // Drag the grab handle down to dismiss the bottom sheet.
  function onGrabStart(e: React.PointerEvent<HTMLDivElement>) {
    if (!sheetRef.current) return
    dragStartY.current = e.clientY
    e.currentTarget.setPointerCapture(e.pointerId)
    sheetRef.current.style.transition = 'none'
  }
  function onGrabMove(e: React.PointerEvent<HTMLDivElement>) {
    if (dragStartY.current === null || !sheetRef.current) return
    const dy = Math.max(0, e.clientY - dragStartY.current)
    sheetRef.current.style.transform = dy ? `translateY(${dy}px)` : ''
  }
  function onGrabEnd(e: React.PointerEvent<HTMLDivElement>) {
    if (dragStartY.current === null || !sheetRef.current) return
    const dy = Math.max(0, e.clientY - dragStartY.current)
    dragStartY.current = null
    sheetRef.current.style.transition = ''
    if (dy > 96) closeSheet()
    else sheetRef.current.style.transform = ''
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-[var(--color-surface)] text-[var(--color-text-primary)]">
      {/* Mobile top bar — replaces the old bottom Sessions/Chat/Artifact tabs */}
      <header className="flex shrink-0 items-center gap-1 border-b border-[var(--color-theme-border)] px-1 py-1 pt-[max(0.25rem,env(safe-area-inset-top))] lg:hidden">
        <button
          ref={menuBtnRef}
          type="button"
          onClick={() => setDrawerOpen(true)}
          aria-label="Conversations"
          aria-expanded={drawerOpen}
          aria-controls="conversations-drawer"
          className="flex h-11 w-11 items-center justify-center rounded-md text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-alt)] hover:text-[var(--color-text-primary)]"
        >
          <PanelLeft className="h-5 w-5" aria-hidden="true" />
        </button>
        <span className="min-w-0 flex-1 truncate text-center text-sm font-semibold">
          {activeSession ? activeSession.title : 'Bible Explorer'}
        </span>
        <button
          type="button"
          onClick={startNewChat}
          aria-label="New chat"
          className="flex h-11 shrink-0 items-center gap-1 rounded-md px-2.5 text-sm font-medium text-[var(--color-theme-accent)] transition-colors hover:bg-[var(--color-surface-alt)]"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          New
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Sessions — desktop sidebar / mobile slide-in drawer */}
        <nav
          ref={drawerRef}
          id="conversations-drawer"
          aria-label="Conversations"
          role={compact ? 'dialog' : undefined}
          aria-modal={compact && drawerOpen ? true : undefined}
          aria-hidden={compact && !drawerOpen ? true : undefined}
          inert={compact && !drawerOpen}
          data-state={drawerOpen ? 'open' : 'closed'}
          className={`fixed inset-y-0 left-0 z-40 flex w-[85%] max-w-xs flex-col border-r border-[var(--color-theme-border)] bg-[var(--color-surface)] shadow-xl transition-transform duration-200 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] ${
            drawerOpen ? 'translate-x-0' : '-translate-x-full'
          } lg:static lg:z-auto lg:w-64 lg:max-w-none lg:shrink-0 lg:translate-none lg:pt-0 lg:pb-0 lg:shadow-none lg:transition-none`}
        >
          <div className="flex items-center justify-between border-b border-[var(--color-theme-border)] px-3 py-2">
            <span className="flex items-center gap-1.5 text-sm font-semibold">
              <BookOpen className="h-4 w-4 text-[var(--color-theme-accent)]" aria-hidden="true" />
              Bible Explorer
            </span>
            <div className="flex items-center gap-1">
              <SettingsPanel />
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close conversations"
                className="flex h-9 w-9 items-center justify-center rounded-md text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-alt)] hover:text-[var(--color-text-primary)] lg:hidden"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>
          <div className="min-h-0 flex-1">
            <ErrorBoundary>
              <SessionsPane
                activeSessionId={sessionId}
                onSelectSession={(id) => {
                  setSessionId(id)
                  setDrawerOpen(false)
                }}
                onNewSession={startNewChat}
              />
            </ErrorBoundary>
          </div>
        </nav>

        {/* Chat — always the primary surface */}
        <div className="min-w-0 flex-1 border-r border-[var(--color-theme-border)]">
          <ErrorBoundary>
            {activeSession ? (
              <ChatPane sessionId={activeSession.id} />
            ) : (
              <ModePickerScreen onSessionStarted={setSessionId} />
            )}
          </ErrorBoundary>
        </div>

        {/* Detail — desktop column / mobile bottom sheet */}
        <aside
          ref={sheetRef}
          aria-label="Scripture details"
          role={compact ? 'dialog' : undefined}
          aria-modal={compact && sheetOpen ? true : undefined}
          aria-hidden={compact && !sheetOpen ? true : undefined}
          inert={compact && !sheetOpen}
          data-state={sheetOpen ? 'open' : 'closed'}
          className={`fixed inset-x-0 bottom-0 z-40 flex h-[85dvh] flex-col rounded-t-2xl border-t border-[var(--color-theme-border)] bg-[var(--color-surface)] shadow-2xl transition-transform duration-200 ${
            sheetOpen ? 'translate-y-0' : 'translate-y-full'
          } lg:static lg:z-auto lg:h-auto lg:w-96 lg:shrink-0 lg:translate-none lg:rounded-none lg:border-t-0 lg:shadow-none lg:transition-none ${
            hasDetail ? 'lg:flex' : 'lg:hidden'
          }`}
        >
          <div
            className="flex shrink-0 touch-none cursor-grab justify-center pt-3 pb-2 active:cursor-grabbing lg:hidden"
            onPointerDown={onGrabStart}
            onPointerMove={onGrabMove}
            onPointerUp={onGrabEnd}
            onPointerCancel={onGrabEnd}
            aria-hidden="true"
          >
            <span className="h-1.5 w-10 rounded-full bg-[var(--color-theme-border)]" />
          </div>
          <div className="min-h-0 flex-1 pb-[env(safe-area-inset-bottom)] lg:h-full lg:pb-0">
            <ErrorBoundary>
              <ArtifactPane onClose={closeSheet} />
            </ErrorBoundary>
          </div>
        </aside>
      </div>

      {compact && drawerOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
          aria-hidden="true"
          onClick={() => setDrawerOpen(false)}
        />
      )}
      {compact && sheetOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
          aria-hidden="true"
          onClick={closeSheet}
        />
      )}
    </div>
  )
}
