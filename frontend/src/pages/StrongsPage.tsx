import { useState, useEffect } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import AppLayout from '@/components/layout/AppLayout'
import type { StrongsResponse } from '@/types/api'

export default function StrongsPage() {
  const [searchParams] = useSearchParams()
  const sn = searchParams.get('strongsnumber') ?? 'H7225'
  const [data, setData] = useState<StrongsResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [input, setInput] = useState(sn)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/strongs?strongsnumber=${encodeURIComponent(sn)}`)
      .then(r => r.json())
      .then(setData)
      .finally(() => setLoading(false))
  }, [sn])

  const isHebrew = sn.toUpperCase().startsWith('H')

  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto">
        <form
          className="flex gap-2 mb-6"
          onSubmit={e => {
            e.preventDefault()
            const v = input.trim()
            if (v) window.location.href = `/strongs?strongsnumber=${encodeURIComponent(v)}`
          }}
        >
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            className="flex-1 border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:border-indigo-400"
            placeholder="Strong's number, e.g. H7225 or G2316"
          />
          <button type="submit" className="bg-indigo-600 text-white text-sm px-4 py-2 rounded hover:bg-indigo-700 transition-colors">
            Search
          </button>
        </form>

        {loading && <div className="text-center text-gray-400 py-12">Loading…</div>}

        {data && !loading && (
          <>
            {data.definition && (
              <div className="bg-white rounded-lg border border-gray-200 p-5 mb-6">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <span className="inline-block font-mono text-sm bg-indigo-50 text-indigo-700 rounded px-2 py-0.5 mb-2">
                      {data.definition.strongsNumber}
                    </span>
                    <div className="flex items-baseline gap-3">
                      <span
                        className="text-3xl"
                        style={{ fontFamily: isHebrew ? 'TaameyFrank, serif' : 'inherit' }}
                      >
                        {data.definition.root}
                      </span>
                      <span className="text-base text-gray-500 font-mono">{data.definition.transliteration1}</span>
                    </div>
                  </div>
                  <span className="text-sm text-gray-400 font-mono">#{data.definition.value}</span>
                </div>

                <div className="text-sm text-gray-500 mb-2">{data.definition.partOfSpeech}</div>
                <div className="text-base font-medium text-gray-800 mb-3">{data.definition.meaning}</div>

                <div
                  className="text-sm text-gray-700 leading-relaxed border-t border-gray-100 pt-3 mb-3"
                  dangerouslySetInnerHTML={{ __html: data.definition.strongsDefinition }}
                />

                {data.definition.outline && (
                  <div
                    className="text-sm text-gray-600 border-t border-gray-100 pt-3"
                    dangerouslySetInnerHTML={{ __html: data.definition.outline }}
                  />
                )}

                <div className="mt-4 flex gap-4 text-sm text-gray-400 border-t border-gray-100 pt-3">
                  <span>{data.definition.usageCount}× used</span>
                  <span>{data.definition.verseCount} verses</span>
                  <span>{data.definition.bookCount} books</span>
                </div>
              </div>
            )}

            <div className="text-sm text-gray-500 mb-3">{data.resultSummary}</div>

            <div className="space-y-4">
              {data.verses.map(group => (
                <div key={group.book} className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                  <div className="px-3 py-2 bg-gray-50 border-b border-gray-100 text-xs font-medium text-gray-600">
                    {group.book}
                  </div>
                  <div className="divide-y divide-gray-50">
                    {group.refs.map(ref => (
                      <div key={ref.id} className="px-3 py-2">
                        <Link
                          to={`/explorer?versenumber=${ref.id}`}
                          className="text-sm text-indigo-600 hover:underline"
                        >
                          {ref.ref}
                        </Link>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </AppLayout>
  )
}
