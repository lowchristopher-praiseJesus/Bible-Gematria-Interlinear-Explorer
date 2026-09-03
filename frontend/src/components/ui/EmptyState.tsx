import type { ComponentType, ReactNode } from 'react'
import type { LucideProps } from 'lucide-react'

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: ComponentType<LucideProps>
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-admin-border-strong bg-admin-raised px-6 py-14 text-center">
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-admin-surface text-admin-subtle ring-1 ring-admin-border">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <p className="text-sm font-medium text-admin-text">{title}</p>
      {description && <p className="max-w-sm text-xs text-admin-muted">{description}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  )
}
