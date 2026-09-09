import { chromium, Browser, BrowserContext, Page } from 'playwright';
import path from 'path';
import fs from 'fs';
import { ScrapedWebsite } from '../types';
import { getDomain } from '../search/provider';
import { getDataDir } from '../db/sqlite';
import {
  extractEmails,
  extractPhones,
  extractAddresses,
  extractSocialLinks,
  extractTechnologies,
  detectContactForm,
  detectBooking,
  detectCTA,
  detectMobile,
} from '../extractors';

const PAGE_TIMEOUT = 15000;
const RETRY_COUNT = 2;
const RENDER_WAIT_MS = 2000;

function emptyResult(url: string, websiteStatus: ScrapedWebsite['websiteStatus']): ScrapedWebsite {
  return {
    url,
    domain: getDomain(url),
    title: '',
    metaDescription: '',
    textContent: '',
    emails: [],
    phones: [],
    addresses: [],
    socialLinks: [],
    technologies: [],
    hasContactForm: false,
    hasBooking: false,
    hasCTA: false,
    isMobile: false,
    websiteStatus,
    pages: [],
    screenshotPath: null,
  };
}

export class ScannerPool {
  private browser: Browser | null = null;
  private signal: AbortSignal | null = null;

  constructor(signal?: AbortSignal) {
    this.signal = signal ?? null;
    if (signal) {
      signal.addEventListener('abort', () => void this.close(), { once: true });
    }
  }

  async getBrowser(): Promise<Browser> {
    if (this.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (!this.browser || !this.browser.isConnected()) {
      this.browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      });
    }
    return this.browser;
  }

  async close(): Promise<void> {
    if (this.browser) {
      const browser = this.browser;
      this.browser = null;
      try {
        await browser.close();
      } catch {
        // ignore
      }
    }
  }
}

async function gotoWithRetry(page: Page, url: string): Promise<boolean> {
  for (let attempt = 0; attempt < RETRY_COUNT; attempt++) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT });
      await page.waitForTimeout(RENDER_WAIT_MS);
      return true;
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') throw err;
      if (attempt < RETRY_COUNT - 1) {
        await page.waitForTimeout(1500).catch(() => undefined);
      }
    }
  }
  return false;
}

async function extractPageData(page: Page, url: string) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT });
    await page.waitForTimeout(RENDER_WAIT_MS);

    const title = await page.title().catch(() => '');
    const metaDescription = await page
      .evaluate(() => document.querySelector('meta[name="description"]')?.getAttribute('content') || '')
      .catch(() => '');
    const textContent = await page.evaluate(() => document.body?.innerText || '').catch(() => '');
    const html = await page.content().catch(() => '');

    return { title, metaDescription, textContent, html };
  } catch {
    return { title: '', metaDescription: '', textContent: '', html: '' };
  }
}

async function captureScreenshot(
  page: Page,
  domain: string,
  runId: number
): Promise<string | null> {
  try {
    const dir = path.join(getDataDir(), 'screenshots', String(runId));
    fs.mkdirSync(dir, { recursive: true });
    const safeDomain = domain.replace(/[^a-z0-9.-]/gi, '_');
    const filePath = path.join(dir, `${safeDomain}.jpg`);
    await page.screenshot({ path: filePath, type: 'jpeg', quality: 60, timeout: 8000 });
    return filePath;
  } catch {
    return null;
  }
}

export async function scanWebsite(
  browser: Browser,
  url: string,
  options: { runId: number; location: string }
): Promise<ScrapedWebsite> {
  const domain = getDomain(url);
  const result = emptyResult(url, 'unavailable');

  let context: BrowserContext | null = null;
  try {
    context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 720 },
    });
    const page = await context.newPage();
    page.setDefaultTimeout(PAGE_TIMEOUT);

    const ok = await gotoWithRetry(page, url);
    if (!ok) {
      result.websiteStatus = 'timeout';
      return result;
    }
    result.websiteStatus = 'available';

    const mainData = await extractPageData(page, url);
    result.title = mainData.title;
    result.metaDescription = mainData.metaDescription;
    result.textContent = mainData.textContent;

    const allText = `${mainData.textContent} ${mainData.html}`;
    result.emails = extractEmails(allText);
    result.phones = extractPhones(mainData.html, options.location);
    result.addresses = extractAddresses(mainData.textContent);
    result.socialLinks = extractSocialLinks(mainData.html);
    result.technologies = extractTechnologies(mainData.html);
    result.hasContactForm = detectContactForm(mainData.html);
    result.hasBooking = detectBooking(allText);
    result.hasCTA = detectCTA(mainData.html);
    result.isMobile = detectMobile(mainData.html);

    result.screenshotPath = await captureScreenshot(page, domain, options.runId);

    const links = await page
      .evaluate(() =>
        Array.from(document.querySelectorAll('a[href]'))
          .map((a) => a.getAttribute('href') || '')
          .filter((href) => {
            if (!href || href.startsWith('#') || href.startsWith('javascript:')) return false;
            if (/facebook\.com|instagram\.com|twitter\.com|x\.com|linkedin\.com|t\.me/.test(href)) return false;
            return true;
          })
      )
      .catch(() => [] as string[]);

    const basePath = new URL(url).origin;
    const pagesToVisit = new Set<string>();

    for (const link of links) {
      try {
        let fullUrl: string;
        if (link.startsWith('/')) fullUrl = basePath + link;
        else if (link.startsWith('http')) fullUrl = link;
        else continue;

        if (getDomain(fullUrl) !== domain) continue;
        const pathname = new URL(fullUrl).pathname;
        if (
          ['/about', '/contact', '/services', '/contacts', '/о-нас', '/контакти', '/послуги'].some((p) =>
            pathname.toLowerCase().startsWith(p)
          )
        ) {
          pagesToVisit.add(fullUrl);
        }
      } catch {
        // skip invalid URLs
      }
    }

    for (const pageUrl of Array.from(pagesToVisit).slice(0, 3)) {
      result.pages.push(pageUrl);
      const pageData = await extractPageData(page, pageUrl);
      const pageText = `${pageData.textContent} ${pageData.html}`;

      result.emails = [...new Set([...result.emails, ...extractEmails(pageText)])];
      result.phones = [...new Set([...result.phones, ...extractPhones(pageData.html, options.location)])];
      result.addresses = [...new Set([...result.addresses, ...extractAddresses(pageData.textContent)])];
      result.socialLinks = [
        ...new Set([...result.socialLinks, ...extractSocialLinks(pageData.html)]),
      ];
      result.technologies = [
        ...new Set([...result.technologies, ...extractTechnologies(pageData.html)]),
      ];

      if (!result.hasContactForm) result.hasContactForm = detectContactForm(pageData.html);
      if (!result.hasBooking) result.hasBooking = detectBooking(pageText);
      if (!result.hasCTA) result.hasCTA = detectCTA(pageData.html);
    }
  } catch (err) {
    if (err instanceof Error && (err.name === 'AbortError' || err.message.includes('Target closed') || err.message.includes('Browser has been closed'))) {
      result.websiteStatus = 'unavailable';
    } else {
      result.websiteStatus = 'unavailable';
    }
  } finally {
    if (context) {
      try {
        await context.close();
      } catch {
        // ignore
      }
    }
  }

  return result;
}

export async function scanMultipleWebsites(
  urls: string[],
  pool: ScannerPool,
  options: { runId: number; location: string; concurrency: number; signal?: AbortSignal },
  onProgress?: (current: number, total: number) => void
): Promise<{ results: ScrapedWebsite[]; aborted: boolean }> {
  const results: ScrapedWebsite[] = [];
  const queue = [...urls];
  const concurrency = Math.max(1, Math.min(options.concurrency || 4, 8));
  let completed = 0;
  let aborted = false;

  async function processNext() {
    while (queue.length > 0) {
      if (options.signal?.aborted) {
        aborted = true;
        return;
      }
      const url = queue.shift()!;
      try {
        const browser = await pool.getBrowser();
        const result = await scanWebsite(browser, url, {
          runId: options.runId,
          location: options.location,
        });
        results.push(result);
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          aborted = true;
          return;
        }
        console.error(`[lead-generator] Failed to scan ${url}:`, err);
        results.push(emptyResult(url, 'unavailable'));
      }
      completed++;
      onProgress?.(completed, urls.length);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, urls.length) }, () => processNext())
  );

  if (options.signal?.aborted) aborted = true;
  return { results, aborted };
}
