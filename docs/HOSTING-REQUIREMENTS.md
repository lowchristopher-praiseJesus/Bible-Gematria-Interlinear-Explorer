# Hosting Requirements — Bible Gematria Interlinear Explorer

**Purpose of this document.** I want to deploy this application to a **free tier** of some
hosting platform (any platform *except* Cloudflare) and keep it running **with the same
architecture and behaviour it has today on my local machine** — no rewrite, no re-platforming
of the framework, no feature loss. This document is a complete, self-contained description of
what the app is, how its pieces fit together, and what it needs from a host, so that an
assessment can be made of which platform and which free tier fit best.

Please read it and recommend: (1) the best-fit platform(s) and their specific free-tier
plan, (2) how to map each process/asset onto that platform's primitives, (3) where the
free-tier limits will bite and what the cheapest mitigation is, (4) anything that genuinely
cannot run on a free tier and why.

---

## 1. What the application is

A read-only Bible study tool: an **interlinear explorer** (KJV English aligned word-by-word
with the original Hebrew/Greek, Strong's numbers, transliteration, morphology) plus
**gematria search** (Hebrew/Greek numeric values of words and whole verses), **Strong's
concordance lookup**, **English full-text search** of the KJV, **Apocrypha** text, and a
**study chatbot** that answers Bible questions using a hybrid of deterministic lookups and an
LLM.

All Bible data is fixed reference content. There are **no user accounts, no logins, no
writes from end users, no payments**. The only server-side state that changes at runtime is a
response cache (see §4).

---

## 2. Architecture as it runs today

Three processes on one machine:

```
                          ┌─────────────────────────────────────────────┐
  browser  ──────────────▶│  (1) Flask app  —  myproject.py  :5000       │
   (SPA or                │                                             │
    direct HTML)          │   • JSON API:  /api/explorer /api/strongs    │
                          │                /api/gematria /api/english    │
                          │                /api/books   /api/apoc        │
                          │   • Server-rendered HTML: /explorer /strongs │
                          │                /gematria /english            │
                          │   • Static images:  /LC_/<file>.jpg          │
                          │   • Reverse proxy:  /api/bible-chat/*  ──────┼──┐
                          │                                             │  │
                          │   reads Complete.db (SQLite, read-only)      │  │
                          │   writes CACHED_PAGES/ (filesystem cache)    │  │
                          └─────────────────────────────────────────────┘  │
                                                                           │
                          ┌────────────────────────────────────────────────▼─┐
                          │  (2) FastAPI chatbot  —  chatbot/  (uvicorn) :8020 │
                          │                                                   │
                          │   • POST /chat, POST /chat/stream (SSE)            │
                          │   • GET  /verse /study /strongs /passage           │
                          │          /book_context /parables /study-wikis      │
                          │                                                   │
                          │   • hybrid router: deterministic pattern match,    │
                          │     else LLM fallback                              │
                          │   • reads Complete.db directly (gematria/English   │
                          │     for "mode primers")                            │
                          │   • parses local Markdown "study wikis" at import  │
                          │   • imports src/ from an EXTERNAL project          │
                          │     (~/Documents/mybibletoolbox-code) for          │
                          │     multi-translation verse text + commentary      │
                          │   • calls an external LLM API (Ollama)             │
                          └───────────────────────────────────────────────────┘

  ┌─────────────────────────────────────────────────────────────────────────┐
  │  (3) React SPA  —  frontend/   (Vite build → static files)               │
  │                                                                         │
  │   • This is the primary UI I use (I open http://localhost:5173).        │
  │   • Pure static assets after `npm run build` (HTML/JS/CSS).             │
  │   • Talks to (1) over same-origin relative URLs: /api/*  and  /LC_/*    │
  │     (in local dev, Vite's dev server proxies those to :5000).           │
  │   • Its chat panel calls /api/bible-chat/* which (1) proxies to (2).    │
  └─────────────────────────────────────────────────────────────────────────┘
```

### Request flow that must keep working
- SPA static files served to the browser.
- `GET /api/explorer?...`, `/api/strongs?...`, `/api/gematria?...`, `/api/english?...`,
  `/api/books`, `/api/apoc?...` → **process (1)**, JSON responses.
- `GET /LC_/BIB_LENCDX_F1B.jpg` (etc.) → **process (1)** (or a static file server / CDN).
- `POST /api/bible-chat/chat` and `POST /api/bible-chat/chat/stream` →
  **process (1)** reverse-proxies to **process (2)**. The `/chat/stream` variant is
  **Server-Sent Events (streaming response)**.
- Directly visiting `/explorer`, `/strongs`, `/gematria`, `/english` in a browser returns a
  complete standalone server-rendered HTML page from **process (1)** (jQuery frontend, cookie
  toggles). The SPA does not use these, but they are part of the app and should remain
  reachable.

### Production topology used previously (for reference)
`Installation.txt` in the repo describes a previous deployment: **nginx + uWSGI** on Ubuntu,
Flask app mounted behind nginx at the paths `/explorer`, `/strongs`, `/gematria`, `/english`;
the `static/` and `LC_/` directories served directly by nginx from `/var/www/html/`. The
chatbot process and the React SPA were added later and are not in that document.

---

## 3. Components inventory

| # | Component | Language / framework | Server model | Default port | Role |
|---|-----------|----------------------|--------------|--------------|------|
| 1 | `myproject.py` | Python 3.13, **Flask**, `flask-caching`, `flask-cors`, `dataset` (SQLAlchemy) | **WSGI**, long-running (uWSGI/gunicorn in prod, `flask run` in dev) | 5000 | JSON API, server-rendered HTML, image serving, reverse proxy to #2 |
| 2 | `chatbot/` | Python 3.13, **FastAPI**, `uvicorn[standard]`, `httpx`, `pydantic`, `markdown` | **ASGI**, long-running, **must support SSE streaming** | 8020 (code default; scripts also mention 8000) | Hybrid deterministic + LLM chatbot; also direct verse/study/Strong's endpoints |
| 3 | `frontend/` | TypeScript, **React 19**, **Vite**, Tailwind | **Static** after `npm run build` (no Node server at runtime) | 5173 (dev only) | The main UI |

Notes:
- (1) and (2) are **separate processes** today. They could in principle be run as one process
  (mount the FastAPI app inside Flask / run both under one ASGI server), but I have not done
  that and would prefer not to change it for this migration.
- (1) currently hard-codes the chatbot URL as `http://localhost:8020` (`CHATBOT_BASE_URL` in
  `myproject.py`). On a host where the two processes are not on `localhost` together, this
  must become configurable.
- (2) is imported/launched in two ways in the repo scripts: as `chatbot.main:app` from within
  `~/Documents/mybibletoolbox-code`, or as a local `create_chatbot_app()` factory. See §6.

---

## 4. Data & assets inventory

| Item | Size | Type | Access pattern | Mutability | Notes |
|------|------|------|----------------|------------|-------|
| `Complete.db` | **178 MB** | SQLite (single file) | Read by (1) and (2). Point lookups by verse id / Strong's number; three endpoints do **full-table `LIKE '%...%'` scans** over 31,102 wide rows (Strong's-in-verse, gematria value, English text) | **Read-only** at runtime | 3 tables: `Complete` (31,102 verse rows, ~30 columns), `Strongs_` (14,298 dictionary rows), `APOC` (5,705 Apocrypha text rows). No indexes defined. Not in git — deployed separately. A 37 MB `Complete.zip` of it is in the repo. |
| `LC_/` | **2.7 GB** | 920 JPEG files (`BIB_LENCDX_*.jpg`), flat directory | Served as static files at `/LC_/<name>`. One verse view references 1–2 of them. Cacheable forever. | Read-only | Leningrad Codex manuscript page scans. Not in git — deployed separately. Big, cold, highly cacheable — ideal for object storage / CDN. |
| `CACHED_PAGES/` | ~4 MB now, **designed to grow to ~150k entries** | `flask-caching` filesystem cache | Written by (1) on cache-miss, read on cache-hit. Keys are function+args of the expensive view functions. TTL ~17 years (effectively permanent). | **Written at runtime** | Needs either a writable persistent volume, or replacement with the platform's cache/KV service, or it can be disabled (correctness is unaffected; every request just recomputes). |
| `chatbot/data/` study wikis + `chatbot/data/*.py` | small (KBs) | Markdown + Python data modules, **in the repo** | Parsed into memory once at process (2) startup | Read-only | Self-contained; no external dependency. |
| **External:** `~/Documents/mybibletoolbox-code/src/` | **724 KB** of code | Python package, **NOT in this repo** | `sys.path`-inserted at a **hard-coded `Path.home() / "Documents" / "mybibletoolbox-code"`** by `chatbot/tools.py`; provides `fetch_verse` (multi-translation text), `scripture_study` (commentary merge), `get_strongs` | Read-only code | The chatbot's non-trivial answers depend on this. Must be vendored into the deployable artifact or the dependency removed. |
| **External:** `~/Documents/mybibletoolbox-code/data/` | **4.4 GB** | Per-verse commentary corpus (`commentary/<BOOK>/<chapter>/<verse>/...`), Strong's data dir, tool registry YAML | Read by `scripture_study` / `get_strongs` on demand; `fetch_verse` also writes a fetch cache here | Mostly read-only; `fetch_verse` writes into it | This is the single largest hosting constraint if full chatbot fidelity is required. See §8. |

**Total persistent storage if everything travels with the app: ~7.3 GB**
(178 MB DB + 2.7 GB images + 4.4 GB commentary corpus), plus cache growth.
**Without the commentary corpus (degraded chatbot): ~2.9 GB.**
**Static SPA build output (`frontend/dist`): a few MB.**

---

## 5. External runtime dependencies (network)

| Dependency | Used by | Purpose | Auth | Notes |
|------------|---------|---------|------|-------|
| **LLM API — NVIDIA NIM or Ollama** | process (2) | Chat answers when no deterministic route matches; also used to synthesise "topical study" answers grounded in the local wikis | `LLM_PROVIDER=nvidia` (default): `NVIDIA_API_KEY` (an `nvapi-…` key from build.nvidia.com) is **required**. `LLM_PROVIDER=ollama`: `OLLAMA_API_KEY` only if using Ollama Cloud; none for a local daemon | `chatbot/ollama_client.py` speaks two wire formats, chosen by `LLM_PROVIDER`. NVIDIA = OpenAI-compatible `POST {NVIDIA_API_URL}/chat/completions` (default base `https://integrate.api.nvidia.com/v1`, default model `meta/llama-3.3-70b-instruct`, SSE stream). Ollama = native `POST {OLLAMA_API_URL}/api/chat` (default model `deepseek-v4-pro:cloud`, newline-JSON stream). Requests can take up to **180 s**. **The host does not need a GPU** — inference is off-box. |
| **BibleHub (implicit)** | process (2), via `mybibletoolbox-code`'s `fetch_verse` | Fetches non-KJV English translations (ESV/NIV/NASB…) and Greek text for a reference on demand | none | Outbound HTTP scraping. Results cached to disk (into the 4.4 GB `data/` dir). Fails gracefully — the chatbot degrades to "no extra translation data" if unreachable. |
| **Google Analytics (`gtag.js`)** | server-rendered HTML pages only (not the SPA) | Page analytics | n/a | Client-side `<script>` tag. No server involvement. |
| **jQuery / React UMD from public CDNs** | server-rendered HTML pages only | Frontend libs for the non-SPA pages | n/a | Client-side `<script src>` to `ajax.googleapis.com` / `unpkg.com`. No server involvement. |

**Outbound HTTPS from the server is required** (LLM API, and BibleHub for translations).

---

## 6. Runtime environment requirements

- **Python 3.11+ (developed/running on 3.13.2).** Both server processes.
- **Node.js LTS** at *build* time only, to run `npm ci && npm run build` in `frontend/`.
  No Node process at runtime.
- **A POSIX filesystem** the server can read (SQLite file, image dir, Markdown wikis,
  vendored `mybibletoolbox` code + optionally its data corpus).
- **Writable path** for `flask-caching` (`CACHED_PAGES/`) *or* a substitute cache service
  *or* accept running with caching off.
- **Long-lived processes / no hard short request timeout.** The chatbot's LLM calls run up
  to 180 s and the `/chat/stream` endpoint holds a streaming SSE connection open. A platform
  that force-kills requests at 10–30 s, or that doesn't support streaming responses, breaks
  the chat feature (the rest of the app is fine under short timeouts).
- **Outbound network** allowed (see §5).
- **No inbound webhooks, no cron, no background workers, no message queue, no GPU.**
- **No database server** — SQLite file only. A managed Postgres/MySQL is *not* wanted; if a
  platform has no persistent disk and forces a managed DB, that's a portability cost to call
  out (the SQL is SQLite-flavoured and uses `LIKE` scans).

### Python dependencies (from `requirements.txt`)
```
flask>=2.0.0
flask-caching>=1.10.0
flask-cors>=3.0.0
dataset>=1.5.0            # SQLAlchemy-based; talks to Complete.db
fastapi>=0.115.0
uvicorn[standard]>=0.32.0
httpx>=0.27.0
pydantic>=2.9.0
python-multipart>=0.0.12
markdown>=3.7
```
The external `mybibletoolbox-code` adds: `requests`, `pyyaml`, `anthropic` (and re-lists
fastapi/uvicorn/httpx/pydantic).

### Environment variables
| Var | Default | Meaning |
|-----|---------|---------|
| `LLM_PROVIDER` | `ollama` | `nvidia` = NVIDIA NIM (OpenAI-compatible); `ollama` = Ollama native API. Selects which var group below is used. |
| `NVIDIA_API_URL` | `https://integrate.api.nvidia.com/v1` | NVIDIA NIM base (OpenAI-compatible surface, ends `/v1`). |
| `NVIDIA_MODEL` | `meta/llama-3.3-70b-instruct` | Model id — see build.nvidia.com. |
| `NVIDIA_API_KEY` | unset | Required when `LLM_PROVIDER=nvidia`. |
| `OLLAMA_API_URL` | `http://localhost:11434` | LLM endpoint. Set to `https://api.ollama.com/v1` for hosted inference. |
| `OLLAMA_MODEL` | `deepseek-v4-pro:cloud` | Model id. |
| `OLLAMA_API_KEY` | unset | Required when `OLLAMA_API_URL` is remote/HTTPS. |
| `CHATBOT_BASE_URL` | **hard-coded** `http://localhost:8020` in `myproject.py` | Where process (1) proxies `/api/bible-chat/*`. **Needs to become a real env var** unless (1) and (2) share `localhost`. |
| `MYBIBLETOOLBOX_PATH` | **hard-coded** `~/Documents/mybibletoolbox-code` in `chatbot/tools.py` | Location of the external code + data. **Needs to become configurable** or the dependency vendored. |

---

## 7. How it is run locally today (the behaviour to preserve)

```bash
# Terminal 1 — Flask API + proxy + image server + server-rendered HTML
pip install -r requirements.txt
python myproject.py                       # serves on http://localhost:5000

# Terminal 2 — FastAPI chatbot
export LLM_PROVIDER=nvidia  NVIDIA_API_KEY=nvapi-...   # or LLM_PROVIDER=ollama + OLLAMA_*
uvicorn chatbot.main:app --host 0.0.0.0 --port 8020
#   (or: python -c "from chatbot import create_chatbot_app; import uvicorn; \
#        uvicorn.run(create_chatbot_app(), host='0.0.0.0', port=8020)")

# Terminal 3 — the UI I actually use
cd frontend && npm install && npm run dev  # Vite dev server on http://localhost:5173,
                                           # proxies /api and /LC_ to :5000
```
For production the SPA would be `npm run build` (static `frontend/dist/`) served by a static
host / CDN, with `/api/*` and `/LC_/*` routed to process (1) and `/api/bible-chat/*` ending
up at process (2).

---

## 8. Resource footprint & sizing

| Resource | Estimate | Basis |
|----------|----------|-------|
| **RAM, process (1) Flask** | 128–256 MB | Flask + SQLAlchemy/`dataset`; SQLite reads are streamed; largest work is building HTML strings and splitting `~`-delimited columns. Peak on the 20,000-row-capped `LIKE` scans. |
| **RAM, process (2) FastAPI** | 256–512 MB | uvicorn + httpx + pydantic + `markdown`; parses all study wikis into memory at startup; imports `mybibletoolbox` `src`. Higher if the commentary corpus access patterns hold large structures (they are read per-verse, so usually modest). |
| **RAM, build step** | ~1–2 GB transient | `vite build` / tsc for `frontend/`. Build-time only. |
| **Persistent disk** | **~7.3 GB** full fidelity / **~2.9 GB** without commentary corpus / **~0.2 GB** if images move to object storage and corpus is dropped | See §4. |
| **CPU** | Low, bursty | No heavy compute server-side. LLM inference is external. The `LIKE` scans are the main CPU/IO spikes. |
| **Egress / bandwidth** | Dominated by `LC_/` JPEGs | Manuscript images are the only large payloads. Everything else is small JSON / a few-MB SPA bundle. Images are immutable and fully CDN-cacheable. |
| **Concurrent users** | Currently **~1** (local only). Target: low — single-digit concurrent, hobby-scale. No load test exists. | |
| **Request rate** | Unknown / low. Assume < a few thousand requests/day initially. | |

### The commentary-corpus problem (most important sizing decision)
Full chatbot fidelity needs the **4.4 GB `data/commentary/` corpus** from an out-of-repo
project, reached today by a hard-coded home-directory path. On a free tier this is the thing
most likely to not fit. Options to weigh in your recommendation:
1. **Vendor the whole corpus** into the deployable image / a persistent volume / object
   storage (need ~5 GB+ disk free — rules out most free tiers).
2. **Vendor only `src/` (724 KB)** and a **subset** of commentary actually used, or move the
   corpus behind object storage with lazy fetches.
3. **Drop the commentary/translation features**: run the chatbot with only `Complete.db`
   (KJV text, Strong's, gematria — all already local and dependency-free) + the local study
   wikis + the LLM. The code degrades gracefully when `fetch_scripture_study` /
   `fetch_verse_translations` fail. This keeps disk at ~2.9 GB (or ~0.2 GB with images in
   object storage).

I'd like the recommendation to cover both "full fidelity" and "degraded but honest" paths.

---

## 9. Hard constraints checklist (for matching a platform)

- [ ] Runs **long-lived Python WSGI + ASGI processes** (not just short-lived serverless
      functions). Two of them, or one combined process.
- [ ] **Streaming responses / SSE** supported for `/api/bible-chat/chat/stream`.
- [ ] **No enforced request timeout below ~180 s** on the chat path (short timeouts elsewhere
      are fine).
- [ ] **Persistent read filesystem** for a 178 MB SQLite file + Markdown data (+ optionally
      2.7 GB images + 4.4 GB corpus, or those go to object storage).
- [ ] **Writable location** for the response cache, **or** a KV/cache add-on, **or** tolerate
      caching disabled.
- [ ] **Outbound HTTPS** to the LLM API and BibleHub.
- [ ] **Static hosting / CDN** for the built SPA and ideally for `LC_/` images.
- [ ] **Custom routing**: one origin where `/`, `/api/*`, `/LC_/*`, `/explorer` etc. and
      `/api/bible-chat/*` all resolve correctly (reverse proxy or path-based routing), OR
      the ability to point the SPA at separate API origins with CORS.
- [ ] **Free tier** that covers the above without a credit card ideally, or with a
      hard spend cap.
- [ ] Enough **build minutes / build RAM** for a Vite React build, or the ability to build
      the SPA elsewhere and upload `dist/`.
- [ ] Not Cloudflare.

### Nice-to-have
- Two services in one project with private networking between them (so `CHATBOT_BASE_URL`
  can stay simple).
- Object storage with zero or cheap egress for the images.
- Scale-to-zero / sleep on idle is acceptable (this is hobby-scale) as long as cold starts
  are tens of seconds, not minutes, and streaming still works after wake.

---

## 10. What is fixed vs negotiable

**Fixed (please design around these):**
- Keep Flask for (1) and FastAPI for (2). No framework rewrite.
- Keep the React SPA as the primary UI.
- Keep SQLite as the datastore (no migration to a managed SQL server).
- Keep the LLM external (Ollama / OpenAI-compatible endpoint). No self-hosted GPU inference.
- Keep all current endpoints and the server-rendered HTML pages reachable.

**Negotiable:**
- Running (1) and (2) as one process instead of two.
- Replacing the filesystem cache with a platform cache/KV, or turning it off.
- Moving `LC_/` images and/or the commentary corpus to object storage.
- Dropping the multi-translation / external-commentary features of the chatbot if they
  can't fit a free tier (see §8 option 3).
- Making the hard-coded `CHATBOT_BASE_URL` and `MYBIBLETOOLBOX_PATH` into real config.
- The exact port numbers.

---

## 11. Questions the assessment should answer

1. Which platform + specific free plan, and why it fits §9 better than the alternatives.
2. Concrete mapping: what runs (1), what runs (2), where the SPA is served, where the DB
   file lives, where images live, where the cache goes.
3. Free-tier limits that will be hit first (disk, RAM, sleep/wake, request timeout, build
   minutes, bandwidth) and the cheapest mitigation for each.
4. Full-fidelity vs degraded-chatbot recommendation given the 4.4 GB corpus.
5. What (if anything) still cannot run free, and the smallest paid add-on that unblocks it.
6. Rough monthly cost if free-tier limits are exceeded at, say, 10× current expected traffic.

---

## 12. Repo layout (orientation)

```
myproject.py              # process (1): Flask — all routes, HTML templates as f-strings
requirements.txt          # Python deps for (1) and (2)
Complete.db               # 178 MB SQLite (gitignored; Complete.zip is the 37 MB archived copy)
LC_/                      # 2.7 GB, 920 manuscript JPEGs (gitignored)
CACHED_PAGES/             # flask-caching filesystem cache (gitignored)
static/                   # CSS/JS/fonts for the server-rendered HTML pages + built chat widget
chatbot/                  # process (2): FastAPI app
  main.py                 #   uvicorn entrypoint (chatbot.main:app)
  __init__.py             #   create_chatbot_app() factory
  api.py / router.py      #   endpoints + hybrid deterministic/LLM routing
  ollama_client.py        #   LLM client (env-configured)
  bible_search.py         #   dependency-free gematria/English over Complete.db
  tools.py                #   sys.path-imports ~/Documents/mybibletoolbox-code/src  ← external dep
  data/                   #   study-wiki Markdown + Python data modules (self-contained)
frontend/                 # process (3): React 19 + Vite SPA (the primary UI)
  dist/                   #   build output (what actually gets hosted)
Installation.txt          # previous nginx + uWSGI deployment notes
docs/HOSTING-REQUIREMENTS.md   # this file
```
