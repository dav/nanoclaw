#!/usr/bin/env node
/**
 * sfpl — San Francisco Public Library catalog search & hold placement
 *
 * Commands:
 *   sfpl search <query>    # Search by title, author, or keyword
 *   sfpl hold <query>      # Search and place a hold on the first matching title
 *   sfpl login              # Force a fresh login
 *
 * Hold placement requires: SFPL_BARCODE, SFPL_PIN env vars
 * Auth state: ~/.sfpl/auth.json (persisted across container runs via mount)
 */
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';

const require = createRequire(import.meta.url);
const { chromium } = require('/usr/local/lib/node_modules/agent-browser/node_modules/playwright-core');

const CHROMIUM = process.env.AGENT_BROWSER_EXECUTABLE_PATH || '/usr/bin/chromium';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const AUTH_DIR = process.env.SFPL_AUTH_DIR || '/home/node/.sfpl';
const AUTH_FILE = path.join(AUTH_DIR, 'auth.json');
const BARCODE = process.env.SFPL_BARCODE;
const PIN = process.env.SFPL_PIN;

const BAYVIEW_PICKUP = 'Bayview/Linda Brooks-Burton';

// ── Browser helpers ───────────────────────────────────────────────────────────

async function launchBrowser() {
  return chromium.launch({
    executablePath: CHROMIUM,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
}

async function newContext(browser, { withSavedAuth = true } = {}) {
  const opts = {
    userAgent: UA,
    viewport: { width: 1280, height: 800 },
  };

  if (withSavedAuth && fs.existsSync(AUTH_FILE)) {
    try {
      opts.storageState = AUTH_FILE;
    } catch {
      // Corrupted auth file — ignore, will re-login
    }
  }

  return browser.newContext(opts);
}

async function saveAuth(ctx) {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  await ctx.storageState({ path: AUTH_FILE });
}

// ── Auth ──────────────────────────────────────────────────────────────────────

async function doLogin(ctx) {
  if (!BARCODE || !PIN) {
    die('SFPL not configured — add SFPL_BARCODE and SFPL_PIN to your .env file');
  }

  process.stderr.write('Logging in to SFPL...\n');
  const page = await ctx.newPage();

  await page.goto('https://sfpl.bibliocommons.com/user/login', { waitUntil: 'domcontentloaded' });

  // Wait for the login form inputs
  await page.waitForSelector('input[name="name"], input[name="user_name"], #user_name, input[type="text"]', { timeout: 15000 });

  // Fill barcode/username field
  const nameInput = await page.$('input[name="name"]')
    || await page.$('input[name="user_name"]')
    || await page.$('#user_name')
    || await page.$('input[type="text"]');
  if (!nameInput) die('Could not find username/barcode field on login page');
  await nameInput.fill(BARCODE);

  // Fill PIN/password field
  const pinInput = await page.$('input[name="user_pin"]')
    || await page.$('input[name="pin"]')
    || await page.$('#user_pin')
    || await page.$('input[type="password"]');
  if (!pinInput) die('Could not find PIN field on login page');
  await pinInput.fill(PIN);

  // Submit the form
  const submitBtn = await page.$('input[type="submit"]')
    || await page.$('button[type="submit"]');
  if (!submitBtn) die('Could not find login submit button');
  await submitBtn.click();

  // Wait for navigation away from login page
  await page.waitForURL(url => !url.toString().includes('/user/login'), { timeout: 15000 });

  if (page.url().includes('/user/login')) {
    die('Login failed — verify SFPL_BARCODE and SFPL_PIN in your .env');
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
    await page.goto('https://sfpl.bibliocommons.com/user_dashboard', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    const loggedIn = await page.evaluate(() =>
      // If we're on the dashboard (not redirected to login), we're logged in
      !window.location.href.includes('/user/login')
    );
    await page.close();
    if (loggedIn) return ctx;
  }

  // Need fresh login
  await doLogin(ctx);
  return ctx;
}

// ── Commands ──────────────────────────────────────────────────────────────────

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

async function cmdHold(query) {
  if (!BARCODE || !PIN) {
    die('SFPL not configured — add SFPL_BARCODE and SFPL_PIN to your .env file');
  }

  const browser = await launchBrowser();
  try {
    const ctx = await ensureAuth(browser);
    const page = await ctx.newPage();

    // Search for the book
    await page.goto(
      `https://sfpl.bibliocommons.com/v2/search?query=${encodeURIComponent(query)}&searchType=keyword`,
      { waitUntil: 'domcontentloaded' },
    );

    await page.waitForSelector('h3.cp-title, [class*="noResults"], [class*="zero-results"]', { timeout: 15000 })
      .catch(() => {});

    const isEmpty = await page.evaluate(() => !document.querySelector('h3.cp-title'));
    if (isEmpty) die(`No results found at SFPL for: "${query}"`);

    // Get the title of the first result for reporting
    const firstTitle = await page.evaluate(() => {
      const item = document.querySelector('[data-test-id="searchResultItem"]');
      return item?.querySelector('h3.cp-title')?.innerText?.trim().split('\n')[0]?.trim() || '';
    });

    process.stderr.write(`Placing hold on: ${firstTitle}\n`);

    // Click the first "Place Hold" button on the page
    const holdBtn = await page.$('button[data-js="request"], a[data-js="request"], .btn-hold, [class*="placeHold"], [class*="place-hold"]')
      || await page.$('button:has-text("Place Hold"), a:has-text("Place Hold")');

    if (!holdBtn) {
      // Try clicking into the first result to find the hold button on the detail page
      const titleLink = await page.$('h3.cp-title a');
      if (!titleLink) die('Could not find a hold button or title link');

      await titleLink.click();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(2000);

      // Look for hold button on the detail page
      const detailHoldBtn = await page.$('button:has-text("Place Hold"), a:has-text("Place Hold"), [class*="placeHold"], [class*="place-hold"]');
      if (!detailHoldBtn) die(`Could not find "Place Hold" button for "${firstTitle}"`);
      await detailHoldBtn.click();
    } else {
      await holdBtn.click();
    }

    // Wait for the hold dialog/form to appear
    await page.waitForTimeout(3000);

    // Select pickup location — look for a dropdown or selector with branch names
    const locationSelected = await selectPickupLocation(page);
    if (!locationSelected) {
      process.stderr.write('Warning: Could not find/select pickup location dropdown. Proceeding with default.\n');
    }

    // Click the confirm/submit hold button in the dialog
    await confirmHold(page);

    // Wait for confirmation
    await page.waitForTimeout(3000);

    // Check for success message
    const result = await page.evaluate(() => {
      const body = document.body.innerText;
      if (/hold was successfully placed|hold has been placed|successfully placed/i.test(body)) {
        return 'success';
      }
      if (/already have a hold|already on hold/i.test(body)) {
        return 'already_held';
      }
      if (/error|failed|unable/i.test(body)) {
        // Try to extract the error message
        const errorEl = document.querySelector('[class*="error"], [class*="alert"], .error-message');
        return `error: ${errorEl?.textContent?.trim() || 'Unknown error'}`;
      }
      return 'unknown';
    });

    await saveAuth(ctx);

    if (result === 'success') {
      console.log(`Hold placed successfully: "${firstTitle}" — pickup at ${BAYVIEW_PICKUP}`);
    } else if (result === 'already_held') {
      console.log(`You already have a hold on "${firstTitle}".`);
    } else if (result.startsWith('error:')) {
      die(`Failed to place hold on "${firstTitle}": ${result.slice(7)}`);
    } else {
      // Take a screenshot for debugging and report what we know
      console.log(`Hold request submitted for "${firstTitle}" — pickup at ${BAYVIEW_PICKUP}`);
      console.log('(Could not confirm success — check your SFPL account to verify.)');
    }

    await page.close();
  } finally {
    await browser.close();
  }
}

async function selectPickupLocation(page) {
  // BiblioCommons uses a dropdown/select for pickup location in the hold dialog
  // Try multiple strategies to find and set it

  // Strategy 1: Look for a <select> element with location options
  const selected = await page.evaluate((bayview) => {
    const selects = document.querySelectorAll('select');
    for (const sel of selects) {
      const options = [...sel.options];
      const match = options.find(o =>
        o.text.toLowerCase().includes('bayview') ||
        o.value.toLowerCase().includes('bayview')
      );
      if (match) {
        sel.value = match.value;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
    }
    return false;
  }, BAYVIEW_PICKUP);

  if (selected) return true;

  // Strategy 2: Look for a custom dropdown (React-style) and click the Bayview option
  const customDropdown = await page.$('[class*="location"] select, [class*="pickup"] select, [class*="branch"] select, [id*="location"] select, [id*="pickup"] select');
  if (customDropdown) {
    await customDropdown.selectOption({ label: new RegExp('bayview', 'i') }).catch(() => {});
    return true;
  }

  // Strategy 3: Click a dropdown trigger, then click the Bayview option in the list
  const dropdownTrigger = await page.$('[class*="location"] button, [class*="pickup"] button, [aria-label*="location" i], [aria-label*="pickup" i]');
  if (dropdownTrigger) {
    await dropdownTrigger.click();
    await page.waitForTimeout(1000);
    const bayviewOption = await page.$(`text=/bayview/i`);
    if (bayviewOption) {
      await bayviewOption.click();
      await page.waitForTimeout(500);
      return true;
    }
  }

  return false;
}

async function confirmHold(page) {
  // Look for a confirmation button in a dialog/modal
  // BiblioCommons typically shows a modal with a "Place Hold" or "Confirm" button

  // Strategy 1: Find a submit/confirm button in a dialog
  const confirmBtn = await page.$('.modal button[type="submit"], .dialog button[type="submit"], [class*="modal"] button[type="submit"]')
    || await page.$('button:has-text("Place Hold"), button:has-text("Confirm Hold"), button:has-text("Confirm")')
    || await page.$('[class*="modal"] button:has-text("Place"), [class*="dialog"] button:has-text("Place")');

  if (confirmBtn) {
    await confirmBtn.click();
    return;
  }

  // Strategy 2: Look for any prominent action button in a visible overlay
  const actionBtn = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('button, input[type="submit"]')];
    const hold = buttons.find(b => /place hold|confirm/i.test(b.textContent || b.value));
    if (hold) { hold.click(); return true; }
    return false;
  });

  if (!actionBtn) {
    process.stderr.write('Warning: Could not find confirm button — hold may require manual confirmation.\n');
  }
}

// ── CLI ───────────────────────────────────────────────────────────────────────

function die(msg) { console.error(msg); process.exit(1); }

const [,, cmd, ...args] = process.argv;

async function main() {
  if (cmd === 'search') {
    const query = args.join(' ');
    if (!query) die('Usage: sfpl search <query>');
    await cmdSearch(query);
  } else if (cmd === 'hold') {
    const query = args.join(' ');
    if (!query) die('Usage: sfpl hold <query>');
    await cmdHold(query);
  } else if (cmd === 'login') {
    if (!BARCODE || !PIN) die('SFPL not configured — add SFPL_BARCODE and SFPL_PIN to your .env file');
    const browser = await launchBrowser();
    try {
      const ctx = await newContext(browser, { withSavedAuth: false });
      await doLogin(ctx);
      console.log('Login successful. Auth state saved.');
    } finally {
      await browser.close();
    }
  } else {
    console.error('Usage:');
    console.error('  sfpl search <query>    # Search by title, author, or keyword');
    console.error('  sfpl hold <query>      # Place a hold (pickup: Bayview)');
    console.error('  sfpl login             # Force fresh login');
    process.exit(1);
  }
}

main().catch(e => { console.error(`Error: ${e.message}`); process.exit(1); });
