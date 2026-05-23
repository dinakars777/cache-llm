#!/usr/bin/env node
import { Command } from 'commander';
import express from 'express';
import cors from 'cors';
import pc from 'picocolors';
import Database from 'better-sqlite3';
import { createHash } from 'crypto';
import path from 'path';

type CacheRow = {
  response: string;
  status: number;
  headers: string;
};

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

const REQUEST_HEADERS_TO_DROP = new Set([
  ...HOP_BY_HOP_HEADERS,
  'content-length',
  'host',
]);

const RESPONSE_HEADERS_TO_DROP = new Set([
  ...HOP_BY_HOP_HEADERS,
  'content-encoding',
  'content-length',
]);

function buildForwardHeaders(headers: express.Request['headers']) {
  const forwardHeaders = new Headers();

  for (const [key, value] of Object.entries(headers)) {
    const normalizedKey = key.toLowerCase();

    if (REQUEST_HEADERS_TO_DROP.has(normalizedKey) || value === undefined) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        forwardHeaders.append(normalizedKey, item);
      }
    } else {
      forwardHeaders.set(normalizedKey, value);
    }
  }

  return forwardHeaders;
}

function hashRequest(method: string, targetEndpoint: string, headers: Headers, body: Buffer) {
  const hashObj = createHash('sha256');
  hashObj.update(method);
  hashObj.update(targetEndpoint);

  for (const [key, value] of [...headers.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    hashObj.update(key);
    hashObj.update(value);
  }

  hashObj.update(body);
  return hashObj.digest('hex');
}

function collectResponseHeaders(headers: Headers) {
  const responseHeaders: Record<string, string> = {};

  headers.forEach((value, key) => {
    if (!RESPONSE_HEADERS_TO_DROP.has(key.toLowerCase())) {
      responseHeaders[key] = value;
    }
  });

  return responseHeaders;
}

const program = new Command();

program
  .name('cache-llm')
  .description('Blazing fast local proxy server that caches LLM API calls')
  .version('1.0.0')
  .option('-p, --port <number>', 'Port to run the proxy on', '8080')
  .option('-t, --target <url>', 'Target LLM API Base URL', 'https://api.openai.com')
  .option('-d, --db <path>', 'Path to SQLite database', './.llm-cache.db')
  .parse(process.argv);

const options = program.opts();
const PORT = parseInt(options.port, 10);
const TARGET_URL = options.target.replace(/\/$/, '');
const DB_PATH = path.resolve(process.cwd(), options.db);

// Initialize DB
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS requests (
    id TEXT PRIMARY KEY,
    response TEXT NOT NULL,
    status INTEGER NOT NULL,
    headers TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

const insertStmt = db.prepare('INSERT INTO requests (id, response, status, headers) VALUES (?, ?, ?, ?)');
const selectStmt = db.prepare('SELECT * FROM requests WHERE id = ?');

const app = express();
app.use(cors());

// We want to capture the exact raw body to compute a precise hash
app.use(express.raw({ type: '*/*', limit: '50mb' }));

app.all('*', async (req, res) => {
  const method = req.method;
  const urlPath = req.originalUrl;
  const targetEndpoint = `${TARGET_URL}${urlPath}`;
  const requestBody = req.body instanceof Buffer ? req.body : Buffer.alloc(0);
  const forwardHeaders = buildForwardHeaders(req.headers);
  const cacheKey = hashRequest(method, targetEndpoint, forwardHeaders, requestBody);

  const startTime = performance.now();

  try {
    // 1. Check Cache
    const cachedRow = selectStmt.get(cacheKey) as CacheRow | undefined;

    if (cachedRow) {
      const endTime = performance.now();
      const duration = (endTime - startTime).toFixed(1);
      
      console.log(`${pc.green('HIT')} ${pc.gray(duration + 'ms')} ${method} ${urlPath}`);
      
      const headers = JSON.parse(cachedRow.headers);
      for (const [key, value] of Object.entries(headers)) {
        res.setHeader(key, value as string);
      }
      
      // Inject a custom header to prove it came from cache
      res.setHeader('x-cache-llm', 'HIT');
      return res.status(cachedRow.status).send(cachedRow.response);
    }

    // 2. Cache Miss - Forward to real API
    console.log(`${pc.yellow('MISS')} ${method} ${urlPath} -> ${targetEndpoint}`);
    
    // Construct fetch options
    const fetchOptions: RequestInit = {
      method,
      headers: forwardHeaders
    };

    if (method !== 'GET' && method !== 'HEAD') {
      fetchOptions.body = requestBody;
    }

    const fetchResponse = await fetch(targetEndpoint, fetchOptions);
    const responseText = await fetchResponse.text();
    
    // Store in cache
    const responseHeaders = collectResponseHeaders(fetchResponse.headers);

    // Only cache successful or acceptable status codes (e.g. 200 OK)
    if (fetchResponse.ok) {
      insertStmt.run(
        cacheKey,
        responseText,
        fetchResponse.status,
        JSON.stringify(responseHeaders)
      );
    }

    const endTime = performance.now();
    const duration = (endTime - startTime).toFixed(1);
    const result = fetchResponse.ok ? 'SAVED' : 'BYPASS';
    console.log(`${pc.cyan(result)} ${pc.gray(duration + 'ms')} ${fetchResponse.status}`);

    // Return to client
    for (const [key, value] of Object.entries(responseHeaders)) {
      res.setHeader(key, value);
    }
    res.setHeader('x-cache-llm', 'MISS');
    res.status(fetchResponse.status).send(responseText);

  } catch (err: any) {
    console.error(pc.red(`Error proxying request: ${err.message}`));
    res.status(500).json({ error: 'Cache-LLM Proxy Error', message: err.message });
  }
});

app.listen(PORT, () => {
  console.log(pc.inverse(pc.bold(' 🧠 cache-llm ')));
  console.log(`\n🚀 Proxy server running on ${pc.green(`http://localhost:${PORT}`)}`);
  console.log(`🎯 Forwarding to target: ${pc.blue(TARGET_URL)}`);
  console.log(`🗄️  Caching in SQLite DB: ${pc.gray(DB_PATH)}\n`);
  console.log(pc.gray('Point your local agents BASE_URL to this proxy.'));
});
