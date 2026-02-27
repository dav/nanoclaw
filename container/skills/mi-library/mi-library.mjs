#!/usr/bin/env node
/**
 * mi-library — Mechanics Institute Library catalog search
 *
 * Commands:
 *   mi-library search <query>    # Search by title, author, or keyword
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

    // encodeURIComponent produces %20 (spaces), which Encore requires — not + signs
    const url = `https://encore.milibrary.org/iii/encore/search/C__S${encodeURIComponent(query)}__Orightresult?lang=eng`;
    await page.goto(url, { waitUntil: 'domcontentloaded' });

    // Wait for results area or no-results message
    await page.waitForSelector(
      '.resultsSummary, .dpBibTitle, .encore-results-layout, #searchResultsContainer',
      { timeout: 15000 },
    ).catch(() => page.waitForTimeout(3000));

    // Check for no results
    const noResults = await page.evaluate(() => {
      const summary = document.querySelector('.resultsSummary, .browseHeader')?.textContent || '';
      return summary.includes('No catalog results') || summary.includes('no results');
    });

    if (noResults) {
      console.log(`No results found at Mechanics Institute Library for: "${query}"`);
      return;
    }

    // Try structured extraction with standard Encore class names
    const results = await page.evaluate(() =>
      [...document.querySelectorAll('.dpBibTitle, .bibliographicData, .encore-bib-data')].slice(0, 8).map(item => {
        const container = item.closest('.resultItem, .dpBibRecord, [class*="result"]') || item.parentElement;
        const title = item.querySelector('a, .title')?.textContent.trim() || item.textContent.trim();
        const author = container?.querySelector('.dpBibAuthor, .author')?.textContent.trim() || '';
        // callNum in Encore shows "Location (Call Number)" — use textContent, it's clean
        const callNum = container?.querySelector('.dpBibCallNum, .callNum, [class*="call"]')?.textContent.trim() || '';
        // avail: use innerText and strip blank lines + UI noise like "see all"
        const rawAvail = container?.querySelector('.dpAvailability, [class*="avail"], [class*="status"]')?.innerText || '';
        const avail = rawAvail.split('\n').map(l => l.trim()).filter(l => l && !/^see all$/i.test(l)).join('  ').trim();
        return { title, author, callNum, avail };
      }).filter(r => r.title)
    );

    if (results.length) {
      console.log(`Mechanics Institute Library — "${query}":\n`);
      for (const r of results) {
        console.log(r.title);
        if (r.author) console.log(`  Author: ${r.author}`);
        // callNum already includes location ("Available at Balcony 3A (153.9 K967)")
        if (r.callNum) console.log(`  ${r.callNum}`);
        if (r.avail) console.log(`  ${r.avail}`);
        console.log();
      }
      return;
    }

    // Fallback: show innerText of the results section (Encore is server-rendered, text is clean)
    const text = await page.evaluate(() => {
      const container =
        document.querySelector('.resultsView, #searchResultsContainer, .encore-results-layout__right-column') ||
        document.querySelector('.encore-results-layout');
      return container?.innerText?.trim() || '';
    });

    if (text && text.length > 20) {
      console.log(`Mechanics Institute Library — "${query}":\n`);
      // Trim noise: keep only the first ~2000 chars of results
      console.log(text.slice(0, 2000));
    } else {
      console.log(`No results found at Mechanics Institute Library for: "${query}"`);
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
    if (!query) die('Usage: mi-library search <query>');
    await cmdSearch(query);
  } else {
    console.error('Usage: mi-library search <query>');
    process.exit(1);
  }
}

main().catch(e => { console.error(`Error: ${e.message}`); process.exit(1); });
