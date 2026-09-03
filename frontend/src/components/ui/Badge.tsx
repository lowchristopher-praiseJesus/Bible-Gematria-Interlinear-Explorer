import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export type BadgeTone = 'neutral' | 'new' | 'triaged' | 'resolved' | 'danger'

const TONES: Record<BadgeTone, string> = {
  neutral: 'text-[var(--admin-neutral)] bg-[var(--admin-neutral-bg)]',
  new: 'text-[var(--admin-new)] bg-[var(--admin-new-bg)]',
  triaged: 'text-[var(--admin-triaged)] bg-[var(--admin-triaged-bg)]',
  resolved: 'text-[var(--admin-resolved)] bg-[var(--admin-resolved-bg)]',
  danger: 'text-[var(--admin-danger)] bg-[var(--admin-danger-bg)]',
}

export function Badge({
  tone = 'neutral',
  dot = false,
  className,
  children,
}: {
  tone?: BadgeTone
  dot?: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium capitalize',
        TONES[tone],
        className,
      )}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />}
      {children}
    </span>
  )
}
