import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useArtifactStore } from './useArtifactStore'
import * as chatApi from '@/lib/chatApi'

describe('useArtifactStore', () => {
  beforeEach(() => {
    useArtifactStore.setState({ activeArtifact: null, status: 'idle', data: null, error: null })
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

  it('close resets to idle', async () => {
    vi.spyOn(chatApi, 'fetchStrongsEntry').mockResolvedValue({ definition: null, verses: [], resultSummary: '' })
    await useArtifactStore.getState().openArtifact({ type: 'strongs', label: '', params: { id: 'G26' } })
    useArtifactStore.getState().close()
    expect(useArtifactStore.getState().status).toBe('idle')
    expect(useArtifactStore.getState().activeArtifact).toBeNull()
  })
})
