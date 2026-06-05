/**
 * Web Scraper + AI Analyzer — CLI entry point.
 *
 * Usage:
 *   tsx src/index.ts --query "gaming laptop" --platform shopee --limit 20
 *   tsx src/index.ts --query "gaming laptop" --platform shopee --fixture examples/fixtures/shopee-gaming-laptop.json
 *
 * Flags:
 *   --query <string>     Search term (required)
 *   --platform <name>    shopee | amazon | ebay (default: shopee)
 *   --limit <number>     Max products (default: 20)
 *   --output <dir>       Output directory (default: examples/output)
 *   --fixture <path>     Load raw products from JSON instead of live scraping
 *   --no-headless        Show the browser window (debugging)
 */

import "dotenv/config";

import { runPipeline } from "./pipeline.js";
import { PlatformSchema, type Platform } from "./types.js";

interface CliArgs {
  query?: string;
  platform: Platform;
  limit?: number;
  output?: string;
  fixture?: string;
  headless: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const flags = new Map<string, string | boolean>();
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token?.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      flags.set(key, true);
    } else {
      flags.set(key, next);
      i += 1;
    }
  }

  const platformRaw = (flags.get("platform") as string) ?? "shopee";
  const platform = PlatformSchema.safeParse(platformRaw);
  if (!platform.success) {
    throw new Error(
      `Invalid --platform "${platformRaw}". Use one of: ${PlatformSchema.options.join(", ")}`,
    );
  }

  const limitRaw = flags.get("limit");
  const limit =
    typeof limitRaw === "string" ? Number.parseInt(limitRaw, 10) : undefined;
  if (limit !== undefined && (Number.isNaN(limit) || limit <= 0)) {
    throw new Error(`Invalid --limit "${String(limitRaw)}". Must be a positive integer.`);
  }

  return {
    query: typeof flags.get("query") === "string" ? (flags.get("query") as string) : undefined,
    platform: platform.data,
    limit,
    output: typeof flags.get("output") === "string" ? (flags.get("output") as string) : undefined,
    fixture: typeof flags.get("fixture") === "string" ? (flags.get("fixture") as string) : undefined,
    headless: flags.get("no-headless") !== true,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.query) {
    throw new Error('Missing --query. Example: --query "gaming laptop" --platform shopee');
  }

  console.log(`🤖 Web Scraper + AI Analyzer\n   query="${args.query}" platform=${args.platform}${args.fixture ? " (fixture)" : ""}\n`);

  const summary = await runPipeline({
    query: args.query,
    platform: args.platform,
    limit: args.limit,
    headless: args.headless,
    outputDir: args.output,
    fixturePath: args.fixture,
  });

  console.log("\n✅ Done");
  console.log(`   Scraped:  ${summary.scrapedCount}`);
  console.log(`   Analyzed: ${summary.analyzedCount}`);
  console.log(
    `   Avg price: ${summary.avgPriceVnd === null ? "n/a" : `${summary.avgPriceVnd.toLocaleString("vi-VN")} VND`}`,
  );
  console.log(`   Output:   ${summary.outputPath}`);
  console.log(
    `   Cost:     $${summary.cost.totalCostUsd.toFixed(4)} over ${summary.cost.requests} calls (cache hit ${(summary.cost.cacheHitRate * 100).toFixed(1)}%)`,
  );
  console.log("\n   🏆 Top by value score:");
  for (const p of summary.topByValue) {
    console.log(`      [${p.score}/10] ${p.price.toLocaleString("vi-VN")} VND — ${p.title.slice(0, 60)}`);
  }
}

main().catch((err) => {
  console.error("❌ Fatal error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
