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
  speak: (text: string) => void
}

interface UseVoiceModeOptions {
  /** Called once per finished user utterance, with the accumulated,
   * trimmed transcript. Never called for an empty/whitespace-only turn. */
  onTranscript: (text: string) => void
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
  const delegationIdRef = useRef<string | null>(null)
  const onTranscriptRef = useRef(onTranscript)
  const prevKeyRef = useRef(openaiApiKey)

  useEffect(() => {
    onTranscriptRef.current = onTranscript
  })

  function setStatus(next: VoiceModeStatus) {
    statusRef.current = next
    setStatusState(next)
  }

  function stop(message: string | null = null) {
    dcRef.current?.close()
    dcRef.current = null
    pcRef.current?.close()
    pcRef.current = null
    micStreamRef.current?.getTracks().forEach((track) => track.stop())
    micStreamRef.current = null
    if (audioElRef.current) {
      audioElRef.current.srcObject = null
    }
    transcriptBufferRef.current = ''
    delegationIdRef.current = null
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
        delegationIdRef.current = delegation?.id ?? null
        const transcript = transcriptBufferRef.current.trim()
        transcriptBufferRef.current = ''
        setLiveCaption('')
        if (transcript) {
          setStatus('thinking')
          onTranscriptRef.current(transcript)
        }
        break
      }
      default:
        break
    }
  }

  async function connect() {
    if (!openaiApiKey) {
      setErrorMessage('Add your OpenAI API key in Settings to use voice mode.')
      setStatus('error')
      return
    }
    setErrorMessage(null)
    setStatus('connecting')

    let micStream: MediaStream
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      setErrorMessage('Microphone permission was denied.')
      setStatus('error')
      return
    }
    micStreamRef.current = micStream

    const pc = new RTCPeerConnection()
    pcRef.current = pc
    micStream.getTracks().forEach((track) => pc.addTrack(track, micStream))

    const dc = pc.createDataChannel('oai-events')
    dc.onmessage = (e) => handleEvent(e.data)
    dcRef.current = dc

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

    try {
      const { sdp } = await createVoiceSession(pc.localDescription?.sdp ?? '', openaiApiKey)
      await pc.setRemoteDescription({ type: 'answer', sdp })
    } catch (err) {
      pc.close()
      micStream.getTracks().forEach((track) => track.stop())
      pcRef.current = null
      dcRef.current = null
      micStreamRef.current = null
      setErrorMessage(err instanceof Error ? err.message : String(err))
      setStatus('error')
      return
    }

    setStatus('listening')
  }

  function toggle() {
    if (statusRef.current === 'idle' || statusRef.current === 'error') {
      void connect()
    } else {
      stop()
    }
  }

  function speak(text: string) {
    const dc = dcRef.current
    if (!dc || dc.readyState !== 'open' || !delegationIdRef.current) return
    setStatus('speaking')
    dc.send(
      JSON.stringify({
        type: 'session.commentary.append',
        event_id: `commentary_${Date.now()}`,
        delegation_id: delegationIdRef.current,
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
