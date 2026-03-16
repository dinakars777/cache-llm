# cache-llm 🧠

> A blazing fast local proxy server that caches LLM API calls to save you money during agent development.

`cache-llm` is a zero-config, ultra-fast proxy server that intercepts your outgoing LLM requests (e.g., to OpenAI), forwards them to the real API, and stores the response in a local SQLite database.

The next time your code makes the exact same request with the exact same prompt, `cache-llm` instantly returns the cached response in `<2ms`.

## Why?
When building autonomous AI agents or complex AI workflows, you end up running the exact same test suites and prompts thousands of times. This burns through your OpenAI/Anthropic API credits incredibly fast, and slows down your local development cycle by thousands of seconds.

With `cache-llm`, your API bill shrinks to almost zero during local iterative testing, and your tests run instantly.

## Installation & Usage

You can run it instantly without installing:

```bash
npx @dinakars777/cache-llm
```

This will start the proxy server on port `8080`, targeting `https://api.openai.com`, and caching responses in `./.llm-cache.db`.

### Options
- `-p, --port`: Which port to run the proxy on (Default: 8080).
- `-t, --target`: The base URL of the LLM API (Default: `https://api.openai.com`).
- `-d, --db`: The location to store the SQLite database (Default: `./.llm-cache.db`).

## Configuring your App
Just point your project's `BASE_URL` to the proxy!

### OpenAI Node.js SDK
```typescript
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: 'http://localhost:8080/v1' // Point this to cache-llm
});
```

### LangChain, AutoGen, etc.
Just set the environment variable:
```bash
export OPENAI_BASE_URL="http://localhost:8080/v1"
```

## How It Works
1. `cache-llm` computes a deterministic `sha256` hash of the HTTP Method, URL path, Authorization header, and raw request body.
2. If the hash exists in the local SQLite DB, it immediately returns the JSON response.
3. If it's a MISS, it securely forwards the request to the target API, stores the response in the DB, and then returns it to your app.

## License
MIT
