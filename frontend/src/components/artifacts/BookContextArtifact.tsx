import type { BookContextResponse } from '@/types/api'

interface Props {
  data: BookContextResponse
}

const SECTION_LABELS: Record<string, string> = {
  historical_setting: 'Historical Setting',
  cultural_background: 'Cultural Background',
  author_and_audience: 'Author & Audience',
  literary_context: 'Literary Context',
  genre_and_style: 'Genre & Style',
  language_and_translation: 'Language & Translation',
  theological_themes: 'Theological Themes',
  immediate_purpose: 'Immediate Purpose',
}

export function BookContextArtifact({ data }: Props) {
  return (
    <div className="flex flex-col gap-3">
      <div className="text-sm font-semibold">{data.book_name} — Book Context</div>
      {Object.entries(data.sections)
        .filter(([, value]) => value)
        .map(([key, value]) => (
          <div key={key}>
            <div className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
              {SECTION_LABELS[key] ?? key}
            </div>
            <div className="text-sm mt-0.5">{value}</div>
          </div>
        ))}
    </div>
  )
}
