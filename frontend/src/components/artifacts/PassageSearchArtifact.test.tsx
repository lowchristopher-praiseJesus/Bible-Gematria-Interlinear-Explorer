import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as chatApi from '@/lib/chatApi'
import { useArtifactStore } from '@/store/useArtifactStore'
import { PassageSearchArtifact } from './PassageSearchArtifact'
import type { PassageSearchArtifactParams } from '@/types/session'

const BASE: PassageSearchArtifactParams = {
  query: 'Where is the rapture talked about in the Bible?',
  kind: 'statement',
  label: '',
  phrasings: ['caught up together'],
  verified: true,
  semantic: true,
  credits: [],
  passages: [
    {
      ref: '1 Thessalonians 4:16-17',
      first_ref: '1 Thessalonians 4:16',
      text: '[16] For the Lord himself shall descend from heaven [17] Then we which are alive and remain shall be caught up',
      reason: 'Describes believers being caught up to meet the Lord.',
      sources: ['embedding', 'keyword'],
    },
    { ref: 'John 14:1-3', first_ref: 'John 14:1', text: '[3] I will come again', reason: '', sources: ['embedding'] },
  ],
}

describe('PassageSearchArtifact', () => {
  beforeEach(() => {
    useArtifactStore.setState({ activeArtifact: null, history: [], status: 'idle', data: null, error: null })
  })
  afterEach(() => vi.restoreAllMocks())

  it('shows the query, each passage, its reason and text', () => {
    render(<PassageSearchArtifact {...BASE} />)
    expect(screen.getByText(/Where is the rapture talked about/)).toBeInTheDocument()
    expect(screen.getByText('Describes believers being caught up to meet the Lord.')).toBeInTheDocument()
    expect(screen.getByText(/shall descend from heaven/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '1 Thessalonians 4:16-17' })).toHaveAttribute(
      'href', '/explorer?reference=1%20Thessalonians%204%3A16',
    )
  })

  it('omits the reason line when a passage has none', () => {
    render(<PassageSearchArtifact {...BASE} />)
    expect(screen.getAllByTestId('passage-reason')).toHaveLength(1)
  })

  it('opens a passage in-app as an interlinear artifact instead of navigating to the dead legacy route', async () => {
    vi.spyOn(chatApi, 'fetchInterlinear').mockResolvedValue({} as Awaited<ReturnType<typeof chatApi.fetchInterlinear>>)
    render(<PassageSearchArtifact {...BASE} />)
    await userEvent.click(screen.getByRole('link', { name: 'John 14:1-3' }))
    expect(useArtifactStore.getState().activeArtifact).toEqual({
      type: 'interlinear', label: 'John 14:1-3 ▸', params: { reference: 'John 14:1' },
    })
    await waitFor(() => expect(useArtifactStore.getState().status).toBe('ready'))
    expect(chatApi.fetchInterlinear).toHaveBeenCalledWith('John 14:1')
    expect(useArtifactStore.getState().error).toBeNull()
  })

  it('notes when relevance was not verified and when semantic search was unavailable', () => {
    render(<PassageSearchArtifact {...BASE} verified={false} semantic={false} />)
    expect(screen.getByText(/relevance not verified/i)).toBeInTheDocument()
    expect(screen.getByText(/semantic search unavailable/i)).toBeInTheDocument()
  })

  it('shows neither note for a verified semantic result', () => {
    render(<PassageSearchArtifact {...BASE} />)
    expect(screen.queryByText(/relevance not verified/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/semantic search unavailable/i)).not.toBeInTheDocument()
  })

  it('shows the search phrasings used and any credits', () => {
    render(<PassageSearchArtifact {...BASE} credits={['Cross-references: OpenBible.info (CC-BY)']} />)
    expect(screen.getByText(/caught up together/)).toBeInTheDocument()
    expect(screen.getByText(/OpenBible.info/)).toBeInTheDocument()
  })

  it('frames a passage query by its label and marks cross-reference hits', () => {
    render(
      <PassageSearchArtifact
        {...BASE}
        kind="passage"
        label="Romans 8:28"
        query="Romans 8:28"
        phrasings={[]}
        passages={[{ ...BASE.passages[0], sources: ['cross_reference'] }]}
      />,
    )
    expect(screen.getByText(/related to Romans 8:28/i)).toBeInTheDocument()
    expect(screen.getByText(/cross-reference/i)).toBeInTheDocument()
  })

  it('renders an empty or malformed card (old or imported) without crashing', () => {
    render(<PassageSearchArtifact {...(BASE as PassageSearchArtifactParams)} passages={undefined as never} phrasings={undefined as never} credits={undefined as never} />)
    expect(screen.getByText(/Where is the rapture talked about/)).toBeInTheDocument()
  })
})
