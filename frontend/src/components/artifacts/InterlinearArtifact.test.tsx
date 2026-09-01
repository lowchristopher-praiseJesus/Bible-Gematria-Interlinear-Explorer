import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { InterlinearArtifact } from './InterlinearArtifact'
import { useArtifactStore } from '@/store/useArtifactStore'
import * as chatApi from '@/lib/chatApi'
import type { ExplorerResponse } from '@/types/api'

const fixture: ExplorerResponse = {
  verse: {
    id: 1, ref: 'John 3:16', bnum: 43, cnum: 3, vnum: 16, Ch: '', wordnum: 0, letternum: 0,
    total: 0, text1769: '', textAV1611: '',
    language: 'Greek', originalText: '', stephanusText: null, stephanusTotal: null,
    lcFiles: [], hasQere: false, code: null, alert: null,
  },
  navigation: { previous: 1, next: 2 },
  kjvWords: [
    { kjvText: 'loved', strongsNumber: 'G0025', root: 'ἀγαπάω', rootTranslit: 'agapaō', rootTranslit2: '', rootVal: 0 },
  ],
  originalWords: [],
  strongsDefinitions: {},
}

describe('InterlinearArtifact', () => {
  beforeEach(() => {
    useArtifactStore.setState({ activeArtifact: null, status: 'idle', data: null, error: null })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('clicking a Strong\'s number badge opens the strongs artifact', async () => {
    vi.spyOn(chatApi, 'fetchStrongsEntry').mockResolvedValue({ definition: null, verses: [], resultSummary: '' })
    render(<InterlinearArtifact data={fixture} />)
    await userEvent.click(screen.getByRole('button', { name: 'G0025' }))
    expect(useArtifactStore.getState().activeArtifact).toEqual({
      type: 'strongs',
      label: 'G0025 ▸',
      params: { id: 'G0025' },
    })
  })

  it('clicking Next requests the next verse by versenumber', async () => {
    vi.spyOn(chatApi, 'fetchInterlinearByVersenumber').mockResolvedValue(fixture)
    render(<InterlinearArtifact data={fixture} />)
    await userEvent.click(screen.getByRole('button', { name: /next verse/i }))
    expect(useArtifactStore.getState().activeArtifact).toEqual({
      type: 'interlinear',
      label: 'Next verse ▸',
      params: { versenumber: 2 },
    })
    expect(chatApi.fetchInterlinearByVersenumber).toHaveBeenCalledWith(2)
  })

  it('clicking Prev requests the previous verse by versenumber', async () => {
    vi.spyOn(chatApi, 'fetchInterlinearByVersenumber').mockResolvedValue(fixture)
    render(<InterlinearArtifact data={fixture} />)
    await userEvent.click(screen.getByRole('button', { name: /previous verse/i }))
    expect(useArtifactStore.getState().activeArtifact).toEqual({
      type: 'interlinear',
      label: 'Previous verse ▸',
      params: { versenumber: 1 },
    })
    expect(chatApi.fetchInterlinearByVersenumber).toHaveBeenCalledWith(1)
  })
})
