# Voice Mode (GPT-Live) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user speak Bible-study questions and hear answers spoken back, using OpenAI's GPT-Live (`gpt-live-1`) for microphone capture, turn detection, transcription, and speech synthesis — while the existing NVIDIA-NIM/Ollama text pipeline stays the sole source of answers.

**Architecture:** A BYOK OpenAI key lives only in a new localStorage-persisted frontend store. A single new backend route (`POST /api/bible-chat/voice/session`) proxies the WebRTC SDP handshake to OpenAI's `/v1/live/sessions`, using the caller's key once and never storing it. Once connected, the browser talks to OpenAI directly over WebRTC in `delegation: { type: "client" }` mode: GPT-Live transcribes what the user says and, on `session.delegation.created`, the frontend forwards the transcript into the existing `ChatPane.sendMessage` → `/chat/stream` pipeline exactly like typed input. When that pipeline's answer resolves, the frontend sends it back over the data channel via `session.commentary.append` and GPT-Live speaks it.

**Tech Stack:** FastAPI (`chatbot/api.py`), `httpx` for the outbound OpenAI call, React + Zustand (`persist` middleware) on the frontend, native browser `RTCPeerConnection`/`getUserMedia`, Vitest + Testing Library for frontend tests, pytest for backend tests.

**Spec:** `docs/superpowers/specs/2026-09-11-voice-mode-design.md`

## Global Constraints

- Model id is exactly `"gpt-live-1"`. Every session is created with `"delegation": { "type": "client" }` — GPT-Live must never generate its own answer text.
- OpenAI endpoint for the SDP handshake: `POST https://api.openai.com/v1/live/sessions`.
- The new backend route is mounted under the existing `/api/bible-chat` prefix (via `chatbot/api.py`'s router) — no nginx changes, it falls under the existing `location /api/` proxy block.
- The user's OpenAI key is sent to the backend only in the `X-OpenAI-Key` header, never a query string or body field, and the backend must never log it, persist it, or echo it back in an error response.
- The frontend key store is `useVoiceSettingsStore`, persisted to localStorage under the key `bible-explorer-voice-settings`, mirroring `useThemeStore`'s shape.
- The existing text-answer pipeline (`ChatPane.tsx` → `postChatStream` → `router.py` → `ollama_client.py`, NVIDIA NIM or Ollama depending on `LLM_PROVIDER`) is never bypassed or duplicated. Voice only supplies transcribed input and spoken output around it.
- Out of scope for this plan (do not implement): voice in `BibleChatWidget` (the embeddable widget), SIP/telephony, WebSocket transport, persisting or replaying audio, carrying a voice session across a sidebar session switch, or any ephemeral-token auth variant (GPT-Live's documented browser flow is the server-proxied SDP handshake used here, not ephemeral tokens).

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `frontend/src/store/useVoiceSettingsStore.ts` | new | Persist the user's OpenAI key (localStorage only) |
| `frontend/src/store/useVoiceSettingsStore.test.ts` | new | Store tests |
| `frontend/src/components/shell/SettingsPanel.tsx` | modify | Add the Voice section (key input, show/hide, clear) |
| `frontend/src/components/shell/SettingsPanel.test.tsx` | modify | Tests for the new section |
| `chatbot/schemas.py` | modify | Add `VoiceSessionRequest` / `VoiceSessionResponse` |
| `chatbot/api.py` | modify | Add `POST /voice/session` |
| `tests/chatbot/test_voice_session_endpoint.py` | new | Route tests |
| `frontend/src/lib/voiceApi.ts` | new | `createVoiceSession()` — thin fetch wrapper around the new route |
| `frontend/src/lib/voiceApi.test.ts` | new | Client tests |
| `frontend/src/components/shell/useVoiceMode.ts` | new | WebRTC session state machine: connect, transcript accumulation, delegation handoff, `speak()`, `stop()` |
| `frontend/src/components/shell/useVoiceMode.test.ts` | new | Hook tests against mocked WebRTC/mic globals |
| `frontend/src/components/shell/ChatPane.tsx` | modify | Voice toggle in the header, live caption, `sendMessage` → `speak()` handoff |
| `frontend/src/components/shell/ChatPane.test.tsx` | modify | Tests for the new wiring |

---

### Task 1: `useVoiceSettingsStore`

**Files:**
- Create: `frontend/src/store/useVoiceSettingsStore.ts`
- Test: `frontend/src/store/useVoiceSettingsStore.test.ts`

**Interfaces:**
- Produces: `useVoiceSettingsStore` — a Zustand store hook with state `{ openaiApiKey: string | null }` and actions `setApiKey(key: string): void`, `clearApiKey(): void`. Persisted under localStorage key `bible-explorer-voice-settings`.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/store/useVoiceSettingsStore.test.ts
import { beforeEach, describe, expect, it } from 'vitest'
import { useVoiceSettingsStore } from './useVoiceSettingsStore'

describe('useVoiceSettingsStore', () => {
  beforeEach(() => {
    localStorage.clear()
    useVoiceSettingsStore.setState({ openaiApiKey: null })
  })

  it('defaults to no key', () => {
    expect(useVoiceSettingsStore.getState().openaiApiKey).toBeNull()
  })

  it('setApiKey updates state and persists to localStorage', () => {
    useVoiceSettingsStore.getState().setApiKey('sk-test-123')
    expect(useVoiceSettingsStore.getState().openaiApiKey).toBe('sk-test-123')
    const stored = JSON.parse(localStorage.getItem('bible-explorer-voice-settings') ?? '{}')
    expect(stored.state.openaiApiKey).toBe('sk-test-123')
  })

  it('clearApiKey resets state and localStorage', () => {
    useVoiceSettingsStore.getState().setApiKey('sk-test-123')
    useVoiceSettingsStore.getState().clearApiKey()
    expect(useVoiceSettingsStore.getState().openaiApiKey).toBeNull()
    const stored = JSON.parse(localStorage.getItem('bible-explorer-voice-settings') ?? '{}')
    expect(stored.state.openaiApiKey).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `cd frontend && npx vitest run src/store/useVoiceSettingsStore.test.ts`
Expected: FAIL — `useVoiceSettingsStore.ts` doesn't exist yet.

- [ ] **Step 3: Implement the store**

```ts
// frontend/src/store/useVoiceSettingsStore.ts
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface VoiceSettingsState {
  openaiApiKey: string | null
  setApiKey: (key: string) => void
  clearApiKey: () => void
}

export const useVoiceSettingsStore = create<VoiceSettingsState>()(
  persist(
    (set) => ({
      openaiApiKey: null,
      setApiKey: (key) => set({ openaiApiKey: key }),
      clearApiKey: () => set({ openaiApiKey: null }),
    }),
    { name: 'bible-explorer-voice-settings', version: 1 }
  )
)
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `cd frontend && npx vitest run src/store/useVoiceSettingsStore.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/store/useVoiceSettingsStore.ts frontend/src/store/useVoiceSettingsStore.test.ts
git commit -m "feat(voice): add localStorage-persisted OpenAI key store"
```

---

### Task 2: Settings UI — Voice section

**Files:**
- Modify: `frontend/src/components/shell/SettingsPanel.tsx`
- Modify: `frontend/src/components/shell/SettingsPanel.test.tsx`

**Interfaces:**
- Consumes: `useVoiceSettingsStore` from Task 1 — `openaiApiKey: string | null`, `setApiKey(key: string): void`, `clearApiKey(): void`.

- [ ] **Step 1: Write the failing tests**

Add to `frontend/src/components/shell/SettingsPanel.test.tsx`, alongside the existing imports and `beforeEach`:

```ts
import { useVoiceSettingsStore } from '@/store/useVoiceSettingsStore'
```

Add `useVoiceSettingsStore.setState({ openaiApiKey: null })` to the existing `beforeEach` block.

Add new test cases:

```ts
  it('saves an OpenAI API key as it is typed', async () => {
    render(<SettingsPanel />)
    await userEvent.click(screen.getByRole('button', { name: /settings/i }))
    const input = screen.getByLabelText(/openai api key/i)
    await userEvent.type(input, 'sk-test-123')
    expect(useVoiceSettingsStore.getState().openaiApiKey).toBe('sk-test-123')
  })

  it('masks the API key by default and reveals it on toggle', async () => {
    useVoiceSettingsStore.getState().setApiKey('sk-test-123')
    render(<SettingsPanel />)
    await userEvent.click(screen.getByRole('button', { name: /settings/i }))
    const input = screen.getByLabelText(/openai api key/i) as HTMLInputElement
    expect(input.type).toBe('password')
    await userEvent.click(screen.getByRole('button', { name: /show api key/i }))
    expect(input.type).toBe('text')
  })

  it('requires a second click to clear the API key', async () => {
    useVoiceSettingsStore.getState().setApiKey('sk-test-123')
    render(<SettingsPanel />)
    await userEvent.click(screen.getByRole('button', { name: /settings/i }))
    const clearButton = screen.getByRole('button', { name: /clear key/i })
    await userEvent.click(clearButton)
    expect(useVoiceSettingsStore.getState().openaiApiKey).toBe('sk-test-123')
    await userEvent.click(screen.getByRole('button', { name: /click again to confirm/i }))
    expect(useVoiceSettingsStore.getState().openaiApiKey).toBeNull()
  })

  it('hides the Clear key button when no key is set', async () => {
    render(<SettingsPanel />)
    await userEvent.click(screen.getByRole('button', { name: /settings/i }))
    expect(screen.queryByRole('button', { name: /clear key/i })).not.toBeInTheDocument()
  })
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd frontend && npx vitest run src/components/shell/SettingsPanel.test.tsx`
Expected: FAIL — no element with label `/openai api key/i` exists yet.

- [ ] **Step 3: Implement the Voice section**

In `frontend/src/components/shell/SettingsPanel.tsx`:

Change the icon import line to add `Eye`, `EyeOff`, `KeyRound`:

```ts
import { CalendarDays, Check, Download, Eye, EyeOff, KeyRound, RotateCcw, Settings, Trash2, Upload, X } from 'lucide-react'
```

Add the store import:

```ts
import { useVoiceSettingsStore } from '@/store/useVoiceSettingsStore'
```

Extend the `Pending` union type:

```ts
type Pending =
  | { kind: 'clear' }
  | { kind: 'plan'; plan: ReadingPlanProgress['plan'] }
  | { kind: 'reset' }
  | { kind: 'clearVoiceKey' }
  | null
```

Inside `SettingsPanel()`, alongside the other store hooks near the top of the function body:

```ts
  const openaiApiKey = useVoiceSettingsStore((s) => s.openaiApiKey)
  const setApiKey = useVoiceSettingsStore((s) => s.setApiKey)
  const clearApiKey = useVoiceSettingsStore((s) => s.clearApiKey)
  const [showKey, setShowKey] = useState(false)
```

Add a handler alongside `handleClearClick` / `handleResetClick`:

```ts
  function handleClearVoiceKeyClick() {
    if (pending?.kind !== 'clearVoiceKey') {
      setPending({ kind: 'clearVoiceKey' })
      return
    }
    clearApiKey()
    setPending(null)
  }
```

Insert a new section between the **Bible in a Year** `{readingPlan && (...)}` block and the **Data** section (both inside the `<div className="flex flex-col gap-7">` wrapper):

```tsx
              {/* ── Voice ──────────────────────────────────────────────── */}
              <section className="flex flex-col gap-2">
                <SectionLabel icon={<KeyRound className="h-3.5 w-3.5" aria-hidden="true" />}>
                  Voice
                </SectionLabel>
                <div className="flex items-center gap-1.5 rounded-xl border border-[var(--color-theme-border)] px-3">
                  <input
                    type={showKey ? 'text' : 'password'}
                    value={openaiApiKey ?? ''}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="OpenAI API key (sk-...)"
                    aria-label="OpenAI API key"
                    className="min-h-11 flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--color-text-secondary)]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey((v) => !v)}
                    aria-label={showKey ? 'Hide API key' : 'Show API key'}
                    className="shrink-0 rounded-lg p-1.5 text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-alt)]"
                  >
                    {showKey ? (
                      <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
                    ) : (
                      <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                  </button>
                </div>
                {!!openaiApiKey && (
                  <button
                    type="button"
                    onClick={handleClearVoiceKeyClick}
                    className={cn(
                      'inline-flex min-h-11 w-fit items-center gap-1.5 rounded-lg px-3 text-sm transition-colors',
                      pending?.kind === 'clearVoiceKey'
                        ? 'bg-[var(--color-danger)]/10 font-medium text-[var(--color-danger)]'
                        : 'text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10',
                    )}
                  >
                    <Trash2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    {pending?.kind === 'clearVoiceKey' ? 'Click again to confirm' : 'Clear key'}
                  </button>
                )}
                <p className="text-xs leading-relaxed text-[var(--color-text-secondary)]">
                  Used only in your browser to start a voice session with OpenAI&apos;s GPT-Live.
                  Your key is sent to this app&apos;s server once per session to set up the
                  connection, then discarded — never stored server-side.
                </p>
              </section>

```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `cd frontend && npx vitest run src/components/shell/SettingsPanel.test.tsx`
Expected: PASS (all tests, old and new)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/shell/SettingsPanel.tsx frontend/src/components/shell/SettingsPanel.test.tsx
git commit -m "feat(voice): add OpenAI API key field to Settings"
```

---

### Task 3: Backend — `POST /voice/session`

**Files:**
- Modify: `chatbot/schemas.py`
- Modify: `chatbot/api.py`
- Create: `tests/chatbot/test_voice_session_endpoint.py`

**Interfaces:**
- Produces: `VoiceSessionRequest { sdp: str }`, `VoiceSessionResponse { session_id: str, sdp: str }` (in `chatbot/schemas.py`); route `POST /voice/session` (mounted at `/api/bible-chat/voice/session`) taking header `X-OpenAI-Key` and body `{ sdp }`, returning `{ session_id, sdp }` on success.

- [ ] **Step 1: Write the failing tests**

```python
# tests/chatbot/test_voice_session_endpoint.py
"""Tests for POST /voice/session — proxies the GPT-Live WebRTC SDP
handshake using a caller-supplied OpenAI key, never persisting it."""

import json

import httpx

import chatbot.api as api


def _install_transport(monkeypatch, handler):
    transport = httpx.MockTransport(handler)
    real_async_client = httpx.AsyncClient

    def client_factory(*args, **kwargs):
        kwargs["transport"] = transport
        return real_async_client(*args, **kwargs)

    monkeypatch.setattr(api.httpx, "AsyncClient", client_factory)


def test_create_voice_session_happy_path(client, monkeypatch):
    def handler(request):
        assert str(request.url) == "https://api.openai.com/v1/live/sessions"
        assert request.headers["Authorization"] == "Bearer sk-test-123"
        payload = json.loads(request.content)
        assert payload["model"] == "gpt-live-1"
        assert payload["delegation"] == {"type": "client"}
        assert payload["transport"] == {"type": "webrtc", "sdp": "fake-offer-sdp"}
        return httpx.Response(
            200,
            json={"session": {"id": "live_123"}, "transport": {"sdp": "fake-answer-sdp"}},
        )

    _install_transport(monkeypatch, handler)
    res = client.post(
        "/voice/session",
        json={"sdp": "fake-offer-sdp"},
        headers={"X-OpenAI-Key": "sk-test-123"},
    )
    assert res.status_code == 200
    assert res.json() == {"session_id": "live_123", "sdp": "fake-answer-sdp"}


def test_create_voice_session_missing_key_header(client):
    res = client.post("/voice/session", json={"sdp": "fake-offer-sdp"})
    assert res.status_code == 422


def test_create_voice_session_oversize_sdp_rejected_before_openai_call(client, monkeypatch):
    def fail_if_called(request):
        raise AssertionError("oversize SDP must not reach OpenAI")

    _install_transport(monkeypatch, fail_if_called)
    res = client.post(
        "/voice/session",
        json={"sdp": "x" * (64 * 1024 + 1)},
        headers={"X-OpenAI-Key": "sk-test-123"},
    )
    assert res.status_code == 413


def test_create_voice_session_bad_key_maps_to_clean_401(client, monkeypatch):
    def handler(request):
        return httpx.Response(401, json={"error": {"message": "Incorrect API key provided: sk-test-123"}})

    _install_transport(monkeypatch, handler)
    res = client.post(
        "/voice/session",
        json={"sdp": "fake-offer-sdp"},
        headers={"X-OpenAI-Key": "sk-test-123"},
    )
    assert res.status_code == 401
    assert "sk-test-123" not in res.text
    assert res.json()["detail"] == "Couldn't start a voice session — check your OpenAI API key in Settings."


def test_create_voice_session_rate_limited_maps_to_429(client, monkeypatch):
    def handler(request):
        return httpx.Response(429, json={"error": {"message": "rate limited"}})

    _install_transport(monkeypatch, handler)
    res = client.post(
        "/voice/session",
        json={"sdp": "fake-offer-sdp"},
        headers={"X-OpenAI-Key": "sk-test-123"},
    )
    assert res.status_code == 429


def test_create_voice_session_network_error_maps_to_502(client, monkeypatch):
    def handler(request):
        raise httpx.ConnectError("network down", request=request)

    _install_transport(monkeypatch, handler)
    res = client.post(
        "/voice/session",
        json={"sdp": "fake-offer-sdp"},
        headers={"X-OpenAI-Key": "sk-test-123"},
    )
    assert res.status_code == 502
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `python -m pytest tests/chatbot/test_voice_session_endpoint.py -v`
Expected: FAIL — `/voice/session` returns 404 (route doesn't exist).

- [ ] **Step 3: Implement the schemas**

Add to `chatbot/schemas.py` (anywhere after `SSEChunk`, matching the file's existing style):

```python
class VoiceSessionRequest(BaseModel):
    sdp: str = Field(..., description="Browser's WebRTC SDP offer")


class VoiceSessionResponse(BaseModel):
    session_id: str = Field(..., description="GPT-Live session id")
    sdp: str = Field(..., description="OpenAI's WebRTC SDP answer")
```

- [ ] **Step 4: Implement the route**

In `chatbot/api.py`, change the fastapi import line:

```python
from fastapi import APIRouter, Header, HTTPException, Query
```

Add `import httpx` to the top-level imports (alongside `import asyncio`).

Add `VoiceSessionRequest, VoiceSessionResponse` to the `chatbot.schemas` import block.

Add near the bottom of the file (after the existing routes):

```python
_MAX_VOICE_SDP_BYTES = 64 * 1024
_GPT_LIVE_SESSIONS_URL = "https://api.openai.com/v1/live/sessions"


@router.post("/voice/session", response_model=VoiceSessionResponse)
async def create_voice_session(
    request: VoiceSessionRequest,
    x_openai_key: str = Header(..., alias="X-OpenAI-Key"),
):
    """Proxy the WebRTC SDP handshake for a GPT-Live voice session.

    Uses the caller-supplied OpenAI key for exactly one outbound call and
    never persists or logs it — see
    docs/superpowers/specs/2026-09-11-voice-mode-design.md.
    """
    if len(request.sdp.encode("utf-8")) > _MAX_VOICE_SDP_BYTES:
        raise HTTPException(status_code=413, detail="SDP offer too large")

    try:
        async with httpx.AsyncClient() as http_client:
            response = await http_client.post(
                _GPT_LIVE_SESSIONS_URL,
                headers={"Authorization": f"Bearer {x_openai_key}"},
                json={
                    "model": "gpt-live-1",
                    "delegation": {"type": "client"},
                    "transport": {"type": "webrtc", "sdp": request.sdp},
                },
                timeout=15.0,
            )
    except httpx.HTTPError:
        raise HTTPException(
            status_code=502, detail="Couldn't reach OpenAI to start a voice session."
        )

    if response.status_code == 401:
        raise HTTPException(
            status_code=401,
            detail="Couldn't start a voice session — check your OpenAI API key in Settings.",
        )
    if response.status_code == 429:
        raise HTTPException(status_code=429, detail="OpenAI is rate-limiting this key right now.")
    if response.status_code >= 400:
        raise HTTPException(status_code=502, detail="OpenAI couldn't start the voice session.")

    body = response.json()
    return VoiceSessionResponse(session_id=body["session"]["id"], sdp=body["transport"]["sdp"])
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `python -m pytest tests/chatbot/test_voice_session_endpoint.py -v`
Expected: PASS (6 tests)

- [ ] **Step 6: Run the full backend suite to check for regressions**

Run: `python -m pytest tests/chatbot -v`
Expected: PASS (no existing test broken by the new imports/route)

- [ ] **Step 7: Commit**

```bash
git add chatbot/schemas.py chatbot/api.py tests/chatbot/test_voice_session_endpoint.py
git commit -m "feat(voice): add POST /voice/session GPT-Live handshake proxy"
```

---

### Task 4: Frontend `voiceApi.ts`

**Files:**
- Create: `frontend/src/lib/voiceApi.ts`
- Test: `frontend/src/lib/voiceApi.test.ts`

**Interfaces:**
- Consumes: backend contract from Task 3 — `POST /api/bible-chat/voice/session`, header `X-OpenAI-Key`, body `{ sdp: string }`, success body `{ session_id: string, sdp: string }`, error body `{ detail: string }`.
- Produces: `createVoiceSession(sdp: string, apiKey: string): Promise<{ sessionId: string; sdp: string }>`.

- [ ] **Step 1: Write the failing tests**

```ts
// frontend/src/lib/voiceApi.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createVoiceSession } from './voiceApi'

describe('createVoiceSession', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('POSTs the offer with the key in a header and returns session id + answer sdp', async () => {
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ session_id: 'live_123', sdp: 'answer-sdp' }), { status: 200 }))

    const result = await createVoiceSession('offer-sdp', 'sk-test-123')

    expect(result).toEqual({ sessionId: 'live_123', sdp: 'answer-sdp' })
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe('/api/bible-chat/voice/session')
    expect(init?.headers).toMatchObject({ 'X-OpenAI-Key': 'sk-test-123' })
    expect(JSON.parse(init?.body as string)).toEqual({ sdp: 'offer-sdp' })
  })

  it('throws the backend detail message on a non-ok response', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ detail: "Couldn't start a voice session — check your OpenAI API key in Settings." }),
        { status: 401 }
      )
    )

    await expect(createVoiceSession('offer-sdp', 'bad-key')).rejects.toThrow(/check your OpenAI API key/)
  })

  it('falls back to a status-based message when the error body has no detail', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response('not json', { status: 500, statusText: 'Server Error' }))

    await expect(createVoiceSession('offer-sdp', 'sk-test-123')).rejects.toThrow(/500/)
  })
})
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd frontend && npx vitest run src/lib/voiceApi.test.ts`
Expected: FAIL — `voiceApi.ts` doesn't exist yet.

- [ ] **Step 3: Implement the client**

```ts
// frontend/src/lib/voiceApi.ts
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
export async function createVoiceSession(sdp: string, apiKey: string): Promise<VoiceSessionResult> {
  const res = await fetch(`${CHAT_API}/voice/session`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-OpenAI-Key': apiKey,
    },
    body: JSON.stringify({ sdp }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(body?.detail || `Request failed: ${res.status} ${res.statusText}`)
  }
  const data = await res.json()
  return { sessionId: data.session_id, sdp: data.sdp }
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `cd frontend && npx vitest run src/lib/voiceApi.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/voiceApi.ts frontend/src/lib/voiceApi.test.ts
git commit -m "feat(voice): add createVoiceSession client for the handshake proxy"
```

---

### Task 5: `useVoiceMode` hook

**Files:**
- Create: `frontend/src/components/shell/useVoiceMode.ts`
- Test: `frontend/src/components/shell/useVoiceMode.test.ts`

**Interfaces:**
- Consumes: `useVoiceSettingsStore` (Task 1) for `openaiApiKey`; `createVoiceSession` (Task 4).
- Produces:
  ```ts
  export type VoiceModeStatus = 'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking' | 'error'

  export interface UseVoiceModeResult {
    status: VoiceModeStatus
    errorMessage: string | null
    liveCaption: string
    toggle: () => void
    stop: () => void
    speak: (text: string) => void
  }

  export function useVoiceMode(options: { onTranscript: (text: string) => void }): UseVoiceModeResult
  ```
  `onTranscript` fires once per finished, non-empty user utterance. `speak(text)` is a no-op if no voice session/delegation is currently open.

- [ ] **Step 1: Write the failing tests**

```ts
// frontend/src/components/shell/useVoiceMode.test.ts
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
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd frontend && npx vitest run src/components/shell/useVoiceMode.test.ts`
Expected: FAIL — `useVoiceMode.ts` doesn't exist yet.

- [ ] **Step 3: Implement the hook**

```ts
// frontend/src/components/shell/useVoiceMode.ts
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
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `cd frontend && npx vitest run src/components/shell/useVoiceMode.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/shell/useVoiceMode.ts frontend/src/components/shell/useVoiceMode.test.ts
git commit -m "feat(voice): add useVoiceMode GPT-Live WebRTC session hook"
```

---

### Task 6: Wire voice mode into `ChatPane`

**Files:**
- Modify: `frontend/src/components/shell/ChatPane.tsx`
- Modify: `frontend/src/components/shell/ChatPane.test.tsx`

**Interfaces:**
- Consumes: `useVoiceMode` (Task 5) — `{ status, errorMessage, liveCaption, toggle, stop, speak }`.

- [ ] **Step 1: Write the failing tests**

Add to `frontend/src/components/shell/ChatPane.test.tsx`, near the top:

```ts
import * as voiceModule from './useVoiceMode'
```

Add new test cases inside the existing `describe('ChatPane', ...)` block:

```ts
  it('renders a voice toggle that reflects the voice hook status', () => {
    vi.spyOn(voiceModule, 'useVoiceMode').mockReturnValue({
      status: 'listening',
      errorMessage: null,
      liveCaption: 'What does grace mean',
      toggle: vi.fn(),
      stop: vi.fn(),
      speak: vi.fn(),
    })
    const session = useSessionsStore.getState().createSession('freeform', {})
    render(<ChatPane sessionId={session.id} />)

    expect(screen.getByRole('button', { name: /listening/i })).toBeInTheDocument()
    expect(screen.getByText('What does grace mean')).toBeInTheDocument()
  })

  it('speaks the resolved answer when the turn was voice-originated', async () => {
    const speak = vi.fn()
    let onTranscript: ((text: string) => void) | undefined
    vi.spyOn(voiceModule, 'useVoiceMode').mockImplementation((opts) => {
      onTranscript = opts.onTranscript
      return { status: 'listening', errorMessage: null, liveCaption: '', toggle: vi.fn(), stop: vi.fn(), speak }
    })
    vi.spyOn(chatApi, 'postChatStream').mockResolvedValue({ type: 'chat', message: 'Grace is unmerited favor.' })
    const session = useSessionsStore.getState().createSession('freeform', {})
    render(<ChatPane sessionId={session.id} />)

    await act(async () => {
      onTranscript?.('What does grace mean?')
    })

    expect(await screen.findByText('Grace is unmerited favor.')).toBeInTheDocument()
    expect(speak).toHaveBeenCalledWith('Grace is unmerited favor.')
  })

  it('does not speak the answer for a normal typed turn', async () => {
    const speak = vi.fn()
    vi.spyOn(voiceModule, 'useVoiceMode').mockReturnValue({
      status: 'idle',
      errorMessage: null,
      liveCaption: '',
      toggle: vi.fn(),
      stop: vi.fn(),
      speak,
    })
    vi.spyOn(chatApi, 'postChatStream').mockResolvedValue({ type: 'chat', message: 'Sure, go ahead.' })
    const session = useSessionsStore.getState().createSession('freeform', {})
    render(<ChatPane sessionId={session.id} />)

    await userEvent.type(screen.getByPlaceholderText(/ask about a verse/i), 'Hello')
    await userEvent.click(screen.getByRole('button', { name: /send/i }))

    await screen.findByText('Sure, go ahead.')
    expect(speak).not.toHaveBeenCalled()
  })
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd frontend && npx vitest run src/components/shell/ChatPane.test.tsx`
Expected: FAIL — no voice toggle button exists yet, `useVoiceMode` isn't imported by `ChatPane.tsx`.

- [ ] **Step 3: Wire the hook into `ChatPane.tsx`**

Change the lucide-react import line:

```ts
import { ArrowUp, CalendarDays, Check, Copy, Flag, Loader2, Mic, MicOff, RefreshCw, Share2 } from 'lucide-react'
```

Add the hook import, next to the other local imports:

```ts
import { useVoiceMode, type UseVoiceModeResult } from './useVoiceMode'
```

Add a status-label constant near `DEVOTIONAL_STATUS_PHRASES`:

```ts
const VOICE_STATUS_LABEL: Record<string, string> = {
  connecting: 'Connecting…',
  listening: 'Listening…',
  thinking: 'Thinking…',
  speaking: 'Speaking…',
}
```

Inside `ChatPane()`, add two refs near the other `useState`/`useRef` declarations at the top of the function body:

```ts
  const lastTurnWasVoiceRef = useRef(false)
  const voiceModeRef = useRef<UseVoiceModeResult | null>(null)
```

`voiceModeRef` exists to break a circular dependency: `sendMessage` needs to call `voiceMode.speak(...)`, but `useVoiceMode`'s `onTranscript` option needs to call `sendMessage`. Routing `sendMessage`'s access to the hook's result through a ref (kept fresh by an effect, declared below) means `sendMessage` never has to reference the `voiceMode` variable directly — so it can be declared before `useVoiceMode()` is called, in either order, with no temporal-dead-zone `ReferenceError` from a `const` used before its own declaration.

Replace the body of the existing `sendMessage` callback (currently ending with the `streamAssistantReply` call inside `try { ... } finally { setLoading(false) }`) with:

```ts
  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || !session) return
      // Enter submits the form directly, bypassing the disabled Send
      // button — without this guard, pressing it during an in-flight
      // generation (the multi-minute devotional turn especially) starts a
      // second one.
      if (loading) return
      const wasVoiceTurn = lastTurnWasVoiceRef.current
      lastTurnWasVoiceRef.current = false
      const userMessage: SessionMessage = { id: genId(), role: 'user', text }
      appendMessage(sessionId, userMessage)
      setInput('')

      if (session.mode === 'devotional' && !session.modeParams.delivered) {
        await runDevotionalTurn(text)
        return
      }

      const history = session.messages.slice(-6).map((m) => ({ role: m.role, text: m.text }))
      setLoading(true)
      try {
        const response = await streamAssistantReply(genId(), {
          message: text,
          history,
          mode: session.mode,
          mode_params: { ...session.modeParams },
        })
        if (wasVoiceTurn) {
          voiceModeRef.current?.speak(response?.message ?? 'Sorry, something went wrong.')
        }
      } finally {
        setLoading(false)
      }
    },
    [session, sessionId, loading, appendMessage, streamAssistantReply, runDevotionalTurn]
  )
```

Immediately after that `sendMessage` block, instantiate the hook (this is fine referencing `sendMessage` directly — by this point in the render, `sendMessage` is already declared and initialized) and keep the ref in sync:

```ts
  const voiceMode = useVoiceMode({
    onTranscript: (text) => {
      lastTurnWasVoiceRef.current = true
      void sendMessage(text)
    },
  })

  useEffect(() => {
    voiceModeRef.current = voiceMode
  })
```

In the header `<div className="flex shrink-0 items-center gap-2">`, insert the voice toggle right after the existing Share `<button>...</button>` (before the Report an issue button):

```tsx
          <button
            onClick={voiceMode.toggle}
            title={voiceMode.errorMessage ?? undefined}
            aria-pressed={voiceMode.status !== 'idle' && voiceMode.status !== 'error'}
            className={`shrink-0 inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border transition-colors ${
              voiceMode.status === 'idle' || voiceMode.status === 'error'
                ? 'border-[var(--color-theme-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-alt)] hover:text-[var(--color-text-primary)]'
                : 'border-[var(--color-theme-accent)] bg-[var(--color-theme-accent)]/10 text-[var(--color-theme-accent)]'
            }`}
          >
            {voiceMode.status === 'idle' || voiceMode.status === 'error' ? (
              <Mic className="w-3 h-3" aria-hidden="true" />
            ) : (
              <MicOff className="w-3 h-3" aria-hidden="true" />
            )}
            {voiceMode.status === 'idle' || voiceMode.status === 'error'
              ? 'Voice'
              : VOICE_STATUS_LABEL[voiceMode.status]}
          </button>
```

Just above the `<form className="flex items-center gap-2 mx-3 mt-3 ...">` composer (right after the `<div ref={bottomRef} />` closing tag), add the live caption:

```tsx
      {voiceMode.liveCaption && (
        <div className="px-4 pb-1 text-xs italic text-[var(--color-text-secondary)]">{voiceMode.liveCaption}</div>
      )}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `cd frontend && npx vitest run src/components/shell/ChatPane.test.tsx`
Expected: PASS (all tests, old and new)

- [ ] **Step 5: Run the full frontend suite to check for regressions**

Run: `cd frontend && npx vitest run`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/shell/ChatPane.tsx frontend/src/components/shell/ChatPane.test.tsx
git commit -m "feat(voice): wire voice mode toggle into ChatPane"
```

---

### Task 7: Manual live verification (not automatable)

This task has no unit tests — it requires a real browser, a real microphone, and a real OpenAI API key with GPT-Live access. It resolves the spec's two open questions and performs the manual pass the spec's Testing section calls for. Do this before considering the feature done.

**Files:** none (verification only; may produce small follow-up edits to `frontend/src/components/shell/useVoiceMode.ts` per Step 3 below).

- [ ] **Step 1: Start the app locally**

Run: `docker compose up` (or the project's normal local-dev flow — `python myproject.py` for Flask, `uvicorn chatbot.main:app --reload --port 8000` for the chatbot backend, `cd frontend && npm run dev` for Vite), per `DEPLOYMENT.md`.

- [ ] **Step 2: Add a real OpenAI key and open a chat**

In the running app: open Settings → Voice → paste a real OpenAI API key with GPT-Live access. Open any chat mode (e.g. Freeform).

- [ ] **Step 3: Confirm the turn-completion signal assumption**

Open the browser's DevTools console — no source edit needed: `handleEvent`'s `default` branch already logs `[voice] unhandled event` via `console.debug` whenever `import.meta.env.DEV` is set, so every event type this implementation does *not* recognise shows up in the console under Verbose/Debug level. (Recognised types — the transcript delta and `session.delegation.created` — are visible through their effects: the live caption and the chat turn.) Click the Voice toggle, grant mic access, and ask a short question aloud.

Confirm: `session.input_transcript.delta` events carry the spoken text under the field this implementation reads (`delta`, falling back to `text`). Confirm `session.delegation.created` fires once, after the user stops talking, and that the transcript accumulated up to that point is the complete utterance (not truncated, not duplicated).

If the real field name or completion signal differs from what Task 5 assumed: update `handleEvent` in `useVoiceMode.ts` accordingly, then re-run `cd frontend && npx vitest run src/components/shell/useVoiceMode.test.ts` to confirm the existing mocked-event tests still pass (update the mocked event shapes in the test file to match reality if the field name changed).

Nothing to remove afterwards — the diagnostic is permanent and DEV-only, so it never reaches a production build.

If the caption stays empty for a turn, look for an `[voice] unhandled event` line naming the real transcript-delta event type, and for any `error`/`*.error` event — those are now surfaced in the UI as a voice-session error rather than swallowed.

- [ ] **Step 4: Confirm commentary speech fidelity**

With the same session, let a full turn complete (transcribed question → existing text pipeline answers → `speak()` fires). Listen to the spoken response.

Confirm it speaks the answer text closely — not a paraphrase or a truncated/edited version. If GPT-Live takes noticeable liberties, tighten this by passing an `instructions` field at session creation in `chatbot/api.py::create_voice_session` (e.g. `"instructions": "When given text via session.commentary.append, speak it verbatim without commentary or embellishment."` inside the session-creation JSON body) and retest.

- [ ] **Step 5: Full manual pass**

Confirm each of the following in the browser:
- Live captions render while speaking, before the turn completes.
- The assistant's spoken answer plays automatically (no extra tap needed).
- Full duplex: interrupting the assistant's spoken answer by talking is handled reasonably (doesn't crash or hang the session).
- Clicking the voice toggle again (Stop) immediately ends the session — check the browser tab/OS microphone-in-use indicator turns off.
- Clearing the API key in Settings while a voice session is open stops the session (per Task 5/6's key-watch effect).
- A wrong/revoked API key produces the Settings-pointing error message from Task 3's 401 handling, not a raw stack trace or silent failure.

- [ ] **Step 6: Record findings**

If Steps 3-5 required any code changes, commit them:

```bash
git add frontend/src/components/shell/useVoiceMode.ts frontend/src/components/shell/useVoiceMode.test.ts chatbot/api.py
git commit -m "fix(voice): adjust event handling / instructions after live GPT-Live verification"
```

If no changes were needed, no commit is required for this task.
