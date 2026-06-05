/**
 * Shared domain types.
 *
 * Zod schemas are the single source of truth; TypeScript types are inferred
 * via `z.infer`. This gives us runtime validation (scraped DOM and AI output
 * are both untrusted) for free, with zero type/schema drift.
 *
 * Data flow:  scraper → RawProduct → AI analyzer → AnalyzedProduct
 */

import { z } from "zod";

/** Supported e-commerce platforms. Add a new adapter = add a value here. */
export const PlatformSchema = z.enum(["shopee", "amazon", "ebay"]);
export type Platform = z.infer<typeof PlatformSchema>;

/**
 * A product as extracted by a scraper, before any AI processing.
 *
 * Nullable fields reflect reality: not every listing exposes a rating or
 * review count. `price` is normalized to a number in the listing's currency.
 */
export const RawProductSchema = z.object({
  /** Product title / name as shown on the listing. */
  title: z.string().min(1),
  /** Price normalized to a number (no currency symbol, no thousand separators). */
  price: z.number().nonnegative(),
  /** ISO 4217 currency code, e.g. "VND", "USD". */
  currency: z.string().length(3),
  /** Average rating (e.g. 4.5), or null if not shown. */
  rating: z.number().min(0).max(5).nullable(),
  /** Number of reviews, or null if not shown. */
  reviewCount: z.number().int().nonnegative().nullable(),
  /** Primary product image URL, or null. */
  imageUrl: z.string().url().nullable(),
  /** Canonical URL of the product page. */
  productUrl: z.string().url(),
  /** Platform this product was scraped from. */
  platform: PlatformSchema,
  /** ISO 8601 timestamp of when the product was scraped. */
  scrapedAt: z.string().datetime(),
});
export type RawProduct = z.infer<typeof RawProductSchema>;

/**
 * The AI-derived analysis of a single product. This is exactly the structured
 * output the analyzer forces Claude to return via Tool Use (function calling).
 */
export const ProductAnalysisSchema = z.object({
  /** High-level product category, e.g. "Gaming Laptop". */
  category: z.string().min(1),
  /** Salient features the AI extracted from the title/description. */
  keyFeatures: z.array(z.string()).max(10),
  /** Price-to-value score, 1 (poor) to 10 (excellent). */
  priceValueScore: z.number().int().min(1).max(10),
  /** Potential concerns: fake reviews, too-good-to-be-true price, etc. */
  redFlags: z.array(z.string()).max(10),
  /** One-sentence buyer-facing summary. */
  summary: z.string().min(1),
});
export type ProductAnalysis = z.infer<typeof ProductAnalysisSchema>;

/**
 * A product enriched with AI analysis — the final pipeline output.
 * Raw scraped data and AI-derived data are kept in separate namespaces so
 * downstream consumers can always tell the source of each field apart.
 */
export const AnalyzedProductSchema = RawProductSchema.extend({
  analysis: ProductAnalysisSchema,
});
export type AnalyzedProduct = z.infer<typeof AnalyzedProductSchema>;

/** Per-call options passed to a scraper. All optional; sensible defaults applied. */
export const ScrapeOptionsSchema = z.object({
  /** Max number of products to return. */
  limit: z.number().int().positive().optional(),
  /** Run the browser headless. Defaults to true. */
  headless: z.boolean().optional(),
  /** Per-navigation timeout in milliseconds. */
  timeoutMs: z.number().int().positive().optional(),
  /** Max retry attempts on transient scrape failures. */
  maxRetries: z.number().int().nonnegative().optional(),
});
export type ScrapeOptions = z.infer<typeof ScrapeOptionsSchema>;

/** Default scrape options, overridable per call and via env in later CPs. */
export const DEFAULT_SCRAPE_OPTIONS = {
  limit: 20,
  headless: true,
  timeoutMs: 30_000,
  maxRetries: 3,
} as const satisfies Required<ScrapeOptions>;
