#!/usr/bin/env node
/**
 * gmail-setup — authorize read-only Gmail access
 *
 * Usage: node scripts/gmail-setup.mjs [path/to/gcp-oauth.keys.json]
 *
 * Starts a local OAuth callback server, opens your browser to authorize
 * Gmail read-only access, and saves credentials to ~/.gmail-readonly/.
 */
import https from 'https';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import os from 'os';
import { URL } from 'url';

const CREDS_DIR = path.join(os.homedir(), '.gmail-readonly');
const KEYS_FILE = path.join(CREDS_DIR, 'gcp-oauth.keys.json');
const TOKENS_FILE = path.join(CREDS_DIR, 'credentials.json');
const REDIRECT_PORT = 8766;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/callback`;
const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

function die(msg) { console.error(msg); process.exit(1); }

// ── Load keys ──────────────────────────────────────────────────────────────────

let keysPath = process.argv[2];

if (!keysPath) {
  // Try common download locations
  const candidates = [
    path.join(os.homedir(), 'Downloads', 'client_secret*.json'),
    path.join(os.homedir(), 'Downloads', 'gcp-oauth*.json'),
    KEYS_FILE,
  ];
  // Check if keys already in place
  if (fs.existsSync(KEYS_FILE)) {
    keysPath = KEYS_FILE;
    console.log(`Using existing keys: ${KEYS_FILE}`);
  }
}

if (!keysPath) {
  console.log(`
Gmail OAuth Setup
================

You need a GCP OAuth client credentials file. If you haven't set one up:

  1. Go to https://console.cloud.google.com
  2. Create or select a project
  3. APIs & Services > Library > search "Gmail API" > Enable
  4. APIs & Services > Credentials > + CREATE CREDENTIALS > OAuth client ID
     - If prompted for consent screen: External, fill in app name + email
     - Application type: Desktop app
     - Name: anything (e.g. "NanoClaw Gmail")
  5. Click DOWNLOAD JSON

Then re-run:
  node scripts/gmail-setup.mjs ~/Downloads/client_secret_....json
`);
  process.exit(1);
}

if (!fs.existsSync(keysPath)) {
  die(`File not found: ${keysPath}`);
}

// Copy keys to ~/.gmail-readonly/ if not already there
fs.mkdirSync(CREDS_DIR, { recursive: true });
if (path.resolve(keysPath) !== path.resolve(KEYS_FILE)) {
  fs.copyFileSync(keysPath, KEYS_FILE);
  console.log(`Copied keys to ${KEYS_FILE}`);
}

const keys = JSON.parse(fs.readFileSync(KEYS_FILE, 'utf-8'));
const { client_id, client_secret } = keys.installed || keys.web;
if (!client_id || !client_secret) die('Could not find client_id/client_secret in keys file.');

// ── OAuth flow ────────────────────────────────────────────────────────────────

const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
authUrl.searchParams.set('client_id', client_id);
authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
authUrl.searchParams.set('response_type', 'code');
authUrl.searchParams.set('scope', SCOPE);
authUrl.searchParams.set('access_type', 'offline');
authUrl.searchParams.set('prompt', 'consent'); // force refresh_token to be returned

console.log('\nOpening browser for Gmail authorization...');
console.log('(Read-only access — cannot send, delete, or modify emails)\n');

// Try to open browser
try {
  const url = authUrl.toString();
  if (process.platform === 'darwin') execSync(`open "${url}"`);
  else if (process.platform === 'linux') execSync(`xdg-open "${url}" 2>/dev/null || true`);
  else console.log(`Open this URL in your browser:\n${url}\n`);
} catch {
  console.log(`Open this URL in your browser:\n${authUrl.toString()}\n`);
}

// ── Local callback server ─────────────────────────────────────────────────────

await new Promise((resolve, reject) => {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${REDIRECT_PORT}`);
    if (url.pathname !== '/callback') { res.end(); return; }

    const code = url.searchParams.get('code');
    const error = url.searchParams.get('error');

    if (error) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<h2>Authorization failed: ${error}</h2><p>Close this tab.</p>`);
      server.close();
      reject(new Error(`OAuth error: ${error}`));
      return;
    }

    if (!code) { res.end('Missing code'); return; }

    // Exchange code for tokens
    const tokenRes = await exchangeCode(client_id, client_secret, code);
    if (tokenRes.error) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<h2>Token exchange failed: ${tokenRes.error}</h2><p>Close this tab.</p>`);
      server.close();
      reject(new Error(tokenRes.error_description || tokenRes.error));
      return;
    }

    const tokens = {
      access_token: tokenRes.access_token,
      refresh_token: tokenRes.refresh_token,
      expiry_date: Date.now() + tokenRes.expires_in * 1000,
    };
    fs.writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 2));

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<h2>Gmail authorized! ✓</h2><p>You can close this tab and return to the terminal.</p>');
    server.close();
    resolve();
  });

  server.on('error', reject);
  server.listen(REDIRECT_PORT, () => {
    console.log(`Waiting for authorization (port ${REDIRECT_PORT})...`);
  });
});

console.log(`\nCredentials saved to ${TOKENS_FILE}`);
console.log('Gmail read-only access is ready.\n');

// ── Helpers ───────────────────────────────────────────────────────────────────

function exchangeCode(clientId, clientSecret, code) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    }).toString();

    const req = https.request(
      {
        hostname: 'oauth2.googleapis.com',
        path: '/token',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
          catch (e) { reject(e); }
        });
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}
