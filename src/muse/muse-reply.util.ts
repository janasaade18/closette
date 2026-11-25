/** Human-readable closet label for agent + UI (never show raw ids). */
export function garmentLabel(item: Record<string, unknown>): string {
  const colors = item.colors as { primary?: string } | undefined;
  const color =
    typeof colors?.primary === 'string' && colors.primary.trim()
      ? colors.primary.trim()
      : '';
  const kindRaw =
    (typeof item.subcategory === 'string' && item.subcategory.trim()
      ? item.subcategory
      : typeof item.category === 'string'
        ? item.category
        : typeof item.name === 'string'
          ? item.name
          : 'piece') || 'piece';
  const kind = String(kindRaw).replace(/[_-]+/g, ' ').trim();
  const label = `${color} ${kind}`.trim().replace(/\s+/g, ' ');
  return label || 'closet piece';
}

const UUID_RE =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
const SHORT_HEX_ID_RE =
  /`?[0-9a-f]{8}(?:-[0-9a-f]{4}){0,3}(?:-[0-9a-f]{12})?`?/gi;
const BACKTICK_CODE_RE = /`([^`]{4,64})`/g;

/**
 * Strip technical ids from Muse chat copy. Prefer wardrobe labels when an id maps.
 */
export function sanitizeMuseReply(
  text: string,
  wardrobe: Record<string, unknown>[] = [],
): string {
  if (!text) return text;

  const byId = new Map<string, string>();
  for (const item of wardrobe) {
    const id = typeof item.id === 'string' ? item.id : '';
    if (!id) continue;
    const label = garmentLabel(item);
    byId.set(id.toLowerCase(), label);
    byId.set(id.slice(0, 8).toLowerCase(), label);
  }

  let out = text;

  out = out.replace(UUID_RE, (match) => {
    return byId.get(match.toLowerCase()) ?? '';
  });

  out = out.replace(BACKTICK_CODE_RE, (_full, inner: string) => {
    const key = String(inner).toLowerCase();
    if (byId.has(key) || byId.has(key.slice(0, 8))) {
      return byId.get(key) ?? byId.get(key.slice(0, 8)) ?? '';
    }
    if (/^[0-9a-f-]{8,36}$/i.test(inner)) return '';
    return inner;
  });

  // Parenthetical id leftovers: (da20213a-…) or (G1)
  out = out.replace(/\s*\(([0-9a-f-]{8,36}|G\d+)\)/gi, '');
  out = out.replace(SHORT_HEX_ID_RE, (match) => {
    const cleaned = match.replace(/`/g, '').toLowerCase();
    if (byId.has(cleaned) || byId.has(cleaned.slice(0, 8))) {
      return byId.get(cleaned) ?? byId.get(cleaned.slice(0, 8)) ?? '';
    }
    // Only strip if it looks like a bare id token, not a normal word
    if (/^[0-9a-f]{8}(-[0-9a-f]{4}){0,4}$/i.test(cleaned)) return '';
    return match;
  });

  return out
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ ?([,.;:])/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function mergeMemoryFacts(
  existing: string[] | undefined,
  incoming: string[],
  limit = 40,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const fact of [...(existing ?? []), ...incoming]) {
    const cleaned = fact.replace(/\s+/g, ' ').trim();
    if (cleaned.length < 3) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned.slice(0, 240));
  }
  return out.slice(-limit);
}
