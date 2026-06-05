# 🎬 Demo

Two ways to run the pipeline.

## Option A — Offline fixture (no Shopee, no scraping)

Best for a reliable demo. Uses pre-scraped raw products in `fixtures/` and runs
the **real AI analyzer** over them. Requires only `ANTHROPIC_API_KEY`.

```bash
cp .env.example .env          # add ANTHROPIC_API_KEY
npm run scrape -- \
  --query "gaming laptop" \
  --platform shopee \
  --fixture examples/fixtures/shopee-gaming-laptop.json
```

Output is written to `examples/output/shopee-gaming-laptop.json`.

## Option B — Live scrape

Scrapes shopee.vn directly. Shopee actively blocks bots, so this can fail with
`ScraperError("blocked")` — that's expected, and the retry/anti-detection layer
will try a fresh user-agent first.

```bash
npx playwright install chromium   # one-time
npm run scrape -- --query "gaming laptop" --platform shopee --limit 20
```

## What the output looks like

`shopee-gaming-laptop.json` is a sample analyzed result (6 products). Each entry
is a scraped product enriched with an `analysis` block:

```json
{
  "title": "Laptop Gaming ASUS TUF F15 i7-12700H RTX 4060 16GB 1TB 144Hz",
  "price": 27490000,
  "currency": "VND",
  "rating": 4.9,
  "reviewCount": 860,
  "platform": "shopee",
  "analysis": {
    "category": "Gaming Laptop",
    "keyFeatures": ["Intel Core i7-12700H", "NVIDIA RTX 4060", "16GB RAM", "1TB SSD", "144Hz display"],
    "priceValueScore": 9,
    "redFlags": [],
    "summary": "Strong mid-high tier gaming laptop, well-priced for its specs..."
  }
}
```

Note how the analyzer flags the suspicious **"RTX 4090 i9 64GB — GIÁ SỐC"**
listing (score 1/10) for an implausible price and 3 reviews with a perfect
rating — exactly the kind of red flag a buyer should catch.
