import { forwardRef } from 'react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-outline'
type Size = 'sm' | 'md'

const BASE =
  'inline-flex select-none items-center justify-center gap-1.5 rounded-md font-medium ' +
  'transition-colors duration-150 disabled:pointer-events-none disabled:opacity-45 ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-accent cursor-pointer'

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-admin-accent text-admin-accent-contrast hover:bg-admin-accent-hover',
  secondary:
    'border border-admin-border-strong bg-admin-surface text-admin-text hover:bg-admin-raised',
  ghost: 'text-admin-muted hover:bg-admin-raised hover:text-admin-text',
  danger:
    'bg-[var(--admin-danger)] text-white hover:bg-[var(--admin-danger-hover)]',
  'danger-outline':
    'border border-[var(--admin-danger)] text-[var(--admin-danger)] hover:bg-[var(--admin-danger-bg)]',
}

const SIZES: Record<Size, string> = {
  sm: 'h-8 px-2.5 text-xs',
  md: 'h-9 px-3.5 text-sm',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
  icon?: ReactNode
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading = false, icon, className, children, disabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(BASE, VARIANTS[variant], SIZES[size], className)}
      {...props}
    >
      {loading ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
      ) : (
        icon
      )}
      {children}
    </button>
  )
})
