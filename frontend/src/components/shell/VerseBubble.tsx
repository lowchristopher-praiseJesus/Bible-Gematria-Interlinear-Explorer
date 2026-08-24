import { useState } from 'react'

interface Props {
  data: {
    reference?: string
    translations?: Record<string, string>
  }
}

function translationLabel(code: string): string {
  const abbr = code.split('-')[1] ?? code
  return abbr.toUpperCase()
}

export function VerseBubble({ data }: Props) {
  const translations = data.translations ?? {}
  const codes = Object.keys(translations)
  const defaultCode = codes.find((c) => c.endsWith('-KJV')) ?? codes[0]
  const [selected, setSelected] = useState(defaultCode)

  if (codes.length === 0) return null

  const activeCode = translations[selected] !== undefined ? selected : defaultCode

  return (
    <div className="mt-1 flex flex-col gap-1.5 text-sm">
      {codes.length > 1 && (
        <select
          value={activeCode}
          onChange={(e) => setSelected(e.target.value)}
          aria-label="Translation"
          className="self-start text-xs border border-[var(--color-theme-border)] rounded px-1.5 py-0.5 bg-[var(--color-surface)]"
        >
          {codes.map((code) => (
            <option key={code} value={code}>
              {translationLabel(code)}
            </option>
          ))}
        </select>
      )}
      <div>{translations[activeCode]}</div>
    </div>
  )
}
