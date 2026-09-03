import { cn } from '@/lib/utils'

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn('animate-pulse rounded-md bg-admin-border/70', className)}
      aria-hidden="true"
    />
  )
}

/** A block of shimmering table rows for the reports list's loading state. */
export function SkeletonRows({ rows = 6, cols = 6 }: { rows?: number; cols?: number }) {
  return (
    <div className="flex flex-col gap-px" aria-hidden="true">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-4 px-3 py-3">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton
              key={c}
              className={cn('h-3.5', c === 0 ? 'w-32' : c === cols - 1 ? 'ml-auto w-6' : 'w-16')}
            />
          ))}
        </div>
      ))}
    </div>
  )
}
