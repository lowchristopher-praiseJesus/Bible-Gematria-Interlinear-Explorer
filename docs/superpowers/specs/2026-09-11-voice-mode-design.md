# Voice Mode (GPT-Live) Design Spec

**Date:** 2026-09-11
**Status:** Draft

## Purpose

Let a user speak their Bible-study questions instead of typing, and hear the
answer spoken back, using OpenAI's **GPT-Live** (`gpt-live-1`) full-duplex
voice API. GPT-Live handles microphone capture, turn detection, and speech
transcription/synthesis; it does **not** generate the answers. The existing
text-chat pipeline (`ChatPane.tsx` → `postChatStream` → `router.py` →
`ollama_client.py`, backed by NVIDIA NIM or Ollama depending on
`LLM_PROVIDER` — the function is named `route_claude` for historical reasons
but no longer calls Claude) stays the sole source of answers, unchanged.
Voice is an I/O layer around that pipeline, not a second brain.

There are no user accounts in this app. Each visitor supplies their **own**
OpenAI API key (bring-your-own-key), pasted into Settings and stored only in
that browser's `localStorage`, matching how theme, reading-plan progress, and
session history already work. The app owner's server never holds a
real key long-term and never pays for anyone's voice usage.

## Scope

**In scope:**

- A **Voice** section in `SettingsPanel.tsx`: masked API-key input, show/hide
  toggle, clear button. Key lives in a new persisted store,
  `useVoiceSettingsStore`.
- A **voice mode toggle** in `ChatPane.tsx`'s header, next to the existing
  Share control. Enabling it opens a GPT-Live session; the user talks, sees
  a live caption of their own speech, and hears the assistant's answer
  spoken back. Disabling it (or an explicit Stop) tears the session down.
- One new backend route, `POST /api/bible-chat/voice/session`, added to
  `chatbot/api.py`. It proxies the WebRTC SDP handshake to OpenAI's
  `POST /v1/live/sessions` using the caller-supplied key, and returns only
  the SDP answer — the key is used once and discarded, never logged or
  persisted server-side.
- A new frontend module (`useVoiceMode` hook, colocated with `ChatPane`)
  owning the `RTCPeerConnection`, the `oai-events` data channel, transcript
  accumulation, and pushing finished answers back via
  `session.commentary.append`.
- A minimal, additive change to `ChatPane.tsx`'s existing `sendMessage`: after
  `streamAssistantReply` resolves, if voice mode is active, hand the final
  answer text to the voice hook so it can be spoken.
- Tests: backend route tests (`tests/chatbot`), a store test for
  `useVoiceSettingsStore`, and `useVoiceMode` tests against a mocked
  `RTCPeerConnection`/`getUserMedia`.

**Out of scope:**

- A site-wide/server-held OpenAI key. Rejected in favor of BYOK — see
  Rejected Approaches.
- Letting GPT-Live generate its own answers (`delegation: "responses"` or no
  delegation at all). The session is always created with
  `delegation: { type: "client" }` so your existing tool-grounded pipeline
  (verse lookup, gematria, Strong's) stays the only answer source.
- Telephony/SIP, WebSocket transport, or any non-browser client. Browser
  WebRTC only.
- Voice for the legacy `BibleChatWidget` (the embeddable widget). This adds
  voice to the main React shell's `ChatPane` only, matching how the Share
  feature was scoped.
- Persisting or replaying voice audio. Only the resulting text (user
  transcript, assistant reply) is ever written into the session — same
  `SessionMessage` shape a typed turn produces. No audio blobs are stored.
- Rate limiting / abuse controls on the new endpoint beyond what already
  exists. Cost falls on each user's own key, which is the main abuse
  deterrent; see Error Handling for the minimal guardrails that are in
  scope (body size, no key logging).
- Keeping a voice session alive across a session switch in the sidebar.
  Switching the open conversation while voice mode is on stops the voice
  session first (see Data Flow).

## Architecture Overview

| Component | Location | Responsibility |
|---|---|---|
| Voice settings store | `frontend/src/store/useVoiceSettingsStore.ts` | Persist the user's OpenAI key (localStorage only) |
| Settings UI | `frontend/src/components/shell/SettingsPanel.tsx` | Add/clear/show the key |
| Voice session proxy | `chatbot/api.py` (`POST /voice/session`, mounted at `/api/bible-chat/voice/session`) | One-shot SDP handshake proxy to OpenAI; never stores the key |
| Voice mode hook | `frontend/src/components/shell/useVoiceMode.ts` (new) | Own the `RTCPeerConnection` + data channel; turn transcripts into `sendMessage` calls; turn finished answers into `commentary.append` |
| Chat pane wiring | `frontend/src/components/shell/ChatPane.tsx` | Voice toggle in the header; one-line hook in `sendMessage` to hand off the finished answer to the voice module |

**Guiding principle:** your server is a signaling relay for exactly one HTTP
call per voice session (the SDP handshake) and never touches audio or the
conversation content. Once the WebRTC connection is up, audio and the
`oai-events` data channel flow directly between the browser and OpenAI. The
answer content always originates from your existing pipeline, never from
GPT-Live itself.

### Session flow

```
User taps the mic/voice toggle in ChatPane
  → browser creates RTCPeerConnection, mic track, "oai-events" data channel
  → creates SDP offer, waits for ICE gathering to complete

  → POST /api/bible-chat/voice/session   (nginx → flask-api → chatbot:8020)
      body: { sdp: <offer> }
      header: X-OpenAI-Key: <user's key, from useVoiceSettingsStore>
    chatbot backend
      → POST https://api.openai.com/v1/live/sessions
          Authorization: Bearer <user's key>
          { model: "gpt-live-1",
            delegation: { type: "client" },
            transport: { type: "webrtc", sdp: <offer> } }
      ← { session: { id }, transport: { sdp: <answer> } }
    key discarded here — never written to a variable that outlives the request
  ← { session_id, sdp: <answer> }   (key never echoed back)

  → browser: setRemoteDescription(answer); WebRTC connects directly to OpenAI

--- per spoken turn ---
User speaks
  → GPT-Live streams `session.input_transcript.delta` events on the data
    channel (live captions in the UI) and, once the turn ends, signals via
    `session.delegation.created` (carries a delegation_id, not the text)
  → browser has been accumulating the delta text; on delegation.created it
    treats the accumulated text as the finished transcript

  → ChatPane.sendMessage(transcript)   — identical code path to typed input
  → existing SSE pipeline: postChatStream → /api/bible-chat/chat/stream
    → router.py → ollama_client.py (NVIDIA NIM or Ollama)
  ← streamed text, same as today; final response.message available when
    streamAssistantReply resolves

  → voice hook sends session.commentary.append
      { delegation_id, content: response.message }
  → GPT-Live speaks it; audio arrives on the WebRTC media track
  → browser attaches it to an <audio> element via ontrack

User taps Stop, or toggles voice off, or switches sessions
  → data channel + peer connection closed, mic track stopped
```

## Frontend: Settings

### `useVoiceSettingsStore.ts` (new)

Mirrors `useThemeStore`'s shape:

```ts
interface VoiceSettingsState {
  openaiApiKey: string | null
  setApiKey: (key: string) => void
  clearApiKey: () => void
}
```

`persist({ name: 'bible-explorer-voice-settings', version: 1 })`. Nothing
else about voice mode (connection state, transcripts) belongs in a
persisted store — that's transient session state, owned by `useVoiceMode`.

### `SettingsPanel.tsx` changes

New section between **Bible in a Year** and **Data**, following the existing
`SectionLabel` + card pattern:

- A password-style `<input>` (masked by default) bound to `openaiApiKey`,
  with a show/hide eye-icon toggle (no new dependency — a local `useState`
  boolean controlling `type="password" | "text"`).
- Save happens on blur/change, same as other settings (no separate Save
  button, matching the rest of the panel's "changes apply immediately"
  feel).
- A **Clear** action (in the same double-click-to-confirm style already used
  for "Clear all chat history") that clears the key. If a voice session is
  currently open using that key, clearing it also stops the session — the
  panel dispatches through the same store/hook `useVoiceMode` subscribes to,
  so this falls out of the hook watching `openaiApiKey` for a transition to
  `null`.
- Helper copy: "Used only in your browser to start a voice session with
  OpenAI's GPT-Live. Your key is sent to this app's server once per session
  to set up the connection, then discarded — never stored server-side."

## Backend: `POST /voice/session`

New handler in `chatbot/api.py`, mounted (via the existing router) at
`/api/bible-chat/voice/session` — no nginx change; it falls under the
existing `location /api/` proxy block alongside every other non-streaming
`bible-chat` route.

```python
@router.post("/voice/session")
async def create_voice_session(
    request: VoiceSessionRequest,          # { sdp: str }
    x_openai_key: str = Header(..., alias="X-OpenAI-Key"),
):
    ...
```

- `X-OpenAI-Key` is a header, never a query string or body field that could
  end up in an access log line.
- Body size guard (a raw SDP offer is a few KB; reject anything absurd, e.g.
  > 64 KB, before parsing — mirrors the `_MAX_SHARE_BYTES` pattern in
  `myproject.py`, scaled down).
- Makes exactly one `httpx` call to `POST https://api.openai.com/v1/live/sessions`
  with `Authorization: Bearer {x_openai_key}`, body:
  ```json
  { "model": "gpt-live-1",
    "delegation": { "type": "client" },
    "transport": { "type": "webrtc", "sdp": "<offer>" } }
  ```
- On success: return `{ "session_id": ..., "sdp": <answer sdp> }`.
- On any failure (bad key → OpenAI 401, rate limited → 429, network error):
  map to a clean `4xx`/`502` with a generic message
  (`"Couldn't start a voice session — check your OpenAI API key in
  Settings."` for 401s, `"OpenAI is rate-limiting this key right now."` for
  429s, a generic connection-failed message otherwise). **Never** include
  OpenAI's raw response body in the error we return, since it could contain
  a fragment of the request including the key.
- The key variable goes out of scope at the end of the request handler; it
  is never written to `trace.py`'s recorder, never logged via the app's
  existing logging, and the request/response bodies for this route are
  excluded from any trace/logging middleware that might otherwise capture
  headers.

`VoiceSessionRequest` / a small `VoiceSessionResponse` go in `chatbot/schemas.py`
next to the existing request/response models.

## Frontend: `useVoiceMode` hook

Lives alongside `ChatPane.tsx` (either in the same file or a sibling
`useVoiceMode.ts`, whichever keeps `ChatPane.tsx` from growing too large —
implementation's call). Instantiated once per `ChatPane` instance (i.e.,
scoped to the currently open session), not a global singleton.

**State machine:** `idle → connecting → listening → thinking → speaking →
listening (loop) | error`. Exposed to `ChatPane` as
`{ status, error, toggle(), stop() }`.

**Responsibilities:**

- `toggle()` — if no `openaiApiKey` in `useVoiceSettingsStore`, sets
  `status: 'error'` with a "add your key in Settings" message and returns
  without touching the mic. Otherwise requests `getUserMedia({ audio: true })`,
  builds the `RTCPeerConnection`, creates the `oai-events` data channel,
  does the offer/`POST /voice/session`/answer dance from the flow above, and
  moves to `listening` once the connection and data channel are open.
- Accumulates `session.input_transcript.delta` text for the in-progress
  turn (shown live as a caption in the chat header/toggle area — not
  written into the session's message list until the turn is final, so a
  false start doesn't leave a stray user bubble).
- On `session.delegation.created`: takes the accumulated transcript, and if
  it's non-empty after trimming, calls `ChatPane`'s `sendMessage(transcript)`
  — the exact same function a typed message uses, so history, mode params,
  and the existing SSE plumbing are untouched. Clears the accumulator for
  the next turn. If the transcript is empty (false trigger / noise), it's
  dropped silently and the hook returns to `listening`.
- `speak(text)` — called by `ChatPane` once `streamAssistantReply` resolves
  for a voice-originated turn (see wiring below). Sends
  `session.commentary.append` with the delegation id captured from the
  triggering `session.delegation.created` event and the answer text. Moves
  status to `speaking`; moves back to `listening` when GPT-Live's audio
  track signals it has stopped (or, if no explicit end signal is available,
  falls back to `ontrack`'s audio element `onended`/silence detection —
  exact mechanism is one of the implementation spike's questions, see
  below).
- `stop()` — closes the data channel and peer connection, stops all local
  mic tracks, resets to `idle`. Called on: explicit user action, the key
  being cleared in Settings, `ChatPane` unmounting, or the open session
  changing (switching conversations in the sidebar stops voice mode rather
  than trying to carry it across sessions — see Scope).

**Wiring into `ChatPane.sendMessage`:** a minimal, additive change — after
the existing `await streamAssistantReply(...)` call in `sendMessage` (and
only there, not in `regenerate` or the devotional path, which aren't part of
this feature), if the turn was voice-originated, hand the resolved
response's `message` text to the voice hook's `speak()`. The simplest way to
track "was this turn voice-originated" is for the voice hook's transcript
handoff to also flip a short-lived ref (`lastTurnWasVoice.current = true`)
that `sendMessage` checks and clears after the call — avoids threading a new
parameter through every `streamAssistantReply` call site.

## Error Handling

- **No key saved**: voice toggle shows an inline prompt pointing at
  Settings; never touches `getUserMedia` or the backend.
- **Mic permission denied**: inline error from the `getUserMedia` rejection;
  toggle reverts to `idle`.
- **`POST /voice/session` fails** (bad key, rate limited, network): the
  backend's clean error message is shown inline; toggle reverts to `idle`;
  no partial `RTCPeerConnection` is left open (closed in the `catch`).
- **WebRTC negotiation/ICE failure or timeout**: same as above — treated as
  a connection error, mic released, toggle reverts.
- **Mid-session drop** (data channel or peer connection closes
  unexpectedly): `stop()` runs, a small toast explains the voice session
  ended; the rest of the chat (typed input, history) is completely
  unaffected since it shares no state with the voice hook beyond
  `sendMessage`.
- **`/chat/stream` fails for a voice-originated turn**: the existing
  `streamAssistantReply` catch already puts an error message in the chat
  bubble (`"Sorry, something went wrong: ..."`); the voice hook additionally
  speaks a short fallback (`"Sorry, something went wrong."`) via
  `commentary.append` so the user isn't left in silence waiting for audio
  that will never come.
- **Empty/noise transcript**: dropped before ever reaching `sendMessage`
  (see hook responsibilities above).
- **Key cleared mid-session**: `useVoiceMode` watches
  `useVoiceSettingsStore`'s `openaiApiKey`; a transition to `null` while
  `status !== 'idle'` calls `stop()`.
- **Session switch while voice mode is on**: `ChatPane` unmount/session-id
  change calls `stop()` before anything else (see Scope: not carried across
  sessions).

## Testing

**Backend — `chatbot/api.py::create_voice_session`:**

- Happy path: mocked `httpx` call to `/v1/live/sessions` — asserts the key
  is forwarded as `Authorization: Bearer <key>`, the response maps
  `session.id`/`transport.sdp` into `{ session_id, sdp }`.
- Oversize SDP body → `4xx` before the OpenAI call is attempted.
- Simulated OpenAI `401` → our `4xx` with the generic "check your key"
  message; **the raw OpenAI response body is not present** in ours.
- Simulated OpenAI `429` → our `429`/`503` with the rate-limit message.
- The key never appears in `trace.py` output or captured logs for this
  route (assert on whatever logging/trace fixture the other `tests/chatbot`
  route tests already use).

**Frontend — `useVoiceSettingsStore`:**

- `setApiKey`/`clearApiKey` persist and round-trip through
  hydrate/rehydrate, same shape as `useThemeStore.test.ts`.

**Frontend — `useVoiceMode`** (mocked `RTCPeerConnection`, `getUserMedia`,
and a fake data channel that can be fed synthetic events):

- No key → `toggle()` sets the "add a key" error and never calls
  `getUserMedia`.
- Permission denied → error state, no connection attempted.
- `/voice/session` rejected → error state, peer connection closed.
- Feeding synthetic `session.input_transcript.delta` events followed by
  `session.delegation.created` → `sendMessage` is called once with the
  accumulated (trimmed) text; accumulator resets for the next turn.
- An all-whitespace accumulated transcript at `delegation.created` →
  `sendMessage` is **not** called.
- `speak(text)` → sends a `session.commentary.append` message on the data
  channel shaped `{ delegation_id, content: text }`.
- `stop()` → closes the peer connection and stops every track obtained from
  the mocked `getUserMedia` stream.

**Frontend — `ChatPane` wiring:**

- Extend `ChatPane.test.tsx`: the voice toggle renders; with `useVoiceMode`
  mocked, confirm `sendMessage`'s post-`streamAssistantReply` hook calls
  `speak()` with the resolved response's `message` exactly when the
  short-lived "voice-originated" ref was set, and does not call it for a
  normal typed turn.

**Manual browser pass** (WebRTC/mic/real OpenAI round trip can't be
scripted): real mic permission prompt; a live session against OpenAI
confirms live captions render, `commentary.append` is spoken close to
verbatim, full-duplex listen-while-speaking behaves reasonably, and Stop
visibly releases the mic (browser's own mic-in-use indicator turns off).
Per this repo's convention, this manual pass happens in an actual browser
before the feature is called done, not just via the automated tests above.

## Open Questions — Resolve With an Early Implementation Spike

The GPT-Live documentation fetched for this spec doesn't fully pin down two
mechanics; rather than guess, the plan is to confirm both with a minimal
spike (one session, one delegated turn, one `commentary.append`) before
building the full toggle/state-machine around them:

1. **Exact turn-completion signal.** This spec assumes accumulated
   `session.input_transcript.delta` text up to a `session.delegation.created`
   event is the finished user utterance. If logging real events shows a
   different/better completion signal (e.g. a dedicated "transcript done"
   event), the hook's accumulation logic adjusts — it's an isolated piece,
   not load-bearing for anything else in this design.
2. **Speech fidelity of `commentary.append`.** Whether GPT-Live speaks the
   appended text essentially verbatim or takes some latitude restyling it
   for speech. If it paraphrases more than acceptable, tightening the
   session's `instructions` field (set at session-creation time) is the
   first lever to try before considering any structural change.

## Rejected Approaches

- **Realtime API (`gpt-realtime-2.1`) with manually-minted ephemeral
  tokens**, generating answers via a "speak this text verbatim" prompt hack.
  This was the original plan before re-checking the docs the user linked;
  rejected once it became clear GPT-Live's `delegation: "client"` mode is
  the purpose-built version of exactly this pattern, with no ephemeral-token
  plumbing needed for GPT-Live's documented browser flow.
- **Site-wide server-held API key.** Rejected: this app has no accounts or
  billing, so a shared key means the site owner pays for every visitor's
  voice usage with no natural cap. BYOK keeps cost and abuse risk with the
  person using their own key, consistent with the app's no-backend-state
  philosophy for user data.
- **`delegation: "responses"` mode** (let GPT-Live call a backend LLM
  itself). Rejected: it would mean re-pointing GPT-Live's own backend model
  config at NVIDIA/Ollama instead of going through `router.py`, which would
  bypass the deterministic routing, verse/gematria/Strong's tools, and
  mode-primer logic that `router.py` and `ollama_client.py` already provide
  — effectively a second, parallel answer pipeline to keep in sync with the
  first.
- **Voice for `BibleChatWidget`.** Out of scope for the same reason the
  Share feature stayed out of it: it's the embeddable widget, not the main
  shell, and adding a WebRTC dependency there duplicates work for a surface
  this pass isn't targeting.
- **Ephemeral-token / browser-direct-to-OpenAI pattern** (skip the app
  server after an initial token mint, as Realtime API supports). GPT-Live's
  documentation only demonstrates the server-proxied "unified interface"
  handshake, not an ephemeral-token variant — building against the
  documented, supported flow instead of an unverified one.
