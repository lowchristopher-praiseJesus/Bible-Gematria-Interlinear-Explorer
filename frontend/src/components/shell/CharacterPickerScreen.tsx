import { useEffect, useState } from 'react'
import { ArrowLeft, Loader2, Search } from 'lucide-react'
import { listCharacters, type CharacterEntry } from '@/lib/modeData'

interface Props {
  onPick: (character: CharacterEntry) => void
  onBack: () => void
}

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; characters: CharacterEntry[] }

const TESTAMENTS: { key: CharacterEntry['testament']; label: string }[] = [
  { key: 'OT', label: 'Old Testament' },
  { key: 'NT', label: 'New Testament' },
]

export function CharacterPickerScreen({ onPick, onBack }: Props) {
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [query, setQuery] = useState('')
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

  const needle = query.trim().toLowerCase()
  const visible =
    state.status === 'ready' ? state.characters.filter((c) => c.name.toLowerCase().includes(needle)) : []

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
          <h1 className="text-lg font-semibold">Chat with a Character</h1>
        </div>

        <label className="flex items-center gap-2 rounded-2xl border border-[var(--color-theme-border)] bg-[var(--color-surface-alt)] px-4 py-2.5 focus-within:border-[var(--color-theme-accent)] transition-colors">
          <Search className="h-4 w-4 shrink-0 text-[var(--color-text-secondary)]" aria-hidden="true" />
          <input
            type="search"
            aria-label="Search characters"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name…"
            className="flex-1 bg-transparent outline-none text-sm"
          />
        </label>

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

        {state.status === 'ready' && visible.length === 0 && (
          <p className="text-sm text-[var(--color-text-secondary)]">No characters match “{query.trim()}”.</p>
        )}

        {TESTAMENTS.map(({ key, label }) => {
          const group = visible.filter((c) => c.testament === key)
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
    </div>
  )
}
