import { useState } from 'react'
import { ArrowLeft, ArrowUp } from 'lucide-react'
import { STORY_STARTER_IDEAS } from '@/lib/storyStarterIdeas'

interface Props {
  onBack: () => void
  onSubmit: (theme: string) => void
}

/**
 * What "Tell a Story" opens to from ModePickerScreen: a few example
 * lesson/theme ideas plus a free-text box, so the user states the story's
 * theme directly instead of picking a past conversation to derive one
 * from (that picker was confusing as an entry point — see the design
 * note in docs/superpowers/specs/2026-09-23-tell-a-story-mode-design.md).
 * A chip only fills the input for the user to review/edit — it doesn't
 * submit by itself.
 */
export function StoryStarterScreen({ onBack, onSubmit }: Props) {
  const [theme, setTheme] = useState('')

  function submit() {
    const trimmed = theme.trim()
    if (!trimmed) return
    onSubmit(trimmed)
  }

  return (
    <div className="h-full flex flex-col items-center px-6 py-8 overflow-y-auto">
      <div className="w-full max-w-lg flex flex-col gap-5">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-1 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-theme-accent)] transition-colors"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back
          </button>
          <h1 className="text-lg font-semibold">What should the story be about?</h1>
        </div>

        <div className="flex flex-wrap gap-2">
          {STORY_STARTER_IDEAS.map((idea) => (
            <button
              key={idea}
              type="button"
              onClick={() => setTheme(idea)}
              className="text-sm px-3.5 py-2 rounded-full border border-[var(--color-theme-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-alt)] hover:border-[var(--color-theme-accent)] transition-colors"
            >
              {idea}
            </button>
          ))}
        </div>

        <form
          className="w-full flex items-center gap-2 rounded-2xl border border-[var(--color-theme-border)] bg-[var(--color-surface-alt)] px-4 py-3 shadow-sm focus-within:border-[var(--color-theme-accent)] transition-colors"
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <input
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
            placeholder="What should the story be about? Pick an idea above, or type your own…"
            className="flex-1 bg-transparent outline-none text-sm"
          />
          <button
            type="submit"
            aria-label="Go"
            disabled={!theme.trim()}
            className="shrink-0 w-9 h-9 flex items-center justify-center rounded-full bg-[var(--color-theme-accent)] text-[var(--color-theme-accent-contrast)] transition-opacity disabled:opacity-40"
          >
            <ArrowUp className="w-4 h-4" aria-hidden="true" />
          </button>
        </form>
      </div>
    </div>
  )
}
