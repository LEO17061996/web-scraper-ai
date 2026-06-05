/**
 * Abstract base for all platform scrapers (Service Adapter Pattern).
 *
 * `BaseScraper` owns everything that is identical across platforms:
 *   - Playwright browser lifecycle (launch → context → page → close)
 *   - Anti-detection (user-agent rotation, randomized viewport, human-like
 *     delays, auto-scroll for lazy-loaded grids)
 *   - Retry with exponential backoff on transient failures
 *   - Zod validation + platform/timestamp stamping of scraped rows
 *
 * A concrete adapter only supplies the two platform-specific bits:
 *   - `buildSearchUrl(query)` — where to navigate
 *   - `extractRawProducts(page, limit)` — how to read product cards off the DOM
 *
 * Adding a platform therefore means implementing two methods — no changes to
 * this file or the pipeline (Open-Closed Principle).
 */

import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright";

import {
  DEFAULT_SCRAPE_OPTIONS,
  RawProductSchema,
  type Platform,
  type RawProduct,
  type ScrapeOptions,
} from "../types.js";
import { logger, type Logger } from "../utils/logger.js";
import { sleep, withRetry } from "../utils/retry.js";
import { IScraper, ScraperError, type ScraperErrorCode } from "./base.js";

/** Fields an adapter extracts per product. Base stamps `platform` + `scrapedAt`. */
export type ScrapedFields = Omit<RawProduct, "platform" | "scrapedAt">;

/** Realistic desktop user-agents rotated per scrape to reduce fingerprinting. */
const USER_AGENTS: readonly string[] = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
];

/** Common desktop viewport sizes, picked at random per scrape. */
const VIEWPORTS: readonly { width: number; height: number }[] = [
  { width: 1920, height: 1080 },
  { width: 1536, height: 864 },
  { width: 1440, height: 900 },
  { width: 1366, height: 768 },
];

/** Error codes worth retrying — a fresh UA / viewport may get through. */
const RETRYABLE_CODES: ReadonlySet<ScraperErrorCode> = new Set([
  "navigation_timeout",
  "blocked",
  "unknown",
]);

/** Pick a random element from a non-empty readonly array. */
function pickRandom<T>(items: readonly T[]): T {
  // Length is guaranteed > 0 by the constant arrays above.
  return items[Math.floor(Math.random() * items.length)]!;
}

export abstract class BaseScraper implements IScraper {
  abstract readonly platform: Platform;

  // --- Platform-specific hooks (implemented by each adapter) ----------------

  /** Build the search-results URL for `query` on this platform. */
  protected abstract buildSearchUrl(query: string): string;

  /**
   * Read product cards off `page` and return best-effort field objects.
   * Returned values are validated by the base class, so adapters should focus
   * on extraction, not defensive typing.
   */
  protected abstract extractRawProducts(
    page: Page,
    limit: number,
  ): Promise<ScrapedFields[]>;

  // --- Public API -----------------------------------------------------------

  async scrape(query: string, options?: ScrapeOptions): Promise<RawProduct[]> {
    const opts = this.resolveOptions(options);
    const log = logger.child({ platform: this.platform, query });

    return withRetry(() => this.scrapeOnce(query, opts, log), {
      maxRetries: opts.maxRetries,
      shouldRetry: (err) =>
        err instanceof ScraperError && RETRYABLE_CODES.has(err.code),
      onRetry: (err, attempt, delayMs) =>
        log.warn(
          { attempt, delayMs, err: errMessage(err) },
          "scrape attempt failed — retrying",
        ),
    });
  }

  // --- Core single-attempt flow ---------------------------------------------

  private async scrapeOnce(
    query: string,
    opts: Required<ScrapeOptions>,
    log: Logger,
  ): Promise<RawProduct[]> {
    const startedAt = Date.now();
    const browser = await this.launchBrowser(opts.headless);

    try {
      const { context, page } = await this.newStealthPage(browser, opts.timeoutMs);
      const url = this.buildSearchUrl(query);

      log.debug({ url }, "navigating to search results");
      try {
        await page.goto(url, { waitUntil: "domcontentloaded" });
      } catch (err) {
        throw new ScraperError(
          `navigation failed: ${errMessage(err)}`,
          this.platform,
          "navigation_timeout",
          { cause: err },
        );
      }

      await this.humanDelay();
      await this.assertNotBlocked(page);
      await this.autoScroll(page);

      const fields = await this.extractRawProducts(page, opts.limit);
      const products = this.validate(fields, opts.limit, log);

      await context.close();

      if (products.length === 0) {
        throw new ScraperError(
          fields.length === 0
            ? "no product cards found on page"
            : "all scraped rows failed validation",
          this.platform,
          fields.length === 0 ? "no_results" : "parse_error",
        );
      }

      log.info(
        { count: products.length, latencyMs: Date.now() - startedAt },
        "scrape succeeded",
      );
      return products;
    } finally {
      await browser.close();
    }
  }

  /** Stamp platform + timestamp, validate each row, drop (and log) bad rows. */
  private validate(
    fields: ScrapedFields[],
    limit: number,
    log: Logger,
  ): RawProduct[] {
    const scrapedAt = new Date().toISOString();
    const products: RawProduct[] = [];

    for (const raw of fields.slice(0, limit)) {
      const parsed = RawProductSchema.safeParse({
        ...raw,
        platform: this.platform,
        scrapedAt,
      });
      if (parsed.success) {
        products.push(parsed.data);
      } else {
        log.warn(
          { issues: parsed.error.issues, title: raw.title },
          "dropping invalid product row",
        );
      }
    }
    return products;
  }

  // --- Browser / anti-detection helpers -------------------------------------

  private async launchBrowser(headless: boolean): Promise<Browser> {
    return chromium.launch({
      headless,
      args: [
        "--disable-blink-features=AutomationControlled",
        "--no-sandbox",
        "--disable-dev-shm-usage",
      ],
    });
  }

  private async newStealthPage(
    browser: Browser,
    timeoutMs: number,
  ): Promise<{ context: BrowserContext; page: Page }> {
    const context = await browser.newContext({
      userAgent: pickRandom(USER_AGENTS),
      viewport: pickRandom(VIEWPORTS),
      locale: "vi-VN",
      timezoneId: "Asia/Ho_Chi_Minh",
    });

    // Hide the most obvious automation signal (navigator.webdriver).
    await context.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });

    const page = await context.newPage();
    page.setDefaultTimeout(timeoutMs);
    page.setDefaultNavigationTimeout(timeoutMs);
    return { context, page };
  }

  /** Scroll the page in steps to trigger lazy-loaded product grids. */
  protected async autoScroll(page: Page, steps = 6): Promise<void> {
    for (let i = 0; i < steps; i += 1) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight));
      await this.humanDelay(400, 900);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
  }

  /** Pause for a randomized, human-like interval. */
  protected async humanDelay(minMs = 600, maxMs = 1600): Promise<void> {
    await sleep(minMs + Math.floor(Math.random() * (maxMs - minMs)));
  }

  /**
   * Detect login walls / captchas. Adapters can override `blockSignals` to add
   * platform-specific markers. Throws `ScraperError("blocked")` when tripped.
   */
  protected async assertNotBlocked(page: Page): Promise<void> {
    const url = page.url();
    if (/\/(login|verify|captcha)/i.test(url)) {
      throw new ScraperError(
        `redirected to a gate page: ${url}`,
        this.platform,
        "blocked",
      );
    }

    const title = (await page.title()).toLowerCase();
    const signals = this.blockSignals();
    if (signals.some((s) => title.includes(s))) {
      throw new ScraperError(
        `block signal in page title: "${title}"`,
        this.platform,
        "blocked",
      );
    }
  }

  /** Lowercase substrings in the page title that indicate a block. Overridable. */
  protected blockSignals(): readonly string[] {
    return ["captcha", "verify", "access denied", "robot"];
  }

  // --- Options --------------------------------------------------------------

  private resolveOptions(options?: ScrapeOptions): Required<ScrapeOptions> {
    // Drop undefined values so they don't clobber defaults.
    const provided = Object.fromEntries(
      Object.entries(options ?? {}).filter(([, v]) => v !== undefined),
    );
    return { ...DEFAULT_SCRAPE_OPTIONS, ...provided };
  }
}

/** Extract a readable message from an unknown thrown value. */
function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
