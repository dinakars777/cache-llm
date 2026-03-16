#!/usr/bin/env node
import { Command } from 'commander';
import express from 'express';
import cors from 'cors';
import pc from 'picocolors';
import Database from 'better-sqlite3';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';

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
  
  // Create a deterministic hash of the request to use as cache key
  const requestBody = req.body instanceof Buffer ? req.body.toString('utf-8') : '';
  const authHeader = req.headers['authorization'] || '';
  
  const hashObj = createHash('sha256');
  hashObj.update(method);
  hashObj.update(targetEndpoint);
  hashObj.update(authHeader);
  hashObj.update(requestBody);
  const cacheKey = hashObj.digest('hex');

  const startTime = performance.now();

  try {
    // 1. Check Cache
    const cachedRow = selectStmt.get(cacheKey) as any;

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
      headers: {
        'Content-Type': req.headers['content-type'] || 'application/json',
        'Authorization': authHeader
      }
    };

    if (method !== 'GET' && method !== 'HEAD') {
      fetchOptions.body = requestBody;
    }

    const fetchResponse = await fetch(targetEndpoint, fetchOptions);
    const responseText = await fetchResponse.text();
    
    // Store in cache
    const responseHeaders: Record<string, string> = {};
    fetchResponse.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

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
    console.log(`${pc.cyan('SAVED')} ${pc.gray(duration + 'ms')} cached new response.`);

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
