#!/usr/bin/env node
/**
 * One-time setup: get the Apple Music User Token via browser flow.
 * Generates a developer token, serves a local page that runs MusicKit JS,
 * captures the user token, and writes it to .env.
 *
 * Usage: node scripts/apple-music-setup.mjs
 */
import http from 'http';
import crypto from 'crypto';
import fs from 'fs';
import { exec } from 'child_process';

const envFile = new URL('../.env', import.meta.url).pathname;

function readEnv(key) {
  const content = fs.readFileSync(envFile, 'utf-8');
  const m = content.match(new RegExp(`^${key}=(.+)$`, 'm'));
  return m ? m[1].trim() : null;
}

function writeEnvKey(key, value) {
  let content = fs.readFileSync(envFile, 'utf-8');
  if (content.match(new RegExp(`^${key}=`, 'm'))) {
    content = content.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${value}`);
  } else {
    content += `\n${key}=${value}\n`;
  }
  fs.writeFileSync(envFile, content);
}

const TEAM_ID = readEnv('MUSICKIT_TEAM_ID');
const KEY_ID = readEnv('MUSICKIT_KEY_ID');
const PRIVATE_KEY_B64 = readEnv('MUSICKIT_PRIVATE_KEY_B64');

if (!TEAM_ID || !KEY_ID || !PRIVATE_KEY_B64) {
  console.error('Missing MUSICKIT_TEAM_ID, MUSICKIT_KEY_ID, or MUSICKIT_PRIVATE_KEY_B64 in .env');
  process.exit(1);
}

// Generate developer token
const key = Buffer.from(PRIVATE_KEY_B64, 'base64').toString('utf-8');
const now = Math.floor(Date.now() / 1000);
const hdr = Buffer.from(JSON.stringify({ alg: 'ES256', kid: KEY_ID })).toString('base64url');
const pay = Buffer.from(JSON.stringify({ iss: TEAM_ID, iat: now, exp: now + 15_777_000 })).toString('base64url');
const input = `${hdr}.${pay}`;
const sign = crypto.createSign('SHA256');
sign.update(input);
const sig = sign.sign({ key, dsaEncoding: 'ieee-p1363' });
const devToken = `${input}.${sig.toString('base64url')}`;

const html = `<!DOCTYPE html>
<html>
<head>
  <title>Apple Music Setup — NanoClaw</title>
  <style>
    body { font-family: sans-serif; max-width: 600px; margin: 60px auto; padding: 0 20px; }
    #token { font-family: monospace; font-size: 11px; word-break: break-all;
             background: #f5f5f5; padding: 12px; border-radius: 6px; margin-top: 8px; }
    button { background: #fc3c44; color: white; border: none; padding: 12px 24px;
             border-radius: 8px; font-size: 16px; cursor: pointer; }
    button:hover { background: #e0343c; }
    #status { margin-top: 16px; color: #555; }
  </style>
</head>
<body>
  <h2>Apple Music — NanoClaw Setup</h2>
  <p>Click the button below to authorize NanoClaw to access your Apple Music library.</p>
  <button id="btn">Authorize Apple Music</button>
  <div id="status"></div>
  <div id="tokenBox" style="display:none">
    <p><strong>Your Music User Token:</strong></p>
    <div id="token"></div>
  </div>

  <script src="https://js-cdn.music.apple.com/musickit/v3/musickit.js" crossorigin></script>
  <script>
    document.getElementById('btn').addEventListener('click', async () => {
      const status = document.getElementById('status');
      status.textContent = 'Configuring MusicKit...';
      try {
        await MusicKit.configure({
          developerToken: '${devToken}',
          app: { name: 'NanoClaw', build: '1.0' }
        });
        status.textContent = 'Waiting for Apple Music authorization...';
        const music = MusicKit.getInstance();
        const userToken = await music.authorize();
        document.getElementById('token').textContent = userToken;
        document.getElementById('tokenBox').style.display = 'block';
        status.textContent = 'Saving token...';
        try {
          const resp = await fetch('/save', {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: userToken
          });
          if (resp.ok) {
            status.textContent = '✓ Token saved to .env. You can close this window.';
          } else {
            status.textContent = 'Could not save automatically — copy the token above into .env as APPLE_MUSIC_USER_TOKEN=';
          }
        } catch {
          status.textContent = 'Could not save automatically — copy the token above into .env as APPLE_MUSIC_USER_TOKEN=';
        }
      } catch (err) {
        status.textContent = 'Error: ' + err.message;
      }
    });
  </script>
</body>
</html>`;

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  } else if (req.method === 'POST' && req.url === '/save') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      const token = body.trim();
      writeEnvKey('APPLE_MUSIC_USER_TOKEN', token);
      console.log('\n✓ Music User Token saved to .env');
      console.log('\nRestart NanoClaw to pick it up:');
      console.log('  systemctl --user restart nanoclaw');
      res.writeHead(200);
      res.end('OK');
      setTimeout(() => server.close(), 1000);
    });
  } else {
    res.writeHead(404);
    res.end();
  }
});

server.listen(8765, '127.0.0.1', () => {
  const url = 'http://localhost:8765';
  console.log(`Opening ${url} ...`);
  exec(`xdg-open "${url}" 2>/dev/null || open "${url}" 2>/dev/null`);
  console.log('Waiting for Apple Music authorization in browser...');
  console.log('(If the browser did not open, navigate to http://localhost:8765 manually)');
});
