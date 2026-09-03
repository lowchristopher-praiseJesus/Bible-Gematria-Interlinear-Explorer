import { forwardRef, useId } from 'react'
import type { SelectHTMLAttributes } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string
  /** Hide the label visually but keep it for screen readers / testing-library. */
  hideLabel?: boolean
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, hideLabel = false, className, id, children, ...props },
  ref,
) {
  const generated = useId()
  const selectId = id ?? generated
  return (
    <div className="flex flex-col gap-1">
      <label
        htmlFor={selectId}
        className={cn(
          'text-xs font-medium text-admin-muted',
          hideLabel && 'sr-only',
        )}
      >
        {label}
      </label>
      <div className="relative">
        <select
          ref={ref}
          id={selectId}
          className={cn(
            'h-8 w-full appearance-none rounded-md border border-admin-border-strong bg-admin-surface',
            'pl-2.5 pr-8 text-sm text-admin-text transition-colors',
            'hover:border-admin-accent focus-visible:border-admin-accent',
            className,
          )}
          {...props}
        >
          {children}
        </select>
        <ChevronDown
          className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-admin-subtle"
          aria-hidden="true"
        />
      </div>
    </div>
  )
})
