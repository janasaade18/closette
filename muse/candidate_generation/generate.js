import { ROLE_ORDER } from "../schemas/constants.js";
import { outfitIdFor } from "../ids.js";
import { itemPreScore } from "../ranking/affinity.js";
import { suggestsCoolLayer, tailoredOuterwear } from "./layers.js";

function byId(items) {
  return [...items].sort((a, b) => a.id.localeCompare(b.id));
}

function byPreScore(items, context, profile) {
  return [...items].sort((a, b) => {
    const diff = itemPreScore(b, context, profile) - itemPreScore(a, context, profile);
    if (diff !== 0) return diff;
    return a.id.localeCompare(b.id);
  });
}

function groupByRole(items) {
  const groups = {
    top: [],
    bottom: [],
    one_piece: [],
    footwear: [],
    outerwear: [],
    accessory: [],
  };
  for (const item of items) {
    if (groups[item.role]) groups[item.role].push(item);
  }
  for (const role of Object.keys(groups)) groups[role] = byId(groups[role]);
  return groups;
}

export function makeOutfit(roleMap) {
  const items = [];
  const roles = {};
  for (const role of ROLE_ORDER) {
    if (!roleMap[role]) continue;
    roles[role] = roleMap[role].id;
    items.push(roleMap[role]);
  }
  const itemIds = items.map((item) => item.id);
  if (new Set(itemIds).size !== itemIds.length) return null;
  const coreRoles = roleMap.one_piece ? ["one_piece", "footwear"] : ["top", "bottom", "footwear"];
  return {
    outfitId: outfitIdFor(itemIds),
    items,
    roles,
    itemIds,
    coreIds: coreRoles.map((role) => roles[role]),
    structure: roleMap.one_piece ? "one-piece" : "separates",
  };
}

function beam(items, count, context, profile) {
  if (items.length <= count) return items;
  return byPreScore(items, context, profile).slice(0, count);
}

function baseOutfits(groups, config, context, profile) {
  const outfits = [];
  let tops = groups.top;
  let bottoms = groups.bottom;
  let shoes = groups.footwear;
  const separatesProduct = tops.length * bottoms.length * shoes.length;
  if (separatesProduct > config.maxCandidates) {
    tops = beam(tops, config.slotBeam, context, profile);
    bottoms = beam(bottoms, config.slotBeam, context, profile);
    shoes = beam(shoes, config.slotBeam, context, profile);
  }
  for (const top of tops) {
    for (const bottom of bottoms) {
      for (const shoe of shoes) {
        const outfit = makeOutfit({ top, bottom, footwear: shoe });
        if (outfit) outfits.push(outfit);
      }
    }
  }

  let pieces = groups.one_piece;
  let pieceShoes = groups.footwear;
  const pieceProduct = pieces.length * pieceShoes.length;
  if (pieceProduct > config.maxCandidates) {
    pieces = beam(pieces, config.slotBeam, context, profile);
    pieceShoes = beam(pieceShoes, config.slotBeam, context, profile);
  }
  for (const piece of pieces) {
    for (const shoe of pieceShoes) {
      const outfit = makeOutfit({ one_piece: piece, footwear: shoe });
      if (outfit) outfits.push(outfit);
    }
  }
  return outfits;
}

function outfitPreScore(outfit, context, profile) {
  return outfit.items.reduce((sum, item) => sum + itemPreScore(item, context, profile), 0);
}

function withRole(outfit, role, item) {
  const roleMap = {};
  for (const piece of outfit.items) roleMap[piece.role] = piece;
  roleMap[role] = item;
  return makeOutfit(roleMap);
}

/**
 * v1 structures: top + bottom + footwear, or one-piece + footwear.
 * Outerwear and one accessory are optional and capped.
 */
export function generateCandidates(items, context, profile, config) {
  const groups = groupByRole(items);
  let bases = baseOutfits(groups, config, context, profile);
  bases.sort((a, b) => {
    const diff = outfitPreScore(b, context, profile) - outfitPreScore(a, context, profile);
    if (diff !== 0) return diff;
    return a.outfitId.localeCompare(b.outfitId);
  });
  if (bases.length > config.maxCandidates) bases = bases.slice(0, config.maxCandidates);

  const cool = suggestsCoolLayer(context, config);
  const outers = groups.outerwear.filter((item) => cool || tailoredOuterwear(item, context));
  const outerPool = beam(outers, config.outerwearBeam, context, profile);
  const accessoryPool = beam(groups.accessory, config.accessoryBeam, context, profile);

  const seen = new Set();
  const candidates = [];
  const push = (outfit) => {
    if (!outfit || seen.has(outfit.outfitId)) return;
    if (candidates.length >= config.maxCandidates) return;
    seen.add(outfit.outfitId);
    candidates.push(outfit);
  };

  for (const base of bases) {
    if (candidates.length >= config.maxCandidates) break;
    const variants = [base];
    for (const coat of outerPool) {
      const layered = withRole(base, "outerwear", coat);
      if (layered) variants.push(layered);
    }
    const withAccessories = [];
    for (const variant of variants) {
      withAccessories.push(variant);
      for (const accessory of accessoryPool) {
        const dressed = withRole(variant, "accessory", accessory);
        if (dressed) withAccessories.push(dressed);
      }
    }
    for (const variant of withAccessories) push(variant);
  }
  return candidates;
}
