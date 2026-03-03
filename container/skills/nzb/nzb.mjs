#!/usr/bin/env node
/**
 * nzb — search and download NZBs from nzb indexer via API
 *
 * Commands:
 *   nzb search <query>                  # General search
 *   nzb tv <query> [--season N] [--ep N]  # TV search
 *   nzb movie <query> [--imdbid N]      # Movie search
 *   nzb nfo <id>                        # Get NFO text
 *   nzb download <id>                   # Download NZB to /tmp/
 *
 * Requires env vars: NZBS_API_URL, NZBS_API_KEY
 * No npm dependencies — uses Node.js built-in https module only.
 */
import https from 'https';
import fs from 'fs';

const API_URL = process.env.NZBS_API_URL;
if (!API_URL) {
  console.error('Missing NZBS_API_URL environment variable');
  process.exit(1);
}
const API_KEY = process.env.NZBS_API_KEY;
if (!API_KEY) {
  console.error('Missing NZBS_API_KEY environment variable');
  process.exit(1);
}

const BASE = API_URL;

// ── HTTP ──────────────────────────────────────────────────────────────────────

function fetch(urlStr) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    https.get({ hostname: u.hostname, path: u.pathname + u.search, headers: { 'Accept-Encoding': 'identity' } }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
}

// ── XML parsing ───────────────────────────────────────────────────────────────

function parseItems(xml) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = itemRegex.exec(xml)) !== null) {
    items.push(parseItem(m[1]));
  }
  return items;
}

function parseItem(xml) {
  const item = {};

  // Standard elements
  const tagVal = (tag) => {
    const m = xml.match(new RegExp(`<${tag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, 'i'))
      || xml.match(new RegExp(`<${tag}>([^<]*)<\\/${tag}>`, 'i'));
    return m ? m[1].trim() : null;
  };

  item.title = tagVal('title');
  item.link = tagVal('link');
  item.pubDate = tagVal('pubDate');
  item.description = tagVal('description');
  item.guid = tagVal('guid');

  // newznab attributes
  const attrRegex = /<newznab:attr\s+name="([^"]+)"\s+value="([^"]*)"\s*\/?>/gi;
  let a;
  while ((a = attrRegex.exec(xml)) !== null) {
    item[a[1]] = a[2];
  }

  return item;
}

function parseError(xml) {
  const m = xml.match(/<error\s+code="(\d+)"\s+description="([^"]*)"/i);
  return m ? { code: m[1], description: m[2] } : null;
}

// ── Formatting ────────────────────────────────────────────────────────────────

function formatSize(bytes) {
  const b = parseInt(bytes, 10);
  if (isNaN(b)) return bytes || '?';
  if (b >= 1073741824) return `${(b / 1073741824).toFixed(1)} GB`;
  if (b >= 1048576) return `${(b / 1048576).toFixed(0)} MB`;
  return `${(b / 1024).toFixed(0)} KB`;
}

function formatAge(pubDate) {
  if (!pubDate) return '';
  const diff = Date.now() - new Date(pubDate).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'today';
  if (days === 1) return '1 day ago';
  if (days < 30) return `${days} days ago`;
  if (days < 365) return `${Math.floor(days / 30)} months ago`;
  return `${Math.floor(days / 365)}y ago`;
}

function printResults(items, query) {
  if (!items.length) {
    console.log(`No results found for: "${query}"`);
    return;
  }

  console.log(`Found ${items.length} result${items.length === 1 ? '' : 's'} for "${query}":\n`);

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const id = it.guid || '';
    const size = formatSize(it.size);
    const age = formatAge(it.pubDate);
    const grabs = it.grabs ? `${it.grabs} grabs` : '';
    const cat = it.category || '';

    console.log(`${i + 1}. ${it.title || '(untitled)'}`);

    const meta = [size, cat, age, grabs].filter(Boolean).join(' | ');
    if (meta) console.log(`   ${meta}`);
    if (id) console.log(`   ID: ${id}`);
    console.log();
  }
}

// ── Commands ──────────────────────────────────────────────────────────────────

function buildUrl(type, params) {
  const url = new URL(BASE);
  url.searchParams.set('t', type);
  url.searchParams.set('apikey', API_KEY);
  url.searchParams.set('extended', '1');
  for (const [k, v] of Object.entries(params)) {
    if (v != null) url.searchParams.set(k, v);
  }
  return url.toString();
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
  return { flags, query: positional.join(' ') };
}

async function cmdSearch(args) {
  const { flags, query } = parseFlags(args);
  if (!query) die('Usage: nzb search <query>');

  const params = { q: query };
  if (flags.limit) params.limit = flags.limit;
  else params.limit = '25';
  if (flags.maxage) params.maxage = flags.maxage;
  if (flags.cat) params.cat = flags.cat;

  const resp = await fetch(buildUrl('search', params));
  const xml = resp.body.toString();
  const err = parseError(xml);
  if (err) die(`API error ${err.code}: ${err.description}`);

  printResults(parseItems(xml), query);
}

async function cmdTv(args) {
  const { flags, query } = parseFlags(args);
  if (!query && !flags.rid && !flags.tvmazeid && !flags.tvdbid) die('Usage: nzb tv <query> [--season N] [--ep N]');

  const params = {};
  if (query) params.q = query;
  if (flags.limit) params.limit = flags.limit;
  else params.limit = '25';
  if (flags.maxage) params.maxage = flags.maxage;
  if (flags.cat) params.cat = flags.cat;
  if (flags.season) params.season = flags.season;
  if (flags.ep) params.ep = flags.ep;
  if (flags.episode) params.ep = flags.episode;
  if (flags.rid) params.rid = flags.rid;
  if (flags.tvmazeid) params.tvmazeid = flags.tvmazeid;
  if (flags.tvdbid) params.tvdbid = flags.tvdbid;

  const resp = await fetch(buildUrl('tvsearch', params));
  const xml = resp.body.toString();
  const err = parseError(xml);
  if (err) die(`API error ${err.code}: ${err.description}`);

  printResults(parseItems(xml), query || 'TV search');
}

async function cmdMovie(args) {
  const { flags, query } = parseFlags(args);
  if (!query && !flags.imdbid) die('Usage: nzb movie <query> [--imdbid N]');

  const params = {};
  if (query) params.q = query;
  if (flags.limit) params.limit = flags.limit;
  else params.limit = '25';
  if (flags.maxage) params.maxage = flags.maxage;
  if (flags.cat) params.cat = flags.cat;
  if (flags.imdbid) params.imdbid = flags.imdbid;

  const resp = await fetch(buildUrl('movie', params));
  const xml = resp.body.toString();
  const err = parseError(xml);
  if (err) die(`API error ${err.code}: ${err.description}`);

  printResults(parseItems(xml), query || 'Movie search');
}

async function cmdNfo(id) {
  if (!id) die('Usage: nzb nfo <id>');

  const resp = await fetch(buildUrl('getnfo', { id }));
  const xml = resp.body.toString();
  const err = parseError(xml);
  if (err) die(`API error ${err.code}: ${err.description}`);

  // NFO content is in CDATA within <content> or returned as raw text
  const content = xml.match(/<!\[CDATA\[([\s\S]*?)\]\]>/)?.[1] || xml;
  console.log(content);
}

async function cmdDownload(id) {
  if (!id) die('Usage: nzb download <id>');

  const url = buildUrl('get', { id });
  const resp = await fetch(url);

  if (resp.status !== 200) {
    const xml = resp.body.toString();
    const err = parseError(xml);
    if (err) die(`API error ${err.code}: ${err.description}`);
    die(`Download failed (HTTP ${resp.status})`);
  }

  // Get filename from content-disposition or use id
  const cd = resp.headers['content-disposition'] || '';
  const fnMatch = cd.match(/filename="?([^";\n]+)"?/);
  const filename = fnMatch ? fnMatch[1].trim() : `${id}.nzb`;
  const path = `/tmp/${filename}`;

  fs.writeFileSync(path, resp.body);
  console.log(`Downloaded: ${path} (${formatSize(resp.body.length)})`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

function die(msg) { console.error(msg); process.exit(1); }

const [,, cmd, ...args] = process.argv;

async function main() {
  switch (cmd) {
    case 'search': await cmdSearch(args); break;
    case 'tv': await cmdTv(args); break;
    case 'movie': await cmdMovie(args); break;
    case 'nfo': await cmdNfo(args[0]); break;
    case 'download': await cmdDownload(args[0]); break;
    default:
      die('Usage: nzb search|tv|movie|nfo|download\n  nzb search <query>\n  nzb tv <query> [--season N] [--ep N]\n  nzb movie <query> [--imdbid N]\n  nzb nfo <id>\n  nzb download <id>');
  }
}

main().catch(e => { console.error(`Error: ${e.message}`); process.exit(1); });
