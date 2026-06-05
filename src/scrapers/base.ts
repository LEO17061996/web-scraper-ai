/**
 * Service Adapter Pattern — scraper contract.
 *
 * Every platform (Shopee, Amazon, eBay, ...) is an adapter that implements
 * `IScraper`. The pipeline depends only on this interface, never on a concrete
 * scraper, so adding a platform means adding one file and zero edits elsewhere
 * (Open-Closed Principle).
 *
 * The concrete `BaseScraper` (shared Playwright lifecycle + anti-detection:
 * user-agent rotation, random delay, viewport) lands in CP3, where the first
 * adapter is implemented against it.
 */

import type { Platform, RawProduct, ScrapeOptions } from "../types.js";

/**
 * Contract for a platform scraper.
 *
 * Implementations must be self-contained: they own their browser lifecycle and
 * resolve to a clean, validated `RawProduct[]`. Failures that survive retries
 * are surfaced as a `ScraperError`.
 */
export interface IScraper {
  /** The platform this adapter scrapes. Used by the pipeline to route queries. */
  readonly platform: Platform;

  /**
   * Scrape search results for `query`.
   *
   * @param query   Free-text search term, e.g. "gaming laptop".
   * @param options Per-call overrides; defaults from `DEFAULT_SCRAPE_OPTIONS`.
   * @returns       Products found, capped at `options.limit`.
   * @throws        {@link ScraperError} when scraping fails after all retries.
   */
  scrape(query: string, options?: ScrapeOptions): Promise<RawProduct[]>;
}

/** Categories of scrape failure, used by callers to decide whether to retry. */
export type ScraperErrorCode =
  | "navigation_timeout"
  | "blocked" // bot detection / captcha
  | "parse_error" // page loaded but selectors did not match
  | "no_results"
  | "unknown";

/** Error thrown by scrapers, carrying the platform and a machine-readable code. */
export class ScraperError extends Error {
  override readonly name = "ScraperError";

  constructor(
    message: string,
    readonly platform: Platform,
    readonly code: ScraperErrorCode = "unknown",
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}
