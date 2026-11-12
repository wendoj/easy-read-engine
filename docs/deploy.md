# Deploying Easy Read

Task 32, design "Deployment". The repo has the container files. Deploying needs your DNS provider, your Dokploy server and your API keys, so those steps are listed here for you to do.

## What's in the repo

| File | What it does |
| --- | --- |
| `checker/Dockerfile` | Python 3.13 slim with uv. Installs the locked dependencies, including the pinned `en_core_web_sm` 3.8.0 wheel, at build time. Runs `uvicorn http_app:app` on port 8000 as a non-root user. Health check on `/health` (200 once spaCy and the symbol index are loaded). |
| `web/Dockerfile` | Node 24 slim, multi-stage. Next.js `output: "standalone"`, Debian `chromium`, `fonts-liberation` and `fonts-dejavu-core`. Copies `prompts/` to `/app/prompts`. Runs `node server.js` on port 3000 as the `node` user. |
| `docker-compose.yml` | `checker` and `web` on one internal network. `web` waits for `checker` to be healthy. The checker has no published port and no domain. One `symbol-cache` volume at `/data/symbol-cache`. Memory limits: 2 GB for `web`, 1 GB for `checker`. Sets `APP_ENV=production`, `CHECKER_URL=http://checker:8000`, `CHROMIUM_PATH` and `SYMBOL_CACHE_DIR` for `web`. |
| `docker-compose.override.yml` | Local testing only: publishes `web` on `127.0.0.1:3000`. |

Secrets are never in the images. `web` reads them at run time from `.env` next to the compose file (`env_file`, optional). Dokploy writes its Environment tab to that file ([Dokploy Docker Compose](https://docs.dokploy.com/docs/core/docker-compose)). Values under `environment:` in `docker-compose.yml` win over `.env`, so production always runs with `APP_ENV=production`.

## Run it locally

```bash
docker compose build
docker compose up -d --wait          # uses your local .env and the override file
docker compose exec web node -e "fetch('http://checker:8000/health').then(r=>r.text()).then(console.log)"
open http://localhost:3000
docker compose down
```

The model chains may list only `bedrock:` and `groq:` entries. Any other provider, including the removed `gemini:` and `openrouter:`, makes `web` refuse to start.

## Steps left for you

### 1. DNS

Add an A record for `easyread.wendyji.com` pointing at the VPS's public IPv4 address (and an AAAA record if the server has IPv6). Wait until `dig +short easyread.wendyji.com` returns the server's address. Do this before adding the domain in Dokploy, or Let's Encrypt may fail to issue the certificate ([Dokploy domain troubleshooting](https://docs.dokploy.com/docs/core/troubleshooting/domains)).

### 2. Create the Dokploy Compose app

1. In Dokploy, create a project, then a **Compose** service from this Git repo and branch.
2. Set the compose path to `./docker-compose.yml`.
3. Open **Preview Compose** and check:
   - `web` has no `ports:` entry (the override file must not be merged on the server).
   - `checker` has no `ports:` entry and no Traefik labels.
   - `web` and `checker` still share a network. Dokploy adds `dokploy-network` (or an isolated network) to the service with the domain; `web` must keep `internal` too, or it can't reach `http://checker:8000` ([Dokploy compose domains](https://docs.dokploy.com/docs/core/docker-compose/domains)).

### 3. Set the environment variables

In the app's **Environment** tab, set these (names from `.env.example`; the values are yours):

| Variable | Notes |
| --- | --- |
| `AWS_BEARER_TOKEN_BEDROCK` | Secret. A long-term Bedrock API key with access to the 3 Bedrock models below |
| `AWS_REGION` | `eu-west-2`. Optional, this is the default |
| `GROQ_API_KEY` | Secret |
| `MODEL_REWRITE` | `bedrock:openai.gpt-oss-120b-1:0,groq:openai/gpt-oss-120b` |
| `MODEL_JUDGE` | `bedrock:qwen.qwen3-235b-a22b-2507-v1:0,groq:qwen/qwen3.8-27b` |
| `MODEL_VISION` | `bedrock:qwen.qwen3-vl-235b-a22b,groq:qwen/qwen3.8-27b` |
| `ACCESS_KEY` | Secret. The judge access key, a random value such as the output of `openssl rand -base64 32`. Required in production: without it, live conversion is closed to everyone and only the sample letters work |

`APP_ENV`, `CHECKER_URL`, `SYMBOL_CACHE_DIR` and `CHROMIUM_PATH` are already set in `docker-compose.yml`. Bedrock is paid per token, so set an AWS Budgets alert on the account.

#### Judge access

The routes that call a model (`/api/convert`, `/api/extract`, `/api/check`) need the access key. Anyone can open the sample letters and export them as PDFs.

1. Set `ACCESS_KEY` in the Environment tab and redeploy.
2. Put the key in the private judge field of the Devpost submission. Don't put it in the README, the video or anywhere public.
3. A judge selects **I have an access key** on the input screen and types the key. The browser keeps a cookie for 30 days. The cookie holds an HMAC of the key, not the key.
4. After judging, change `ACCESS_KEY` (or clear it) and redeploy. Every cookie made with the old key stops working at once.

The per-client rate limit and the daily cap still apply to key holders. Key attempts count against the per-client limit, to slow guessing.

### 4. Attach the domain

In the **Domains** tab, add `easyread.wendyji.com` to the `web` service, container port `3000`, HTTPS on, certificate provider Let's Encrypt. Don't add a domain to `checker`. Then deploy.

### 5. Smoke test on the live URL

1. Open `https://easyread.wendyji.com`. The page loads over HTTPS with a valid certificate.
2. Without the key, select a sample letter: it loads, and the paste and upload controls are turned off. Then select **I have an access key**, type `ACCESS_KEY`, and convert a letter (one of the invented letters in `fixtures/letters/`, pasted in). The result screen shows the Original on the left, the notice that can't be dismissed, and the Easy Read lines with key facts highlighted.
3. Click **Export** and check the PDF: A4, the notice at the top of page 1, pictures in the left column, and the ARASAAC attribution in the footer.
4. Start-up check: in the Environment tab, set `MODEL_REWRITE` to a value with an unknown provider (for example `gemini:gemini-2.5-flash`) and redeploy. The `web` container must exit with `Refusing to start: Unknown model provider in entry "gemini:gemini-2.5-flash". Use one of: bedrock, groq` in its logs, and the site must not serve. Because of `restart: unless-stopped`, Docker restarts it and it exits again each time. Put the real value back and redeploy.
5. In the `web` logs, check that log lines hold rule results, counts and timings only, with no letter text (R7.4).

## Chromium sandbox

The web container runs as the non-root `node` user, but PDF export currently launches Chromium **without** its sandbox. `web/src/export/chromium.ts` uses Playwright's default (`chromiumSandbox: false`, which passes `--no-sandbox`). The local Docker check for task 32 found:

- With Docker's default seccomp profile, Chromium's sandbox fails to start ("Chromium sandboxing failed!"). The profile blocks the user-namespace system calls (`unshare`, `clone` with `CLONE_NEWUSER`) the sandbox needs. Debian's `chromium` package ships no setuid `chrome-sandbox` helper to fall back on.
- With seccomp turned off for the container, the sandbox starts and the PDF renders.

The export page is low risk without the sandbox: it renders only HTML the server builds itself, with JavaScript off, the context offline, and every network request aborted. To turn the sandbox on later:

1. Use a seccomp profile: Docker's default profile with `clone`, `clone3` and `unshare` allowed. Set it on `web` with `security_opt: ["seccomp=./web/chromium-seccomp.json"]`.
2. Set `chromiumSandbox: true` in `chromium.ts` (or make it an env setting).

Don't use `cap_add: [SYS_ADMIN]` or `seccomp=unconfined` for this. Both give the container far more than the sandbox needs.
