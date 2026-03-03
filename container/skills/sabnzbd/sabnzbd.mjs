#!/usr/bin/env node
/**
 * sabnzbd — interact with SABnzbd download client via API
 *
 * Commands:
 *   sabnzbd add <url>                     # Add NZB by URL
 *   sabnzbd addfile <path>                # Add NZB from local file (in container)
 *   sabnzbd queue                         # Show current download queue
 *   sabnzbd history [--limit N]           # Show recent download history
 *   sabnzbd status                        # Quick server status summary
 *
 * Requires env vars: SABNZBD_URL, SABNZBD_API_KEY
 * No npm dependencies — uses Node.js built-in http/https modules only.
 */
import http from 'http';
import https from 'https';
import fs from 'fs';
import path from 'path';

const SAB_URL = process.env.SABNZBD_URL;
if (!SAB_URL) { console.error('Missing SABNZBD_URL environment variable'); process.exit(1); }
const API_KEY = process.env.SABNZBD_API_KEY;
if (!API_KEY) { console.error('Missing SABNZBD_API_KEY environment variable'); process.exit(1); }

const BASE = SAB_URL.replace(/\/+$/, '') + '/api';

// ── HTTP ──────────────────────────────────────────────────────────────────────

function fetchJson(urlStr) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const mod = u.protocol === 'https:' ? https : http;
    mod.get({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, headers: { 'Accept-Encoding': 'identity' } }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString();
        try { resolve(JSON.parse(body)); }
        catch { resolve({ raw: body }); }
      });
    }).on('error', reject);
  });
}

function postMultipart(urlStr, filename, fileBuffer) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const boundary = '----NanoClawBoundary' + Date.now();
    const mod = u.protocol === 'https:' ? https : http;

    const head = `--${boundary}\r\nContent-Disposition: form-data; name="nzbfile"; filename="${path.basename(filename)}"\r\nContent-Type: application/x-nzb\r\n\r\n`;
    const tail = `\r\n--${boundary}--\r\n`;
    const body = Buffer.concat([Buffer.from(head), fileBuffer, Buffer.from(tail)]);

    const req = mod.request({
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
      },
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        try { resolve(JSON.parse(text)); }
        catch { resolve({ raw: text }); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildUrl(mode, params = {}) {
  const url = new URL(BASE);
  url.searchParams.set('mode', mode);
  url.searchParams.set('apikey', API_KEY);
  url.searchParams.set('output', 'json');
  for (const [k, v] of Object.entries(params)) {
    if (v != null) url.searchParams.set(k, v);
  }
  return url.toString();
}

function die(msg) { console.error(msg); process.exit(1); }

function formatSize(bytes) {
  const b = parseFloat(bytes);
  if (isNaN(b)) return bytes || '?';
  if (b >= 1073741824) return `${(b / 1073741824).toFixed(1)} GB`;
  if (b >= 1048576) return `${(b / 1048576).toFixed(0)} MB`;
  if (b >= 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${b} B`;
}

function formatSizeMB(mb) {
  const n = parseFloat(mb);
  if (isNaN(n)) return mb || '?';
  if (n >= 1024) return `${(n / 1024).toFixed(1)} GB`;
  return `${n.toFixed(0)} MB`;
}

function checkError(data) {
  if (data.error) die(`SABnzbd error: ${data.error}`);
  if (data.raw) die(`Unexpected response: ${data.raw.slice(0, 200)}`);
}

function parseFlags(args) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--') && i + 1 < args.length) {
      flags[args[i].slice(2)] = args[++i];
    } else {
      positional.push(args[i]);
    }
  }
  return { flags, positional };
}

const PRIORITIES = { '-3': 'Duplicate', '-2': 'Paused', '-1': 'Low', '0': 'Normal', '1': 'High', '2': 'Force' };

// ── Commands ──────────────────────────────────────────────────────────────────

async function cmdAdd(args) {
  const { flags, positional } = parseFlags(args);
  const url = positional.join(' ');
  if (!url) die('Usage: sabnzbd add <nzb-url> [--cat Category] [--priority 0]');

  const params = { name: url };
  if (flags.cat) params.cat = flags.cat;
  if (flags.priority) params.priority = flags.priority;
  if (flags.nzbname) params.nzbname = flags.nzbname;

  const data = await fetchJson(buildUrl('addurl', params));
  checkError(data);

  if (data.status === true || data.status === 'True') {
    const ids = data.nzo_ids || [];
    console.log(`Added to SABnzbd queue.`);
    if (ids.length) console.log(`  Job ID: ${ids.join(', ')}`);
  } else {
    console.log(`Response: ${JSON.stringify(data)}`);
  }
}

async function cmdAddFile(args) {
  const { flags, positional } = parseFlags(args);
  const filePath = positional.join(' ');
  if (!filePath) die('Usage: sabnzbd addfile <path-to-nzb> [--cat Category] [--priority 0]');

  if (!fs.existsSync(filePath)) die(`File not found: ${filePath}`);
  const fileBuffer = fs.readFileSync(filePath);

  const params = {};
  if (flags.cat) params.cat = flags.cat;
  if (flags.priority) params.priority = flags.priority;
  if (flags.nzbname) params.nzbname = flags.nzbname;

  const url = buildUrl('addfile', params);
  const data = await postMultipart(url, filePath, fileBuffer);
  checkError(data);

  if (data.status === true || data.status === 'True') {
    const ids = data.nzo_ids || [];
    console.log(`Added "${path.basename(filePath)}" to SABnzbd queue.`);
    if (ids.length) console.log(`  Job ID: ${ids.join(', ')}`);
  } else {
    console.log(`Response: ${JSON.stringify(data)}`);
  }
}

async function cmdQueue(args) {
  const { flags } = parseFlags(args);
  const params = { limit: flags.limit || '20' };
  if (flags.search) params.search = flags.search;
  if (flags.cat) params.cat = flags.cat;

  const data = await fetchJson(buildUrl('queue', params));
  checkError(data);

  const q = data.queue;
  if (!q) { console.log('No queue data returned.'); return; }

  console.log(`SABnzbd Queue — ${q.status || 'Unknown'}`);
  if (q.speed) console.log(`  Speed: ${q.speed}`);
  if (q.timeleft && q.timeleft !== '0:00:00') console.log(`  Time left: ${q.timeleft}`);
  if (q.sizeleft) console.log(`  Remaining: ${q.sizeleft}`);
  console.log();

  const slots = q.slots || [];
  if (!slots.length) {
    console.log('Queue is empty.');
    return;
  }

  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    const pct = s.percentage || '0';
    const status = s.status || '';
    const prio = PRIORITIES[s.priority] || s.priority;
    const cat = s.cat && s.cat !== '*' ? s.cat : '';

    console.log(`${i + 1}. ${s.filename || '(untitled)'}`);
    const meta = [`${pct}%`, formatSizeMB(s.mb), status, cat, prio !== 'Normal' ? prio : ''].filter(Boolean).join(' | ');
    console.log(`   ${meta}`);
    if (s.timeleft && s.timeleft !== '0:00:00') console.log(`   ETA: ${s.timeleft}`);
    console.log();
  }
}

async function cmdHistory(args) {
  const { flags } = parseFlags(args);
  const params = { limit: flags.limit || '15' };
  if (flags.search) params.search = flags.search;
  if (flags.cat) params.cat = flags.cat;
  if (flags.failed) params.failed_only = '1';

  const data = await fetchJson(buildUrl('history', params));
  checkError(data);

  const h = data.history;
  if (!h) { console.log('No history data returned.'); return; }

  console.log(`SABnzbd History — ${h.noofslots || 0} total items\n`);

  const slots = h.slots || [];
  if (!slots.length) {
    console.log('No history entries.');
    return;
  }

  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    const status = s.status || '';
    const size = formatSize(s.bytes);
    const cat = s.category && s.category !== '*' ? s.category : '';
    const completed = s.completed ? new Date(s.completed * 1000).toLocaleDateString() : '';

    const icon = status === 'Completed' ? '+' : status === 'Failed' ? 'x' : '-';
    console.log(`${icon} ${s.name || '(untitled)'}`);
    const meta = [status, size, cat, completed].filter(Boolean).join(' | ');
    console.log(`  ${meta}`);
    if (s.fail_message) console.log(`  Reason: ${s.fail_message}`);
    console.log();
  }
}

async function cmdStatus() {
  const data = await fetchJson(buildUrl('queue', { limit: '0' }));
  checkError(data);

  const q = data.queue;
  if (!q) { console.log('No data returned.'); return; }

  console.log(`SABnzbd Status: ${q.status || 'Unknown'}`);
  if (q.speed) console.log(`  Speed: ${q.speed}`);
  if (q.noofslots_total) console.log(`  Jobs in queue: ${q.noofslots_total}`);
  if (q.sizeleft) console.log(`  Remaining: ${q.sizeleft}`);
  if (q.timeleft && q.timeleft !== '0:00:00') console.log(`  Time left: ${q.timeleft}`);
  if (q.diskspace1) console.log(`  Disk space (temp): ${parseFloat(q.diskspace1).toFixed(1)} GB`);
  if (q.diskspace2) console.log(`  Disk space (final): ${parseFloat(q.diskspace2).toFixed(1)} GB`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

const [,, cmd, ...args] = process.argv;

async function main() {
  switch (cmd) {
    case 'add': await cmdAdd(args); break;
    case 'addfile': await cmdAddFile(args); break;
    case 'queue': await cmdQueue(args); break;
    case 'history': await cmdHistory(args); break;
    case 'status': await cmdStatus(); break;
    default:
      die('Usage: sabnzbd add|addfile|queue|history|status\n  sabnzbd add <nzb-url> [--cat Category] [--priority 0]\n  sabnzbd addfile <path> [--cat Category]\n  sabnzbd queue [--limit N] [--search term]\n  sabnzbd history [--limit N] [--search term]\n  sabnzbd status');
  }
}

main().catch(e => { console.error(`Error: ${e.message}`); process.exit(1); });
