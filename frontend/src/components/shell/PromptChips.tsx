interface Props {
  prompts: string[]
  onPick: (text: string) => void
  /** When true, every chip is non-interactive — used while a response
   * is already in flight. */
  disabled?: boolean
  /** Optional caption shown above the row (e.g. "Try asking…"). */
  label?: string
}

/** A row of clickable prompt suggestions. Used both for a mode's opening
 * starters (so a fresh chat isn't a blank input) and for the backend's
 * per-response follow-up questions. Picking one sends it immediately,
 * matching the choice-pill behaviour elsewhere in the chat. */
export function PromptChips({ prompts, onPick, disabled, label }: Props) {
  if (prompts.length === 0) return null
  return (
    <div className="mt-2 flex flex-col gap-1.5">
      {label && <span className="text-xs text-[var(--color-text-secondary)]">{label}</span>}
      <div className="flex flex-wrap gap-2">
        {prompts.map((prompt, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onPick(prompt)}
            disabled={disabled}
            className="text-sm px-3.5 py-2 rounded-full border border-[var(--color-theme-border)] bg-[var(--color-surface)] text-left transition-colors hover:bg-[var(--color-surface-alt)] hover:border-[var(--color-theme-accent)] disabled:opacity-40"
          >
            {prompt}
          </button>
        ))}
      </div>
    </div>
  )
}
