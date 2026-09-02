# Deployment — Oracle Cloud Always Free Ampere A1 (ARM64)

This runs the **exact current architecture** — Flask + FastAPI + a static React SPA —
as three containers behind Nginx, via Docker Compose.

No business-logic or route changes. The edits made:

- **Two env-var reads** (the intended config changes), both defaulting to their old
  hard-coded values:
  - `CHATBOT_BASE_URL` in `myproject.py` → `os.environ.get(..., "http://localhost:8020")`
  - `MYBIBLETOOLBOX_PATH` in `chatbot/tools.py` → `os.environ.get(..., "~/Documents/mybibletoolbox-code")`
- **`requirements.txt` dependency corrections** (manifest only, no code):
  - added `requests` — `myproject.py` has always `import`ed it (the `/api/bible-chat`
    proxy) but it was missing from the manifest; the container has no ambient site-packages
    to fall back on, so it must be declared.
  - capped `flask-caching<2.5` and `flask<3.1` / `flask-cors<5` to the known-good local
    set. `flask-caching==2.5.0` breaks the lazy `filesystem` backend import that
    `CACHE_TYPE='filesystem'` relies on (`module 'flask_caching.backends' has no
    attribute 'filesystem'`).

```
                       ┌──────── nginx  (public :80) ─────────┐
  browser ────────────▶│  /               → SPA (dist/, disk)  │
                       │  /LC_/           → images (disk, alias)│
                       │  /static/        → flask-api           │
                       │  /explorer …     → flask-api           │
                       │  /api/…          → flask-api           │
                       │  /api/bible-chat/chat/stream → flask-api (SSE, unbuffered)
                       └───────────────┬──────────────────────┘
                                       ▼
                       flask-api :5000 ──(/api/bible-chat/* internal proxy)──▶ chatbot :8020
                       (gunicorn)                                             (uvicorn)
       both mount ./Complete.db (rw — see §3a)   chatbot also reads vendored mybibletoolbox-code
       flask-api writes ./CACHED_PAGES
```

Nginx is the **only** container that publishes a host port. `flask-api` and `chatbot`
talk over the private `bible-net` bridge by service name. Nginx never talks to the
chatbot container directly — every chatbot call goes through Flask's existing
`/api/bible-chat/*` proxy.

---

## 0. Deliverables in this repo

| File | Purpose |
|---|---|
| `docker-compose.yml` | the three services + network + mounts |
| `Dockerfile.flask` | Flask image (gunicorn) |
| `Dockerfile.chatbot` | FastAPI image (uvicorn) + vendored `mybibletoolbox-code` |
| `nginx/conf.d/default.conf` | routing, SSE-safe streaming, gzip, image caching, `/healthz`, per-request upstream DNS |
| `.dockerignore` | keeps the 2.7 GB `LC_/` and 178 MB DB out of the build context |
| `.env.example` | every env var referenced; copy to `.env` (git-ignored) |
| `scripts/vendor-mybibletoolbox.sh` | stages the external package into `vendor/` |

---

## 1. Provision the VM

- Shape: **VM.Standard.A1.Flex**, Ubuntu 22.04/24.04, **ARM64/aarch64**.
- This guide assumes the current Always Free grant: **2 OCPU / 12 GB RAM / 200 GB
  block storage**. Everything below fits comfortably; the only tight spot is a Vite
  build (see §4).

Install Docker Engine + the Compose plugin (arm64 packages are in Docker's apt repo):

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
echo "deb [arch=arm64 signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker $USER && newgrp docker   # re-login afterwards
```

`docker compose build` runs **natively** on the A1 — it is already ARM64, so there is
no `buildx` / QEMU / cross-build step.

---

## 2. Resize the block volume BEFORE copying data

New OCI boot/block volumes are provisioned larger than the filesystem that ships on
them — the extra space is unallocated until you grow it. Do this first or you will run
out of disk part-way through copying the images.

```bash
df -h /                      # shows the SMALL initial size
sudo growpart /dev/sda 1     # or the device oci-growfs reports
sudo resize2fs /dev/sda1
# Oracle's Ubuntu images ship a helper that does both:
sudo /usr/libexec/oci-utils/oci-growfs -y   # (older images: sudo oci-growfs)
df -h /                      # now shows the full allowance
```

If you keep the big assets on a **separate** block volume, attach it, `mkfs.ext4`,
mount it (e.g. at `/opt/bible-app`), add it to `/etc/fstab`, and adjust the bind-mount
paths in `docker-compose.yml` accordingly.

---

## 3. Get the code and the data onto the VM

```bash
git clone <this-repo> bible-app && cd bible-app
```

### 3a. `Complete.db` (178 MB) — mounted read-write, on purpose

`unzip Complete.zip` (or `scp` your `Complete.db`) into the repo root. The compose
file bind-mounts it into **both** `flask-api` and `chatbot`.

It is mounted **read-write**, even though the application only ever runs `SELECT`s.
Reason: the app's DB library, `dataset`, unconditionally issues
`PRAGMA journal_mode=WAL` on every connection (`sqlite_wal_mode=True` is its default),
and that PRAGMA writes to the SQLite file header. With a `:ro` mount, every
DB-backed route (`/api/explorer`, `/api/gematria`, `/api/english`, `/api/strongs`,
`/api/apoc`, `/explorer`, …) returns **500 — "attempt to write a readonly database"**.
Changing that would mean editing `DB_PATH` / the `dataset.connect()` calls, which is
outside the "config only, no rewrites" scope of this migration.

Consequences of the read-write mount:
- No application data is ever modified — the app issues no `INSERT`/`UPDATE`/`DELETE`.
- SQLite maintains `Complete.db-wal` / `Complete.db-shm` sidecar files next to the
  DB. That's normal; leave them.
- If you want a belt-and-braces guarantee the file can't change, put it on a
  filesystem/volume you snapshot, or take a checksum before/after and diff.

### 3b. `LC_/` manuscript images (2.7 GB)

`scp -r` / `rsync` the `LC_/` directory into the repo root (or onto the block volume
and repoint the mount). Nginx serves these straight off disk with a 1-year immutable
cache header — they never pass through Flask in this deployment.

```bash
rsync -a --info=progress2 ./LC_/  ubuntu@<vm>:~/bible-app/LC_/
```

### 3c. Vendored `mybibletoolbox-code`

`chatbot/tools.py` imports this package at start-up. The needed subset (~620 KB:
`src/`, `book_codes` + `biblehub_fetcher` scripts, `tool-registry.yaml`, and empty
`data/{commentary,strongs}/` stubs) is staged under `vendor/mybibletoolbox-code/` and
should be **committed to this repo** so `git clone` on the VM brings it. To refresh it
from a checkout of the source project:

```bash
scripts/vendor-mybibletoolbox.sh /path/to/mybibletoolbox-code
```

The empty `data/commentary/` and `data/strongs/` directories are load-bearing:
`src/config.py` runs a data-directory check at import time and calls `sys.exit(1)` if
neither exists. With them present but empty, the chatbot runs in **degraded
(no-corpus) mode** — commentary and multi-translation lookups return nothing and the
router degrades gracefully to KJV + Strong's + gematria + local study wikis + the LLM.

### 3d. Full-fidelity commentary corpus (optional, ~4.4 GB)

Only if you want the external commentary / multi-translation features:

```bash
mkdir -p /opt/bible-app/mybibletoolbox-data
rsync -a /path/to/mybibletoolbox-code/data/  /opt/bible-app/mybibletoolbox-data/
```

Then uncomment this line in `docker-compose.yml` (under `chatbot:` → `volumes:`):

```yaml
- /opt/bible-app/mybibletoolbox-data:/app/vendor/mybibletoolbox-code/data:ro
```

`src/config.py` auto-detects the corpus at that path — no env var needed. The 200 GB
volume holds it easily.

### 3e. Build the SPA (`frontend/dist`)

Nginx bind-mounts `frontend/dist` read-only; there is **no Node process at runtime**
and, by default, **no Vite build inside Docker** (it would spend 1–2 GB RAM and a few
minutes of the free VM's 2 OCPUs per build).

- **Preferred:** build on your workstation and copy the output up:
  ```bash
  cd frontend && npm ci && npm run build          # -> frontend/dist
  rsync -a frontend/dist/  ubuntu@<vm>:~/bible-app/frontend/dist/
  ```
- **On the VM instead:** it fits in 12 GB RAM, just expect a few minutes:
  ```bash
  cd frontend && npm ci && npm run build && cd ..
  ```
- An in-Docker `node:lts` multi-stage build stage is included, commented out, at the
  bottom of `docker-compose.yml` for later.

### 3f. `.env`

```bash
cp .env.example .env
# Default: LLM_PROVIDER=nvidia — set NVIDIA_API_KEY (an "nvapi-..." key from
# build.nvidia.com); adjust NVIDIA_MODEL if you don't want the default.
# To use Ollama instead: set LLM_PROVIDER=ollama and fill in OLLAMA_API_KEY /
# OLLAMA_API_URL / OLLAMA_MODEL.
```

`.env` is git-ignored and is read by the `chatbot` and `flask-api` services
(both declare `env_file: - .env`). Whichever provider you pick, the VM needs
outbound HTTPS egress to reach it — inference runs off-box, so no GPU on the VM.

### 3g. Troubleshooting feedback (`/admin`)

Users can file a chat report from any session ("Report an issue"). Reports —
conversation + per-turn trace — are written to a **separate SQLite DB**
(`feedback.db`), not `Complete.db`. In Docker it lives on the named
`feedback-db` volume mounted into `flask-api` at `/app/feedback-db/`; set
`FEEDBACK_DB_URL` to relocate it.

The admin trajectory viewer is the SPA route **`/admin`** and the
`GET/PATCH /api/admin/feedback*` API. Both require HTTP Basic auth from
`ADMIN_USER` / `ADMIN_PASSWORD`. If either is unset the admin API returns
`503` and the `/admin` page shows "admin access is not configured".

Pass `VITE_APP_VERSION` when building the frontend (`VITE_APP_VERSION=$(git
describe --tags --always) npm run build`) so reports record which build they
came from; it defaults to `dev`.

No nginx change is needed — `/api/feedback`, `/api/admin/*`, and the `/admin`
SPA route all resolve under existing `location` blocks.

---

## 4. Open the firewall — in TWO places

Oracle Cloud blocks inbound traffic at **two independent layers**. Opening only one
leaves the site unreachable with no error.

### 4a. OCI console — Security List (or NSG)

VCN → Subnet → **Security List** (or the instance's **NSG**) → **Add Ingress Rule**:

| Field | Value |
|---|---|
| Stateless | No |
| Source Type / CIDR | CIDR / `0.0.0.0/0` |
| IP Protocol | TCP |
| Destination Port Range | `80` (add `443` when you enable TLS) |

### 4b. The VM's own OS firewall

Oracle's Ubuntu images ship **iptables** rules that `DROP` inbound traffic on
everything except SSH — even after 4a is done. Open 80/443 and persist:

```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save            # survives reboot (installs iptables-persistent if needed)
```

If you would rather manage it with `ufw`:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

(Use one or the other, not both. On stock OCI Ubuntu the raw `iptables` rules above
are the common path.)

---

## 5. Build and start

```bash
docker compose build          # native arm64, first build ~2–4 min
docker compose up -d
docker compose ps             # all three services should be "Up (healthy)"
```

Startup is ordered by health, not just container start: `chatbot` must pass its
healthcheck (`GET /parables`) before `flask-api` starts, and `flask-api` must pass
its own (`GET /api/books`) before `nginx` starts. First `up` therefore takes
~30–60 s to reach all-healthy — `chatbot`'s `start_period` is 45 s to cover
study-wiki parsing and the `mybibletoolbox-code` import. `nginx` no longer resolves
`flask-api` at startup (it uses Docker's DNS per request via `resolver`), so it will
not exit-loop while the others come up. `restart: unless-stopped` still covers a
later crash. If a service is stuck `unhealthy`, check its logs first
(`docker compose logs <svc>`); `docker inspect --format '{{json .State.Health}}' <container>`
shows the last probe output.

---

## 6. Sanity-check from the VM itself (before testing from outside)

This separates an **app** problem from a **firewall/network** problem.

```bash
docker compose ps                         # want "Up (healthy)" on all three
docker compose logs --tail=40 chatbot     # no "Bible Data Directory Not Found",
                                          # no ImportError, "Uvicorn running on ... 8020"
docker compose logs --tail=40 flask-api   # "Listening at: http://0.0.0.0:5000"

# nginx liveness (the compose healthcheck target)
curl -s localhost/healthz                 # -> ok

# JSON API (Flask, no LLM)
curl -s localhost/api/books | head -c 200 ; echo

# Server-rendered HTML page
curl -sI localhost/explorer | head -n 1

# A manuscript image, served by nginx off disk (pick a real name)
ls LC_ | head -1
curl -s -o /dev/null -w 'HTTP %{http_code}  %{size_download} bytes\n' \
  localhost/LC_/$(ls LC_ | head -1)

# SPA entry
curl -sI localhost/ | head -n 1

# Chatbot through Flash's proxy, deterministic path (no LLM)
curl -s localhost/api/bible-chat/parables | head -c 200 ; echo

# Chatbot streaming (needs the LLM provider configured in .env —
# NVIDIA_API_KEY or OLLAMA_API_KEY). -N = no curl buffering;
# tokens should arrive incrementally, not all at the end at the nginx layer.
curl -N -s -X POST localhost/api/bible-chat/chat/stream \
  -H 'content-type: application/json' \
  -d '{"message":"What does John 3:16 say?"}'
```

Only once those pass, browse to `http://<public-ip>/` from your machine.

---

## 7. Troubleshooting

| Symptom | Likely cause |
|---|---|
| Site unreachable from outside, but `curl localhost/` works on the VM | Firewall — one of the two layers in §4 is still closed. |
| `flask-api` / `nginx` never leave `Created`, only `chatbot` is `Up` | `depends_on: condition: service_healthy` — the dependency isn't healthy yet. `docker inspect --format '{{json .State.Health}}' bible-explorer-chatbot-1` shows why the probe fails; `docker compose logs chatbot`. |
| A service shows `Up (unhealthy)` but seems to work | The probe URL is failing even though the port is open — check `.State.Health` output. `chatbot` needs its `data/{commentary,strongs}` stub dirs to have finished importing (give it the 45 s `start_period`). |
| `502 Bad Gateway` on `/api/*` or `/explorer` | `flask-api` is down or crash-looping — `docker compose logs flask-api`. `502` with `flask-api` healthy: DNS — `docker compose exec nginx nslookup flask-api` (the `resolver` line in `default.conf` must point at `127.0.0.11`). |
| Chat returns `{"error":"Chatbot service unavailable..."}` (503) | `chatbot` container down, or failed to import — `docker compose logs chatbot`. Common: missing `vendor/mybibletoolbox-code/data/{commentary,strongs}` stub dirs. |
| Chatbot log shows `Bible Data Directory Not Found!` then exits | Same as above — the empty `data/` stub dirs are missing from the image. Rebuild after `scripts/vendor-mybibletoolbox.sh`. |
| `flask-api` log: `attempt to write a readonly database` on every DB route | The `Complete.db` mount is `:ro`. It must be read-write — `dataset` runs `PRAGMA journal_mode=WAL` on connect. See §3a; remove `:ro` from both mounts in `docker-compose.yml`. |
| `/LC_/...jpg` returns 404 | Wrong mount path or filename case. Check `docker compose exec nginx ls /srv/LC_ | head`. |
| Deep SPA link (e.g. `/somepage`) 404s on refresh | `frontend/dist` not mounted / empty — the `try_files … /index.html` fallback needs `index.html` present. |
| Streaming reply arrives all at once after a long pause | Note: Flask's internal proxy (`myproject.py`) reads the upstream response with `requests` and returns `resp.content`, so it buffers the whole SSE body before nginx sees it — first token latency ≈ full generation time. This is existing app behaviour, not the container setup; the nginx block is already unbuffered for when that proxy is made streaming. |

Tail live logs while debugging:

```bash
docker compose exec nginx tail -f /var/log/nginx/bible.access.log   # or ./nginx/logs/ on the host
docker compose logs -f flask-api chatbot
```

---

## 8. Updating

```bash
git pull
# refresh SPA if the frontend changed:  (rebuild dist/ per §3e)
docker compose build
docker compose up -d
```

Clear the Flask response cache after data changes (it has a ~17-year TTL):

```bash
docker compose exec flask-api sh -c 'rm -rf /app/CACHED_PAGES/*'
# or on the host:  rm -rf CACHED_PAGES/*
```

---

## 9. Resource expectation on 2 OCPU / 12 GB

| Container | Steady RAM | Notes |
|---|---|---|
| `flask-api` (gunicorn, 3×2) | ~150–300 MB | peak on the 20 000-row-capped `LIKE` scans |
| `chatbot` (uvicorn) | ~250–500 MB | parses study wikis at start-up; LLM inference is off-box |
| `nginx` | ~10–20 MB | serves SPA + images off disk |
| Vite build (§3e) | ~1–2 GB transient | build-time only; do it off-box or expect a few minutes on the VM |

Disk: 178 MB DB + 2.7 GB images + a few MB SPA ≈ **3 GB** in degraded mode; **~7.4 GB**
with the full commentary corpus. Both fit the 200 GB volume many times over.

---

## 10. Adding TLS later (out of scope for this pass)

`nginx/conf.d/default.conf` and `docker-compose.yml` both carry commented
placeholders. The usual path: publish `443:443`, add a `certbot/certbot` companion
container with a shared `./nginx/certs:/etc/letsencrypt` volume and an ACME webroot
under the SPA root, uncomment the `ssl_certificate*` lines, and add an HTTP→HTTPS
redirect server block.
