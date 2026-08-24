import { useEffect } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { useThemeStore, type ThemeId } from '@/store/useThemeStore'

const THEMES: { id: ThemeId; label: string }[] = [
  { id: 'illuminated', label: 'Illuminated Manuscript' },
  { id: 'scholarly', label: 'Modern Scholarly' },
  { id: 'midnight', label: 'Midnight Study' },
  { id: 'papyrus', label: 'Papyrus Editorial' },
]

export function SettingsPanel() {
  const theme = useThemeStore((s) => s.theme)
  const setTheme = useThemeStore((s) => s.setTheme)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  return (
    <Popover.Root>
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
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
