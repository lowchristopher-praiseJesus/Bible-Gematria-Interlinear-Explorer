import type { ComponentType } from 'react'
import type { LucideProps } from 'lucide-react'
import { cn } from '@/lib/utils'

interface StatCardProps {
  label: string
  value: number | string
  icon: ComponentType<LucideProps>
  /** Accent colour for the icon chip, e.g. 'var(--admin-new)'. */
  accent?: string
  active?: boolean
  loading?: boolean
  onClick?: () => void
}

export function StatCard({
  label,
  value,
  icon: Icon,
  accent = 'var(--admin-accent)',
  active = false,
  loading = false,
  onClick,
}: StatCardProps) {
  const interactive = typeof onClick === 'function'
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!interactive}
      aria-pressed={interactive ? active : undefined}
      className={cn(
        'flex items-center gap-3 rounded-xl border bg-admin-surface px-3.5 py-3 text-left transition-colors',
        interactive && 'cursor-pointer hover:border-admin-border-strong hover:bg-admin-raised',
        active
          ? 'border-admin-accent ring-1 ring-admin-accent'
          : 'border-admin-border',
        !interactive && 'cursor-default',
      )}
    >
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
        style={{ color: accent, backgroundColor: `color-mix(in srgb, ${accent} 12%, transparent)` }}
      >
        <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="block text-lg font-semibold leading-tight text-admin-text tabular-nums">
          {loading ? '—' : value}
        </span>
        <span className="block truncate text-xs text-admin-muted">{label}</span>
      </span>
    </button>
  )
}
