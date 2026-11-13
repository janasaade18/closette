/**
 * Marketplace products are Muse garments plus commerce fields.
 * source is always "marketplace" so mixed outfits stay auditable.
 */
import { normalizeGarment } from "../schemas/garment.js";
import { normToken } from "../schemas/constants.js";

function readSizes(raw) {
  if (Array.isArray(raw.sizes)) {
    return raw.sizes.map((entry) => String(entry).trim()).filter(Boolean);
  }
  if (raw.size != null && String(raw.size).trim()) return [String(raw.size).trim()];
  return [];
}

export function normalizeMarketplaceProduct(raw) {
  const base = normalizeGarment(raw);
  const price = typeof raw.price === "number" && Number.isFinite(raw.price) ? raw.price : null;
  const availability = base.availability ?? normToken(raw.stock_status);
  const inStock =
    raw.in_stock === false || availability === "sold_out" || availability === "unavailable"
      ? false
      : true;
  return {
    ...base,
    source: "marketplace",
    name: typeof raw.name === "string" ? raw.name.trim() : null,
    brand: typeof raw.brand === "string" ? raw.brand.trim() : null,
    price,
    currency: typeof raw.currency === "string" ? raw.currency.trim().toUpperCase() : "USD",
    sizes: readSizes(raw),
    inStock,
    productId: base.id,
    imageUrl:
      typeof raw.image_url === "string"
        ? raw.image_url.trim()
        : typeof raw.imageUrl === "string"
          ? raw.imageUrl.trim()
          : null,
  };
}

export function isMarketplaceItem(item) {
  return item?.source === "marketplace";
}
