#!/usr/bin/env node
/**
 * apple-music — create playlists and add songs via Apple Music API
 *
 * Commands:
 *   apple-music search <query>
 *   apple-music create-playlist "Name" ["Description"]
 *   apple-music add-songs <playlist-id> <song-id> [song-id ...]
 *   apple-music make "Playlist Name" "query1" "query2" ...
 *   apple-music list-playlists
 *   apple-music delete-playlist <playlist-id>
 *
 * Requires env vars:
 *   MUSICKIT_TEAM_ID, MUSICKIT_KEY_ID, MUSICKIT_PRIVATE_KEY_B64, APPLE_MUSIC_USER_TOKEN
 */
import https from 'https';
import crypto from 'crypto';
import zlib from 'zlib';

const TEAM_ID = process.env.MUSICKIT_TEAM_ID;
const KEY_ID = process.env.MUSICKIT_KEY_ID;
const PRIVATE_KEY_B64 = process.env.MUSICKIT_PRIVATE_KEY_B64;
const USER_TOKEN = process.env.APPLE_MUSIC_USER_TOKEN;
const STOREFRONT = process.env.APPLE_MUSIC_STOREFRONT || 'us';

if (!TEAM_ID || !KEY_ID || !PRIVATE_KEY_B64) {
  console.error('Missing credentials. Ensure MUSICKIT_TEAM_ID, MUSICKIT_KEY_ID, MUSICKIT_PRIVATE_KEY_B64 are set.');
  process.exit(1);
}

// ── Developer token (JWT ES256) ───────────────────────────────────────────────

function devToken() {
  const key = Buffer.from(PRIVATE_KEY_B64, 'base64').toString('utf-8');
  const now = Math.floor(Date.now() / 1000);
  const hdr = Buffer.from(JSON.stringify({ alg: 'ES256', kid: KEY_ID })).toString('base64url');
  const pay = Buffer.from(JSON.stringify({ iss: TEAM_ID, iat: now, exp: now + 15_777_000 })).toString('base64url');
  const input = `${hdr}.${pay}`;
  const sign = crypto.createSign('SHA256');
  sign.update(input);
  const sig = sign.sign({ key, dsaEncoding: 'ieee-p1363' });
  return `${input}.${sig.toString('base64url')}`;
}

// ── HTTP ──────────────────────────────────────────────────────────────────────

function api(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const token = devToken();
    const headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
    if (USER_TOKEN) headers['Music-User-Token'] = USER_TOKEN;
    const bodyStr = body ? JSON.stringify(body) : null;
    if (bodyStr) headers['Content-Length'] = Buffer.byteLength(bodyStr).toString();

    const req = https.request(
      { hostname: 'api.music.apple.com', path, method, headers },
      res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          const encoding = res.headers['content-encoding'];
          const parse = (data) => {
            const text = data.toString('utf-8');
            let parsed;
            try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
            resolve({ status: res.statusCode, body: parsed, rawBody: text });
          };
          if (encoding === 'gzip') {
            zlib.gunzip(buf, (err, d) => parse(err ? buf : d));
          } else if (encoding === 'br') {
            zlib.brotliDecompress(buf, (err, d) => parse(err ? buf : d));
          } else {
            parse(buf);
          }
        });
      },
    );
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── API operations ────────────────────────────────────────────────────────────

async function search(query) {
  const q = encodeURIComponent(query);
  const r = await api('GET', `/v1/catalog/${STOREFRONT}/search?term=${q}&types=songs&limit=5`);
  if (r.status !== 200) die(`Search failed (${r.status}): ${JSON.stringify(r.body)}`);
  return r.body?.results?.songs?.data || [];
}

// Fetch ALL user library playlists, paging through results
async function getAllPlaylists() {
  requireUserToken();
  const all = [];
  let path = '/v1/me/library/playlists?limit=100';
  while (path) {
    const r = await api('GET', path);
    if (r.status !== 200) break;
    all.push(...(r.body?.data || []));
    // Follow pagination cursor if present
    path = r.body?.next || null;
  }
  return all;
}

async function createPlaylist(name, description = '') {
  requireUserToken();

  // Refuse to create if a playlist with this name already exists.
  // This prevents duplicate playlists when the command is retried.
  const existing = await getAllPlaylists();
  const dup = existing.find(p => p.attributes?.name === name);
  if (dup) {
    die(`A playlist named "${name}" already exists (ID: ${dup.id}). Use add-songs to add to it, or choose a different name.`);
  }

  const r = await api('POST', '/v1/me/library/playlists', {
    attributes: { name, description },
  });

  if (r.status !== 201) {
    die(`Failed to create playlist (${r.status}): ${r.rawBody}`);
  }

  // Try to get the ID from the response body
  const playlist = r.body?.data?.[0];
  if (playlist?.id) return playlist;

  // Response body didn't include the created resource (known Apple Music quirk).
  // Retry up to 4 times (up to ~10 seconds) waiting for API propagation.
  for (let attempt = 1; attempt <= 4; attempt++) {
    await sleep(attempt * 750 + 1500); // 2.25s, 3s, 3.75s, 4.5s
    const all = await getAllPlaylists();
    const match = all.find(p => p.attributes?.name === name);
    if (match) return match;
  }

  die(`Playlist "${name}" was created but its ID could not be retrieved after retries. API response: ${r.rawBody}`);
  throw new Error('unreachable'); // tells JS the function always returns or throws
}

async function addSongs(playlistId, songIds) {
  requireUserToken();
  const r = await api('POST', `/v1/me/library/playlists/${playlistId}/tracks`, {
    data: songIds.map(id => ({ id, type: 'songs' })),
  });
  if (r.status !== 204 && r.status !== 200) {
    die(`Failed to add songs (${r.status}): ${r.rawBody}`);
  }
}

async function deletePlaylist(playlistId) {
  requireUserToken();
  const r = await api('DELETE', `/v1/me/library/playlists/${playlistId}`);
  if (r.status !== 204 && r.status !== 200) {
    die(`Failed to delete playlist (${r.status}): ${r.rawBody}`);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function die(msg) { console.error(msg); process.exit(1); }

function requireUserToken() {
  if (!USER_TOKEN) die('APPLE_MUSIC_USER_TOKEN is not set. Run: node scripts/apple-music-setup.mjs');
}

function printSong(song) {
  const a = song.attributes;
  console.log(`  ID: ${song.id}`);
  console.log(`  ${a.name} — ${a.artistName} (${a.albumName})`);
}

// ── CLI ───────────────────────────────────────────────────────────────────────

const [,, cmd, ...args] = process.argv;

async function main() {
  if (cmd === 'search') {
    const query = args.join(' ');
    if (!query) die('Usage: apple-music search <query>');
    const songs = await search(query);
    if (!songs.length) { console.log('No songs found.'); return; }
    console.log(`Found ${songs.length} result(s):`);
    songs.forEach((s, i) => { console.log(`\n${i + 1}.`); printSong(s); });

  } else if (cmd === 'create-playlist') {
    const [name, description] = args;
    if (!name) die('Usage: apple-music create-playlist "Name" ["Description"]');
    const playlist = await createPlaylist(name, description);
    console.log(`Created playlist: ${playlist.attributes?.name || name}`);
    console.log(`ID: ${playlist.id}`);

  } else if (cmd === 'add-songs') {
    const [playlistId, ...songIds] = args;
    if (!playlistId || !songIds.length) die('Usage: apple-music add-songs <playlist-id> <song-id> [...]');
    await addSongs(playlistId, songIds);
    console.log(`Added ${songIds.length} song(s) to playlist.`);

  } else if (cmd === 'make') {
    const [name, ...queries] = args;
    if (!name || !queries.length) die('Usage: apple-music make "Playlist Name" "query1" "query2" ...');

    const playlist = await createPlaylist(name);
    console.log(`Created playlist: ${name} (ID: ${playlist.id})`);

    const found = [];
    const notFound = [];
    for (const q of queries) {
      const songs = await search(q);
      if (songs.length) {
        found.push(songs[0]);
        console.log(`  ✓ ${songs[0].attributes.name} — ${songs[0].attributes.artistName}`);
      } else {
        notFound.push(q);
        console.log(`  ✗ Not found: ${q}`);
      }
    }

    if (found.length) {
      await addSongs(playlist.id, found.map(s => s.id));
      console.log(`\nAdded ${found.length} song(s) to "${name}".`);
    }
    if (notFound.length) {
      console.log(`Could not find: ${notFound.join(', ')}`);
    }

  } else if (cmd === 'list-playlists') {
    const playlists = await getAllPlaylists();
    if (!playlists.length) { console.log('No playlists found.'); return; }
    console.log('Your playlists:');
    for (const p of playlists) {
      console.log(`  • ${p.attributes?.name}  (ID: ${p.id})`);
    }

  } else if (cmd === 'delete-playlist') {
    const [playlistId] = args;
    if (!playlistId) die('Usage: apple-music delete-playlist <playlist-id>');
    await deletePlaylist(playlistId);
    console.log(`Deleted playlist ${playlistId}.`);

  } else {
    console.error('Usage: apple-music search|create-playlist|add-songs|make|list-playlists|delete-playlist');
    process.exit(1);
  }
}

main().catch(e => { console.error(`Error: ${e.message}`); process.exit(1); });
