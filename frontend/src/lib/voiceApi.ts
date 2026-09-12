const CHAT_API = '/api/bible-chat'

export interface VoiceSessionResult {
  sessionId: string
  sdp: string
}

/**
 * Proxies the WebRTC SDP handshake for a GPT-Live voice session through
 * this app's backend, which makes the one authenticated call to OpenAI on
 * the caller's behalf — see chatbot/api.py::create_voice_session. The key
 * is sent once, in a header, and never stored by this client either.
 */
export async function createVoiceSession(
  sdp: string,
  apiKey: string,
  hasHistory: boolean = false
): Promise<VoiceSessionResult> {
  const res = await fetch(`${CHAT_API}/voice/session`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-OpenAI-Key': apiKey,
    },
    body: JSON.stringify({ sdp, has_history: hasHistory }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(body?.detail || `Request failed: ${res.status} ${res.statusText}`)
  }
  const data = await res.json()
  return { sessionId: data.session_id, sdp: data.sdp }
}
