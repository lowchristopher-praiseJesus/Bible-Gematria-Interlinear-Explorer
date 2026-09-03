import { forwardRef } from 'react'
import type { ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

type Tone = 'default' | 'danger'

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required — icon-only buttons must name themselves for assistive tech. */
  label: string
  tone?: Tone
}

const TONES: Record<Tone, string> = {
  default: 'text-admin-subtle hover:bg-admin-raised hover:text-admin-text',
  danger: 'text-admin-subtle hover:bg-[var(--admin-danger-bg)] hover:text-[var(--admin-danger)]',
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, tone = 'default', className, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md transition-colors',
        'disabled:pointer-events-none disabled:opacity-45',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-accent',
        TONES[tone],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
})
