import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

async function readBody(req) {
  const chunks = [];

  for await (const chunk of req) {
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
}

async function getFreePort() {
  const server = createNetServer();
  const port = await listen(server);
  server.close();
  await once(server, 'close');
  return port;
}

async function closeServer(server) {
  if (!server.listening) {
    return;
  }

  server.close();
  await once(server, 'close');
}

function waitForReady(child) {
  let output = '';

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`proxy did not start. Output:\n${output}`));
    }, 5000);

    child.stdout.on('data', data => {
      output += data.toString();

      if (output.includes('Proxy server running')) {
        clearTimeout(timeout);
        resolve();
      }
    });

    child.stderr.on('data', data => {
      output += data.toString();
    });

    child.once('exit', code => {
      clearTimeout(timeout);
      reject(new Error(`proxy exited with code ${code}. Output:\n${output}`));
    });
  });
}

async function stopProxy(child) {
  if (child.exitCode !== null) {
    return;
  }

  child.kill();
  await once(child, 'exit');
}

test('forwards request headers and varies cache entries by forwarded headers', async () => {
  const calls = [];
  const tempDir = await mkdtemp(path.join(tmpdir(), 'cache-llm-'));

  const upstream = createHttpServer(async (req, res) => {
    const body = await readBody(req);
    const callNumber = calls.length + 1;

    calls.push({
      body,
      headers: req.headers,
      method: req.method,
      url: req.url,
    });

    res.setHeader('content-type', 'application/json');
    res.setHeader('x-upstream-call', String(callNumber));
    res.end(JSON.stringify({
      call: callNumber,
      organization: req.headers['openai-organization'] ?? null,
      project: req.headers['openai-project'] ?? null,
    }));
  });

  const upstreamPort = await listen(upstream);
  const proxyPort = await getFreePort();
  const dbPath = path.join(tempDir, 'cache.db');
  const proxy = spawn(process.execPath, [
    'dist/index.js',
    '--port',
    String(proxyPort),
    '--target',
    `http://127.0.0.1:${upstreamPort}`,
    '--db',
    dbPath,
  ], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    await waitForReady(proxy);

    const sendRequest = organization => fetch(`http://127.0.0.1:${proxyPort}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer test-key',
        'content-type': 'application/json',
        'openai-organization': organization,
        'openai-project': 'proj-test',
      },
      body: JSON.stringify({ model: 'test-model', messages: [{ role: 'user', content: 'hello' }] }),
    });

    const first = await sendRequest('org-a');
    assert.equal(first.headers.get('x-cache-llm'), 'MISS');
    assert.deepEqual(await first.json(), { call: 1, organization: 'org-a', project: 'proj-test' });

    const second = await sendRequest('org-b');
    assert.equal(second.headers.get('x-cache-llm'), 'MISS');
    assert.deepEqual(await second.json(), { call: 2, organization: 'org-b', project: 'proj-test' });

    const third = await sendRequest('org-a');
    assert.equal(third.headers.get('x-cache-llm'), 'HIT');
    assert.deepEqual(await third.json(), { call: 1, organization: 'org-a', project: 'proj-test' });

    assert.equal(calls.length, 2);
    assert.equal(calls[0].headers['openai-organization'], 'org-a');
    assert.equal(calls[1].headers['openai-organization'], 'org-b');
    assert.equal(calls[0].headers['openai-project'], 'proj-test');
    assert.deepEqual(calls[0].body, calls[1].body);
  } finally {
    await stopProxy(proxy);
    await closeServer(upstream);
    await rm(tempDir, { force: true, recursive: true });
  }
});
