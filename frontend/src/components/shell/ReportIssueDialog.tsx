import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { submitReport, type ReportCategory } from '@/lib/feedbackApi'
import type { Session } from '@/types/session'

interface ReportIssueDialogProps {
  session: Session
  open: boolean
  onOpenChange: (open: boolean) => void
}

const CATEGORY_OPTIONS: { value: ReportCategory; label: string }[] = [
  { value: 'wrong_answer', label: 'Wrong or misleading answer' },
  { value: 'error', label: 'Error or crash' },
  { value: 'slow', label: 'Too slow' },
  { value: 'ui', label: 'UI problem' },
  { value: 'other', label: 'Other' },
]

type Status = 'idle' | 'sending' | 'sent' | 'error'

export function ReportIssueDialog({ session, open, onOpenChange }: ReportIssueDialogProps) {
  const [category, setCategory] = useState<ReportCategory>('wrong_answer')
  const [description, setDescription] = useState('')
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<Status>('idle')

  function reset() {
    setCategory('wrong_answer')
    setDescription('')
    setEmail('')
    setStatus('idle')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!description.trim() || status === 'sending') return
    setStatus('sending')
    try {
      await submitReport(session, {
        category,
        description: description.trim(),
        email: email.trim() || undefined,
      })
      setStatus('sent')
      setTimeout(() => {
        onOpenChange(false)
        reset()
      }, 1200)
    } catch {
      setStatus('error')
    }
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) reset()
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 w-[min(92vw,32rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-[var(--color-theme-border)] bg-[var(--color-surface)] p-5 shadow-xl">
          <Dialog.Title className="text-sm font-semibold">Report an issue with this chat</Dialog.Title>
          <Dialog.Description className="mt-1 text-xs text-[var(--color-text-secondary)]">
            Your conversation and a technical trace of this session are attached so we can diagnose it.
          </Dialog.Description>

          <form className="mt-4 flex flex-col gap-3" onSubmit={handleSubmit}>
            <label className="flex flex-col gap-1 text-xs">
              <span>Category</span>
              <select
                className="rounded border border-[var(--color-theme-border)] bg-[var(--color-surface-alt)] px-2 py-1.5 text-sm"
                value={category}
                onChange={(e) => setCategory(e.target.value as ReportCategory)}
              >
                {CATEGORY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-xs">
              <span>What went wrong?</span>
              <textarea
                className="min-h-24 rounded border border-[var(--color-theme-border)] bg-[var(--color-surface-alt)] px-2 py-1.5 text-sm"
                maxLength={8192}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                required
              />
            </label>

            <label className="flex flex-col gap-1 text-xs">
              <span>Email (optional — if you want a reply)</span>
              <input
                type="email"
                className="rounded border border-[var(--color-theme-border)] bg-[var(--color-surface-alt)] px-2 py-1.5 text-sm"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>

            {status === 'error' && (
              <p className="text-xs text-red-600">Couldn&apos;t send your report. Please try again.</p>
            )}
            {status === 'sent' && (
              <p className="text-xs text-[var(--color-theme-accent)]">Thanks — your report was sent.</p>
            )}

            <div className="mt-1 flex justify-end gap-2">
              <Dialog.Close asChild>
                <button type="button" className="rounded px-3 py-1.5 text-sm border border-[var(--color-theme-border)]">
                  Cancel
                </button>
              </Dialog.Close>
              <button
                type="submit"
                disabled={!description.trim() || status === 'sending' || status === 'sent'}
                className="rounded px-3 py-1.5 text-sm bg-[var(--color-theme-accent)] text-[var(--color-theme-accent-contrast)] disabled:opacity-40"
              >
                {status === 'sending' ? 'Sending…' : 'Send report'}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
