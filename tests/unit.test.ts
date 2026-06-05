/**
 * Unit tests — pure logic only (no network, no browser).
 * Covers: domain schema validation, cost/cache math, and fixture integrity.
 */

import { readFile } from "node:fs/promises";
import { describe, it, expect } from "vitest";

import {
  RawProductSchema,
  AnalyzedProductSchema,
  ProductAnalysisSchema,
} from "../src/types.js";
import { CostTracker } from "../src/ai/cost-tracker.js";

describe("RawProductSchema", () => {
  const valid = {
    title: "Acer Nitro 5",
    price: 18990000,
    currency: "VND",
    rating: 4.8,
    reviewCount: 1200,
    imageUrl: "https://cf.shopee.vn/file/x.jpg",
    productUrl: "https://shopee.vn/product/acer",
    platform: "shopee",
    scrapedAt: "2026-06-05T09:00:00.000Z",
  };

  it("accepts a valid product", () => {
    expect(RawProductSchema.parse(valid)).toMatchObject({ title: "Acer Nitro 5" });
  });

  it("allows null rating / reviewCount", () => {
    expect(() =>
      RawProductSchema.parse({ ...valid, rating: null, reviewCount: null }),
    ).not.toThrow();
  });

  it("rejects a negative price", () => {
    expect(() => RawProductSchema.parse({ ...valid, price: -1 })).toThrow();
  });

  it("rejects an unknown platform", () => {
    expect(() => RawProductSchema.parse({ ...valid, platform: "tiki" })).toThrow();
  });

  it("rejects a rating above 5", () => {
    expect(() => RawProductSchema.parse({ ...valid, rating: 6 })).toThrow();
  });
});

describe("ProductAnalysisSchema", () => {
  it("rejects a price-value score out of range", () => {
    const base = {
      category: "Gaming Laptop",
      keyFeatures: ["RTX 4060"],
      redFlags: [],
      summary: "ok",
    };
    expect(() => ProductAnalysisSchema.parse({ ...base, priceValueScore: 11 })).toThrow();
    expect(() => ProductAnalysisSchema.parse({ ...base, priceValueScore: 7 })).not.toThrow();
  });
});

describe("CostTracker", () => {
  it("computes cost and cache-hit rate from usage", () => {
    const tracker = new CostTracker({
      inputPerM: 3,
      outputPerM: 15,
      cacheWritePerM: 3.75,
      cacheReadPerM: 0.3,
    });

    // First call: writes the system prompt to cache.
    tracker.record({
      input_tokens: 100,
      output_tokens: 50,
      cache_creation_input_tokens: 1000,
      cache_read_input_tokens: 0,
    });
    // Second call: reads the cached prompt.
    tracker.record({
      input_tokens: 100,
      output_tokens: 50,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 1000,
    });

    const s = tracker.summary();
    expect(s.requests).toBe(2);
    expect(s.cacheReadTokens).toBe(1000);
    // cacheHitRate = cacheRead / (input + cacheWrite + cacheRead) = 1000 / 2200
    expect(s.cacheHitRate).toBeCloseTo(0.4545, 3);
    expect(s.totalCostUsd).toBeGreaterThan(0);
  });

  it("reports zero metrics before any calls", () => {
    const s = new CostTracker().summary();
    expect(s).toMatchObject({ requests: 0, totalCostUsd: 0, cacheHitRate: 0 });
  });
});

describe("fixture + example data integrity", () => {
  it("raw fixture matches RawProductSchema", async () => {
    const text = await readFile(
      new URL("../examples/fixtures/shopee-gaming-laptop.json", import.meta.url),
      "utf8",
    );
    const rows = RawProductSchema.array().parse(JSON.parse(text));
    expect(rows.length).toBeGreaterThan(0);
  });

  it("analyzed example matches AnalyzedProductSchema", async () => {
    const text = await readFile(
      new URL("../examples/shopee-gaming-laptop.json", import.meta.url),
      "utf8",
    );
    const rows = AnalyzedProductSchema.array().parse(JSON.parse(text));
    expect(rows.every((r) => r.analysis.priceValueScore >= 1)).toBe(true);
  });
});
