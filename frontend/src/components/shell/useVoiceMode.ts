import { useEffect, useRef, useState } from 'react'
import { createVoiceSession } from '@/lib/voiceApi'
import { useVoiceSettingsStore } from '@/store/useVoiceSettingsStore'

export type VoiceModeStatus = 'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking' | 'error'

export interface UseVoiceModeResult {
  status: VoiceModeStatus
  errorMessage: string | null
  liveCaption: string
  toggle: () => void
  stop: () => void
  /** Voices `text` for the turn identified by `delegationId` — always the id
   * that turn's own transcript arrived with (see `onTranscript`), never
   * "whatever delegation is current now": with full-duplex listening a
   * later utterance's delegation can already have superseded it by the time
   * an answer is ready, and appending to that one would speak this answer
   * against the wrong question. */
  speak: (text: string, delegationId: string) => void
}

interface UseVoiceModeOptions {
  /** Called once per finished user utterance, with the accumulated,
   * trimmed transcript and the delegation id that utterance was delegated
   * under. Never called for an empty/whitespace-only turn. The caller must
   * hand that same id back to `speak()` when the answer is ready — it is
   * the only way to keep two overlapping turns' answers from being swapped.
   * Empty string when the event carried no id (nothing can be spoken back
   * for that turn; the transcript is still answered on screen). */
  onTranscript: (text: string, delegationId: string) => void
}

/**
 * Owns a GPT-Live WebRTC voice session in "client delegation" mode:
 * OpenAI handles mic capture, turn detection, transcription, and speech
 * synthesis, but never generates its own answer. Forwards each finished
 * user utterance to `onTranscript` (the caller feeds it into the existing
 * text-chat pipeline) and exposes `speak()` to have GPT-Live voice the
 * resulting answer via `session.commentary.append`.
 *
 * See docs/superpowers/specs/2026-09-11-voice-mode-design.md. The exact
 * field name carrying delta text on `session.input_transcript.delta`
 * wasn't confirmed from documentation alone (see that spec's Open
 * Questions) — this reads both `delta` and `text` defensively; confirm
 * against a real session (Task 7) and simplify once verified.
 */
export function useVoiceMode({ onTranscript }: UseVoiceModeOptions): UseVoiceModeResult {
  const openaiApiKey = useVoiceSettingsStore((s) => s.openaiApiKey)

  const [status, setStatusState] = useState<VoiceModeStatus>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [liveCaption, setLiveCaption] = useState('')

  const statusRef = useRef<VoiceModeStatus>('idle')
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const dcRef = useRef<RTCDataChannel | null>(null)
  const micStreamRef = useRef<MediaStream | null>(null)
  const audioElRef = useRef<HTMLAudioElement | null>(null)
  const transcriptBufferRef = useRef('')
  const onTranscriptRef = useRef(onTranscript)
  const prevKeyRef = useRef(openaiApiKey)
  /** Bumped by stop() and by connect() itself; lets a suspended connect()
   * detect — after each meaningful await — that it has been superseded
   * (by an explicit stop(), unmount, the key-cleared effect, or a newer
   * connect()) and must tear down whatever it already created instead of
   * committing it to the shared refs / status. */
  const connectionIdRef = useRef(0)

  useEffect(() => {
    onTranscriptRef.current = onTranscript
  })

  function setStatus(next: VoiceModeStatus) {
    statusRef.current = next
    setStatusState(next)
  }

  function stop(message: string | null = null) {
    // Invalidate any in-flight connect() so it cleans up after itself
    // instead of resuming and committing a live mic/peer connection that
    // nothing will ever be told about again.
    connectionIdRef.current += 1
    dcRef.current?.close()
    dcRef.current = null
    // Detach before closing, the same discipline connect()'s cleanup
    // branches use: close() can fire connectionstatechange synchronously,
    // and onconnectionstatechange reads the *shared* statusRef — letting it
    // run mid-teardown is the bug class that pattern exists to prevent.
    if (pcRef.current) {
      pcRef.current.onconnectionstatechange = null
      pcRef.current.ontrack = null
    }
    pcRef.current?.close()
    pcRef.current = null
    micStreamRef.current?.getTracks().forEach((track) => track.stop())
    micStreamRef.current = null
    if (audioElRef.current) {
      audioElRef.current.srcObject = null
    }
    transcriptBufferRef.current = ''
    setLiveCaption('')
    setErrorMessage(message)
    setStatus(message ? 'error' : 'idle')
  }

  function handleEvent(raw: string) {
    let event: Record<string, unknown>
    try {
      event = JSON.parse(raw)
    } catch {
      return
    }
    switch (event.type) {
      case 'session.input_transcript.delta': {
        if (statusRef.current === 'speaking' || statusRef.current === 'thinking') {
          setStatus('listening')
        }
        const delta = String((event as { delta?: string }).delta ?? (event as { text?: string }).text ?? '')
        transcriptBufferRef.current += delta
        setLiveCaption(transcriptBufferRef.current)
        break
      }
      case 'session.delegation.created': {
        const delegation = event.delegation as { id?: string } | undefined
        // Hand this turn's id straight to the caller rather than parking it
        // in a shared ref: with full-duplex listening a later utterance can
        // overwrite that ref before this turn's answer is ready, which would
        // speak this answer against the wrong delegation.
        const delegationId = delegation?.id ?? ''
        const transcript = transcriptBufferRef.current.trim()
        transcriptBufferRef.current = ''
        setLiveCaption('')
        if (transcript) {
          setStatus('thinking')
          onTranscriptRef.current(transcript, delegationId)
        }
        break
      }
      default: {
        // GPT-Live's error shape isn't pinned down by the docs this was
        // built from (see the spec's Open Questions), so recognise both
        // `error` and any `*.error` type and read the message defensively.
        // Swallowing these silently is how the whole feature can fail with
        // no caption, no audio, and nothing to debug from.
        const type = String(event.type ?? '')
        if (type === 'error' || type.endsWith('.error')) {
          const nested = (event as { error?: { message?: unknown } }).error
          const detail =
            (typeof nested?.message === 'string' && nested.message) ||
            (typeof (event as { message?: unknown }).message === 'string' &&
              (event as { message: string }).message) ||
            ''
          // A hard error means the session is in a bad state (a rejected
          // commentary.append would otherwise pin status at 'speaking'
          // forever), so tear it down with a visible message rather than
          // sitting in some status silently.
          stop(detail ? `Voice session error: ${detail}` : 'The voice session reported an error.')
          break
        }
        // Permanent, DEV-only diagnostic: the manual verification pass needs
        // to see the real event stream (to confirm the transcript delta field
        // name, among others) without hand-editing this file to add a log.
        if (import.meta.env.DEV) {
          console.debug('[voice] unhandled event', event.type, event)
        }
        break
      }
    }
  }

  async function connect() {
    if (!openaiApiKey) {
      setErrorMessage('Add your OpenAI API key in Settings to use voice mode.')
      setStatus('error')
      return
    }
    // Claim a generation id for this attempt. stop() (called explicitly,
    // on unmount, from the key-cleared effect, or from
    // onconnectionstatechange below) bumps connectionIdRef — any await
    // this function resumes from after that must notice `myId` is stale
    // and tear down what it already built instead of finishing the
    // connection or touching shared status/refs.
    const myId = ++connectionIdRef.current
    setErrorMessage(null)
    setStatus('connecting')

    let micStream: MediaStream
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      if (myId === connectionIdRef.current) {
        setErrorMessage('Microphone permission was denied.')
        setStatus('error')
      }
      return
    }

    if (myId !== connectionIdRef.current) {
      // Superseded while awaiting the mic — release it, nothing else was
      // created yet.
      micStream.getTracks().forEach((track) => track.stop())
      return
    }

    const pc = new RTCPeerConnection()
    micStream.getTracks().forEach((track) => pc.addTrack(track, micStream))

    const dc = pc.createDataChannel('oai-events')
    dc.onmessage = (e) => handleEvent(e.data)

    pc.ontrack = (event: RTCTrackEvent) => {
      if (!audioElRef.current) {
        audioElRef.current = new Audio()
      }
      audioElRef.current.srcObject = event.streams[0]
      void audioElRef.current.play().catch(() => {})
    }
    pc.onconnectionstatechange = () => {
      if (['failed', 'disconnected', 'closed'].includes(pc.connectionState) && statusRef.current !== 'idle') {
        stop('Voice session ended unexpectedly.')
      }
    }

    // Everything from here through setRemoteDescription can throw (a
    // rejected createOffer/setLocalDescription, the ICE wait, the
    // handshake proxy call, or setRemoteDescription itself) — all of it
    // must be caught so a failure always lands in 'error' with the mic
    // and peer connection released, never an unhandled rejection with
    // status stuck at 'connecting' and live resources leaked.
    try {
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      await new Promise<void>((resolve) => {
        if (pc.iceGatheringState === 'complete') {
          resolve()
          return
        }
        const check = () => {
          if (pc.iceGatheringState === 'complete') {
            pc.removeEventListener('icegatheringstatechange', check)
            resolve()
          }
        }
        pc.addEventListener('icegatheringstatechange', check)
      })

      const { sdp } = await createVoiceSession(pc.localDescription?.sdp ?? '', openaiApiKey)
      await pc.setRemoteDescription({ type: 'answer', sdp })
    } catch (err) {
      // Detach handlers on this attempt's own pc before closing it: pc.close()
      // transitions connectionState to 'closed' and fires connectionstatechange,
      // and if onconnectionstatechange were still attached it could see a
      // *later, legitimate* session's status (statusRef is shared) and
      // wrongly tear that down. Nulling first makes this attempt's close a
      // no-op event.
      pc.onconnectionstatechange = null
      pc.ontrack = null
      dc.close()
      pc.close()
      micStream.getTracks().forEach((track) => track.stop())
      if (myId === connectionIdRef.current) {
        setErrorMessage(err instanceof Error ? err.message : String(err))
        setStatus('error')
      }
      return
    }

    if (myId !== connectionIdRef.current) {
      // Superseded while completing the handshake — tear down the
      // connection/mic this attempt just finished building. Same
      // detach-before-close reasoning as the catch block above: a newer
      // connect() may already be 'listening' by the time this runs.
      pc.onconnectionstatechange = null
      pc.ontrack = null
      dc.close()
      pc.close()
      micStream.getTracks().forEach((track) => track.stop())
      return
    }

    pcRef.current = pc
    dcRef.current = dc
    micStreamRef.current = micStream
    setStatus('listening')
  }

  function toggle() {
    if (statusRef.current === 'idle' || statusRef.current === 'error') {
      void connect()
    } else {
      stop()
    }
  }

  function speak(text: string, delegationId: string) {
    const dc = dcRef.current
    if (!dc || dc.readyState !== 'open') return
    if (!delegationId) {
      // The turn arrived without a delegation id, so there is nothing to
      // append the answer to — but don't leave the hook pinned at
      // 'thinking' waiting for audio that can never be requested.
      if (statusRef.current === 'thinking') setStatus('listening')
      return
    }
    setStatus('speaking')
    dc.send(
      JSON.stringify({
        type: 'session.commentary.append',
        event_id: `commentary_${Date.now()}`,
        delegation_id: delegationId,
        content: text,
      })
    )
  }

  useEffect(() => {
    if (prevKeyRef.current && !openaiApiKey && statusRef.current !== 'idle') {
      stop('Voice mode stopped because the API key was cleared.')
    }
    prevKeyRef.current = openaiApiKey
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openaiApiKey])

  useEffect(() => {
    return () => {
      stop()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { status, errorMessage, liveCaption, toggle, stop, speak }
}
