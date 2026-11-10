#!/usr/bin/env node
// Tiny dev server for Table Cube. No dependencies, just Node 18+.
//
//   node devserver.mjs            (port 8000)
//   node devserver.mjs 8080       (other port)
//
// It serves this folder and receives log lines from the headset at POST /log.
// Every line is printed here and appended to xr-log.txt, so the log survives
// the headset browser crashing.
//
// Magic Leap 2 over USB:  adb reverse tcp:8000 tcp:8000
// then open http://localhost:8000 in the Magic Leap browser.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.argv[2] || process.env.PORT || 8000);
const LOG_FILE = path.join(ROOT, 'xr-log.txt');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
};
const COLOURS = { info: '\x1b[37m', warn: '\x1b[33m', error: '\x1b[31;1m' };
const RESET = '\x1b[0m';

function writeLog(text) {
  try { fs.appendFileSync(LOG_FILE, text + '\n'); } catch { /* ignore */ }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/log/ping') {
    res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
    res.end('tablecube-log-server');
    return;
  }

  if (url.pathname === '/log' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) req.destroy();
    });
    req.on('end', () => {
      try {
        for (const l of JSON.parse(body)) {
          const text = `${l.t} #${l.n ?? '?'} [${l.level}] ${l.text}`;
          console.log((COLOURS[l.level] || '') + text + RESET);
          writeLog(text);
        }
      } catch (err) {
        console.warn('Could not read log body:', err.message);
      }
      res.writeHead(204);
      res.end();
    });
    return;
  }

  // Static files from this folder.
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store', // always load the newest files while developing
    });
    res.end(data);
  });
});

server.listen(PORT, () => {
  const stamp = new Date().toISOString();
  writeLog(`\n===== devserver started ${stamp} =====`);
  console.log(`Serving ${ROOT}`);
  console.log(`  On this laptop:      http://localhost:${PORT}`);
  console.log(`  Magic Leap over USB: adb reverse tcp:${PORT} tcp:${PORT}`);
  console.log(`                       then open http://localhost:${PORT} on the headset`);
  console.log(`Headset log lines appear below and in ${LOG_FILE}\n`);
});
