#!/usr/bin/env node
/**
 * gmail — read-only Gmail access via Google API
 *
 * Commands:
 *   gmail list [--max N] [--query "..."]  # List recent emails (default 15)
 *   gmail read <id>                        # Read a full email
 *   gmail search <query>                   # Search emails
 *   gmail profile                          # Show connected Gmail address
 *
 * Requires: ~/.gmail-readonly/gcp-oauth.keys.json
 *           ~/.gmail-readonly/credentials.json
 * Set up with: node scripts/gmail-setup.mjs
 */
import https from 'https';
import fs from 'fs';
import path from 'path';

const CREDS_DIR = process.env.GMAIL_READONLY_DIR || '/home/node/.gmail-readonly';
const KEYS_FILE = path.join(CREDS_DIR, 'gcp-oauth.keys.json');
const TOKENS_FILE = path.join(CREDS_DIR, 'credentials.json');

// ── Auth ──────────────────────────────────────────────────────────────────────

function loadCredentials() {
  if (!fs.existsSync(KEYS_FILE)) {
    die('Gmail not set up. Run: node scripts/gmail-setup.mjs');
  }
  if (!fs.existsSync(TOKENS_FILE)) {
    die('Gmail not authorized. Run: node scripts/gmail-setup.mjs');
  }
  const keys = JSON.parse(fs.readFileSync(KEYS_FILE, 'utf-8'));
  const tokens = JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf-8'));
  const { client_id, client_secret } = keys.installed || keys.web;
  return { client_id, client_secret, ...tokens };
}

function httpPost(hostname, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const bodyStr = typeof body === 'string' ? body : new URLSearchParams(body).toString();
    const req = https.request(
      {
        hostname,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(bodyStr),
          ...headers,
        },
      },
      res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf-8');
          try { resolve(JSON.parse(text)); } catch { resolve(text); }
        });
      },
    );
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

async function getAccessToken() {
  const creds = loadCredentials();

  // Still valid (with 60s buffer)
  if (creds.access_token && creds.expiry_date > Date.now() + 60_000) {
    return creds.access_token;
  }

  if (!creds.refresh_token) {
    die('Gmail token expired and no refresh token found. Re-run: node scripts/gmail-setup.mjs');
  }

  const refreshed = await httpPost('oauth2.googleapis.com', '/token', {
    client_id: creds.client_id,
    client_secret: creds.client_secret,
    refresh_token: creds.refresh_token,
    grant_type: 'refresh_token',
  });

  if (refreshed.error) {
    die(`Token refresh failed: ${refreshed.error_description || refreshed.error}`);
  }

  const updated = {
    ...creds,
    access_token: refreshed.access_token,
    expiry_date: Date.now() + refreshed.expires_in * 1000,
  };
  try {
    fs.writeFileSync(TOKENS_FILE, JSON.stringify(updated, null, 2));
  } catch {
    // Read-only mount — token works for this session, just won't be cached
  }
  return updated.access_token;
}

// ── Gmail API ─────────────────────────────────────────────────────────────────

function gmailRequest(accessToken, apiPath) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'gmail.googleapis.com',
        path: `/gmail/v1/users/me${apiPath}`,
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
      },
      res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf-8');
          let parsed;
          try { parsed = JSON.parse(text); } catch { parsed = text; }
          if (parsed?.error) {
            reject(new Error(`Gmail API error ${res.statusCode}: ${parsed.error.message || JSON.stringify(parsed.error)}`));
          } else {
            resolve(parsed);
          }
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

// ── Email parsing ─────────────────────────────────────────────────────────────

function getHeader(headers, name) {
  return headers?.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';
}

function extractText(payload) {
  if (!payload) return '';

  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64').toString('utf-8');
  }

  if (payload.mimeType === 'text/html' && payload.body?.data) {
    return stripHtml(Buffer.from(payload.body.data, 'base64').toString('utf-8'));
  }

  if (payload.parts?.length) {
    // Prefer text/plain; fall back to text/html; then recurse
    for (const preferred of ['text/plain', 'text/html']) {
      const part = payload.parts.find(p => p.mimeType === preferred);
      if (part) {
        const text = extractText(part);
        if (text.trim()) return text;
      }
    }
    for (const part of payload.parts) {
      const text = extractText(part);
      if (text.trim()) return text;
    }
  }

  return '';
}

function stripHtml(html) {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  try {
    return new Date(dateStr).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true,
    });
  } catch {
    return dateStr;
  }
}

// ── Commands ──────────────────────────────────────────────────────────────────

async function cmdList(query, maxResults) {
  const token = await getAccessToken();

  const q = query ? `&q=${encodeURIComponent(query)}` : '';
  const listRes = await gmailRequest(token, `/messages?maxResults=${maxResults}${q}`);

  if (!listRes.messages?.length) {
    console.log(query ? `No emails found for: ${query}` : 'No emails found.');
    return;
  }

  // Fetch metadata for all messages in parallel
  const metas = await Promise.all(
    listRes.messages.map(m =>
      gmailRequest(token, `/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`)
    )
  );

  console.log(`${metas.length} email(s)${query ? ` matching "${query}"` : ''}:\n`);
  for (let i = 0; i < metas.length; i++) {
    const m = metas[i];
    const from = getHeader(m.payload?.headers, 'From');
    const subject = getHeader(m.payload?.headers, 'Subject') || '(no subject)';
    const date = formatDate(getHeader(m.payload?.headers, 'Date'));
    console.log(`${i + 1}. ID: ${m.id}`);
    console.log(`   From: ${from}`);
    console.log(`   Subject: ${subject}`);
    console.log(`   Date: ${date}`);
    if (m.snippet) console.log(`   Preview: ${m.snippet.slice(0, 120)}`);
    console.log();
  }
}

async function cmdRead(id) {
  const token = await getAccessToken();
  const msg = await gmailRequest(token, `/messages/${id}?format=full`);

  const headers = msg.payload?.headers || [];
  console.log(`From: ${getHeader(headers, 'From')}`);
  console.log(`To: ${getHeader(headers, 'To')}`);
  const cc = getHeader(headers, 'Cc');
  if (cc) console.log(`Cc: ${cc}`);
  console.log(`Date: ${formatDate(getHeader(headers, 'Date'))}`);
  console.log(`Subject: ${getHeader(headers, 'Subject') || '(no subject)'}`);
  console.log();

  const body = extractText(msg.payload);
  if (body.trim()) {
    console.log(body);
  } else {
    console.log('(no text content — email may be image-only or have attachments)');
  }

  // List attachment names if any
  const attachments = [];
  function findAttachments(payload) {
    if (!payload) return;
    if (payload.filename && payload.body?.attachmentId) attachments.push(payload.filename);
    payload.parts?.forEach(findAttachments);
  }
  findAttachments(msg.payload);
  if (attachments.length) {
    console.log(`\nAttachments: ${attachments.join(', ')}`);
  }
}

async function cmdProfile() {
  const token = await getAccessToken();
  const profile = await gmailRequest(token, '/profile');
  console.log(`Gmail account: ${profile.emailAddress}`);
  console.log(`Total messages: ${profile.messagesTotal?.toLocaleString()}`);
  console.log(`Total threads: ${profile.threadsTotal?.toLocaleString()}`);
}

// ── CLI ───────────────────────────────────────────────────────────────────────

function die(msg) { console.error(msg); process.exit(1); }

const [,, cmd, ...args] = process.argv;

async function main() {
  if (cmd === 'list') {
    let max = 15;
    let query = '';
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--max' && args[i + 1]) { max = parseInt(args[++i]); }
      else if (args[i] === '--query' && args[i + 1]) { query = args[++i]; }
      else if (!args[i].startsWith('--')) { query = args.slice(i).join(' '); break; }
    }
    await cmdList(query, max);

  } else if (cmd === 'read') {
    const id = args[0];
    if (!id) die('Usage: gmail read <message-id>');
    await cmdRead(id);

  } else if (cmd === 'search') {
    const query = args.join(' ');
    if (!query) die('Usage: gmail search <query>');
    await cmdList(query, 15);

  } else if (cmd === 'profile') {
    await cmdProfile();

  } else {
    console.error('Usage: gmail list [--max N] [--query "..."]');
    console.error('       gmail read <id>');
    console.error('       gmail search <query>');
    console.error('       gmail profile');
    process.exit(1);
  }
}

main().catch(e => { console.error(`Error: ${e.message}`); process.exit(1); });
