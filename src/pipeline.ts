/**
 * Pipeline orchestrator: scrape → analyze → output → summarize.
 *
 * Routes a query to the right scraper adapter (or loads an offline fixture),
 * runs the AI analyzer over the results, saves JSON, and returns summary stats.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

import { ProductAnalyzer } from "./ai/analyzer.js";
import { saveToJson } from "./output/json.js";
import { getScraper } from "./scrapers/index.js";
import {
  RawProductSchema,
  type AnalyzedProduct,
  type Platform,
  type RawProduct,
} from "./types.js";
import type { CostSummary } from "./ai/cost-tracker.js";
import { logger } from "./utils/logger.js";

export interface PipelineOptions {
  query: string;
  platform: Platform;
  limit?: number;
  headless?: boolean;
  /** Directory for the output JSON. Default "examples/output". */
  outputDir?: string;
  /** If set, load RawProduct[] from this file instead of scraping live. */
  fixturePath?: string;
}

export interface PipelineSummary {
  query: string;
  platform: Platform;
  source: "live" | "fixture";
  scrapedCount: number;
  analyzedCount: number;
  avgPriceVnd: number | null;
  topByValue: { title: string; price: number; score: number }[];
  outputPath: string;
  cost: CostSummary;
}

const FixtureSchema = z.array(RawProductSchema);

export async function runPipeline(
  opts: PipelineOptions,
): Promise<PipelineSummary> {
  const log = logger.child({ query: opts.query, platform: opts.platform });

  // 1. Acquire raw products (live scrape or offline fixture).
  const source: "live" | "fixture" = opts.fixturePath ? "fixture" : "live";
  const raw = opts.fixturePath
    ? await loadFixture(opts.fixturePath, opts.limit)
    : await scrapeLive(opts);
  log.info({ source, scrapedCount: raw.length }, "raw products acquired");

  // 2. AI analysis.
  const analyzer = new ProductAnalyzer();
  const analyzed = await analyzer.analyzeBatch(raw);
  analyzer.costTracker.report();

  // 3. Persist.
  const outputPath = join(
    opts.outputDir ?? "examples/output",
    `${opts.platform}-${slugify(opts.query)}.json`,
  );
  await saveToJson(analyzed, outputPath);

  // 4. Summarize.
  return {
    query: opts.query,
    platform: opts.platform,
    source,
    scrapedCount: raw.length,
    analyzedCount: analyzed.length,
    avgPriceVnd: averagePrice(analyzed),
    topByValue: topByValue(analyzed, 3),
    outputPath,
    cost: analyzer.costTracker.summary(),
  };
}

async function scrapeLive(opts: PipelineOptions): Promise<RawProduct[]> {
  const scraper = getScraper(opts.platform);
  return scraper.scrape(opts.query, {
    limit: opts.limit,
    headless: opts.headless,
  });
}

async function loadFixture(
  path: string,
  limit?: number,
): Promise<RawProduct[]> {
  const text = await readFile(path, "utf8");
  const products = FixtureSchema.parse(JSON.parse(text));
  return limit ? products.slice(0, limit) : products;
}

function averagePrice(products: AnalyzedProduct[]): number | null {
  if (products.length === 0) return null;
  const sum = products.reduce((acc, p) => acc + p.price, 0);
  return Math.round(sum / products.length);
}

function topByValue(
  products: AnalyzedProduct[],
  n: number,
): { title: string; price: number; score: number }[] {
  return [...products]
    .sort((a, b) => b.analysis.priceValueScore - a.analysis.priceValueScore)
    .slice(0, n)
    .map((p) => ({
      title: p.title,
      price: p.price,
      score: p.analysis.priceValueScore,
    }));
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
