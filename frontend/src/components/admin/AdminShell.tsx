import type { ReactNode } from 'react'
import { ArrowUpRight, Inbox, LifeBuoy } from 'lucide-react'

function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-admin-accent text-admin-accent-contrast">
        <LifeBuoy className="h-[18px] w-[18px]" aria-hidden="true" />
      </span>
      <span className="leading-tight">
        <span className="block text-sm font-semibold text-admin-text">Bible Explorer</span>
        <span className="block text-[11px] text-admin-muted">Admin console</span>
      </span>
    </div>
  )
}

export function AdminShell({ children }: { children: ReactNode }) {
  return (
    <div className="admin-scope min-h-screen lg:grid lg:grid-cols-[240px_1fr]">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen flex-col border-r border-admin-border bg-admin-surface px-4 py-5 lg:flex">
        <Brand />
        <nav className="mt-7 flex flex-col gap-1">
          <span
            aria-current="page"
            className="flex items-center gap-2.5 rounded-md bg-admin-accent-weak px-2.5 py-2 text-sm font-medium text-admin-accent"
          >
            <Inbox className="h-4 w-4" aria-hidden="true" />
            Reports
          </span>
        </nav>
        <div className="mt-auto flex flex-col gap-2 border-t border-admin-border pt-4">
          <a
            href="/"
            className="group flex items-center gap-1.5 text-xs text-admin-muted transition-colors hover:text-admin-text"
          >
            Open study app
            <ArrowUpRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" aria-hidden="true" />
          </a>
          <span className="text-[11px] text-admin-subtle">Signed in via HTTP Basic</span>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="flex items-center justify-between border-b border-admin-border bg-admin-surface px-4 py-3 lg:hidden">
        <Brand />
        <a
          href="/"
          className="flex items-center gap-1 text-xs text-admin-muted hover:text-admin-text"
        >
          Study app
          <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
        </a>
      </header>

      <main className="min-w-0">
        <div className="mx-auto max-w-6xl px-4 py-5 lg:px-8 lg:py-7">{children}</div>
      </main>
    </div>
  )
}
