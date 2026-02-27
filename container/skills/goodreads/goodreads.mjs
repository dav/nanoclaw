#!/usr/bin/env node
/**
 * goodreads — Goodreads via headless browser automation (Playwright direct)
 *
 * Commands:
 *   goodreads search <query>           # Search for books by title/author
 *   goodreads shelf [<name>]           # List books on a shelf (default: to-read)
 *   goodreads add-to-read <query>      # Find a book and add it to to-read list
 *   goodreads profile                  # Show profile info and shelf names
 *   goodreads login                    # Force a fresh login
 *
 * Requires: GOODREADS_EMAIL, GOODREADS_PASSWORD env vars
 * Auth state: ~/.goodreads/auth.json (persisted across container runs via mount)
 *
 * Uses playwright-core from agent-browser's bundled deps so there's no extra
 * npm install needed. Sets a realistic user agent and masks navigator.webdriver
 * to avoid bot-detection blocks.
 */
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';

const require = createRequire(import.meta.url);
const { chromium } = require('/usr/local/lib/node_modules/agent-browser/node_modules/playwright-core');

const AUTH_DIR = process.env.GOODREADS_AUTH_DIR || '/home/node/.goodreads';
const AUTH_FILE = path.join(AUTH_DIR, 'auth.json');
const EMAIL = process.env.GOODREADS_EMAIL;
const PASSWORD = process.env.GOODREADS_PASSWORD;
const CHROMIUM = process.env.AGENT_BROWSER_EXECUTABLE_PATH || '/usr/bin/chromium';

// Realistic desktop Chrome UA — avoids "HeadlessChrome" being sent to the server
const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// ── Browser helpers ───────────────────────────────────────────────────────────

async function launchBrowser() {
  return chromium.launch({
    executablePath: CHROMIUM,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled', // hides automation flag at Chrome level
    ],
  });
}

async function newContext(browser, { withSavedAuth = true } = {}) {
  const opts = {
    userAgent: USER_AGENT,
    viewport: { width: 1280, height: 800 },
    locale: 'en-US',
  };

  if (withSavedAuth && fs.existsSync(AUTH_FILE)) {
    try {
      opts.storageState = AUTH_FILE;
    } catch {
      // Corrupted auth file — ignore, will re-login
    }
  }

  const ctx = await browser.newContext(opts);

  // Mask webdriver before any page scripts run
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    window.chrome = { runtime: {} };
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
  });

  return ctx;
}

async function saveAuth(ctx) {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  await ctx.storageState({ path: AUTH_FILE });
}

// ── Auth ──────────────────────────────────────────────────────────────────────

async function doLogin(ctx) {
  if (!EMAIL || !PASSWORD) {
    die('Goodreads not configured — add GOODREADS_EMAIL and GOODREADS_PASSWORD to your .env file');
  }

  process.stderr.write('Logging in to Goodreads...\n');
  const page = await ctx.newPage();

  // Step 1: Goodreads sign-in page — click "Sign in with email" to reach Amazon's form
  await page.goto('https://www.goodreads.com/user/sign_in', { waitUntil: 'domcontentloaded' });
  await page.getByText('Sign in with email').first().click();

  // Wait for Amazon's auth form to appear (more reliable than networkidle)
  await page.waitForSelector('#ap_email', { timeout: 15000 });

  // Step 2: Fill Amazon-hosted auth page (goodreads.com/ap/signin)
  await page.locator('#ap_email').fill(EMAIL);
  await page.locator('#ap_password').fill(PASSWORD);
  await page.locator('#signInSubmit').click();

  // Wait for redirect away from the sign-in page
  await page.waitForURL(url => !url.toString().includes('/ap/signin'), { timeout: 30000 });

  if (page.url().includes('signin')) {
    die('Login failed — verify GOODREADS_EMAIL and GOODREADS_PASSWORD in your .env');
  }

  await saveAuth(ctx);
  await page.close();
  process.stderr.write('Logged in — auth state saved.\n');
}

async function ensureAuth(browser) {
  const ctx = await newContext(browser, { withSavedAuth: true });

  // Quick check: are we actually logged in?
  if (fs.existsSync(AUTH_FILE)) {
    const page = await ctx.newPage();
    await page.goto('https://www.goodreads.com', { waitUntil: 'domcontentloaded' });
    // Wait a moment for the nav to render after DOM is ready
    await page.waitForTimeout(1500);
    const loggedIn = await page.evaluate(() =>
      !!document.querySelector('.personalNav, [data-testid="header-profile-nav"], .userMenu, .profilePicture')
    );
    await page.close();
    if (loggedIn) return ctx;
  }

  // Need fresh login
  await doLogin(ctx);
  return ctx;
}

async function withPage(ctx, fn) {
  const page = await ctx.newPage();
  try {
    return await fn(page);
  } finally {
    await page.close();
  }
}

// ── Commands ──────────────────────────────────────────────────────────────────

async function cmdSearch(query) {
  const browser = await launchBrowser();
  try {
    const ctx = await ensureAuth(browser);
    await withPage(ctx, async page => {
      await page.goto(
        `https://www.goodreads.com/search?q=${encodeURIComponent(query)}&search_type=books`,
        { waitUntil: 'domcontentloaded' },
      );
      await page.waitForSelector('.bookTitle', { timeout: 15000 });

      const books = await page.evaluate(() =>
        [...document.querySelectorAll('.bookTitle')].slice(0, 10).map(el => {
          const row = el.closest('tr');
          const authorEl = row?.querySelector('.authorName');
          const ratingEl = row?.querySelector('.minirating');
          const idMatch = el.href?.match(/\/show\/([\d]+)/);
          return {
            id: idMatch?.[1] || '',
            title: el.textContent.trim(),
            author: authorEl?.textContent.trim() || '',
            rating: ratingEl?.textContent.trim() || '',
          };
        }).filter(b => b.title)
      );

      if (!books.length) {
        console.log(`No results found for: "${query}"`);
        return;
      }

      console.log(`Search results for "${query}":\n`);
      for (let i = 0; i < books.length; i++) {
        const b = books[i];
        console.log(`${i + 1}. ${b.title}`);
        if (b.author) console.log(`   Author: ${b.author}`);
        if (b.rating) console.log(`   ${b.rating}`);
        if (b.id) console.log(`   Goodreads ID: ${b.id}`);
        console.log();
      }
    });
  } finally {
    await browser.close();
  }
}

async function cmdShelf(shelfName = 'to-read') {
  const browser = await launchBrowser();
  try {
    const ctx = await ensureAuth(browser);
    await withPage(ctx, async page => {
      await page.goto('https://www.goodreads.com/profile', { waitUntil: 'domcontentloaded' });
      const profileUrl = page.url();
      const userIdMatch = profileUrl.match(/\/user\/show\/(\d+)/);
      if (!userIdMatch) die('Could not determine your Goodreads user ID — are you logged in?');
      const userId = userIdMatch[1];

      await page.goto(
        `https://www.goodreads.com/review/list/${userId}?shelf=${encodeURIComponent(shelfName)}&per_page=30&view=table`,
        { waitUntil: 'domcontentloaded' },
      );

      const books = await page.evaluate(() =>
        [...document.querySelectorAll('#booksBody tr, table.table tbody tr')].map(row => {
          const titleEl = row.querySelector('.title a, td.field.title a');
          const authorEl = row.querySelector('.author a, td.field.author a');
          const dateEl = row.querySelector('.date_added span, td.field.date_added span');
          if (!titleEl) return null;
          return {
            title: titleEl.textContent.trim(),
            author: authorEl?.textContent.trim() || '',
            added: dateEl?.title || dateEl?.textContent.trim() || '',
          };
        }).filter(Boolean)
      );

      if (!books.length) {
        console.log(`No books found on "${shelfName}" shelf.`);
        return;
      }

      console.log(`${books.length} book(s) on "${shelfName}" shelf:\n`);
      for (let i = 0; i < books.length; i++) {
        const b = books[i];
        let line = `${i + 1}. ${b.title}`;
        if (b.author) line += ` — ${b.author}`;
        console.log(line);
        if (b.added) console.log(`   Added: ${b.added}`);
      }
    });
  } finally {
    await browser.close();
  }
}

async function cmdAddToRead(query) {
  const browser = await launchBrowser();
  try {
    const ctx = await ensureAuth(browser);
    await withPage(ctx, async page => {
      await page.goto(
        `https://www.goodreads.com/search?q=${encodeURIComponent(query)}&search_type=books`,
        { waitUntil: 'domcontentloaded' },
      );

      const bookUrl = await page.evaluate(() => document.querySelector('.bookTitle')?.href || '');
      const bookTitle = await page.evaluate(() => document.querySelector('.bookTitle')?.textContent.trim() || '');

      if (!bookUrl) die(`No books found matching: "${query}"`);

      await page.goto(bookUrl, { waitUntil: 'domcontentloaded' });

      // Click "Want to Read" — Goodreads has changed this button's markup several times
      const clicked = await page.evaluate(() => {
        const selectors = [
          'button[aria-label*="Want to read" i]',
          'button[data-testid="want-to-read-button"]',
          '.wantToReadBtn',
          '.wantToRead',
          '[class*="WantToReadButton"]',
          '[class*="wantToRead"]',
        ];
        for (const sel of selectors) {
          const btn = document.querySelector(sel);
          if (btn) { btn.click(); return 'clicked'; }
        }
        const btn = [...document.querySelectorAll('button, [role="button"]')]
          .find(b => /want to read/i.test(b.textContent));
        if (btn) { btn.click(); return 'clicked'; }
        return 'not-found';
      });

      if (clicked === 'not-found') {
        try {
          await page.getByText(/want to read/i).first().click();
        } catch {
          die(
            `Found "${bookTitle || query}" but could not click "Want to Read". ` +
            `The book may already be on a shelf, or Goodreads' UI may have changed.`,
          );
        }
      }

      await page.waitForTimeout(1500);
      await saveAuth(ctx);
      console.log(`Added "${bookTitle || query}" to your to-read list.`);
    });
  } finally {
    await browser.close();
  }
}

async function cmdProfile() {
  const browser = await launchBrowser();
  try {
    const ctx = await ensureAuth(browser);
    await withPage(ctx, async page => {
      await page.goto('https://www.goodreads.com/profile', { waitUntil: 'domcontentloaded' });
      const url = page.url();
      const userId = url.match(/\/user\/show\/(\d+)/)?.[1] || '(unknown)';

      const profile = await page.evaluate(() => ({
        name:
          document.querySelector('h1.userProfileName, .userProfileName, [data-testid="user-name"]')
            ?.textContent.trim() || '',
        shelves: [
          ...new Set(
            [...document.querySelectorAll('a[href*="shelf="]')]
              .map(el => el.textContent.trim())
              .filter(Boolean),
          ),
        ].slice(0, 15),
      }));

      if (profile.name) console.log(`Name: ${profile.name}`);
      console.log(`User ID: ${userId}`);
      console.log(`Profile: ${url}`);
      if (profile.shelves?.length) {
        console.log('\nShelves:');
        for (const s of profile.shelves) console.log(`  • ${s}`);
      }
    });
  } finally {
    await browser.close();
  }
}

// ── CLI ───────────────────────────────────────────────────────────────────────

function die(msg) { console.error(msg); process.exit(1); }

const [,, cmd, ...args] = process.argv;

async function main() {
  if (cmd === 'search') {
    const query = args.join(' ');
    if (!query) die('Usage: goodreads search <query>');
    await cmdSearch(query);
  } else if (cmd === 'shelf') {
    await cmdShelf(args[0] || 'to-read');
  } else if (cmd === 'add-to-read') {
    const query = args.join(' ');
    if (!query) die('Usage: goodreads add-to-read <book title or search query>');
    await cmdAddToRead(query);
  } else if (cmd === 'profile') {
    await cmdProfile();
  } else if (cmd === 'login') {
    const browser = await launchBrowser();
    try {
      const ctx = await newContext(browser, { withSavedAuth: false });
      await doLogin(ctx);
    } finally {
      await browser.close();
    }
  } else {
    console.error('Usage:');
    console.error('  goodreads search <query>           # Search for books');
    console.error('  goodreads shelf [name]             # List shelf (default: to-read)');
    console.error('  goodreads add-to-read <query>      # Add book to to-read list');
    console.error('  goodreads profile                  # Show profile and shelf names');
    console.error('  goodreads login                    # Force fresh login');
    process.exit(1);
  }
}

main().catch(e => { console.error(`Error: ${e.message}`); process.exit(1); });
