import { useEffect, useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { useThemeStore, type ThemeId } from '@/store/useThemeStore'
import { useSessionsStore } from '@/store/useSessionsStore'
import { useArtifactStore } from '@/store/useArtifactStore'

const THEMES: { id: ThemeId; label: string }[] = [
  { id: 'illuminated', label: 'Illuminated Manuscript' },
  { id: 'scholarly', label: 'Modern Scholarly' },
  { id: 'midnight', label: 'Midnight Study' },
  { id: 'papyrus', label: 'Papyrus Editorial' },
]

export function SettingsPanel() {
  const theme = useThemeStore((s) => s.theme)
  const setTheme = useThemeStore((s) => s.setTheme)
  const clearAllSessions = useSessionsStore((s) => s.clearAllSessions)
  const hasSessions = useSessionsStore((s) => Object.keys(s.sessions).length > 0)
  // Wiping every chat is irreversible and far more destructive than
  // deleting one, so it gets a confirm step the single-session delete
  // doesn't have — armed by the first click, only the second actually
  // clears anything.
  const [confirmingClear, setConfirmingClear] = useState(false)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  function handleClearClick() {
    if (!confirmingClear) {
      setConfirmingClear(true)
      return
    }
    clearAllSessions()
    useArtifactStore.getState().close()
    setConfirmingClear(false)
  }

  return (
    <Popover.Root onOpenChange={(open) => !open && setConfirmingClear(false)}>
      <Popover.Trigger asChild>
        <button aria-label="Settings" className="text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]">
          ⚙︎
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="bg-[var(--color-surface)] border border-[var(--color-theme-border)] rounded-lg shadow-lg p-2 flex flex-col gap-1 w-56"
          sideOffset={6}
        >
          <div className="text-xs font-medium text-[var(--color-text-secondary)] px-2 py-1">Theme</div>
          {THEMES.map((t) => (
            <button
              key={t.id}
              onClick={() => setTheme(t.id)}
              className={`text-left text-sm px-2 py-1.5 rounded ${
                theme === t.id
                  ? 'bg-[var(--color-theme-accent)] text-[var(--color-theme-accent-contrast)]'
                  : 'text-[var(--color-text-primary)] hover:bg-[var(--color-surface-alt)]'
              }`}
            >
              {t.label}
            </button>
          ))}

          <div className="mt-1 pt-1 border-t border-[var(--color-theme-border)] flex flex-col gap-1">
            <button
              onClick={handleClearClick}
              disabled={!hasSessions}
              className="text-left text-sm px-2 py-1.5 rounded text-red-600 hover:bg-[var(--color-surface-alt)] disabled:opacity-40 disabled:hover:bg-transparent"
            >
              {confirmingClear ? 'Click again to confirm' : 'Clear all chat history'}
            </button>
            {confirmingClear && (
              <button
                onClick={() => setConfirmingClear(false)}
                className="text-left text-xs px-2 py-1 rounded text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-alt)]"
              >
                Cancel
              </button>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
