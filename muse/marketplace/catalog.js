import fs from "node:fs";
import path from "node:path";
import { museRoot } from "../config.js";
import { normalizeMarketplaceProduct } from "./normalize.js";

export class MemoryMarketplaceCatalog {
  constructor(products = []) {
    this.products = products.map((row) => normalizeMarketplaceProduct(row));
  }

  list() {
    return this.products;
  }
}

export function loadMarketplaceCatalog(filePath) {
  if (!filePath) return null;
  const absolute = path.isAbsolute(filePath) ? filePath : path.join(museRoot(), filePath);
  if (!fs.existsSync(absolute)) {
    throw new Error(`Marketplace catalog not found: ${absolute}`);
  }
  const text = fs.readFileSync(absolute, "utf8").trim();
  if (!text) return new MemoryMarketplaceCatalog([]);
  if (absolute.endsWith(".jsonl")) {
    const rows = text.split("\n").filter(Boolean).map((line) => JSON.parse(line));
    return new MemoryMarketplaceCatalog(rows);
  }
  const parsed = JSON.parse(text);
  const rows = Array.isArray(parsed) ? parsed : parsed.products ?? [];
  return new MemoryMarketplaceCatalog(rows);
}

export function defaultMarketplaceFixturePath() {
  return path.join(museRoot(), "marketplace", "fixtures", "demo_catalog.json");
}
