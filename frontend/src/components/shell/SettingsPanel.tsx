import { useEffect, useState, type ReactNode } from 'react'
import { CalendarDays, Check, RotateCcw, Settings, Trash2, X } from 'lucide-react'
import * as Dialog from '@radix-ui/react-dialog'
import { cn } from '@/lib/utils'
import { useThemeStore, type ThemeId } from '@/store/useThemeStore'
import { useSessionsStore } from '@/store/useSessionsStore'
import { useArtifactStore } from '@/store/useArtifactStore'
import { useReadingPlanStore, type ReadingPlanProgress } from '@/store/useReadingPlanStore'

// `swatch` mirrors the surface / accent / text tokens each theme sets in
// index.css — it exists only so a card can preview itself. Keep the three
// colours in step if those tokens ever change.
type Theme = {
  id: ThemeId
  label: string
  blurb: string
  swatch: { bg: string; accent: string; text: string }
}

const THEMES: Theme[] = [
  {
    id: 'illuminated',
    label: 'Illuminated Manuscript',
    blurb: 'Warm parchment, rubric red',
    swatch: { bg: '#faf3e6', accent: '#5a1f2e', text: '#4a3520' },
  },
  {
    id: 'scholarly',
    label: 'Modern Scholarly',
    blurb: 'Clean white, indigo accent',
    swatch: { bg: '#ffffff', accent: '#4338ca', text: '#1e293b' },
  },
  {
    id: 'midnight',
    label: 'Midnight Study',
    blurb: 'Dark slate, candlelit gold',
    swatch: { bg: '#1a1a2e', accent: '#e8c874', text: '#d8d8e8' },
  },
  {
    id: 'papyrus',
    label: 'Papyrus Editorial',
    blurb: 'Soft ivory, terracotta',
    swatch: { bg: '#fdfbf7', accent: '#a34a2f', text: '#2d2926' },
  },
]

const PLANS: { id: ReadingPlanProgress['plan']; label: string }[] = [
  { id: 'chronological', label: 'Chronological' },
  { id: 'canonical', label: 'Canonical (book order)' },
]

// The destructive-ish actions in here (wiping chats, switching plan,
// restarting the day count) all discard something the user can't get
// back, so each is armed by a first click and only acts on the second.
// Only one can be armed at a time.
type Pending = { kind: 'clear' } | { kind: 'plan'; plan: ReadingPlanProgress['plan'] } | { kind: 'reset' } | null

export function SettingsPanel() {
  const theme = useThemeStore((s) => s.theme)
  const setTheme = useThemeStore((s) => s.setTheme)
  const clearAllSessions = useSessionsStore((s) => s.clearAllSessions)
  const hasSessions = useSessionsStore((s) => Object.keys(s.sessions).length > 0)
  const readingPlan = useReadingPlanStore((s) => s.progress)
  const switchPlan = useReadingPlanStore((s) => s.switchPlan)
  const restartDayCount = useReadingPlanStore((s) => s.restartDayCount)
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState<Pending>(null)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (!next) setPending(null)
  }

  function handleClearClick() {
    if (pending?.kind !== 'clear') {
      setPending({ kind: 'clear' })
      return
    }
    clearAllSessions()
    useArtifactStore.getState().close()
    setPending(null)
  }

  function handlePlanClick(plan: ReadingPlanProgress['plan']) {
    if (plan === readingPlan?.plan) return
    if (pending?.kind !== 'plan' || pending.plan !== plan) {
      setPending({ kind: 'plan', plan })
      return
    }
    switchPlan(plan)
    setPending(null)
  }

  function handleResetClick() {
    if (pending?.kind !== 'reset') {
      setPending({ kind: 'reset' })
      return
    }
    restartDayCount()
    setPending(null)
  }

  const planPending = pending?.kind === 'plan' || pending?.kind === 'reset'

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Trigger asChild>
        <button
          aria-label="Settings"
          className="flex h-9 w-9 items-center justify-center rounded-md text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-alt)] hover:text-[var(--color-text-primary)]"
        >
          <Settings className="h-4 w-4" aria-hidden="true" />
        </button>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="settings-overlay fixed inset-0 z-50 bg-black/45 backdrop-blur-[1px]" />
        <Dialog.Content
          aria-describedby={undefined}
          onCloseAutoFocus={(e) => e.preventDefault()}
          className={cn(
            'settings-panel fixed z-50 flex flex-col border border-[var(--color-theme-border)]',
            'bg-[var(--color-surface)] text-[var(--color-text-primary)] shadow-2xl focus:outline-none',
            // Mobile: a bottom sheet flush to the edges.
            'inset-x-0 bottom-0 max-h-[88dvh] rounded-t-2xl',
            // sm+: a centred card.
            'sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-[27rem] sm:max-h-[min(85dvh,42rem)]',
            'sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl',
          )}
        >
          {/* Drag affordance — mirrors the scripture sheet, mobile only. */}
          <div className="flex shrink-0 justify-center pt-3 pb-1 sm:hidden" aria-hidden="true">
            <span className="h-1.5 w-10 rounded-full bg-[var(--color-theme-border)]" />
          </div>

          <div className="flex shrink-0 items-center justify-between gap-3 px-5 pb-3 pt-2 sm:pt-5">
            <Dialog.Title className="text-base font-semibold tracking-tight">Settings</Dialog.Title>
            <Dialog.Close asChild>
              <button
                aria-label="Close settings"
                className="-mr-1.5 flex h-9 w-9 items-center justify-center rounded-lg text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-alt)] hover:text-[var(--color-text-primary)]"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </Dialog.Close>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:pb-6">
            <div className="flex flex-col gap-7">
              {/* ── Appearance ─────────────────────────────────────────── */}
              <section className="flex flex-col gap-3">
                <SectionLabel>Appearance</SectionLabel>
                <div className="grid grid-cols-2 gap-2.5">
                  {THEMES.map((t) => {
                    const active = theme === t.id
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setTheme(t.id)}
                        aria-pressed={active}
                        className={cn(
                          'group relative flex flex-col gap-2 rounded-xl border p-2.5 text-left transition-colors',
                          active
                            ? 'border-[var(--color-theme-accent)] ring-1 ring-[var(--color-theme-accent)]'
                            : 'border-[var(--color-theme-border)] hover:border-[var(--color-text-secondary)]',
                        )}
                      >
                        <span
                          className="flex h-14 w-full flex-col justify-between overflow-hidden rounded-lg border border-black/5 p-2"
                          style={{ background: t.swatch.bg }}
                          aria-hidden="true"
                        >
                          <span className="h-1.5 w-9 rounded-full" style={{ background: t.swatch.accent }} />
                          <span className="flex flex-col gap-1">
                            <span
                              className="h-1 w-full rounded-full opacity-25"
                              style={{ background: t.swatch.text }}
                            />
                            <span
                              className="h-1 w-2/3 rounded-full opacity-25"
                              style={{ background: t.swatch.text }}
                            />
                          </span>
                        </span>
                        <span className="flex items-start justify-between gap-1.5">
                          <span className="flex min-w-0 flex-col">
                            <span className="text-[13px] font-medium leading-tight">{t.label}</span>
                            <span className="mt-0.5 text-[11px] leading-tight text-[var(--color-text-secondary)]">
                              {t.blurb}
                            </span>
                          </span>
                          {active && (
                            <span className="mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[var(--color-theme-accent)] text-[var(--color-theme-accent-contrast)]">
                              <Check className="h-3 w-3" aria-hidden="true" />
                            </span>
                          )}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </section>

              {/* ── Bible in a Year ────────────────────────────────────── */}
              {readingPlan && (
                <section className="flex flex-col gap-3">
                  <SectionLabel icon={<CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />}>
                    Bible in a Year
                  </SectionLabel>
                  <div className="overflow-hidden rounded-xl border border-[var(--color-theme-border)]">
                    {PLANS.map((p, i) => {
                      const armed = pending?.kind === 'plan' && pending.plan === p.id
                      const active = readingPlan.plan === p.id
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => handlePlanClick(p.id)}
                          aria-pressed={active}
                          className={cn(
                            'flex min-h-11 w-full items-center justify-between gap-2 px-3.5 py-2.5 text-left text-sm transition-colors',
                            i > 0 && 'border-t border-[var(--color-theme-border)]',
                            armed
                              ? 'bg-[var(--color-danger)]/10 font-medium text-[var(--color-danger)]'
                              : active
                                ? 'bg-[var(--color-theme-accent)]/10 font-medium text-[var(--color-theme-accent)]'
                                : 'hover:bg-[var(--color-surface-alt)]',
                          )}
                        >
                          <span>{armed ? 'Click again to confirm' : p.label}</span>
                          {active && !armed && <Check className="h-4 w-4 shrink-0" aria-hidden="true" />}
                        </button>
                      )
                    })}
                  </div>
                  {pending?.kind === 'plan' && (
                    <p className="-mt-1 text-xs leading-relaxed text-[var(--color-text-secondary)]">
                      Switching plan restarts your progress at Day 1.
                    </p>
                  )}
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={handleResetClick}
                      className={cn(
                        'inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-sm transition-colors',
                        pending?.kind === 'reset'
                          ? 'bg-[var(--color-danger)]/10 font-medium text-[var(--color-danger)]'
                          : 'text-[var(--color-text-primary)] hover:bg-[var(--color-surface-alt)]',
                      )}
                    >
                      <RotateCcw className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      {pending?.kind === 'reset' ? 'Click again to confirm' : 'Reset to Day 1'}
                    </button>
                    {planPending && (
                      <button
                        type="button"
                        onClick={() => setPending(null)}
                        className="min-h-11 rounded-lg px-3 text-sm text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-alt)]"
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </section>
              )}

              {/* ── Data ───────────────────────────────────────────────── */}
              <section className="flex flex-col gap-2">
                <SectionLabel>Data</SectionLabel>
                <div className="rounded-xl border border-[var(--color-theme-border)] p-1">
                  <button
                    type="button"
                    onClick={handleClearClick}
                    disabled={!hasSessions}
                    className={cn(
                      'flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-sm transition-colors',
                      'text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10',
                      'disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent',
                    )}
                  >
                    <Trash2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                    {pending?.kind === 'clear' ? 'Click again to confirm' : 'Clear all chat history'}
                  </button>
                  {pending?.kind === 'clear' && (
                    <button
                      type="button"
                      onClick={() => setPending(null)}
                      className="mt-0.5 flex min-h-9 w-full items-center rounded-lg px-3 text-left text-xs text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-alt)]"
                    >
                      Cancel
                    </button>
                  )}
                </div>
                <p className="text-xs leading-relaxed text-[var(--color-text-secondary)]">
                  Conversations live only in this browser. Clearing removes every one and can&apos;t be undone.
                </p>
              </section>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function SectionLabel({ children, icon }: { children: ReactNode; icon?: ReactNode }) {
  return (
    <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-secondary)]">
      {icon}
      {children}
    </h3>
  )
}
