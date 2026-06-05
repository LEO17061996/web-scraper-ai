/**
 * AI product analyzer (Anthropic Claude).
 *
 * Production patterns demonstrated here:
 *   - TOOL USE: `tool_choice` forces `extract_product_info` → typed JSON, no
 *     fragile text parsing.
 *   - PROMPT CACHING: the large system prompt is cached (ephemeral); batch calls
 *     reuse it at ~10% cost.
 *   - RESILIENCE: exponential backoff on 429/5xx (via withRetry) + a circuit
 *     breaker that aborts a batch after N consecutive failures.
 *   - VALIDATION: the tool result is parsed with Zod before it leaves this layer.
 *   - OBSERVABILITY: every call's tokens/cost/cache flow into CostTracker.
 */

import Anthropic from "@anthropic-ai/sdk";

import {
  ProductAnalysisSchema,
  type AnalyzedProduct,
  type ProductAnalysis,
  type RawProduct,
} from "../types.js";
import { logger } from "../utils/logger.js";
import { withRetry } from "../utils/retry.js";
import { CostTracker } from "./cost-tracker.js";
import { SYSTEM_PROMPT, EXTRACT_TOOL, buildUserPrompt } from "./prompts.js";

const DEFAULT_MODEL = "claude-sonnet-4-6";

export interface AnalyzerOptions {
  model?: string;
  maxTokens?: number;
  /** Retry attempts after the first try, per product. Default 3. */
  maxRetries?: number;
  /** Abort the batch after this many consecutive failures. Default 5. */
  circuitBreakerThreshold?: number;
  /** Inject a tracker (e.g. shared across the pipeline). */
  costTracker?: CostTracker;
}

/** HTTP statuses worth retrying. */
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 529]);

function isRetryable(error: unknown): boolean {
  return (
    error instanceof Anthropic.APIError &&
    typeof error.status === "number" &&
    RETRYABLE_STATUS.has(error.status)
  );
}

export class ProductAnalyzer {
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly maxTokens: number;
  private readonly maxRetries: number;
  private readonly breakerThreshold: number;
  readonly costTracker: CostTracker;

  constructor(options: AnalyzerOptions = {}) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        "ANTHROPIC_API_KEY is not set. Copy .env.example to .env and add your key.",
      );
    }
    this.client = new Anthropic({ apiKey });
    this.model = options.model ?? process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;
    this.maxTokens = options.maxTokens ?? 1024;
    this.maxRetries = options.maxRetries ?? 3;
    this.breakerThreshold = options.circuitBreakerThreshold ?? 5;
    this.costTracker = options.costTracker ?? new CostTracker();
  }

  /** Analyze a single product → validated ProductAnalysis. */
  async analyze(product: RawProduct): Promise<ProductAnalysis> {
    const log = logger.child({ title: product.title.slice(0, 40) });

    return withRetry(
      async () => {
        const startedAt = Date.now();
        const response = await this.client.messages.create({
          model: this.model,
          max_tokens: this.maxTokens,
          system: [
            {
              type: "text",
              text: SYSTEM_PROMPT,
              cache_control: { type: "ephemeral" },
            },
          ],
          tools: [EXTRACT_TOOL],
          tool_choice: { type: "tool", name: EXTRACT_TOOL.name },
          messages: [{ role: "user", content: buildUserPrompt(product) }],
        });

        const cost = this.costTracker.record(response.usage);
        log.debug(
          { latencyMs: Date.now() - startedAt, costUsd: Number(cost.toFixed(6)) },
          "analyzed product",
        );
        return this.parseToolResult(response);
      },
      {
        maxRetries: this.maxRetries,
        shouldRetry: isRetryable,
        onRetry: (err, attempt, delayMs) =>
          log.warn(
            { attempt, delayMs, status: (err as { status?: number }).status },
            "analyze failed — retrying",
          ),
      },
    );
  }

  /**
   * Analyze many products sequentially (so the cache warms after the first
   * call). A circuit breaker aborts the batch after too many consecutive
   * failures, instead of burning the whole list on a systemic outage.
   */
  async analyzeBatch(products: RawProduct[]): Promise<AnalyzedProduct[]> {
    const results: AnalyzedProduct[] = [];
    let consecutiveFailures = 0;

    for (const [i, product] of products.entries()) {
      try {
        const analysis = await this.analyze(product);
        results.push({ ...product, analysis });
        consecutiveFailures = 0;
      } catch (err) {
        consecutiveFailures += 1;
        logger.error(
          { index: i, title: product.title, err: errMessage(err), consecutiveFailures },
          "failed to analyze product",
        );
        if (consecutiveFailures >= this.breakerThreshold) {
          throw new Error(
            `Circuit breaker tripped: ${consecutiveFailures} consecutive analyze failures. Aborting batch.`,
          );
        }
      }
    }
    return results;
  }

  /** Pull the forced tool_use block out of the response and Zod-validate it. */
  private parseToolResult(response: Anthropic.Message): ProductAnalysis {
    const toolUse = response.content.find(
      (block): block is Anthropic.ToolUseBlock =>
        block.type === "tool_use" && block.name === EXTRACT_TOOL.name,
    );
    if (!toolUse) {
      throw new Error(
        `Expected a '${EXTRACT_TOOL.name}' tool_use block, got: ${response.content
          .map((b) => b.type)
          .join(", ")}`,
      );
    }
    return ProductAnalysisSchema.parse(toolUse.input);
  }
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
