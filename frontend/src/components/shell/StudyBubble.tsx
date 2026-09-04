import { useArtifactStore } from '@/store/useArtifactStore'

/** The deterministic "commentary"/"study" route (chatbot/router.py →
 * fetch_scripture_study) returns, per verse, the original-language text plus
 * a word-by-word breakdown (gloss, lemma, morphology, Strong's) drawn from
 * the TBTA / Macula datasets. This renders that as a compact interlinear so
 * a "Here is the commentary for X" reply isn't just a bare sentence. */

interface StudyWord {
  position?: number
  text?: string
  lemma?: string
  translation?: { gloss?: string }
  morphology?: { morph?: string; class?: string }
  lexical?: { strong?: string }
}

interface StudyCommentary {
  text?: string
  language?: string
  words?: StudyWord[]
  note?: string
}

interface StudyVerse {
  reference?: string
  display_reference?: string
  commentary?: StudyCommentary
  note?: string
}

interface Props {
  data: { verses?: StudyVerse[] }
}

function strongsId(raw: string | undefined, language: string | undefined): string | null {
  const digits = (raw ?? '').replace(/\D/g, '')
  if (!digits) return null
  const prefix = language === 'hbo' ? 'H' : language === 'grc' ? 'G' : /^[hH]/.test(raw ?? '') ? 'H' : 'G'
  return `${prefix}${digits}`
}

export function StudyBubble({ data }: Props) {
  const openArtifact = useArtifactStore((s) => s.openArtifact)
  const verses = data.verses ?? []
  if (verses.length === 0) return null

  return (
    <div className="mt-1 flex flex-col gap-3 text-sm">
      {verses.map((v, i) => {
        const commentary = v.commentary
        const language = commentary?.language
        const rtl = language === 'hbo'
        const scriptStyle = {
          fontFamily: rtl ? 'var(--font-hebrew)' : 'var(--font-greek)',
          direction: rtl ? ('rtl' as const) : ('ltr' as const),
        }
        const words = commentary?.words ?? []

        return (
          <div key={v.reference ?? i} className="rounded-lg border border-[var(--color-theme-border)] p-2">
            <div className="text-xs font-semibold">{v.display_reference ?? v.reference}</div>

            {commentary?.text && (
              <div className="mt-1 text-base leading-relaxed" style={scriptStyle}>
                {commentary.text}
              </div>
            )}

            {words.length > 0 ? (
              <div className="mt-2 flex flex-col divide-y divide-[var(--color-theme-border)]">
                {words.map((w, j) => {
                  const sid = strongsId(w.lexical?.strong, language)
                  const gloss = w.translation?.gloss
                  return (
                    <div key={w.position ?? j} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 py-1">
                      <span className="text-sm" style={scriptStyle}>
                        {w.text}
                      </span>
                      {gloss && gloss !== '-' && <span className="text-[var(--color-text-primary)]">{gloss}</span>}
                      {w.lemma && w.lemma !== w.text && (
                        <span className="text-xs text-[var(--color-text-secondary)]" style={scriptStyle}>
                          {w.lemma}
                        </span>
                      )}
                      {w.morphology?.morph && (
                        <span className="font-mono text-[10px] uppercase text-[var(--color-text-secondary)]">
                          {w.morphology.morph}
                        </span>
                      )}
                      {sid && (
                        <button
                          type="button"
                          onClick={() => openArtifact({ type: 'strongs', label: `${sid} ▸`, params: { id: sid } })}
                          className="rounded bg-[var(--color-surface-alt)] px-1 font-mono text-xs hover:underline"
                        >
                          {sid}
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            ) : (
              !commentary?.text && (
                <div className="mt-1 text-xs italic text-[var(--color-text-secondary)]">
                  {v.note ?? commentary?.note ?? 'No commentary available for this verse.'}
                </div>
              )
            )}
          </div>
        )
      })}
    </div>
  )
}
