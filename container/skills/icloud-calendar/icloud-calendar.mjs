#!/usr/bin/env node
/**
 * icloud-calendar — read iCloud calendar events via CalDAV
 * Usage: icloud-calendar today|tomorrow|week|range YYYY-MM-DD YYYY-MM-DD|list-calendars
 *
 * Requires env vars: ICLOUD_APPLE_ID, ICLOUD_APP_PASSWORD
 * No npm dependencies — uses Node.js built-in https module only.
 */
import https from 'https';
import fs from 'fs';

const APPLE_ID = process.env.ICLOUD_APPLE_ID;
const APP_PASSWORD = process.env.ICLOUD_APP_PASSWORD;

if (!APPLE_ID || !APP_PASSWORD) {
  console.error('Authentication failed — check ICLOUD_APPLE_ID and ICLOUD_APP_PASSWORD');
  process.exit(1);
}

const AUTH = `Basic ${Buffer.from(`${APPLE_ID}:${APP_PASSWORD}`).toString('base64')}`;
const CACHE_FILE = '/tmp/icloud-caldav-cache.json';
const CACHE_TTL = 3_600_000;

// ── HTTP ──────────────────────────────────────────────────────────────────────

function request(method, urlStr, extraHeaders = {}, body = null) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const headers = {
      Authorization: AUTH,
      'Content-Type': 'application/xml; charset=utf-8',
      'Accept-Encoding': 'identity',
      ...extraHeaders,
    };
    if (body) headers['Content-Length'] = Buffer.byteLength(body).toString();

    const req = https.request(
      { hostname: u.hostname, path: u.pathname + u.search, method, headers },
      res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () =>
          resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }),
        );
      },
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// ── XML helpers (namespace-agnostic) ─────────────────────────────────────────

function xmlInner(xml, tag) {
  const m = xml.match(new RegExp(`<[^:>]*:?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/[^:>]*:?${tag}>`, 'i'));
  return m ? m[1].trim() : null;
}

function xmlInnerAll(xml, tag) {
  const re = new RegExp(`<[^:>]*:?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/[^:>]*:?${tag}>`, 'gi');
  const results = [];
  let m;
  while ((m = re.exec(xml)) !== null) results.push(m[1].trim());
  return results;
}

function extractHref(block) {
  const m = block.match(/<[^:>]*:?href[^>]*>([^<]+)</i);
  return m ? decodeURIComponent(m[1].trim()) : null;
}

// ── CalDAV discovery ──────────────────────────────────────────────────────────

async function discover() {
  try {
    const c = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
    if (Date.now() - c.ts < CACHE_TTL && c.calendars?.length) return c;
  } catch {}

  // Step 1: Resolve which iCloud server to use via well-known redirect
  let serverBase = 'https://caldav.icloud.com';
  const wkResp = await request(
    'PROPFIND',
    `${serverBase}/.well-known/caldav`,
    { Depth: '0' },
    '<D:propfind xmlns:D="DAV:"><D:prop><D:current-user-principal/></D:prop></D:propfind>',
  );

  if ([301, 302, 307, 308].includes(wkResp.status) && wkResp.headers.location) {
    const loc = new URL(wkResp.headers.location, `${serverBase}/`);
    serverBase = `${loc.protocol}//${loc.host}`;
  } else if (wkResp.status === 401) {
    die('Authentication failed — check ICLOUD_APPLE_ID and ICLOUD_APP_PASSWORD');
  }

  // Step 2: Get current-user-principal
  const pResp = await request(
    'PROPFIND',
    `${serverBase}/`,
    { Depth: '0' },
    '<D:propfind xmlns:D="DAV:"><D:prop><D:current-user-principal/></D:prop></D:propfind>',
  );
  if (pResp.status === 401) die('Authentication failed — check ICLOUD_APPLE_ID and ICLOUD_APP_PASSWORD');
  if (pResp.status !== 207) die(`CalDAV server returned unexpected status ${pResp.status}`);

  const principalBlock = xmlInner(pResp.body, 'current-user-principal');
  const principalHref = principalBlock ? extractHref(principalBlock) : null;
  if (!principalHref) die('CalDAV discovery failed: no principal URL found');

  const principalUrl = principalHref.startsWith('http') ? principalHref : `${serverBase}${principalHref}`;

  // Step 3: Get calendar-home-set from principal
  const hResp = await request(
    'PROPFIND',
    principalUrl,
    { Depth: '0' },
    `<?xml version="1.0" encoding="UTF-8"?>
<D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop><C:calendar-home-set/></D:prop>
</D:propfind>`,
  );

  const homeBlock = xmlInner(hResp.body, 'calendar-home-set');
  const homeHref = homeBlock ? extractHref(homeBlock) : null;
  if (!homeHref) die('CalDAV discovery failed: no calendar-home-set found');

  const homeUrl = homeHref.startsWith('http') ? homeHref : `${serverBase}${homeHref}`;

  // Step 4: List calendars (Depth:1)
  const lResp = await request(
    'PROPFIND',
    homeUrl,
    { Depth: '1' },
    `<?xml version="1.0" encoding="UTF-8"?>
<D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop>
    <D:displayname/>
    <D:resourcetype/>
    <C:supported-calendar-component-set/>
  </D:prop>
</D:propfind>`,
  );

  const calendars = [];
  for (const response of xmlInnerAll(lResp.body, 'response')) {
    const href = extractHref(response);
    if (!href || href === homeHref) continue;
    if (!response.match(/VEVENT/i)) continue;
    if (response.match(/schedule-inbox|schedule-outbox/i)) continue;
    const name = xmlInner(response, 'displayname') || href.split('/').filter(Boolean).pop() || 'Calendar';
    const url = href.startsWith('http') ? href : `${serverBase}${href}`;
    calendars.push({ name, url });
  }

  if (!calendars.length) die('No event calendars found in iCloud account');

  const cache = { ts: Date.now(), serverBase, calendars };
  try { fs.writeFileSync(CACHE_FILE, JSON.stringify(cache)); } catch {}
  return cache;
}

// ── CalDAV REPORT ─────────────────────────────────────────────────────────────

function toUtcStamp(d) {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
}

async function fetchEvents(calendars, serverBase, startDate, endDate) {
  const query = `<?xml version="1.0" encoding="UTF-8"?>
<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop>
    <D:getetag/>
    <C:calendar-data/>
  </D:prop>
  <C:filter>
    <C:comp-filter name="VCALENDAR">
      <C:comp-filter name="VEVENT">
        <C:time-range start="${toUtcStamp(startDate)}" end="${toUtcStamp(endDate)}"/>
      </C:comp-filter>
    </C:comp-filter>
  </C:filter>
</C:calendar-query>`;

  const events = [];
  for (const cal of calendars) {
    const resp = await request('REPORT', cal.url, { Depth: '1' }, query);
    if (resp.status !== 207) continue;
    for (const response of xmlInnerAll(resp.body, 'response')) {
      const calData = xmlInner(response, 'calendar-data');
      if (!calData) continue;
      const ev = parseVEvent(calData, cal.name);
      if (ev) events.push(ev);
    }
  }
  return events;
}

// ── iCal parser ───────────────────────────────────────────────────────────────

function unfold(ical) {
  return ical.replace(/\r?\n[ \t]/g, '');
}

function icalProp(ical, name) {
  const re = new RegExp(`^(${name}(?:;[^:]*)?):(.+)$`, 'im');
  const m = ical.match(re);
  if (!m) return null;
  const params = {};
  const pStr = m[1].slice(name.length);
  for (const seg of pStr.split(';').slice(1)) {
    const eq = seg.indexOf('=');
    if (eq > 0) params[seg.slice(0, eq).toUpperCase()] = seg.slice(eq + 1);
  }
  return { params, value: m[2].trim() };
}

function parseICalDate(prop) {
  if (!prop) return null;
  const { value } = prop;

  // All-day: YYYYMMDD
  if (/^\d{8}$/.test(value)) {
    const y = +value.slice(0, 4), mo = +value.slice(4, 6) - 1, d = +value.slice(6, 8);
    return { allDay: true, date: new Date(y, mo, d) };
  }

  // UTC datetime: YYYYMMDDTHHmmssZ
  if (value.endsWith('Z') && value.includes('T')) {
    const dp = value.slice(0, 8), tp = value.slice(9, 15);
    const iso = `${dp.slice(0,4)}-${dp.slice(4,6)}-${dp.slice(6,8)}T${tp.slice(0,2)}:${tp.slice(2,4)}:${tp.slice(4,6)}Z`;
    return { allDay: false, date: new Date(iso) };
  }

  // Floating/TZID datetime: YYYYMMDDTHHmmss
  if (/^\d{8}T\d{6}$/.test(value)) {
    const y = +value.slice(0,4), mo = +value.slice(4,6)-1, d = +value.slice(6,8);
    const h = +value.slice(9,11), mi = +value.slice(11,13), s = +value.slice(13,15);
    return { allDay: false, date: new Date(y, mo, d, h, mi, s) };
  }

  return null;
}

function unescapeIcal(s) {
  return s.replace(/\\n/g, ' ').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
}

function parseVEvent(calData, calName) {
  const text = unfold(calData);
  const m = text.match(/BEGIN:VEVENT([\s\S]*?)END:VEVENT/i);
  if (!m) return null;
  const ev = m[1];

  const summary = icalProp(ev, 'SUMMARY');
  const location = icalProp(ev, 'LOCATION');
  const dtstart = parseICalDate(icalProp(ev, 'DTSTART'));
  const dtend = parseICalDate(icalProp(ev, 'DTEND'));
  if (!dtstart) return null;

  return {
    summary: summary ? unescapeIcal(summary.value) : '(no title)',
    location: location ? unescapeIcal(location.value) : null,
    start: dtstart,
    end: dtend,
    calendar: calName,
  };
}

// ── Formatting ────────────────────────────────────────────────────────────────

function fmtTime(d) {
  const h = d.getHours(), m = d.getMinutes();
  const ampm = h >= 12 ? 'pm' : 'am';
  return `${h % 12 || 12}:${m.toString().padStart(2, '0')}${ampm}`;
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fmtDateHeader(d, today) {
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const base = `${DAYS[d.getDay()]} ${MONTHS[d.getMonth()]} ${d.getDate()}`;
  if (d.toDateString() === today.toDateString()) return `Today — ${base}`;
  if (d.toDateString() === tomorrow.toDateString()) return `Tomorrow — ${base}`;
  return base;
}

function printEvents(events) {
  if (!events.length) { console.log('No events found.'); return; }

  const byDay = new Map();
  for (const e of events) {
    const d = e.start.date;
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (!byDay.has(key)) byDay.set(key, { date: new Date(d.getFullYear(), d.getMonth(), d.getDate()), events: [] });
    byDay.get(key).events.push(e);
  }

  const today = new Date(); today.setHours(0, 0, 0, 0);
  for (const day of [...byDay.values()].sort((a, b) => a.date - b.date)) {
    console.log(fmtDateHeader(day.date, today));
    console.log('');
    const sorted = [...day.events].sort((a, b) => {
      if (a.start.allDay !== b.start.allDay) return a.start.allDay ? -1 : 1;
      return a.start.date - b.start.date;
    });
    for (const e of sorted) {
      let time;
      if (e.start.allDay) {
        time = 'All day';
      } else {
        const st = fmtTime(e.start.date);
        const et = e.end ? fmtTime(e.end.date) : '';
        time = et ? `${st}–${et}` : st;
      }
      let line = `• ${time.padEnd(14)}  ${e.summary}`;
      if (e.location) line += `  (${e.location})`;
      console.log(line);
    }
    console.log('');
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function die(msg) { console.error(msg); process.exit(1); }
function dayStart(d) { const r = new Date(d); r.setHours(0, 0, 0, 0); return r; }
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }

// ── Main ──────────────────────────────────────────────────────────────────────

const [,, cmd, ...args] = process.argv;

async function main() {
  const now = new Date();
  let startDate, endDate, listOnly = false;

  if (cmd === 'today') {
    startDate = dayStart(now); endDate = addDays(startDate, 1);
  } else if (cmd === 'tomorrow') {
    startDate = dayStart(addDays(now, 1)); endDate = addDays(startDate, 1);
  } else if (cmd === 'week') {
    startDate = dayStart(now); endDate = addDays(startDate, 7);
  } else if (cmd === 'range') {
    if (args.length < 2) die('Usage: icloud-calendar range YYYY-MM-DD YYYY-MM-DD');
    startDate = new Date(args[0] + 'T00:00:00');
    endDate = new Date(args[1] + 'T23:59:59');
  } else if (cmd === 'list-calendars') {
    listOnly = true; startDate = endDate = now;
  } else {
    die('Usage: icloud-calendar today|tomorrow|week|range YYYY-MM-DD YYYY-MM-DD|list-calendars');
  }

  const { calendars, serverBase } = await discover();

  if (listOnly) {
    console.log('Calendars:');
    for (const c of calendars) console.log(`• ${c.name}`);
    return;
  }

  const events = await fetchEvents(calendars, serverBase, startDate, endDate);
  printEvents(events);
}

main().catch(e => { console.error(`Error: ${e.message}`); process.exit(1); });
