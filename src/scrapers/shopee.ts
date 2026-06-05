/**
 * Shopee (shopee.vn) adapter.
 *
 * Implements the two platform-specific hooks of `BaseScraper`:
 *   - `buildSearchUrl` — Shopee's search endpoint
 *   - `extractRawProducts` — read product cards off the results grid
 *
 * NOTE ON RELIABILITY: Shopee has aggressive bot protection (login walls,
 * captchas, frequent DOM/class-name changes). The base class detects gates and
 * raises `ScraperError("blocked")`; selectors here target the relatively stable
 * `data-sqe` attributes Shopee uses to tag list items and names. Treat this as a
 * best-effort scraper — see README for the offline fixture demo path.
 */

import type { Page } from "playwright";

import { BaseScraper, type ScrapedFields } from "./base-scraper.js";
import type { Platform } from "../types.js";

const BASE_URL = "https://shopee.vn";

export class ShopeeScraper extends BaseScraper {
  override readonly platform: Platform = "shopee";

  protected override buildSearchUrl(query: string): string {
    return `${BASE_URL}/search?keyword=${encodeURIComponent(query)}`;
  }

  protected override blockSignals(): readonly string[] {
    // Shopee's gate page title is usually generic; rely mostly on URL + these.
    return [...super.blockSignals(), "đăng nhập", "shopee | login"];
  }

  protected override async extractRawProducts(
    page: Page,
    limit: number,
  ): Promise<ScrapedFields[]> {
    // Wait for at least one product card; tolerate timeout (handled upstream
    // as no_results / parse_error) rather than throwing a raw Playwright error.
    await page
      .waitForSelector("[data-sqe='item']", { timeout: 15_000 })
      .catch(() => undefined);

    const rows = await page.$$eval(
      "[data-sqe='item']",
      (nodes, baseUrl) => {
        const text = (el: Element | null): string =>
          (el?.textContent ?? "").trim();

        return nodes.map((node) => {
          const link = node.querySelector("a");
          const href = link?.getAttribute("href") ?? "";
          const img = node.querySelector("img");

          // Title: Shopee tags the name node with data-sqe="name".
          const title =
            text(node.querySelector("[data-sqe='name']")) ||
            text(link);

          // Price: first "₫<number>" occurrence in the card text.
          const cardText = text(node);
          const priceMatch = cardText.match(/₫\s*([\d.,]+)/);
          const priceRaw = priceMatch?.[1] ?? "";

          // Rating: a bare decimal like "4.8" near the star block, if present.
          const ratingMatch = cardText.match(/\b([0-5](?:\.\d)?)\b\s*(?:★|sao)?/);
          const ratingRaw = ratingMatch?.[1] ?? "";

          // Sold count → used as a review-count proxy when present ("đã bán 1,2k").
          const soldMatch = cardText.match(/đã bán\s*([\d.,]+)\s*(k|tr)?/i);

          return {
            title,
            priceRaw,
            ratingRaw,
            soldRaw: soldMatch?.[1] ?? "",
            soldUnit: soldMatch?.[2] ?? "",
            imageUrl: img?.getAttribute("src") ?? null,
            href,
            baseUrl,
          };
        });
      },
      BASE_URL,
    );

    return rows
      .map((r) => this.toFields(r))
      .filter((f): f is ScrapedFields => f !== null);
  }

  /** Convert one raw DOM row into typed `ScrapedFields` (or null if unusable). */
  private toFields(r: {
    title: string;
    priceRaw: string;
    ratingRaw: string;
    soldRaw: string;
    soldUnit: string;
    imageUrl: string | null;
    href: string;
    baseUrl: string;
  }): ScrapedFields | null {
    const title = r.title.trim();
    const price = parseVndPrice(r.priceRaw);
    if (!title || price === null) return null;

    const productUrl = r.href.startsWith("http")
      ? r.href
      : `${r.baseUrl}${r.href}`;

    const rating = r.ratingRaw ? clampRating(Number(r.ratingRaw)) : null;
    const reviewCount = parseSoldCount(r.soldRaw, r.soldUnit);

    return {
      title,
      price,
      currency: "VND",
      rating,
      reviewCount,
      imageUrl: r.imageUrl,
      productUrl,
    };
  }
}

/** "16.990.000" → 16990000. Returns null if no digits. */
function parseVndPrice(raw: string): number | null {
  const digits = raw.replace(/[^\d]/g, "");
  return digits ? Number(digits) : null;
}

/** Clamp a parsed rating into the valid 0–5 range, or null if NaN. */
function clampRating(value: number): number | null {
  if (Number.isNaN(value)) return null;
  return Math.min(5, Math.max(0, value));
}

/** "1,2" + "k" → 1200. Returns null when absent/unparseable. */
function parseSoldCount(raw: string, unit: string): number | null {
  if (!raw) return null;
  const base = Number(raw.replace(/\./g, "").replace(",", "."));
  if (Number.isNaN(base)) return null;
  const multiplier = unit.toLowerCase() === "tr" ? 1_000_000 : unit.toLowerCase() === "k" ? 1000 : 1;
  return Math.round(base * multiplier);
}
