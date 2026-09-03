import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useArtifactStore } from './useArtifactStore'
import * as chatApi from '@/lib/chatApi'

describe('useArtifactStore', () => {
  beforeEach(() => {
    useArtifactStore.setState({
      activeArtifact: null, activeNote: null, history: [], status: 'idle', data: null, error: null,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('openArtifact sets loading then ready with fetched data for a strongs link', async () => {
    vi.spyOn(chatApi, 'fetchStrongsEntry').mockResolvedValue({
      definition: null,
      verses: [],
      resultSummary: 'No results',
    })
    const link = { type: 'strongs' as const, label: "Strong's ▸", params: { id: 'G26' } }
    const promise = useArtifactStore.getState().openArtifact(link)
    expect(useArtifactStore.getState().status).toBe('loading')
    await promise
    expect(useArtifactStore.getState().status).toBe('ready')
    expect(useArtifactStore.getState().activeArtifact).toEqual(link)
  })

  it('openArtifact sets an error state when the fetch throws', async () => {
    vi.spyOn(chatApi, 'fetchStrongsEntry').mockRejectedValue(new Error('network down'))
    const link = { type: 'strongs' as const, label: "Strong's ▸", params: { id: 'G26' } }
    await useArtifactStore.getState().openArtifact(link)
    expect(useArtifactStore.getState().status).toBe('error')
    expect(useArtifactStore.getState().error).toBe('network down')
  })

  it('openArtifact fetches by reference for an interlinear link with a reference param', async () => {
    const explorerFixture = { verse: {}, navigation: { previous: 1, next: 2 }, kjvWords: [], originalWords: [], strongsDefinitions: {} } as never
    vi.spyOn(chatApi, 'fetchInterlinear').mockResolvedValue(explorerFixture)
    const byVersenumber = vi.spyOn(chatApi, 'fetchInterlinearByVersenumber')
    await useArtifactStore.getState().openArtifact({ type: 'interlinear', label: '', params: { reference: 'JOB 1:1' } })
    expect(chatApi.fetchInterlinear).toHaveBeenCalledWith('JOB 1:1')
    expect(byVersenumber).not.toHaveBeenCalled()
  })

  it('openArtifact fetches by versenumber for an interlinear link with a versenumber param', async () => {
    const explorerFixture = { verse: {}, navigation: { previous: 1, next: 3 }, kjvWords: [], originalWords: [], strongsDefinitions: {} } as never
    vi.spyOn(chatApi, 'fetchInterlinearByVersenumber').mockResolvedValue(explorerFixture)
    const byReference = vi.spyOn(chatApi, 'fetchInterlinear')
    await useArtifactStore.getState().openArtifact({ type: 'interlinear', label: '', params: { versenumber: 2 } })
    expect(chatApi.fetchInterlinearByVersenumber).toHaveBeenCalledWith(2)
    expect(byReference).not.toHaveBeenCalled()
  })

  it('close resets to idle', async () => {
    vi.spyOn(chatApi, 'fetchStrongsEntry').mockResolvedValue({ definition: null, verses: [], resultSummary: '' })
    await useArtifactStore.getState().openArtifact({ type: 'strongs', label: '', params: { id: 'G26' } })
    useArtifactStore.getState().close()
    expect(useArtifactStore.getState().status).toBe('idle')
    expect(useArtifactStore.getState().activeArtifact).toBeNull()
    expect(useArtifactStore.getState().history).toEqual([])
  })

  it('opening a second artifact stacks the first one onto history', async () => {
    const verseLink = { type: 'interlinear' as const, label: 'John 3:16 ▸', params: { versenumber: 26136 } }
    const strongsLink = { type: 'strongs' as const, label: 'G26 ▸', params: { id: 'G26' } }
    vi.spyOn(chatApi, 'fetchInterlinearByVersenumber').mockResolvedValue({
      verse: {}, navigation: { previous: 1, next: 2 }, kjvWords: [], originalWords: [], strongsDefinitions: {},
    } as never)
    vi.spyOn(chatApi, 'fetchStrongsEntry').mockResolvedValue({ definition: null, verses: [], resultSummary: '' })

    await useArtifactStore.getState().openArtifact(verseLink)
    expect(useArtifactStore.getState().history).toEqual([])

    await useArtifactStore.getState().openArtifact(strongsLink)
    expect(useArtifactStore.getState().activeArtifact).toEqual(strongsLink)
    expect(useArtifactStore.getState().history).toEqual([verseLink])
  })

  it('goBack returns to the previous artifact and re-fetches its data', async () => {
    const verseLink = { type: 'interlinear' as const, label: 'John 3:16 ▸', params: { versenumber: 26136 } }
    const strongsLink = { type: 'strongs' as const, label: 'G26 ▸', params: { id: 'G26' } }
    const verseFixture = {
      verse: { ref: 'John 3:16' }, navigation: { previous: 1, next: 2 }, kjvWords: [], originalWords: [], strongsDefinitions: {},
    } as never
    vi.spyOn(chatApi, 'fetchInterlinearByVersenumber').mockResolvedValue(verseFixture)
    vi.spyOn(chatApi, 'fetchStrongsEntry').mockResolvedValue({ definition: null, verses: [], resultSummary: '' })

    await useArtifactStore.getState().openArtifact(verseLink)
    await useArtifactStore.getState().openArtifact(strongsLink)

    const goBackPromise = useArtifactStore.getState().goBack()
    expect(useArtifactStore.getState().status).toBe('loading')
    expect(useArtifactStore.getState().activeArtifact).toEqual(verseLink)
    await goBackPromise

    expect(useArtifactStore.getState().status).toBe('ready')
    expect(useArtifactStore.getState().data).toEqual(verseFixture)
    expect(useArtifactStore.getState().history).toEqual([])
  })

  it('goBack does nothing when there is no history', async () => {
    vi.spyOn(chatApi, 'fetchStrongsEntry').mockResolvedValue({ definition: null, verses: [], resultSummary: '' })
    const link = { type: 'strongs' as const, label: '', params: { id: 'G26' } }
    await useArtifactStore.getState().openArtifact(link)

    await useArtifactStore.getState().goBack()

    expect(useArtifactStore.getState().activeArtifact).toEqual(link)
    expect(useArtifactStore.getState().status).toBe('ready')
  })

  it('reopening the same artifact does not push a duplicate onto history', async () => {
    vi.spyOn(chatApi, 'fetchStrongsEntry').mockResolvedValue({ definition: null, verses: [], resultSummary: '' })
    const link = { type: 'strongs' as const, label: '', params: { id: 'G26' } }
    await useArtifactStore.getState().openArtifact(link)
    await useArtifactStore.getState().openArtifact({ ...link, label: 'different label but same target' })

    expect(useArtifactStore.getState().history).toEqual([])
  })

  it('openNote sets activeNote and clears any active artifact and history', async () => {
    vi.spyOn(chatApi, 'fetchStrongsEntry').mockResolvedValue({ definition: null, verses: [], resultSummary: '' })
    await useArtifactStore.getState().openArtifact({ type: 'strongs', label: '', params: { id: 'G26' } })
    useArtifactStore.getState().openNote('session-1', 'note-1')
    const s = useArtifactStore.getState()
    expect(s.activeNote).toEqual({ sessionId: 'session-1', noteId: 'note-1' })
    expect(s.activeArtifact).toBeNull()
    expect(s.history).toEqual([])
    expect(s.status).toBe('idle')
  })

  it('openNewNote sets activeNote with an empty noteId sentinel', () => {
    useArtifactStore.getState().openNewNote('session-1')
    expect(useArtifactStore.getState().activeNote).toEqual({ sessionId: 'session-1', noteId: '' })
  })

  it('openArtifact clears an active note', async () => {
    vi.spyOn(chatApi, 'fetchStrongsEntry').mockResolvedValue({ definition: null, verses: [], resultSummary: '' })
    useArtifactStore.getState().openNote('s1', 'n1')
    await useArtifactStore.getState().openArtifact({ type: 'strongs', label: '', params: { id: 'G26' } })
    expect(useArtifactStore.getState().activeNote).toBeNull()
  })

  it('close clears an active note', () => {
    useArtifactStore.getState().openNote('s1', 'n1')
    useArtifactStore.getState().close()
    expect(useArtifactStore.getState().activeNote).toBeNull()
  })

  it('goBack clears an active note while returning to the previous artifact', async () => {
    const verseLink = { type: 'interlinear' as const, label: 'v', params: { versenumber: 1 } }
    const strongsLink = { type: 'strongs' as const, label: 's', params: { id: 'G26' } }
    vi.spyOn(chatApi, 'fetchInterlinearByVersenumber').mockResolvedValue({
      verse: {}, navigation: { previous: 1, next: 2 }, kjvWords: [], originalWords: [], strongsDefinitions: {},
    } as never)
    vi.spyOn(chatApi, 'fetchStrongsEntry').mockResolvedValue({ definition: null, verses: [], resultSummary: '' })
    await useArtifactStore.getState().openArtifact(verseLink)
    await useArtifactStore.getState().openArtifact(strongsLink)
    useArtifactStore.setState({ activeNote: { sessionId: 's1', noteId: 'n1' } })
    await useArtifactStore.getState().goBack()
    expect(useArtifactStore.getState().activeNote).toBeNull()
    expect(useArtifactStore.getState().activeArtifact).toEqual(verseLink)
  })
})
