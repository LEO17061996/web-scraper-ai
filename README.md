# 🤖 Web Scraper + AI Analyzer

> AI-powered e-commerce product scraper with the Service Adapter Pattern.
> Built with Playwright + Anthropic Claude SDK + TypeScript (strict).

[![CI](https://github.com/LEO17061996/web-scraper-ai/actions/workflows/ci.yml/badge.svg)](https://github.com/LEO17061996/web-scraper-ai/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue.svg)](tsconfig.json)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Scrape product listings from a marketplace, let Claude analyze each one
(category, key features, price-value score, red flags), and save structured
JSON — with production-grade resilience and cost controls throughout.

## ✨ Features

- 🌐 **Multi-platform** via the Service Adapter Pattern — Shopee today; adding a
  platform is one new file implementing `IScraper` (Open-Closed Principle).
- 🤖 **AI analysis** — Claude extracts category, key features, a 1–10 value
  score, and red flags (scam / fake-review detection).
- 🎯 **Claude Tool Use** (function calling) with forced `tool_choice` →
  structured, Zod-validated output instead of fragile text parsing.
- 💰 **Prompt Caching** — the large system prompt is cached (`ephemeral`), so
  batch calls reuse it at ~10% of input cost.
- 🛡️ **Production resilience** — exponential backoff + jitter on 429/5xx, a
  circuit breaker that aborts a batch after consecutive failures, and scraper
  anti-detection (UA rotation, randomized viewport, human-like delays).
- 📊 **Cost + observability** — per-call and per-session token cost, average
  cost/request, and cache-hit rate, all via structured Pino logs.
- 📦 **Structured output** — pretty-printed JSON, schema-validated end to end.
- 🧪 **Tested** — Vitest unit tests for schemas, cost math, and fixtures.

## 🚀 Quick start

```bash
git clone https://github.com/LEO17061996/web-scraper-ai
cd web-scraper-ai
npm install
cp .env.example .env            # add ANTHROPIC_API_KEY

# Reliable offline demo (real AI, no live scraping):
npm run scrape -- --query "gaming laptop" --platform shopee \
  --fixture examples/fixtures/shopee-gaming-laptop.json

# Live scrape (requires a browser; Shopee may block):
npx playwright install chromium
npm run scrape -- --query "gaming laptop" --platform shopee --limit 20
```

See [`examples/README-demo.md`](examples/README-demo.md) for sample output.

## 📊 Measured run

Analyzing the 6-product fixture with `claude-sonnet-4-6`:

| Run | Cache hit | Cost (6 products) | Cost / product |
|---|---|---|---|
| Cold start | 63.1% | $0.0399 | ~$0.0067 |
| Warm cache (within 5-min TTL) | 75.8% | $0.0366 | ~$0.0061 |

Prompt caching keeps the cost flat even though the system prompt is large —
cached tokens are billed at ~10% of the input rate. At the warm-cache rate,
**~100 products costs roughly $0.61**.

## 🏗 Architecture

```
[User query]
     │
     ▼
[Scraper Adapter] ──► RawProduct[]  ──►  [AI Analyzer] ──► AnalyzedProduct[] ──► [JSON output]
  IScraper                                Claude Tool Use
  (Shopee / …)                            + Prompt Caching
     ▲                                    + retry / circuit breaker
     │
  BaseScraper: Playwright lifecycle, anti-detection, retry, Zod validation
```

**Service Adapter Pattern** — the pipeline depends only on the `IScraper`
interface and a small registry. A concrete adapter (e.g. `ShopeeScraper`)
implements just two hooks: `buildSearchUrl()` and `extractRawProducts()`. Adding
Lazada / Amazon / eBay touches no existing code.

## 📂 Project structure

```
src/
├── index.ts                # CLI entry point
├── pipeline.ts             # scrape → analyze → output → summarize
├── types.ts                # Zod schemas = source of truth (RawProduct, AnalyzedProduct)
├── scrapers/
│   ├── base.ts             # IScraper interface + ScraperError
│   ├── base-scraper.ts     # abstract BaseScraper (Playwright + anti-detection)
│   ├── shopee.ts           # ShopeeScraper adapter
│   └── index.ts            # platform → adapter registry
├── ai/
│   ├── analyzer.ts         # Claude Tool Use + caching + retry + circuit breaker
│   ├── prompts.ts          # cached system prompt + tool schema
│   └── cost-tracker.ts     # cost + cache-hit observability
├── output/json.ts          # JSON sink
└── utils/
    ├── logger.ts           # Pino structured logger
    └── retry.ts            # exponential backoff + jitter
examples/                   # fixtures + sample analyzed output
tests/                      # Vitest unit tests
```

## 💡 Why these patterns matter

| Pattern | Why it's here |
|---|---|
| Tool Use (forced) | Reliable typed output — no regex parsing of model prose |
| Prompt Caching | Cuts batch cost dramatically; the system prompt is the stable, cacheable prefix |
| Backoff + circuit breaker | Survives transient 429/5xx without hammering the API |
| Anti-detection | Real-world scraping defense (UA rotation, viewport, delays) |
| Zod everywhere | Scraped DOM and AI output are both untrusted — validate at the boundary |

## 🧪 Tech stack

- **Runtime**: Node.js 20+, TypeScript 5.6 (strict, `noUncheckedIndexedAccess`)
- **Browser**: Playwright headless Chromium
- **AI**: Anthropic Claude SDK (Tool Use + prompt caching)
- **Validation**: Zod · **Logging**: Pino · **Testing**: Vitest

## 📜 Scripts

```bash
npm run scrape -- --query "..." --platform shopee   # run the pipeline
npm run build                                        # tsc → dist/
npm test                                             # vitest
```

## ⚠️ Note on Shopee

Shopee has aggressive bot protection and frequently changes its DOM. The live
scraper is best-effort: the base class detects login walls / captchas and raises
`ScraperError("blocked")`, and retries with a fresh fingerprint. For a
deterministic demo, use the **offline fixture mode** shown above.

## 👨‍💻 Author

[Leo — Lê Thanh Thuận](https://leo-studio.pages.dev)

- AI-Native Developer · daily Claude Code workflow
- Built end-to-end with Spec-Driven Development

## 📜 License

MIT
