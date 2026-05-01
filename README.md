# cache-llm 🧠

[![npm version](https://img.shields.io/npm/v/@dinakars777/cache-llm.svg?style=flat-square)](https://www.npmjs.com/package/@dinakars777/cache-llm)
[![npm downloads](https://img.shields.io/npm/dm/@dinakars777/cache-llm.svg?style=flat-square)](https://www.npmjs.com/package/@dinakars777/cache-llm)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)

> Local proxy that caches LLM API calls.

Building AI agents means running the same prompts thousands of times. That burns API credits. **cache-llm** caches responses in SQLite and returns them in `<2ms` on repeat calls.

## Features

- ⚡ `<2ms` response time on cache hits
- 💾 SQLite-backed — zero external dependencies
- 🔌 Drop-in compatible with OpenAI SDK, LangChain, AutoGen, and any OpenAI-compatible client
- 🔒 Deterministic `sha256` hashing — same prompt always hits the same cache entry

## Quick Start

```bash
npx @dinakars777/cache-llm
```

Starts the proxy on `http://localhost:8080` targeting `https://api.openai.com`.

## Options

| Flag | Description | Default |
|---|---|---|
| `-p, --port` | Port to run the proxy on | `8080` |
| `-t, --target` | Target LLM API base URL | `https://api.openai.com` |
| `-d, --db` | SQLite database file path | `./.llm-cache.db` |

## Configuring Your App

Point your client's `baseURL` at the proxy:

```typescript
// OpenAI Node.js SDK
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: 'http://localhost:8080/v1',
});
```

```bash
# LangChain, AutoGen, etc.
export OPENAI_BASE_URL="http://localhost:8080/v1"
```

## How It Works

1. Computes a `sha256` hash of the method, URL path, auth header, and request body
2. Returns the cached response instantly on a hit
3. On a miss, forwards to the real API, stores the response, then returns it

## Tech Stack

| Package | Purpose |
|---|---|
| `better-sqlite3` | Fast local SQLite caching |
| `express` | Proxy server |
| TypeScript | Type-safe implementation |

## License

MIT
