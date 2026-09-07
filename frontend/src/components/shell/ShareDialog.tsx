import { useCallback, useEffect, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Check, Copy, Loader2 } from 'lucide-react'
import { createShare } from '@/lib/shareApi'
import type { Session } from '@/types/session'

interface Props {
  session: Session
  open: boolean
  onOpenChange: (open: boolean) => void
}

type Status = 'idle' | 'creating' | 'ready' | 'error'

export function ShareDialog({ session, open, onOpenChange }: Props) {
  const [status, setStatus] = useState<Status>('idle')
  const [url, setUrl] = useState('')
  const [copied, setCopied] = useState(false)
  // One link per (session id + message count) — re-opening the dialog on
  // an unchanged conversation reuses the link, but sharing again after
  // more messages mints a fresh snapshot instead of returning a stale one.
  const cache = useRef<Record<string, string>>({})

  const runCreate = useCallback(() => {
    setCopied(false)
    const cacheKey = `${session.id}:${session.messages.length}`
    const cached = cache.current[cacheKey]
    if (cached) {
      setUrl(cached)
      setStatus('ready')
      return
    }
    setStatus('creating')
    createShare(session)
      .then((res) => {
        cache.current[cacheKey] = res.url
        setUrl(res.url)
        setStatus('ready')
      })
      .catch(() => setStatus('error'))
  }, [session])

  useEffect(() => {
    if (open) runCreate()
  }, [open, runCreate])

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard blocked — the field is still selectable */
    }
  }

  function retry() {
    delete cache.current[`${session.id}:${session.messages.length}`]
    runCreate()
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 w-[min(92vw,32rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-[var(--color-theme-border)] bg-[var(--color-surface)] p-5 shadow-xl">
          <Dialog.Title className="text-sm font-semibold">Share this conversation</Dialog.Title>
          <Dialog.Description className="mt-1 text-xs text-[var(--color-text-secondary)]">
            Anyone with this link can import a copy of this conversation, including its notes.
          </Dialog.Description>

          <div className="mt-4">
            {status === 'creating' && (
              <p className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Creating a link…
              </p>
            )}

            {status === 'error' && (
              <div className="flex flex-col gap-2">
                <p className="text-xs text-red-600">Couldn&apos;t create a share link.</p>
                <button
                  type="button"
                  onClick={retry}
                  className="self-start rounded px-3 py-1.5 text-sm border border-[var(--color-theme-border)]"
                >
                  Try again
                </button>
              </div>
            )}

            {status === 'ready' && (
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  aria-label="Share link"
                  value={url}
                  onFocus={(e) => e.currentTarget.select()}
                  className="min-w-0 flex-1 rounded border border-[var(--color-theme-border)] bg-[var(--color-surface-alt)] px-2 py-1.5 text-sm"
                />
                <button
                  type="button"
                  onClick={copy}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded px-3 py-1.5 text-sm bg-[var(--color-theme-accent)] text-[var(--color-theme-accent-contrast)]"
                >
                  {copied ? (
                    <Check className="h-3.5 w-3.5" aria-hidden="true" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
            )}
          </div>

          <div className="mt-4 flex justify-end">
            <Dialog.Close asChild>
              <button
                type="button"
                className="rounded px-3 py-1.5 text-sm border border-[var(--color-theme-border)]"
              >
                Done
              </button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
