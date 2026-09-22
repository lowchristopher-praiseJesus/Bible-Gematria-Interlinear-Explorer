import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CharacterPickerScreen } from './CharacterPickerScreen'
import { listCharacters, type CharacterEntry } from '@/lib/modeData'

vi.mock('@/lib/modeData', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/modeData')>()
  return { ...actual, listCharacters: vi.fn() }
})

const CHARACTERS: CharacterEntry[] = [
  { id: 'david', name: 'David', testament: 'OT', summary: 'The shepherd boy who became king.' },
  { id: 'ruth', name: 'Ruth', testament: 'OT', summary: 'The Moabite widow who stayed.' },
  { id: 'peter', name: 'Peter (Simon Peter)', testament: 'NT', summary: 'The fisherman named the rock.' },
]

describe('CharacterPickerScreen', () => {
  beforeEach(() => {
    vi.mocked(listCharacters).mockResolvedValue(CHARACTERS)
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  it('lists characters under Old Testament and New Testament headings', async () => {
    render(<CharacterPickerScreen onPick={() => {}} onBack={() => {}} />)

    expect(await screen.findByRole('button', { name: /david/i })).toBeInTheDocument()
    const ot = screen.getByRole('region', { name: /old testament/i })
    const nt = screen.getByRole('region', { name: /new testament/i })
    expect(ot).toHaveTextContent('David')
    expect(ot).toHaveTextContent('Ruth')
    expect(ot).not.toHaveTextContent('Peter')
    expect(nt).toHaveTextContent('Peter (Simon Peter)')
  })

  it("shows each character's one-line summary", async () => {
    render(<CharacterPickerScreen onPick={() => {}} onBack={() => {}} />)
    expect(await screen.findByText('The shepherd boy who became king.')).toBeInTheDocument()
  })

  it('shows a loading state until the list arrives', async () => {
    render(<CharacterPickerScreen onPick={() => {}} onBack={() => {}} />)
    expect(screen.getByText(/loading characters/i)).toBeInTheDocument()
    await screen.findByRole('button', { name: /david/i })
    expect(screen.queryByText(/loading characters/i)).not.toBeInTheDocument()
  })

  it('filters by name as the user types, case-insensitively', async () => {
    render(<CharacterPickerScreen onPick={() => {}} onBack={() => {}} />)
    await screen.findByRole('button', { name: /david/i })

    await userEvent.type(screen.getByRole('searchbox', { name: /search characters/i }), 'RUT')

    expect(screen.getByRole('button', { name: /ruth/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /david/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /new testament/i })).not.toBeInTheDocument()
  })

  it('says so when nothing matches the search', async () => {
    render(<CharacterPickerScreen onPick={() => {}} onBack={() => {}} />)
    await screen.findByRole('button', { name: /david/i })

    await userEvent.type(screen.getByRole('searchbox', { name: /search characters/i }), 'zzz')

    expect(screen.getByText(/no characters match/i)).toBeInTheDocument()
  })

  it('calls onPick with the chosen character', async () => {
    const onPick = vi.fn()
    render(<CharacterPickerScreen onPick={onPick} onBack={() => {}} />)

    await userEvent.click(await screen.findByRole('button', { name: /david/i }))

    expect(onPick).toHaveBeenCalledWith(CHARACTERS[0])
  })

  it('calls onBack from the back button', async () => {
    const onBack = vi.fn()
    render(<CharacterPickerScreen onPick={() => {}} onBack={onBack} />)
    await screen.findByRole('button', { name: /david/i })

    await userEvent.click(screen.getByRole('button', { name: /back/i }))

    expect(onBack).toHaveBeenCalled()
  })

  it('shows the error and lets the user retry when the list fails to load', async () => {
    vi.mocked(listCharacters).mockRejectedValueOnce(new Error('boom'))
    render(<CharacterPickerScreen onPick={() => {}} onBack={() => {}} />)

    expect(await screen.findByText(/boom/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /retry/i }))

    expect(await screen.findByRole('button', { name: /david/i })).toBeInTheDocument()
  })
})
