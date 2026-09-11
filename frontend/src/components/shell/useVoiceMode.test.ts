import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useVoiceMode } from './useVoiceMode'
import { useVoiceSettingsStore } from '@/store/useVoiceSettingsStore'
import * as voiceApi from '@/lib/voiceApi'

class FakeDataChannel {
  readyState: 'connecting' | 'open' | 'closed' = 'open'
  sent: string[] = []
  onmessage: ((e: MessageEvent) => void) | null = null
  send(data: string) {
    this.sent.push(data)
  }
  close() {
    this.readyState = 'closed'
  }
  dispatchEvent(event: MessageEvent) {
    this.onmessage?.(event)
    return true
  }
}

class FakeRTCPeerConnection {
  static instances: FakeRTCPeerConnection[] = []
  iceGatheringState = 'complete'
  connectionState = 'new'
  localDescription: { sdp: string } | null = null
  dataChannel: FakeDataChannel | null = null
  ontrack: ((e: unknown) => void) | null = null
  onconnectionstatechange: (() => void) | null = null
  closed = false

  constructor() {
    FakeRTCPeerConnection.instances.push(this)
  }
  addTrack() {}
  createDataChannel() {
    this.dataChannel = new FakeDataChannel()
    return this.dataChannel
  }
  addEventListener() {}
  removeEventListener() {}
  async createOffer() {
    return { type: 'offer', sdp: 'fake-offer-sdp' }
  }
  async setLocalDescription(desc: { sdp: string }) {
    this.localDescription = desc
  }
  async setRemoteDescription() {}
  close() {
    this.closed = true
  }
}

function fakeMicStream() {
  const stopFns = [vi.fn(), vi.fn()]
  return {
    getTracks: () => stopFns.map((stop) => ({ stop })),
    stopFns,
  } as unknown as MediaStream & { stopFns: ReturnType<typeof vi.fn>[] }
}

describe('useVoiceMode', () => {
  beforeEach(() => {
    localStorage.clear()
    useVoiceSettingsStore.setState({ openaiApiKey: 'sk-test-123' })
    FakeRTCPeerConnection.instances = []
    vi.stubGlobal('RTCPeerConnection', FakeRTCPeerConnection)
    Object.defineProperty(global.navigator, 'mediaDevices', {
      value: { getUserMedia: vi.fn().mockResolvedValue(fakeMicStream()) },
      configurable: true,
    })
    vi.spyOn(voiceApi, 'createVoiceSession').mockResolvedValue({ sessionId: 'live_123', sdp: 'fake-answer-sdp' })
    HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('does not touch the microphone when no API key is set', () => {
    useVoiceSettingsStore.setState({ openaiApiKey: null })
    const { result } = renderHook(() => useVoiceMode({ onTranscript: vi.fn() }))

    act(() => {
      result.current.toggle()
    })

    expect(result.current.status).toBe('error')
    expect(result.current.errorMessage).toMatch(/add your openai api key/i)
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled()
  })

  it('surfaces a mic-permission error', async () => {
    ;(navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>).mockRejectedValue(
      new DOMException('denied', 'NotAllowedError')
    )
    const { result } = renderHook(() => useVoiceMode({ onTranscript: vi.fn() }))

    await act(async () => {
      result.current.toggle()
    })

    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.errorMessage).toMatch(/microphone/i)
  })

  it('surfaces a session-create failure and closes the peer connection', async () => {
    vi.spyOn(voiceApi, 'createVoiceSession').mockRejectedValue(new Error('bad key'))
    const { result } = renderHook(() => useVoiceMode({ onTranscript: vi.fn() }))

    await act(async () => {
      result.current.toggle()
    })

    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.errorMessage).toBe('bad key')
    expect(FakeRTCPeerConnection.instances[0]?.closed).toBe(true)
  })

  it('connects, accumulates transcript deltas, and forwards the finished transcript on delegation.created', async () => {
    const onTranscript = vi.fn()
    const { result } = renderHook(() => useVoiceMode({ onTranscript }))

    await act(async () => {
      result.current.toggle()
    })
    await waitFor(() => expect(result.current.status).toBe('listening'))

    const dc = FakeRTCPeerConnection.instances[0].dataChannel!
    act(() => {
      dc.dispatchEvent(
        new MessageEvent('message', {
          data: JSON.stringify({ type: 'session.input_transcript.delta', delta: 'What does ' }),
        })
      )
      dc.dispatchEvent(
        new MessageEvent('message', {
          data: JSON.stringify({ type: 'session.input_transcript.delta', delta: 'love mean?' }),
        })
      )
      dc.dispatchEvent(
        new MessageEvent('message', {
          data: JSON.stringify({ type: 'session.delegation.created', delegation: { id: 'deleg_1', target: 'client' } }),
        })
      )
    })

    expect(onTranscript).toHaveBeenCalledTimes(1)
    expect(onTranscript).toHaveBeenCalledWith('What does love mean?')
    expect(result.current.liveCaption).toBe('')
  })

  it('drops an empty/whitespace transcript at delegation.created without calling onTranscript', async () => {
    const onTranscript = vi.fn()
    const { result } = renderHook(() => useVoiceMode({ onTranscript }))

    await act(async () => {
      result.current.toggle()
    })
    await waitFor(() => expect(result.current.status).toBe('listening'))

    const dc = FakeRTCPeerConnection.instances[0].dataChannel!
    act(() => {
      dc.dispatchEvent(
        new MessageEvent('message', {
          data: JSON.stringify({ type: 'session.delegation.created', delegation: { id: 'deleg_1', target: 'client' } }),
        })
      )
    })

    expect(onTranscript).not.toHaveBeenCalled()
  })

  it('speak() sends a session.commentary.append with the current delegation id', async () => {
    const { result } = renderHook(() => useVoiceMode({ onTranscript: vi.fn() }))

    await act(async () => {
      result.current.toggle()
    })
    await waitFor(() => expect(result.current.status).toBe('listening'))

    const dc = FakeRTCPeerConnection.instances[0].dataChannel!
    act(() => {
      dc.dispatchEvent(
        new MessageEvent('message', {
          data: JSON.stringify({ type: 'session.delegation.created', delegation: { id: 'deleg_1', target: 'client' } }),
        })
      )
    })

    act(() => {
      result.current.speak('Love is patient and kind.')
    })

    expect(dc.sent).toHaveLength(1)
    const sent = JSON.parse(dc.sent[0])
    expect(sent.type).toBe('session.commentary.append')
    expect(sent.delegation_id).toBe('deleg_1')
    expect(sent.content).toBe('Love is patient and kind.')
    expect(result.current.status).toBe('speaking')
  })

  it('stop() closes the peer connection and stops every mic track', async () => {
    const mic = fakeMicStream()
    ;(navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>).mockResolvedValue(mic)
    const { result } = renderHook(() => useVoiceMode({ onTranscript: vi.fn() }))

    await act(async () => {
      result.current.toggle()
    })
    await waitFor(() => expect(result.current.status).toBe('listening'))

    act(() => {
      result.current.stop()
    })

    expect(result.current.status).toBe('idle')
    expect(FakeRTCPeerConnection.instances[0].closed).toBe(true)
    mic.stopFns.forEach((stop) => expect(stop).toHaveBeenCalled())
  })

  it('tears down and reports an error when the connection drops unexpectedly', async () => {
    const { result } = renderHook(() => useVoiceMode({ onTranscript: vi.fn() }))
    await act(async () => {
      result.current.toggle()
    })
    await waitFor(() => expect(result.current.status).toBe('listening'))

    const pc = FakeRTCPeerConnection.instances[0]
    act(() => {
      pc.connectionState = 'failed'
      pc.onconnectionstatechange?.()
    })

    expect(result.current.status).toBe('error')
    expect(result.current.errorMessage).toMatch(/voice session ended/i)
  })
})
