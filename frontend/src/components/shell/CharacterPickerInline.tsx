import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { listCharacters, type CharacterEntry } from '@/lib/modeData'

interface Props {
  onPick: (character: CharacterEntry) => void
}

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; characters: CharacterEntry[] }

const TESTAMENTS: { key: CharacterEntry['testament']; label: string }[] = [
  { key: 'OT', label: 'Old Testament' },
  { key: 'NT', label: 'New Testament' },
]

/**
 * Chat with a Character's opening step — pick a character — rendered
 * inline as part of the mode's first assistant message in ChatPane, rather
 * than as a separate pre-chat screen. Every mode now starts its session
 * immediately on tile click, matching Devotional. No search box of its
 * own: the compose box below already resolves a typed name against this
 * same roster (see ChatPane's resolveCharacterByName), so this just lists
 * everyone to click through or scan.
 */
export function CharacterPickerInline({ onPick }: Props) {
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    listCharacters().then(
      (characters) => {
        if (!cancelled) setState({ status: 'ready', characters })
      },
      (err) => {
        if (!cancelled) setState({ status: 'error', message: err instanceof Error ? err.message : String(err) })
      }
    )
    return () => {
      cancelled = true
    }
  }, [attempt])

  function retry() {
    setState({ status: 'loading' })
    setAttempt((n) => n + 1)
  }

  const characters = state.status === 'ready' ? state.characters : []

  return (
    <div className="mt-2 flex flex-col gap-3">
      {state.status === 'loading' && (
        <p className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading characters…
        </p>
      )}

      {state.status === 'error' && (
        <div className="flex flex-col items-start gap-2 text-sm">
          <p>Could not load the characters: {state.message}</p>
          <button
            type="button"
            onClick={retry}
            className="px-3 py-1.5 rounded-full border border-[var(--color-theme-border)] hover:border-[var(--color-theme-accent)] transition-colors"
          >
            Retry
          </button>
        </div>
      )}

      {TESTAMENTS.map(({ key, label }) => {
        const group = characters.filter((c) => c.testament === key)
        if (group.length === 0) return null
        return (
          <section key={key} aria-label={label} className="flex flex-col gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">{label}</h2>
            <div className="flex flex-col gap-2">
              {group.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onPick(c)}
                  className="text-left rounded-xl border border-[var(--color-theme-border)] bg-[var(--color-surface)] px-4 py-2.5 hover:bg-[var(--color-surface-alt)] hover:border-[var(--color-theme-accent)] transition-colors"
                >
                  <span className="block text-sm font-medium">{c.name}</span>
                  <span className="block text-xs text-[var(--color-text-secondary)] line-clamp-2">{c.summary}</span>
                </button>
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}
