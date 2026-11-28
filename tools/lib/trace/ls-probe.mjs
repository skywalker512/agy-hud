import { existsSync, readdirSync, readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { statSafe } from '../../../plugin/sidecars/hud_panel/lib/constants.ts';
import {
  isLoopbackHost,
  normalizeLsBaseUrl,
} from '../../../plugin/sidecars/hud_panel/lib/ls-client.ts';

export function resolveDataDir(explicitDir = '') {
  if (explicitDir) return explicitDir;
  if (process.env.ANTIGRAVITY_APP_DATA_DIR) return process.env.ANTIGRAVITY_APP_DATA_DIR;
  return join(homedir(), '.gemini', 'antigravity');
}

export function isPidAlive(pid) {
  const n = Number(pid);
  if (!Number.isInteger(n) || n <= 0) return false;
  try {
    process.kill(n, 0);
    return true;
  } catch (err) {
    return err?.code === 'EPERM';
  }
}

function buildBaseUrlsFromAddr(rawAddr) {
  const norm = normalizeLsBaseUrl(rawAddr);
  if (!norm) return [];
  const out = [norm];
  if (!/^https?:\/\//i.test(String(rawAddr).trim()) && norm.startsWith('https://')) {
    try {
      if (isLoopbackHost(new URL(norm).hostname)) {
        out.push(norm.replace(/^https:/, 'http:'));
      }
    } catch {
      /* ignore */
    }
  }
  return out;
}

export function discoverLsConnection(appDataDir = resolveDataDir()) {
  const envAddr = process.env.ANTIGRAVITY_LS_ADDRESS || '';
  const envCsrf = process.env.ANTIGRAVITY_CSRF_TOKEN || '';
  if (envAddr && envCsrf) {
    const baseUrls = buildBaseUrlsFromAddr(envAddr);
    if (baseUrls.length) {
      return {
        source: 'env',
        baseUrls,
        csrfToken: envCsrf,
        pid: null,
        lsVersion: '',
        daemonFile: '',
      };
    }
  }

  const daemonDir = join(appDataDir, 'daemon');
  if (!existsSync(daemonDir)) return null;

  let files = [];
  try {
    files = readdirSync(daemonDir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        const p = join(daemonDir, f);
        return { path: p, stat: statSafe(p) };
      })
      .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
  } catch {
    return null;
  }

  for (const item of files) {
    try {
      const raw = JSON.parse(readFileSync(item.path, 'utf8'));
      if (!raw?.csrfToken) continue;
      if (raw.pid && !isPidAlive(raw.pid)) continue;
      const baseUrls = [];
      if (raw.httpPort) baseUrls.push(`http://127.0.0.1:${raw.httpPort}`);
      if (raw.httpsPort) baseUrls.push(`https://127.0.0.1:${raw.httpsPort}`);
      if (!baseUrls.length) continue;
      return {
        source: 'daemon',
        baseUrls,
        csrfToken: String(raw.csrfToken),
        pid: Number(raw.pid || 0) || null,
        lsVersion: String(raw.lsVersion || ''),
        daemonFile: item.path,
      };
    } catch {
      /* ignore malformed daemon file */
    }
  }
  return null;
}

function postConnectJson(urlStr, headers, payload, timeoutMs = 1500) {
  return new Promise((resolve, reject) => {
    let url;
    try {
      url = new URL(urlStr);
    } catch (err) {
      reject(err);
      return;
    }
    const isHttps = url.protocol === 'https:';
    const isLocal = isLoopbackHost(url.hostname);
    if (!isLocal) {
      reject(new Error(`refusing non-loopback LS host: ${url.hostname}`));
      return;
    }
    const mod = isHttps ? https : http;
    const body = JSON.stringify(payload);
    const req = mod.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: 'POST',
        timeout: timeoutMs,
        rejectUnauthorized: false,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'Connect-Protocol-Version': '1',
          ...headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`HTTP ${res.statusCode}: ${text.slice(0, 200)}`));
            return;
          }
          try {
            resolve(JSON.parse(text));
          } catch (err) {
            reject(new Error(`invalid JSON response: ${err.message}`));
          }
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end(body);
  });
}

export async function callLsRpc(conn, method, payload, timeoutMs = 1500) {
  if (!conn || !conn.baseUrls?.length || !conn.csrfToken) {
    return { ok: false, latencyMs: 0, error: 'no_ls_connection', data: null };
  }
  const path = `/exa.language_server_pb.LanguageServerService/${method}`;
  const headers = { 'x-codeium-csrf-token': conn.csrfToken };
  const t0 = performance.now();
  let lastErr = null;

  for (const baseUrl of conn.baseUrls) {
    try {
      const data = await postConnectJson(`${baseUrl}${path}`, headers, payload, timeoutMs);
      if (conn.baseUrls[0] !== baseUrl) {
        conn.baseUrls = [baseUrl, ...conn.baseUrls.filter((u) => u !== baseUrl)];
      }
      return { ok: true, latencyMs: Math.round(performance.now() - t0), error: '', data };
    } catch (err) {
      lastErr = err;
    }
  }
  return {
    ok: false,
    latencyMs: Math.round(performance.now() - t0),
    error: lastErr?.message || 'rpc_error',
    data: null,
  };
}
