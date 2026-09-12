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
    // Match real RTCPeerConnection: close() is a no-op if already closed
    // (per spec), and otherwise transitions connectionState to 'closed'
    // and fires connectionstatechange — this is what makes the
    // detach-handlers-before-close fix in useVoiceMode.ts actually
    // testable (without this, an abandoned attempt's pc.close() would
    // silently do nothing observable to onconnectionstatechange).
    if (this.closed) return
    this.closed = true
    this.connectionState = 'closed'
    this.onconnectionstatechange?.()
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
    Object.defineProperty(globalThis.navigator, 'mediaDevices', {
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
    expect(FakeRTCPeerConnection.instances[0]?.dataChannel?.readyState).toBe('closed')
  })

  it('surfaces an error and releases the mic + peer connection when a pre-handshake step throws', async () => {
    // Regression test: createOffer/setLocalDescription/the ICE wait used to
    // sit outside any try/catch, so a rejection here was an unhandled
    // promise rejection that left status stuck at 'connecting' with a live
    // mic and peer connection. The whole sequence through
    // setRemoteDescription must now be caught and cleaned up.
    const mic = fakeMicStream()
    ;(navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>).mockResolvedValue(mic)
    const offerSpy = vi
      .spyOn(FakeRTCPeerConnection.prototype, 'createOffer')
      .mockRejectedValue(new Error('no ice servers'))

    const { result } = renderHook(() => useVoiceMode({ onTranscript: vi.fn() }))

    await act(async () => {
      result.current.toggle()
    })

    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.errorMessage).toBe('no ice servers')
    expect(FakeRTCPeerConnection.instances[0]?.closed).toBe(true)
    expect(FakeRTCPeerConnection.instances[0]?.dataChannel?.readyState).toBe('closed')
    mic.stopFns.forEach((stop) => expect(stop).toHaveBeenCalled())

    offerSpy.mockRestore()
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
    expect(onTranscript).toHaveBeenCalledWith('What does love mean?', 'deleg_1')
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

  it('speak() sends a session.commentary.append with the delegation id it was given', async () => {
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
      result.current.speak('Love is patient and kind.', 'deleg_1')
    })

    expect(dc.sent).toHaveLength(1)
    const sent = JSON.parse(dc.sent[0])
    expect(sent.type).toBe('session.commentary.append')
    expect(sent.delegation_id).toBe('deleg_1')
    expect(sent.content).toBe('Love is patient and kind.')
    expect(result.current.status).toBe('speaking')
  })

  it("speaks each turn's answer against the delegation id that turn's transcript arrived with", async () => {
    // Full-duplex: a second utterance's delegation.created can land before
    // the first utterance's answer is ready. The first answer must still be
    // appended to deleg_A — not to whichever delegation happens to be the
    // most recent when speak() finally runs.
    const onTranscript = vi.fn()
    const { result } = renderHook(() => useVoiceMode({ onTranscript }))

    await act(async () => {
      result.current.toggle()
    })
    await waitFor(() => expect(result.current.status).toBe('listening'))

    const dc = FakeRTCPeerConnection.instances[0].dataChannel!

    // Turn A finishes: transcript captured with deleg_A.
    act(() => {
      dc.dispatchEvent(
        new MessageEvent('message', {
          data: JSON.stringify({ type: 'session.input_transcript.delta', delta: 'Who wrote Psalm 23?' }),
        })
      )
      dc.dispatchEvent(
        new MessageEvent('message', {
          data: JSON.stringify({ type: 'session.delegation.created', delegation: { id: 'deleg_A', target: 'client' } }),
        })
      )
    })
    expect(onTranscript).toHaveBeenCalledTimes(1)
    const [textA, delegationIdA] = onTranscript.mock.calls[0]
    expect(textA).toBe('Who wrote Psalm 23?')
    expect(delegationIdA).toBe('deleg_A')

    // Turn B starts and completes while A's answer is still generating.
    act(() => {
      dc.dispatchEvent(
        new MessageEvent('message', {
          data: JSON.stringify({ type: 'session.input_transcript.delta', delta: 'And who wrote Psalm 51?' }),
        })
      )
      dc.dispatchEvent(
        new MessageEvent('message', {
          data: JSON.stringify({ type: 'session.delegation.created', delegation: { id: 'deleg_B', target: 'client' } }),
        })
      )
    })

    // A's answer arrives now, carrying the id captured at A's transcript time.
    act(() => {
      result.current.speak('David.', delegationIdA)
    })

    const appended = dc.sent.map((raw) => JSON.parse(raw))
    const commentary = appended.filter((e) => e.type === 'session.commentary.append')
    expect(commentary).toHaveLength(1)
    expect(commentary[0].delegation_id).toBe('deleg_A')
    expect(commentary[0].content).toBe('David.')
  })

  it('surfaces a GPT-Live error event instead of silently swallowing it', async () => {
    const { result } = renderHook(() => useVoiceMode({ onTranscript: vi.fn() }))

    await act(async () => {
      result.current.toggle()
    })
    await waitFor(() => expect(result.current.status).toBe('listening'))

    const dc = FakeRTCPeerConnection.instances[0].dataChannel!
    act(() => {
      dc.dispatchEvent(
        new MessageEvent('message', {
          data: JSON.stringify({
            type: 'error',
            error: { type: 'invalid_request_error', message: 'Unknown delegation_id' },
          }),
        })
      )
    })

    expect(result.current.status).toBe('error')
    expect(result.current.errorMessage).toMatch(/unknown delegation_id/i)
    // A hard error means the session is in a bad state — it's torn down
    // rather than left sitting silently in some status.
    expect(FakeRTCPeerConnection.instances[0].closed).toBe(true)
  })

  it('surfaces a suffixed *.error event and falls back to a generic message when none is carried', async () => {
    const { result } = renderHook(() => useVoiceMode({ onTranscript: vi.fn() }))

    await act(async () => {
      result.current.toggle()
    })
    await waitFor(() => expect(result.current.status).toBe('listening'))

    const dc = FakeRTCPeerConnection.instances[0].dataChannel!
    act(() => {
      dc.dispatchEvent(
        new MessageEvent('message', { data: JSON.stringify({ type: 'session.error' }) })
      )
    })

    expect(result.current.status).toBe('error')
    expect(result.current.errorMessage).toMatch(/voice session/i)
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
    // Same detach-before-close discipline connect()'s cleanup branches use:
    // close() can fire connectionstatechange, and a still-attached handler
    // touching the shared statusRef during teardown is exactly the bug
    // class that pattern exists to prevent.
    expect(FakeRTCPeerConnection.instances[0].onconnectionstatechange).toBeNull()
    expect(FakeRTCPeerConnection.instances[0].ontrack).toBeNull()
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

  it('stops an active session and reports an error when the API key is cleared mid-session', async () => {
    const mic = fakeMicStream()
    ;(navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>).mockResolvedValue(mic)
    const { result } = renderHook(() => useVoiceMode({ onTranscript: vi.fn() }))

    await act(async () => {
      result.current.toggle()
    })
    await waitFor(() => expect(result.current.status).toBe('listening'))

    act(() => {
      useVoiceSettingsStore.setState({ openaiApiKey: null })
    })

    expect(result.current.status).toBe('error')
    expect(result.current.errorMessage).toMatch(/api key was cleared/i)
    expect(FakeRTCPeerConnection.instances[0].closed).toBe(true)
    mic.stopFns.forEach((stop) => expect(stop).toHaveBeenCalled())
  })

  it('does not run the key-cleared teardown on mount when no key is set', () => {
    useVoiceSettingsStore.setState({ openaiApiKey: null })
    const { result } = renderHook(() => useVoiceMode({ onTranscript: vi.fn() }))

    expect(result.current.status).toBe('idle')
    expect(result.current.errorMessage).toBeNull()
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled()
  })

  it('does not run the key-cleared teardown on mount when a key is already set', () => {
    // openaiApiKey is 'sk-test-123' from beforeEach — mounting with a
    // truthy key must not itself be treated as a "key cleared" transition.
    const { result } = renderHook(() => useVoiceMode({ onTranscript: vi.fn() }))

    expect(result.current.status).toBe('idle')
    expect(result.current.errorMessage).toBeNull()
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled()
  })

  it('closes the peer connection and stops every mic track on unmount', async () => {
    const mic = fakeMicStream()
    ;(navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>).mockResolvedValue(mic)
    const { result, unmount } = renderHook(() => useVoiceMode({ onTranscript: vi.fn() }))

    await act(async () => {
      result.current.toggle()
    })
    await waitFor(() => expect(result.current.status).toBe('listening'))

    unmount()

    expect(FakeRTCPeerConnection.instances[0].closed).toBe(true)
    mic.stopFns.forEach((stop) => expect(stop).toHaveBeenCalled())
  })

  it('speak() is a no-op when no voice session is open', () => {
    const { result } = renderHook(() => useVoiceMode({ onTranscript: vi.fn() }))

    expect(() => {
      act(() => {
        result.current.speak('hello', 'deleg_1')
      })
    }).not.toThrow()
    expect(result.current.status).toBe('idle')
  })

  it('speak() is a no-op when the turn carried no delegation id, and never leaves the hook at "thinking"', async () => {
    const onTranscript = vi.fn()
    const { result } = renderHook(() => useVoiceMode({ onTranscript }))

    await act(async () => {
      result.current.toggle()
    })
    await waitFor(() => expect(result.current.status).toBe('listening'))

    const dc = FakeRTCPeerConnection.instances[0].dataChannel!
    // A delegation.created with no id at all: the transcript is still
    // forwarded to the chat pipeline, but there is nothing to append the
    // answer to.
    act(() => {
      dc.dispatchEvent(
        new MessageEvent('message', {
          data: JSON.stringify({ type: 'session.input_transcript.delta', delta: 'hello' }),
        })
      )
      dc.dispatchEvent(
        new MessageEvent('message', { data: JSON.stringify({ type: 'session.delegation.created' }) })
      )
    })
    expect(onTranscript).toHaveBeenCalledWith('hello', '')
    expect(result.current.status).toBe('thinking')

    act(() => {
      result.current.speak('an answer', '')
    })

    expect(dc.sent).toHaveLength(0)
    expect(result.current.status).toBe('listening')
  })

  it('aborts an in-flight connect() when stop() is called before it resolves, leaving no mic or peer connection behind', async () => {
    const mic = fakeMicStream()
    ;(navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>).mockResolvedValue(mic)

    let resolveSession!: (value: { sessionId: string; sdp: string }) => void
    vi.spyOn(voiceApi, 'createVoiceSession').mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSession = resolve
        })
    )

    const { result } = renderHook(() => useVoiceMode({ onTranscript: vi.fn() }))

    act(() => {
      result.current.toggle()
    })
    expect(result.current.status).toBe('connecting')

    await waitFor(() => expect(FakeRTCPeerConnection.instances).toHaveLength(1))

    act(() => {
      result.current.stop()
    })
    expect(result.current.status).toBe('idle')

    // Let the suspended connect() resume: it must notice it was
    // superseded and tear down what it built rather than reporting
    // 'listening' or leaving the mic/peer connection live.
    act(() => {
      resolveSession({ sessionId: 'live_123', sdp: 'fake-answer-sdp' })
    })

    await waitFor(() => expect(FakeRTCPeerConnection.instances[0].closed).toBe(true))
    expect(result.current.status).toBe('idle')
    expect(FakeRTCPeerConnection.instances[0].dataChannel?.readyState).toBe('closed')
    mic.stopFns.forEach((stop) => expect(stop).toHaveBeenCalled())
    expect(FakeRTCPeerConnection.instances).toHaveLength(1)
  })

  it('does not let a stale, abandoned connect() attempt tear down a later legitimate session', async () => {
    // Attempt A: starts connecting, then gets cancelled by stop() while its
    // SDP handshake call is still pending. Attempt B: a fresh, successful
    // connect() started right after. A's handshake call is later allowed
    // to resolve, well after B is already 'listening'. A's stale cleanup
    // then closes its own (abandoned) peer connection — real
    // RTCPeerConnection.close() fires connectionstatechange, and if A's
    // onconnectionstatechange were still attached it would read the
    // *shared* statusRef (now 'listening' because of B) and wrongly call
    // the shared stop(), tearing B down. This reproduces that exact race.
    let resolveA!: (value: { sessionId: string; sdp: string }) => void
    let handshakeCalls = 0
    vi.spyOn(voiceApi, 'createVoiceSession').mockImplementation(() => {
      handshakeCalls += 1
      if (handshakeCalls === 1) {
        return new Promise((resolve) => {
          resolveA = resolve
        })
      }
      return Promise.resolve({ sessionId: 'live_b', sdp: 'fake-answer-sdp-b' })
    })

    const { result } = renderHook(() => useVoiceMode({ onTranscript: vi.fn() }))

    // Attempt A: gets stuck awaiting its (deliberately deferred) handshake.
    act(() => {
      result.current.toggle()
    })
    await waitFor(() => expect(FakeRTCPeerConnection.instances).toHaveLength(1))

    // User cancels A before it resolves.
    act(() => {
      result.current.stop()
    })
    expect(result.current.status).toBe('idle')

    // Attempt B: a fresh connect() that succeeds normally.
    act(() => {
      result.current.toggle()
    })
    await waitFor(() => expect(result.current.status).toBe('listening'))
    expect(FakeRTCPeerConnection.instances).toHaveLength(2)

    // Now let A's stale handshake resolve, triggering A's superseded-cleanup
    // path (which closes A's own abandoned peer connection).
    act(() => {
      resolveA({ sessionId: 'live_a', sdp: 'fake-answer-sdp-a' })
    })
    await waitFor(() => expect(FakeRTCPeerConnection.instances[0].closed).toBe(true))

    // B must be completely unaffected by A's belated teardown.
    expect(result.current.status).toBe('listening')
    expect(result.current.errorMessage).toBeNull()
    expect(FakeRTCPeerConnection.instances[1].closed).toBe(false)
  })
})
