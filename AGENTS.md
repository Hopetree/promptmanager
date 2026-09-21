# AGENTS.md - Operating guide for AI agents working in this repository

> **Audience**: AI agents and fresh sessions working in this repo. This is *not* a product introduction,
> *not* a requirements spec, and *not* a general engineering standard - those are `README.md`, `BRIEF.md`,
> and `/root/greenhouse/STANDARDS.md` (**highest precedence**; it wins on any conflict).
>
> This file covers **how to work in this repo** and nothing else. Every command below was actually executed
> on 2026-09-21 and re-verified in stage 32 (test counts, bundle size, screenshot conventions); every path
> was checked with `test -e`. Where a topic is already documented elsewhere, this file **points to it
> instead of duplicating it**, so there is exactly one source of truth.
>
> This file is **English-only by policy** (`STANDARDS.md` section 5.1: AI instruction files are English so
> agents can match and update them reliably). The rest of the repo's documentation is Chinese.

---

## 1. What this project is

- **What it is**: a lightweight, self-hosted, **data-you-own** prompt manager. It is a clean-room
  implementation of prompt management only (the upstream PromptHub is feature-rich but heavy, and AGPL-3.0).
  No RAG, no vector search, no AI calls.
- **Stack**: Node 24 + TypeScript (ESM, strict) + Fastify 5 + SQLite (`better-sqlite3` + `kysely`)
  + React 19 + **antd 6** + Vite 8.
- **Shape**: **one process, one port, one database file**. The same process serves both the HTTP API and the
  built frontend. Data lives in `DATA_DIR/pm.db` (WAL); **backup = copy the file**.
- **Current version**: `1.0.0`, read from a single source of truth (`package.json`), which `/healthz` also reads.
- **Deployment shape**: on host 228 it runs under **systemd** (the `deploy/` trio). The repo also contains
  container files delivered by host_manger (`Dockerfile`, `docker-compose.yml`, `deploy/container.md`).
  **Delivered is not deployed.**
- Listen address, port, auth model, and the environment-variable table live in the "how to run" section of
  `README.md`. Default is `0.0.0.0:8767`; every `/api/*` route except `/healthz` and `/api/login` returns
  401 when unauthenticated.

## 2. Five-minute quickstart (fresh session)

```bash
cd /root/greenhouse/projects/promptmanager
npm ci --cache var/cache/npm     # WARNING: /root/.npm is read-only in this sandbox; keep the cache in-repo (see section 3 and pitfall 3)
npm run build                    # tsc -> dist/server, vite -> dist/web
npm test                         # expect: tests 329 / pass 329 / fail 0 (~15s)

# Start a throwaway instance (never touches production data, never takes port 8767)
AC=$(mktemp -d)
printf '%s\n' 'dev-pw-123456' | DATA_DIR=$AC node bin/pm.mjs user set-password --username admin
DATA_DIR=$AC PORT=8766 node dist/server/index.js &   # then open http://<this-host-LAN-IP>:8766
curl -s http://127.0.0.1:8766/healthz                # {"status":"ok","version":"1.0.0"}
```

After changing code you **must** run `npm test` and `bash tools/ci-check.sh` before committing (see section 7).

## 3. Common commands (all of these were run for real)

| Goal | Command | Verified output / pass criterion |
| --- | --- | --- |
| Install deps | `npm ci --cache var/cache/npm` | rc=0; 209 entries in `node_modules`. **Without `--cache` it fails with EROFS** (pitfall 3). The trailing `npm warn allow-scripts ... better-sqlite3@13.0.3 (install: node-gyp rebuild)` is **expected** (pitfall 9). |
| Full build | `npm run build` | rc=0 -> `dist/server` + `dist/web`; largest chunk `vendor-antd-*.js` = 470985 B (no `larger than 500 kB` warning). |
| Server build only | `npm run build:server` | rc=0. The CLI and `node --test` both load from `dist/**` (pitfall 8). |
| Web build only | `npm run build:web` | rc=0. |
| Full test suite | `npm test` | rc=0; `tests 329` / `pass 329` / `fail 0` (= build + typecheck:tests + `node --test "tests/**/*.test.ts"`). |
| One test file | `npm run build && node --test tests/health.test.ts` | rc=0; `tests 3` / `pass 3` / `fail 0`. **Build first**: tests import from `../dist/**`, and some cases need `dist/web`. |
| One test case | `npm run build && node --test --test-name-pattern='0.0.0.0' tests/health.test.ts` | rc=0; `tests 1` / `pass 1` / `fail 0`. |
| Type check | `npm run typecheck:web` / `npm run typecheck:tests` | Both rc=0, `0` TS errors (silent on success). **`typecheck:tests` runs `build:server` first**, because the tests type-check against `../dist/**` (pitfall 11). |
| **Local quality gate (= the CI gate)** | `bash tools/ci-check.sh` | rc=0; all 6 rows green (**deps / build / 2x typecheck / npm test / 500 KB chunk budget** - the build comes *before* the type checks, see pitfall 11). The script's own pass banner is Chinese in its source; in English it says "all quality checks passed (6 items)". It reports `tests 329 ... fail 0` and max chunk `470985 B`. |
| Migrate (idempotent) | `DATA_DIR=$AC npm run migrate` | rc=0; prints **`ok: schema at v3`**. A second run prints the same and also exits 0. |
| Set the admin password | `printf '%s\n' '<strong-password>' \| DATA_DIR=$AC node bin/pm.mjs user set-password --username admin` | rc=0; prints **`ok: user admin password updated`** (password is read from stdin and never echoed). |
| Start (default 8767) | `npm start` | rc=0; logs `promptmanager listening on 0.0.0.0:<PORT> (HOST=0.0.0.0 PORT=<PORT>, DATA_DIR=...)`. Verified with `PORT=8765`; **8767 is currently occupied by the test environment**. |
| **Start a throwaway instance** | `DATA_DIR=$(mktemp -d) PORT=8766 node dist/server/index.js` | Logs `listening on 0.0.0.0:8766`; `/healthz` -> `{"status":"ok","version":"1.0.0"}`; unauthenticated `/api/prompts` -> `401`; `/` -> `200`. |
| Big fixture (2000 rows) | `DATA_DIR=$AC node tools/seed-prompts.mjs 2000` | rc=0; `ok: seeded 2000 prompts (total=2000, fts_hits=2000) in ... [192 ms]`. |
| Deployment file syntax | `systemd-analyze verify deploy/promptmanager.service` | rc=0 and **no output**. Note: it cannot catch the "starts, then crashes" trap (pitfall 1). |
| UI evidence screenshots | `bash tools/ui-shots.sh` | rc=0; `OK ui-shots done`; **self-check mode writes the full 53-shot set to `tmp/ui-shots/shots/` (not committed)**. Use `bash tools/ui-shots.sh --key` to (re)generate the one key set of 8 into `docs/shots/` (see section 5.1). |
| One representative stage script | `bash tools/ac-stage25.sh` | rc=0; the script's final banner (Chinese in its source) means "AC-76 all checks passed". For the full script list see the verification section of `README.md`; there is no stage 9 script. |

**Port discipline**: never use 8767 for a throwaway instance - the test environment is already listening
there (verified with `ss -ltn`). Pick a free port in the allocated range **8765-8770** (check `ss -ltn`
first). If all of them are taken, write `QUESTIONS.md` and stop; do not widen the range.

## 4. Project layout

| Path | Responsibility / key files |
| --- | --- |
| `bin/` | Two entry points: `pm.mjs` (CLI, delegates to `dist/server/cli.js`) and `pm-mcp.mjs` (MCP stdio entry). |
| `src/config.ts` | Runtime config (`HOST` / `PORT` / `DATA_DIR` / ... defaults and validation). `findProjectRoot()` locates the repo root by the `name` field in `package.json`. |
| `src/server/` | HTTP layer: `index.ts` (**process entry**, listen + graceful shutdown), `app.ts` (assembles Fastify, mounts routes and static hosting), `cli.ts` (CLI implementation), `auth.ts` (session / Bearer gate), `params.ts`, `routes/*.ts` (auth, prompts, folders, tags, export, render, tokens, usage, health). |
| `src/services/` | Domain logic: `prompts.ts`, `folders.ts`, `tags.ts`, `versions.ts`, `variables.ts`, `markdown.ts`, `export.ts`, `import.ts`, `tokens.ts`, `usage.ts`, `auth.ts`. |
| `src/db/` | Data layer: `index.ts` (connection / QueryEngine), `migrate.ts` (applies `migrations/*.sql`), `schema.ts` (kysely table types), `prompt-queries.ts`, `prompt-versions.ts`, `search.ts` (FTS5 trigram with LIKE fallback). |
| `src/mcp/` | MCP tool surface (`server.ts`, three read-only tools). |
| `src/client/pm-api.ts` | HTTP client used by the consumer-side CLI (`pm get` / `pm render` go through it). |
| `web/` | Frontend: `index.html`, `src/main.tsx` (mount), `src/App.tsx`, `src/components/*.tsx` (`Workspace`, `SplitView`, `PromptEditor`, `VersionPanel`, `VariablePanel`, `VarsDialog`, ...), `src/api.ts`, `src/clipboard.ts`, `src/theme.ts`, `src/types.ts`, `src/styles/*.css`. |
| `migrations/` | `001_init.sql`, `002_tokens-and-usage.sql`, `003_prompt-sort-order.sql`. |
| `tests/` | `node:test` cases (59 `*.test.ts` files) plus shared fixtures in `helpers.ts`. |
| `tools/` | `ci-check.sh` (the local = CI quality gate), `ui-shots.sh` + `ui-shot.mjs` (UI evidence), `ac-stage<N>.sh` + `ac-stage<N>-probe.mjs` (per-stage AC self-checks), `seed-prompts.mjs`, `search-zh-poc.mjs`, `mcp-client-smoke.py`. |
| `deploy/` | Deliverables (**this repo does not deploy them**): `promptmanager.service`, `promptmanager.env.example`, `README.md` (install / verify / roll back / troubleshoot), `reverse-proxy.example.conf`, `mcp-register.example.json`, `container.md`. |
| `docs/` | **Final-state documentation only, for humans** (developers + users): `dependencies.md` (deps + licenses + CVEs), `versioning.md`, `search-zh.md`, `brief-changelog.md`, `shots/` (**one** set of key page shots, 8 PNGs), `dev-history/` (process archive kept as acceptance evidence: full PROGRESS/VERIFY, past QUESTIONS, design studies — **documents only; its screenshots live in `tmp/`**). See section 5.1. |
| Root files | `BRIEF.md` (requirements + ACs, **read-only**), `README.md`, `PROGRESS.md`, `VERIFY.md`, `QUESTIONS.md`, `CHANGELOG.md`, `package.json` / `package-lock.json`, `tsconfig*.json`, `vite.config.ts`, `.gitignore`, `Dockerfile` / `docker-compose.yml` / `.dockerignore`, `.github/workflows/ci.yml`. |
| Runtime (never committed) | `tmp/` (**never committed**: process artifacts — self-check screenshots, archived shots, debug dumps, logs, scratch scripts), `var/` (logs and caches), `dist/` (build output), `node_modules/`, `_env/` (credentials, mode 700, read-only use). The default data dir `data/` appears **after the first run** (see section 6). |

## 5. Code conventions

- **Language / modules**: TypeScript strict + **ESM**. Server code in `src/**` compiles to `dist/**`, so
  **relative imports must carry the `.js` extension** (`../config.js`) even though the source is `.ts`.
  Frontend code in `web/src/**` is bundled by Vite; components are `.tsx`.
- **Naming**: files and directories are lowercase with hyphens (`prompt-queries.ts`, `ac-stage25.sh`).
  **HTTP JSON fields and database columns are snake_case** (`user_prompt`, `folder_id`, `sort_order`) -
  that is the contract in `BRIEF.md` section 6.1. **Do not rename them to camelCase.**
- **Frontend always uses the antd component library** (`antd@6.6.4` + `@ant-design/icons@6.3.4`, both MIT):
  buttons, forms, inputs, selects, tables, pagination, trees, modals, drawers, tabs, notifications, icons -
  all from the library. **No hand-rolled base components**, **no second styling system** (no Tailwind),
  **no CDN**. Copying library source into the repo and editing it counts as hand-rolling. Interactive
  elements carry `data-testid="pm-*"` because the AC probes locate them by that attribute.
- **Drag and drop always uses `@dnd-kit`** (never a hand-written drag engine). The same rule applies to all
  infrastructure: HTTP framework, ORM, migrations, test framework, and so on. See the forbidden-hand-rolling
  list in `STANDARDS.md` section 4.2.
- **Dependency discipline**: before adding a dependency - (1) check CVE/OSV, (2) check the license
  (MIT / Apache / BSD / ISC are fine; MPL / LGPL are acceptable; GPL / AGPL / no license means write
  `QUESTIONS.md` first), (3) **pin the exact version** (no `^`, no `latest`), (4) register it in
  `docs/dependencies.md` with name, version, license, and purpose. The package manager is fixed to **npm**
  (`package-lock.json` is committed); **do not use pnpm**.
- Request validation uses Fastify's built-in JSON Schema (ajv); MCP tool inputs use `zod`. Do not add
  another validation library.
- Comments explain **why** (especially why a workaround exists), not what the code already says.

### 5.1 Where documentation and screenshots live: `docs/` vs `tmp/` (STANDARDS.md section 5.2)

**Rule of thumb**: *final deliverable / documentation (a human reads it) goes to `docs/`; a process
artifact (only the process needs it) goes to `tmp/`.*

- **`docs/` is final-state, for humans** (developers + users): product docs, dependency list, versioning
  plan, search report, BRIEF change history, and **one set of key page shots**.
- **`tmp/` holds process artifacts and is never committed** (it is in `.gitignore`): per-stage acceptance
  screenshots, regression/self-check screenshot batches, AC-probe intermediate output, debug dumps, scratch
  scripts, logs, backups. **`git ls-files tmp` must always be `0`** - never `git add` anything under `tmp/`.
- **Screenshot tiers**:
  - **key page shots → `docs/shots/`** - exactly one set of 8 (`01-login`, `02-split`, `03-table`,
    `04-cards`, `05-editor`, `06-detail`, `07-mobile`, `08-dark`), covering
    login / split / table / card / editor / detail / mobile / dark;
  - **per-stage process shots → `tmp/shots/stage<N>/`** (written by the `ac-stage<N>.sh` scripts);
  - anything replaced is **archived (moved) to `tmp/shots-archive/`** - never left behind in `docs/`.
- **Tool conventions**:
  - `bash tools/ui-shots.sh` - **default output is `tmp/ui-shots/shots/`** (self-check mode, not
    committed). Only `bash tools/ui-shots.sh --key` produces the single key set into `docs/shots/`, and it
    first archives the previous set to `tmp/shots-archive/docs-shots/<timestamp>/` ("one set only").
  - `bash tools/ac-stage<N>.sh` - process shots default to `tmp/shots/stage<N>/`.
- **`docs/dev-history/` keeps its documents** (full PROGRESS / VERIFY / past QUESTIONS / design studies)
  because they are **acceptance evidence**; **only its screenshots move to `tmp/`**.
- The full text is `/root/greenhouse/STANDARDS.md` section 5.2. **Do not restate these rules elsewhere -
  point at that section.**

## 6. Data and migrations

- **Data directory**: `DATA_DIR` (defaults to `<repo>/data`, created on first run). It holds `pm.db`
  (SQLite, WAL) and `media/`. In production it is `/var/lib/promptmanager` (the unit's `StateDirectory`).
- **Migrations**: `migrations/NNN_*.sql`, applied in order by `src/db/migrate.ts`, with applied versions
  recorded in `schema_migrations`. There are 3 files today, hence the output `ok: schema at v3`.
  **The server also runs migrations on startup**, so every migration must be **idempotent**.
- **Adding a migration**: create `004_xxx.sql`; **never edit the already-applied `001`-`003`**. Keep it pure
  SQL and safe to run twice. Verify with `DATA_DIR=$(mktemp -d) npm run migrate` (expect `ok: schema at vN`).
- `schema_version` (the **export file format**, currently 1) is **decoupled** from the project version
  `MAJOR.MINOR.PATCH`. For the rules, tag conventions, and the release procedure, read
  `docs/versioning.md` - **do not restate them here**.
- Backup / restore / rollback: copy `pm.db` (plus `-wal` and `-shm` in WAL mode), or run
  `node bin/pm.mjs export --out backup.json`. Details in `deploy/README.md` section 4.
  **This project does not do backups by default.**
- **Version retention (FR-86)**: `prompt_versions` holds **at most the newest 10 rows per prompt**
  (`VERSION_KEEP_LIMIT` in `src/db/prompt-versions.ts`). Every code path that inserts a version must call
  `pruneVersions(qe, promptId)` **inside the same transaction** - today that is create / PUT / rollback /
  bulk favorite·move / import (replace + merge). Pruning only deletes rows: it never renumbers
  `version_no`, and `prompts.version_no` is always exempt from deletion. There is **no migration** for
  existing data - old rows get trimmed the next time that prompt produces a version. The cap outranks the
  `replace` export→import→re-export byte-equality guarantee when a file carries more than 10 versions;
  see the "known limitations" section of `README.md`.

## 7. Tests

- **Location and size**: `tests/**/*.test.ts` (59 files, **329** cases). How to run them: section 3.
  The case count **only grows**; the pass criterion is `fail 0`. A larger number means new cases were added;
  a smaller number or `fail > 0` means a regression.
- **Style**: Node's built-in `node:test` + `node:assert/strict` (**no third-party test framework**). Shared
  fixtures live in `tests/helpers.ts` (`makeFixture`, `login`, `cookieOf`, `readDb`, `runCliProcess`,
  `assertCliOk`). Every case creates its own temporary `DATA_DIR` (`mkdtemp`) and **never touches `data/`
  or port 8767**.
- **CLI subprocesses** always go through `runCliProcess()`; do not `spawn` them yourself - see pitfall 4.
- Part of the frontend coverage is **source-level assertions** (`tests/stage*.test.ts` read text/structure
  from `web/src/**`) and **DOM-level assertions** (jsdom renders components). Neither needs a real browser;
  real-browser verification happens in the AC scripts described in section 8.
- **If you see `✖ <file> 'test failed'` with no assertion detail, do not start editing business code.**
  That shape almost always means **the file's process was killed by a signal**, not that an assertion failed.
  When `bash tools/ci-check.sh` fails it prints the full diagnostics (`signal`, `Error:`, last log lines).

## 8. Verification and evidence (project-specific; do not copy generic habits)

- **Turn every AC into an executable command.** Each AC must translate into a command plus an expected
  output, and at wrap-up you must paste the **raw output** into `PROGRESS.md`. Ready-made per-stage scripts
  are `bash tools/ac-stage<N>.sh` (they start and stop their own throwaway instance with a temporary
  `DATA_DIR` and never touch production files).
- **Interaction ACs must use real mouse events**: CDP `Input.dispatchMouseEvent` with
  `mouseMoved` -> `mousePressed` -> `mouseReleased`. **Never use JS `.click()`** - it bypasses pointer
  events and will not expose real bugs in drag-and-drop, multi-select, or drag handles.
- **UI ACs must take and read their own screenshots**: `bash tools/ui-shots.sh` starts and stops its own
  instance and drives a zero-install headless chromium. **Self-check runs write to `tmp/` and are not
  committed**; only `--key` (release/delivery) writes the single key set of 8 to `docs/shots/`. The run
  also writes a post-render DOM dump for the `ant-*` class-name count. Record your per-image reading in
  the PROGRESS section for that stage. See section 5.1.
- **Capabilities that depend on a secure context must be verified over the LAN IP**:
  `http://192.168.0.228:<port>`. `127.0.0.1` counts as a secure context and will **mask** real bugs that
  only appear over plain HTTP on the LAN (see pitfall 5).
- **Read-only / no-side-effect claims need executable evidence** (`ss -ltn`, `git status --porcelain`,
  DOM counts, `grep -c`).
- **Wrap-up trio, all green with raw output pasted**: `npm test`, `bash tools/ci-check.sh`, and this
  stage's `tools/ac-stage<N>.sh`.

## 9. Hard rules

- Write only inside this project directory. **Never edit `BRIEF.md` or `STANDARDS.md`** (not even to
  "tidy up the wording").
- **Do not touch** `/opt/promptmanager`, systemd units, the 8767 test environment, or firewall / NAT /
  kernel settings - those belong to host_manger. Deployment, reverse proxying, and backups are executed by
  host_manger **only when the user explicitly asks for them**.
- **Credentials never enter the repo**: `_env/` (mode 700, gitignored) is read-only for you, never copied.
  Passwords go into the database from stdin and are **never echoed, logged, or written to `.env`**.
  Password-like values in `deploy/*.env.example` stay empty.
- No CDN resources, no global package installs (`npm i -g`, system-wide `pip install`), and no external
  publishing (pushing to public repos, posting anywhere).
- Never `rm -rf` a path you are unsure about. `data/`, `tmp/`, `var/`, `dist/`, `node_modules/`, and
  `_env/` are all excluded from git.
- **`docs/` is final-state only and `tmp/` is never committed** (`STANDARDS.md` section 5.2): keep key page
  shots in `docs/shots/`, per-stage/self-check screenshots in `tmp/`, and confirm `git ls-files tmp` is
  empty before every commit. See section 5.1.
- **`git add` with explicit paths only** (for example `git add AGENTS.md`) - **never `git add -A` or
  `git add .`**: another session's uncommitted changes may be sitting in the working tree, and `-A` would
  sweep them into your commit.
- Never weaken security to "make it pass": disabling auth, disabling validation, skipping tests, or using
  `--insecure` are all violations.

## 10. Project-specific pitfalls (each one points at evidence)

1. **A Node service unit must allow `AF_NETLINK`, or it crashes on startup.** `os.networkInterfaces()`
   (which Fastify calls to log the listen address) needs an AF_NETLINK socket; without it you get
   `uv_interface_addresses ... errno 97 (EAFNOSUPPORT)` -> `status=1/FAILURE` and a restart loop.
   **`systemd-analyze verify` cannot catch this** - it is all green while the service still dies.
   Evidence: `deploy/promptmanager.service:52`, `deploy/README.md` section 6,
   `docs/dev-history/PROGRESS.md` (stage 9.1 section).
2. **A Node service must not enable `MemoryDenyWriteExecute`** (it conflicts with V8 JIT's writable and
   executable pages -> `status=5/TRAP`). This repo's unit does not contain that directive at all:
   `grep -c MemoryDenyWriteExecute deploy/promptmanager.service` -> `0`.
   Evidence: `deploy/README.md` section 1 ("unit key conventions"), `STANDARDS.md` section 7.5 failure table.
3. **`npm ci` fails with EROFS in this sandbox**: `npm error code EROFS ... /root/.npm/_cacache/tmp`
   because `/root/.npm` is read-only. Fix: keep the cache inside the repo ->
   **`npm ci --cache var/cache/npm`** (verified rc=0; `var/` is gitignored). The same applies to any npm
   command that writes the cache.
4. **Under `node --test`, CLI subprocesses must be spawned with `detached: true` or the suite goes flaky.**
   A child that shares the test runner's process group gets killed when the environment cleans up the whole
   group (`kill -PGID`, `bwrap --die-with-parent`), so the assertion sees `code=null`; with better
   diagnostics it turned out to be `signal=SIGSEGV`. For this failure shape `node:test` only reports a
   file-level `✖ <file> 'test failed'` with no detail. The fix is the shared helper
   (`runCliProcess()` in `tests/helpers.ts`: `detached`, swallow EPIPE, 30s safety valve) - **not a retry**.
   Evidence: `tests/helpers.ts:69-113`, `PROGRESS.md` (P2-C and P2 rework sections),
   `VERIFY.md` (P2 rework acceptance).
5. **`navigator.clipboard` simply does not exist over plain HTTP on the LAN.** At
   `http://192.168.x.x:<port>` the page is not a secure context (`window.isSecureContext === false`), so
   copying must fall back to `document.execCommand('copy')`. Verifying over `127.0.0.1` hides this bug.
   Evidence: `web/src/clipboard.ts:6-32`, `tests/clipboard-fallback.test.ts`,
   `docs/dev-history/PROGRESS.md` (AC-65 section, `ac65_clipboard_type=undefined`).
6. **The `jsdom` instance used for Markdown rendering is a module-level singleton and holds ~200 MB RSS.**
   `src/services/markdown.ts:12` runs `new JSDOM('')` at module load; a fully started server reaches
   VmRSS ~204 MB. When several test files load jsdom concurrently they create memory pressure, which shows
   up as a **file-level `test failed`** (not an assertion error). Evidence: `src/services/markdown.ts:12`,
   `README.md` ("Known limitations"), `PROGRESS.md` (P2, "second flaky").
7. **The `folder_id` filter includes all descendants; it is not an exact match.**
   `GET /api/prompts?folder_id=X` returns prompts in X and every folder beneath it (the same scope the
   sidebar counts use). This is intentional, not a bug. Evidence: `src/db/prompt-queries.ts:16,44`
   (`descendantFolderIds`), `tests/api-folder-inclusive.test.ts`, `README.md` ("Known limitations", folders).
8. **`bin/pm.mjs` and `node --test` both load from `dist/**`.** Calling the CLI before
   `npm run build` (or `build:server`) fails with `error: ... dist/server/cli.js ...` and exit code 1.
   And because tests import from `../dist/**`, **editing `src/` without rebuilding means you are testing
   stale code**. Evidence: `bin/pm.mjs:9-17`, `tests/health.test.ts:6-7`.
9. **`npm ci` skips better-sqlite3's install script** (npm 11 allow-scripts policy; it prints
   `npm warn allow-scripts ... better-sqlite3@13.0.3 (install: node-gyp rebuild)`). **This is harmless**:
   the package ships per-platform binaries in `prebuilds/`, so **the deployment host needs no gcc or
   node-gyp**. Verified after a cold install: `require('better-sqlite3')` table create/read/write and
   `fts5(x, tokenize='trigram')` both work. Evidence: `docs/dependencies.md:123-125`,
   `docs/dev-history/PROGRESS.md` (AC-1 section).
10. **Import `replace` cannot wipe tables in one shot**: `folders.parent_id` is a self-referencing foreign
    key declared `ON DELETE RESTRICT` (`migrations/001_init.sql:37`), so folders must be deleted
    leaf-first, repeatedly. Evidence: `docs/dev-history/PROGRESS.md` (stage 5, "replace clearing order").
11. **`npm run typecheck:tests` type-checks against the *build output*, so `dist/` must exist first.**
    `tests/**/*.test.ts` import from `../dist/**`; on a clean checkout (CI, no `dist/`) it fails with
    **38 `TS2307: Cannot find module '../dist/…'`** (plus 3 cascading `TS7006`) - while passing locally,
    where a stale `dist/` happens to exist. That is why `tools/ci-check.sh` runs the build **before** the
    type checks, and why the `typecheck:tests` script itself starts with `npm run build:server &&`.
    Reproduce: `rm -rf dist && npm run typecheck:tests` -> **38** errors before the fix, **0** after.
    Evidence: `tools/ci-check.sh` (header comment + step ②), `package.json` scripts,
    `tests/stage32-ci-order.test.ts`, `tools/ac-stage32.sh`, `PROGRESS.md` (stage 32).

## 11. Documentation map (which doc owns what, and when to read it)

| Document | What it owns | When to read it |
| --- | --- | --- |
| `/root/greenhouse/STANDARDS.md` | Engineering standard (**highest precedence**), hard rules, port / dependency / documentation / commit / acceptance rules | Before starting; and whenever it conflicts with `BRIEF.md` |
| `BRIEF.md` | **The only source of requirements**: FRs, technical constraints, interface contracts, **every AC**, the stage table (read-only) | Before starting, read the sections for your stage: 4 (FRs), 5 (constraints), 6 (contracts), 8 (ACs), 11 (stage table) |
| `README.md` | What it is / how to run / how to verify / known limitations; environment-variable table, UI description, verification script list | When you need to run it, need to know how to verify something, or need the known limitations |
| `PROGRESS.md` | **Current status + stage index** (the trimmed root-level version) | When you want to know where the project stands or what comes next |
| `docs/dev-history/PROGRESS.md` | **Full process record**: every AC's commands and raw output, per-image screenshot readings, decisions, and pitfalls | When re-checking an AC, mining historical pitfalls, or explaining why something was built that way |
| `VERIFY.md` / `docs/dev-history/VERIFY.md` | Acceptance conclusions / full acceptance record including rework lists (written by host_manger) | When you need to know whether the last stage passed and what was sent back |
| `docs/versioning.md` | Semver criteria, tag conventions, the four release steps, and how `schema_version` decouples from the project version | When bumping the version, cutting a release, or changing the export format |
| `docs/dependencies.md` | Dependency list + licenses + selection rationale + OSV/CVE audit evidence | When adding a dependency, auditing dependencies, or asking "why this package" |
| `docs/search-zh.md` | Measured report on Chinese full-text search (FTS5 trigram with LIKE fallback, 2000-row baseline) | When changing search logic |
| `docs/brief-changelog.md` | Change history of BRIEF v1-v32 (moved out of `BRIEF.md`) | When you need to know when and why a requirement appeared |
| `CHANGELOG.md` | Human-readable version history (Keep a Changelog style) | When releasing, or when you need to know what a version contains |
| `deploy/README.md` | systemd install / verify / roll back, plus troubleshooting (AF_NETLINK and friends) | When touching deployment files or diagnosing a startup failure |
| `deploy/container.md` | Container shape (delivered by host_manger) | When you need the container form |
| `docs/shots/` | **One** set of key page shots (8 PNGs: login / split / table / card / editor / detail / mobile / dark) - the human-facing UI evidence | When you need a current UI reference or compare against a UI AC |
| `tmp/shots-archive/` (not committed) | Archived screenshots: the old top-level set, per-stage process shots, `docs/dev-history/shots/`, and the design-study shots | When you need historical/process screenshots for an old AC |
| `QUESTIONS.md` | Template for stopping and asking (past Q&A in `docs/dev-history/QUESTIONS-history.md`) | When the spec does not cover something that blocks delivery (see section 12) |

## 12. Working agreement for AI agents

- **Commit granularity**: one commit per **acceptable unit**, message shaped `<type>(<scope>): <summary>`
  (type is one of `feat`, `fix`, `refactor`, `test`, `docs`, `chore`). Do not commit half-finished work.
  Commit linearly on `main`; **never force push and never rewrite existing history**.
- **Ledger-style replies**: every conclusion must name **where it landed on disk** (file path plus
  section/line, or a commit hash). **Saying it in chat does not count as delivering it.** Any claim of
  "I did X" needs the command, its output, and the commit.
- **If the spec does not cover something that blocks delivery, write `QUESTIONS.md` (2-3 options plus a
  recommendation) and stop** - do not decide it yourself. Stop for the same reason when a single AC has
  failed three times in a row, when requirements contradict each other, when you would need to cross a
  boundary, or when you need a credential that is not in `_env/`. When stopping, keep the tree compilable
  and commit whatever is already complete.
- **Fresh session or after context compaction**: re-read `BRIEF.md` sections 4 (your stage's FRs),
  5 (constraints), 8 (your stage's ACs), and 11 (stage table), then the status table and stage index in
  `PROGRESS.md`. **Do not edit code from memory.**
- **When several sessions run in parallel**: make sure the files you write do not overlap with anyone
  else's; use explicit `git add` paths (section 9); and check whether another session is running before
  you run `npm test` or `npm run build`, so you do not disturb each other and produce false results.
- **Stage boundaries**: only claim what your stage is supposed to deliver. If you implement something from
  a later stage along the way, record it in `PROGRESS.md` for reference and **do not claim that later stage
  is done**.
