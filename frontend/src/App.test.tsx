import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
import { useSessionsStore } from '@/store/useSessionsStore'
import * as chatApi from '@/lib/chatApi'

describe('App', () => {
  beforeEach(() => {
    localStorage.clear()
    useSessionsStore.setState({ sessions: {}, activeSessionId: null })
    window.history.pushState({}, '', '/')
  })

  it('shows the mode picker when there is no active session', () => {
    render(<App />)
    expect(screen.getByRole('button', { name: /ask anything/i })).toBeInTheDocument()
  })

  it('starting a session switches to the three-pane chat layout', async () => {
    vi.spyOn(chatApi, 'postChat').mockResolvedValue({ type: 'chat', message: 'Ask me anything.' })
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: /ask anything/i }))
    expect(await screen.findByText('Ask me anything.')).toBeInTheDocument()
    expect(screen.getByText(/click a link in the chat/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /new session/i })).toBeInTheDocument()
  })
})
