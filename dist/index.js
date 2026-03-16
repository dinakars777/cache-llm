#!/usr/bin/env node

// src/index.ts
import { Command } from "commander";
import express from "express";
import cors from "cors";
import pc from "picocolors";
import Database from "better-sqlite3";
import { createHash } from "crypto";
import path from "path";
var program = new Command();
program.name("cache-llm").description("Blazing fast local proxy server that caches LLM API calls").version("1.0.0").option("-p, --port <number>", "Port to run the proxy on", "8080").option("-t, --target <url>", "Target LLM API Base URL", "https://api.openai.com").option("-d, --db <path>", "Path to SQLite database", "./.llm-cache.db").parse(process.argv);
var options = program.opts();
var PORT = parseInt(options.port, 10);
var TARGET_URL = options.target.replace(/\/$/, "");
var DB_PATH = path.resolve(process.cwd(), options.db);
var db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS requests (
    id TEXT PRIMARY KEY,
    response TEXT NOT NULL,
    status INTEGER NOT NULL,
    headers TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);
var insertStmt = db.prepare("INSERT INTO requests (id, response, status, headers) VALUES (?, ?, ?, ?)");
var selectStmt = db.prepare("SELECT * FROM requests WHERE id = ?");
var app = express();
app.use(cors());
app.use(express.raw({ type: "*/*", limit: "50mb" }));
app.all("*", async (req, res) => {
  const method = req.method;
  const urlPath = req.originalUrl;
  const targetEndpoint = `${TARGET_URL}${urlPath}`;
  const requestBody = req.body instanceof Buffer ? req.body.toString("utf-8") : "";
  const authHeader = req.headers["authorization"] || "";
  const hashObj = createHash("sha256");
  hashObj.update(method);
  hashObj.update(targetEndpoint);
  hashObj.update(authHeader);
  hashObj.update(requestBody);
  const cacheKey = hashObj.digest("hex");
  const startTime = performance.now();
  try {
    const cachedRow = selectStmt.get(cacheKey);
    if (cachedRow) {
      const endTime2 = performance.now();
      const duration2 = (endTime2 - startTime).toFixed(1);
      console.log(`${pc.green("HIT")} ${pc.gray(duration2 + "ms")} ${method} ${urlPath}`);
      const headers = JSON.parse(cachedRow.headers);
      for (const [key, value] of Object.entries(headers)) {
        res.setHeader(key, value);
      }
      res.setHeader("x-cache-llm", "HIT");
      return res.status(cachedRow.status).send(cachedRow.response);
    }
    console.log(`${pc.yellow("MISS")} ${method} ${urlPath} -> ${targetEndpoint}`);
    const fetchOptions = {
      method,
      headers: {
        "Content-Type": req.headers["content-type"] || "application/json",
        "Authorization": authHeader
      }
    };
    if (method !== "GET" && method !== "HEAD") {
      fetchOptions.body = requestBody;
    }
    const fetchResponse = await fetch(targetEndpoint, fetchOptions);
    const responseText = await fetchResponse.text();
    const responseHeaders = {};
    fetchResponse.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });
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
    console.log(`${pc.cyan("SAVED")} ${pc.gray(duration + "ms")} cached new response.`);
    for (const [key, value] of Object.entries(responseHeaders)) {
      res.setHeader(key, value);
    }
    res.setHeader("x-cache-llm", "MISS");
    res.status(fetchResponse.status).send(responseText);
  } catch (err) {
    console.error(pc.red(`Error proxying request: ${err.message}`));
    res.status(500).json({ error: "Cache-LLM Proxy Error", message: err.message });
  }
});
app.listen(PORT, () => {
  console.log(pc.inverse(pc.bold(" \u{1F9E0} cache-llm ")));
  console.log(`
\u{1F680} Proxy server running on ${pc.green(`http://localhost:${PORT}`)}`);
  console.log(`\u{1F3AF} Forwarding to target: ${pc.blue(TARGET_URL)}`);
  console.log(`\u{1F5C4}\uFE0F  Caching in SQLite DB: ${pc.gray(DB_PATH)}
`);
  console.log(pc.gray("Point your local agents BASE_URL to this proxy."));
});
