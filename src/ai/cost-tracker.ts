/**
 * Cost + observability tracker for Anthropic API usage.
 *
 * Accumulates token usage across a session and reports total cost, average
 * cost per request, and cache-hit rate. This is the "💰 Prompt Caching saves
 * 90%" evidence that shows up in the README.
 */

import { logger } from "../utils/logger.js";

/** USD price per 1M tokens for a model. */
export interface ModelPricing {
  inputPerM: number;
  outputPerM: number;
  /** Writing to cache costs 1.25× base input. */
  cacheWritePerM: number;
  /** Reading from cache costs ~0.1× base input. */
  cacheReadPerM: number;
}

/** Known pricing (USD / 1M tokens). Extend as models are added. */
export const PRICING: Record<string, ModelPricing> = {
  // Standard Sonnet tier rates (input/output 3/15, cache write 1.25×, read 0.1×).
  "claude-sonnet-4-6": {
    inputPerM: 3,
    outputPerM: 15,
    cacheWritePerM: 3.75,
    cacheReadPerM: 0.3,
  },
};

const DEFAULT_PRICING: ModelPricing = PRICING["claude-sonnet-4-6"]!;

/** The token usage shape we read from an Anthropic message response. */
export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

export interface CostSummary {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  totalCostUsd: number;
  avgCostPerRequestUsd: number;
  /** Share of input tokens served from cache (0–1). */
  cacheHitRate: number;
}

export class CostTracker {
  private requests = 0;
  private inputTokens = 0;
  private outputTokens = 0;
  private cacheWriteTokens = 0;
  private cacheReadTokens = 0;
  private totalCostUsd = 0;

  constructor(private readonly pricing: ModelPricing = DEFAULT_PRICING) {}

  /** Record one API call's usage and return its computed cost in USD. */
  record(usage: TokenUsage): number {
    const cacheWrite = usage.cache_creation_input_tokens ?? 0;
    const cacheRead = usage.cache_read_input_tokens ?? 0;

    const cost =
      (usage.input_tokens * this.pricing.inputPerM +
        usage.output_tokens * this.pricing.outputPerM +
        cacheWrite * this.pricing.cacheWritePerM +
        cacheRead * this.pricing.cacheReadPerM) /
      1_000_000;

    this.requests += 1;
    this.inputTokens += usage.input_tokens;
    this.outputTokens += usage.output_tokens;
    this.cacheWriteTokens += cacheWrite;
    this.cacheReadTokens += cacheRead;
    this.totalCostUsd += cost;

    logger.debug(
      {
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
        cacheWrite,
        cacheRead,
        costUsd: Number(cost.toFixed(6)),
      },
      "api call recorded",
    );
    return cost;
  }

  summary(): CostSummary {
    const totalInput =
      this.inputTokens + this.cacheWriteTokens + this.cacheReadTokens;
    return {
      requests: this.requests,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      cacheWriteTokens: this.cacheWriteTokens,
      cacheReadTokens: this.cacheReadTokens,
      totalCostUsd: Number(this.totalCostUsd.toFixed(6)),
      avgCostPerRequestUsd:
        this.requests === 0
          ? 0
          : Number((this.totalCostUsd / this.requests).toFixed(6)),
      cacheHitRate:
        totalInput === 0
          ? 0
          : Number((this.cacheReadTokens / totalInput).toFixed(4)),
    };
  }

  /** Log a human-readable end-of-session report. */
  report(): void {
    const s = this.summary();
    logger.info(
      {
        requests: s.requests,
        totalCostUsd: s.totalCostUsd,
        avgCostPerRequestUsd: s.avgCostPerRequestUsd,
        cacheHitRate: `${(s.cacheHitRate * 100).toFixed(1)}%`,
      },
      "💰 session cost summary",
    );
  }
}
