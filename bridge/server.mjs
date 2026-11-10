#!/usr/bin/env node
/**
 * Local bridge: lets the extension translate through the Claude Code CLI that
 * is installed and logged in on this machine (so it uses your Claude
 * subscription instead of API credits).
 *
 *   node bridge/server.mjs          # listens on http://127.0.0.1:47615
 *
 * Only the browser extension may call it: requests must come from a
 * chrome-extension:// (or moz-extension://) origin and target localhost.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const PORT = Number(process.env.CRDS_BRIDGE_PORT ?? 47615);
const CLAUDE_BIN = process.env.CLAUDE_BIN ?? 'claude';
const MODELS = new Set(['opus', 'sonnet', 'haiku', 'fable']);
const MAX_BODY = 2 * 1024 * 1024;
const TIMEOUT_MS = 5 * 60 * 1000;

const SCHEMA = JSON.stringify({
  type: 'object',
  properties: {
    lines: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'number' }, text: { type: 'string' } },
        required: ['id', 'text'],
        additionalProperties: false,
      },
    },
  },
  required: ['lines'],
  additionalProperties: false,
});

// An empty working directory: no project files, no CLAUDE.md to pick up.
const workdir = mkdtempSync(path.join(os.tmpdir(), 'crds-bridge-'));

function runClaude({ system, prompt, model }) {
  return new Promise((resolve, reject) => {
    const args = [
      '-p',
      '--model', model,
      '--system-prompt', system,
      '--tools', '', // translation only: no file, shell or web access
      '--strict-mcp-config',
      '--no-session-persistence',
      '--output-format', 'json',
      '--json-schema', SCHEMA,
    ];
    const child = spawn(CLAUDE_BIN, args, { cwd: workdir, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), TIMEOUT_MS);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(new Error(`cannot start "${CLAUDE_BIN}": ${e.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      let result;
      try {
        result = JSON.parse(out);
      } catch {
        return reject(new Error(`claude exited ${code}: ${(err || out).slice(0, 400)}`));
      }
      if (result.is_error) return reject(new Error(String(result.result ?? 'claude reported an error').slice(0, 400)));
      let data = result.structured_output;
      if (!data && typeof result.result === 'string') {
        // Fallback: pull the JSON object out of the text answer.
        const m = result.result.match(/\{[\s\S]*\}/);
        try {
          data = m ? JSON.parse(m[0]) : undefined;
        } catch {
          data = undefined;
        }
      }
      if (!data || !Array.isArray(data.lines)) return reject(new Error('claude returned no translation'));
      resolve(data.lines);
    });
    child.stdin.end(prompt);
  });
}

function allowed(req) {
  const origin = req.headers.origin ?? '';
  const host = (req.headers.host ?? '').split(':')[0];
  const fromExtension = origin.startsWith('chrome-extension://') || origin.startsWith('moz-extension://');
  return fromExtension && (host === '127.0.0.1' || host === 'localhost');
}

const server = http.createServer((req, res) => {
  const reply = (status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (!allowed(req)) return reply(403, { error: 'forbidden' });
  if (req.method === 'GET' && req.url === '/health') return reply(200, { ok: true });
  if (req.method !== 'POST' || req.url !== '/translate') return reply(404, { error: 'not found' });

  let body = '';
  req.on('data', (d) => {
    body += d;
    if (body.length > MAX_BODY) req.destroy();
  });
  req.on('end', async () => {
    try {
      const { system, prompt, model } = JSON.parse(body);
      if (typeof system !== 'string' || typeof prompt !== 'string') return reply(400, { error: 'bad request' });
      const started = Date.now();
      const lines = await runClaude({ system, prompt, model: MODELS.has(model) ? model : 'opus' });
      console.log(`translated ${lines.length} lines in ${((Date.now() - started) / 1000).toFixed(1)}s`);
      reply(200, { lines });
    } catch (e) {
      console.error(String(e));
      reply(500, { error: e instanceof Error ? e.message : String(e) });
    }
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`cr-dual-subs bridge listening on http://127.0.0.1:${PORT} (using "${CLAUDE_BIN}")`);
});
