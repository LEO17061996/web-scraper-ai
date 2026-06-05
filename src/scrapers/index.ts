/**
 * Scraper registry — maps a Platform to its adapter (Service Adapter Pattern).
 *
 * The pipeline resolves scrapers through here, so it never imports a concrete
 * adapter directly. Registering a new platform = add one line.
 */

import type { Platform } from "../types.js";
import type { IScraper } from "./base.js";
import { ShopeeScraper } from "./shopee.js";

const REGISTRY: Record<Platform, () => IScraper> = {
  shopee: () => new ShopeeScraper(),
  amazon: () => {
    throw new Error("Amazon adapter is not implemented yet.");
  },
  ebay: () => {
    throw new Error("eBay adapter is not implemented yet.");
  },
};

/** Construct the scraper for `platform`. Throws if the adapter is missing. */
export function getScraper(platform: Platform): IScraper {
  return REGISTRY[platform]();
}
