import type { ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useChatContext } from '@/context/ChatContext'

interface Props {
  children: ReactNode
}

const navLinks = [
  { to: '/explorer', label: 'Explorer' },
  { to: '/strongs', label: "Strong's" },
  { to: '/gematria', label: 'Gematria' },
  { to: '/english', label: 'English' },
]

export default function AppLayout({ children }: Props) {
  const { pathname } = useLocation()
  const { isOpen, toggle } = useChatContext()

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 flex items-center h-12 gap-6">
          <Link
            to="/explorer"
            className="font-semibold text-indigo-600 text-sm whitespace-nowrap"
          >
            Bible Explorer
          </Link>
          <nav className="flex gap-1 flex-1">
            {navLinks.map(({ to, label }) => (
              <Link
                key={to}
                to={to}
                className={`px-3 py-1 rounded text-sm transition-colors ${
                  pathname === to
                    ? 'bg-indigo-100 text-indigo-700 font-medium'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                }`}
              >
                {label}
              </Link>
            ))}
          </nav>
          <button
            onClick={toggle}
            aria-label="Toggle chat"
            className={`px-3 py-1 rounded text-sm transition-colors flex items-center gap-1.5 ${
              isOpen
                ? 'bg-indigo-100 text-indigo-700 font-medium'
                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
            }`}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            Chat
          </button>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-4 py-4">{children}</main>
    </div>
  )
}
