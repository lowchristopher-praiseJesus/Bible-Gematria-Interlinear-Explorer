import { Loader2 } from 'lucide-react'

export interface StoryTheme {
  id: string
  label: string
  description: string
}

export type StoryAgeRange = '3-6' | '7-8' | '9-10'

const AGE_RANGES: { value: StoryAgeRange; label: string }[] = [
  { value: '3-6', label: 'Ages 3-6' },
  { value: '7-8', label: 'Ages 7-8' },
  { value: '9-10', label: 'Ages 9-10' },
]

interface Props {
  themes: StoryTheme[]
  selectedIds: string[]
  ageRange: StoryAgeRange
  onToggleTheme: (id: string) => void
  onChangeAgeRange: (age: StoryAgeRange) => void
  onSubmit: () => void
  submitting: boolean
}

/**
 * The Tell a Story mode's theme + age picker, shown until a story has been
 * generated — ChatPane stops rendering it once one exists (regenerating
 * from here was removed: its "Try again" button worked, but never
 * scrolled the new story into view, so a regeneration routinely landed
 * off-screen and looked broken). Fully controlled — the caller (ChatPane)
 * owns the current selection in session.modeParams, the same source of
 * truth every other mode's options already use.
 */
export function ThemePicker({
  themes, selectedIds, ageRange, onToggleTheme, onChangeAgeRange, onSubmit, submitting,
}: Props) {
  return (
    <div className="mt-2 flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        {themes.map((theme) => {
          const checked = selectedIds.includes(theme.id)
          return (
            <label
              key={theme.id}
              className="flex items-start gap-2 text-sm rounded-xl border border-[var(--color-theme-border)] px-3 py-2 cursor-pointer hover:bg-[var(--color-surface-alt)]"
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => onToggleTheme(theme.id)}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium">{theme.label}</span>
                {theme.description && (
                  <span className="block text-xs text-[var(--color-text-secondary)]">{theme.description}</span>
                )}
              </span>
            </label>
          )
        })}
      </div>
      <div className="flex flex-wrap gap-2">
        {AGE_RANGES.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChangeAgeRange(option.value)}
            aria-pressed={ageRange === option.value}
            className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
              ageRange === option.value
                ? 'border-[var(--color-theme-accent)] bg-[var(--color-theme-accent)] text-[var(--color-theme-accent-contrast)]'
                : 'border-[var(--color-theme-border)] hover:bg-[var(--color-surface-alt)]'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={onSubmit}
        disabled={submitting || selectedIds.length === 0}
        className="self-start inline-flex items-center gap-2 text-sm px-3.5 py-2 rounded-full bg-[var(--color-theme-accent)] text-[var(--color-theme-accent-contrast)] disabled:opacity-50"
      >
        {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />}
        Make my story
      </button>
    </div>
  )
}
