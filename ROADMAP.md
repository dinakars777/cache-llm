# cache-llm Roadmap

Last updated: 2026-05-23

## Current Baseline

`cache-llm` is a small Node CLI that runs an OpenAI-compatible local proxy and stores successful upstream responses in SQLite. Recent maintenance fixed the highest-confidence issues found during the initial repo audit:

- Removed the checked-in `node_modules` tree and made dependency installation reproducible from `package-lock.json`.
- Updated dependency metadata so `npm ci`, `npm ls`, `npm audit --audit-level=high`, and `npm pack --dry-run` are meaningful checks.
- Fixed request forwarding so custom API headers reach upstream and participate in cache keys.
- Added an end-to-end proxy regression test.
- Added GitHub Actions CI for Node 20, 22, 24, and 26.

The next work should improve correctness first, then add developer-facing controls and release maturity.

## Principles

- Preserve proxy compatibility before optimizing cache hit rate.
- Prefer explicit cache policy over surprising implicit behavior.
- Keep local-first ergonomics: one command to run, no external services required.
- Treat cached LLM data as sensitive by default.
- Keep every feature covered by either an end-to-end proxy test or focused unit coverage.

## Phase 1: Cache Policy And Safety

Goal: make cache behavior intentional and inspectable.

Recommended work:

- Add CLI flags and environment variables for cache mode: `read-write`, `read-only`, `refresh`, and `off`.
- Add TTL support with a default that preserves current behavior unless configured.
- Honor request controls such as `Cache-Control: no-store` and a project-specific bypass header such as `x-cache-llm-bypass: true`.
- Add a `cache-llm clear` command or equivalent subcommand for deleting entries by age, target, or all data.
- Store request metadata that helps users understand entries without exposing full prompts by default: method, path, selected vary headers, status, created timestamp, and hit count.

Likely files:

- `src/index.ts`
- `README.md`
- `test/proxy.test.js`

Acceptance criteria:

- Repeated requests still hit the cache in default mode.
- `read-only` never writes new entries.
- `refresh` bypasses existing entries and replaces them after a successful upstream response.
- `off` neither reads nor writes cache entries.
- TTL expiration is covered by tests without slow real-time sleeps.
- Cache bypass headers are not forwarded upstream unless explicitly intended.

## Phase 2: Streaming And Body Fidelity

Goal: handle common LLM response modes without corrupting transport behavior.

Recommended work:

- Detect streaming requests (`stream: true` JSON bodies and `text/event-stream` responses).
- Default to pass-through for streaming responses until replay semantics are explicitly implemented.
- Keep hashing binary-safe by continuing to hash raw request buffers.
- Decide whether non-text upstream responses should be cached, passed through, or rejected with a clear message.
- Add response-header tests for encoded and length-bearing upstream responses.

Likely files:

- `src/index.ts`
- `test/proxy.test.js`

Acceptance criteria:

- Streaming requests do not get buffered and replayed as a single completed body.
- Non-streaming JSON responses continue to cache and replay.
- Cached responses never replay stale `content-length`, `content-encoding`, or hop-by-hop headers.
- Binary request bodies are forwarded byte-for-byte in tests.

## Phase 3: CLI And Configuration Hardening

Goal: make startup failures clear and configuration predictable.

Recommended work:

- Validate `--port`, `--target`, and `--db` before opening the database or server.
- Support `CACHE_LLM_PORT`, `CACHE_LLM_TARGET`, and `CACHE_LLM_DB` environment defaults.
- Add graceful shutdown that closes the HTTP server and SQLite database.
- Split CLI parsing, app creation, cache storage, and proxy behavior into testable modules.
- Add a `--verbose` flag for detailed request/cache logging while keeping default logs compact.

Likely files:

- `src/index.ts`
- `src/cli.ts`
- `src/proxy.ts`
- `src/cache.ts`
- `test/*.test.js`

Acceptance criteria:

- Invalid ports and target URLs exit non-zero before binding.
- Environment defaults work and remain overridable by CLI flags.
- Tests can exercise app/cache logic without spawning the CLI for every case.
- The server exits cleanly on `SIGINT` and `SIGTERM`.

## Phase 4: Packaging And Release Readiness

Goal: make npm publishing predictable and minimal.

Recommended work:

- Add an explicit `files` allowlist in `package.json` so npm packages include only runtime files and docs.
- Add `prepack` or release automation so `dist/index.js` is always built before packaging.
- Consider npm provenance and a release workflow after package ownership and publishing policy are settled.
- Add repository metadata (`repository`, `bugs`, `homepage`) to `package.json`.
- Document the supported Node range and install expectations in `README.md`.

Likely files:

- `package.json`
- `README.md`
- `.github/workflows/ci.yml`

Acceptance criteria:

- `npm pack --dry-run` shows only intended files.
- Package contents include the executable `dist/index.js`.
- CI catches missing build output before release.
- README install instructions match the package metadata.

## Phase 5: Observability And Developer UX

Goal: help users understand savings and debug misses.

Recommended work:

- Add a stats view or command showing total entries, hits, misses, estimated saved calls, and database path.
- Add a safe cache inspection command that shows metadata without dumping full response bodies by default.
- Add optional JSON logs for editor/agent integrations.
- Add examples for OpenAI SDK, LangChain, and other OpenAI-compatible clients.

Likely files:

- `src/index.ts`
- `README.md`
- `test/*.test.js`

Acceptance criteria:

- Users can answer "why was this a miss?" without opening SQLite manually.
- Stats do not expose prompt or response bodies unless the user opts in.
- JSON logs are stable enough for agent tooling to parse.

## Suggested Sequencing

1. Implement Phase 1 before adding more cache surfaces. It defines user trust boundaries.
2. Implement Phase 2 before advertising broad OpenAI endpoint compatibility.
3. Do the Phase 3 module split when Phase 1 or Phase 2 starts to make tests cheaper.
4. Do Phase 4 before the next npm release.
5. Do Phase 5 after the cache metadata model exists.
