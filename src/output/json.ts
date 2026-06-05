/**
 * JSON output sink.
 *
 * Persists analyzed products to a pretty-printed JSON file, creating parent
 * directories as needed.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { AnalyzedProduct } from "../types.js";
import { logger } from "../utils/logger.js";

/** Write `products` to `filePath` as indented JSON. Returns the path written. */
export async function saveToJson(
  products: AnalyzedProduct[],
  filePath: string,
): Promise<string> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(products, null, 2), "utf8");
  logger.info({ filePath, count: products.length }, "saved JSON output");
  return filePath;
}
