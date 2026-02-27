#!/usr/bin/env node
/**
 * sfpl — San Francisco Public Library catalog search
 *
 * Commands:
 *   sfpl search <query>    # Search by title, author, or keyword
 *
 * No authentication required — public catalog.
 */
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { chromium } = require('/usr/local/lib/node_modules/agent-browser/node_modules/playwright-core');

const CHROMIUM = process.env.AGENT_BROWSER_EXECUTABLE_PATH || '/usr/bin/chromium';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

async function launchBrowser() {
  return chromium.launch({
    executablePath: CHROMIUM,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
}

async function cmdSearch(query) {
  const browser = await launchBrowser();
  try {
    const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();

    await page.goto(
      `https://sfpl.bibliocommons.com/v2/search?query=${encodeURIComponent(query)}&searchType=keyword`,
      { waitUntil: 'domcontentloaded' },
    );

    // Wait for result items or a no-results indicator
    await page.waitForSelector('h3.cp-title, [class*="noResults"], [class*="zero-results"]', { timeout: 15000 })
      .catch(() => {});

    const isEmpty = await page.evaluate(() =>
      !document.querySelector('h3.cp-title')
    );

    if (isEmpty) {
      console.log(`No results found at SFPL for: "${query}"`);
      return;
    }

    const results = await page.evaluate(() =>
      [...document.querySelectorAll('[data-test-id="searchResultItem"]')].slice(0, 8).map(item => {
        // innerText respects CSS visibility — avoids the hidden screen-reader duplicate title
        const title = item.querySelector('h3.cp-title')?.innerText?.trim().split('\n')[0]?.trim() || '';
        const author = item.querySelector('.cp-author-link')?.innerText?.trim() || '';

        const formats = [...item.querySelectorAll('.manifestation-item')].map(m => {
          // Format info text: "eBook, 2025. Call number: EBOOK LIBBY"
          const formatRaw = m.querySelector('.cp-format-info')?.innerText?.trim() || '';
          const [formatPart, callPart] = formatRaw.split(/\.\s*Call number:\s*/);

          // Availability block: "All copies in use\nView location...\nHolds: 8 on 5 copies"
          const availRaw = m.querySelector('.manifestation-item-availability-block-wrap')?.innerText?.trim() || '';
          const status = availRaw.split('\n')[0]?.trim() || '';
          const holdsMatch = availRaw.match(/Holds:\s*(\d+)\s*on\s*(\d+)/);
          const holds = holdsMatch ? `Holds: ${holdsMatch[1]} on ${holdsMatch[2]} copies` : '';

          return {
            format: formatPart?.trim() || '',
            callNumber: callPart?.trim() || '',
            status,
            holds,
          };
        }).filter(f => f.format);

        return { title, author, formats };
      }).filter(r => r.title)
    );

    if (!results.length) {
      console.log(`No results found at SFPL for: "${query}"`);
      return;
    }

    console.log(`SFPL — "${query}":\n`);
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      console.log(`${i + 1}. ${r.title}${r.author ? ` — by ${r.author}` : ''}`);
      for (const f of r.formats) {
        let line = `   • ${f.format}`;
        if (f.callNumber) line += ` — ${f.callNumber}`;
        if (f.status) line += ` — ${f.status}`;
        if (f.holds) line += ` (${f.holds})`;
        console.log(line);
      }
      console.log();
    }
  } finally {
    await browser.close();
  }
}

function die(msg) { console.error(msg); process.exit(1); }

const [,, cmd, ...args] = process.argv;

async function main() {
  if (cmd === 'search') {
    const query = args.join(' ');
    if (!query) die('Usage: sfpl search <query>');
    await cmdSearch(query);
  } else {
    console.error('Usage: sfpl search <query>');
    process.exit(1);
  }
}

main().catch(e => { console.error(`Error: ${e.message}`); process.exit(1); });
