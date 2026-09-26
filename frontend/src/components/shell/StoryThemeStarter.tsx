import { STORY_STARTER_IDEAS } from '@/lib/storyStarterIdeas'

interface Props {
  onPick: (theme: string) => void
}

/**
 * Tell a Story's opening step — pick a theme — rendered inline as part of
 * the mode's first assistant message in ChatPane (like ThemePicker is for
 * the age/theme-confirmation step that follows it), rather than as a
 * separate pre-chat screen. Only the example chips live here; typing a
 * custom theme instead uses ChatPane's own compose box at the bottom
 * (intercepted by sendMessage while no theme has been picked yet) so the
 * mode never shows two text inputs at once.
 */
export function StoryThemeStarter({ onPick }: Props) {
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {STORY_STARTER_IDEAS.map((idea) => (
        <button
          key={idea}
          type="button"
          onClick={() => onPick(idea)}
          className="text-sm px-3.5 py-2 rounded-full border border-[var(--color-theme-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-alt)] hover:border-[var(--color-theme-accent)] transition-colors"
        >
          {idea}
        </button>
      ))}
    </div>
  )
}
