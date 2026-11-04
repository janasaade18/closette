export function garment(fields) {
  return { ...fields };
}

export function piece(role, id, extra = {}) {
  const defaults = {
    top: { category: "tops", subcategory: "t-shirt" },
    bottom: { category: "bottoms", subcategory: "jeans" },
    shoes: { category: "footwear", subcategory: "sneakers" },
    dress: { category: "one-piece", subcategory: "dress" },
    coat: { category: "outerwear", subcategory: "coat" },
    blazer: { category: "outerwear", subcategory: "blazer" },
    jacket: { category: "outerwear", subcategory: "jacket" },
    bag: { category: "accessories", subcategory: "bag" },
  };
  return {
    formality: "casual",
    colors: { primary: "navy" },
    ...defaults[role],
    ...extra,
    id,
  };
}

export function request(wardrobe, extra = {}) {
  return {
    user_id: "user-1",
    occasion: "casual",
    wardrobe,
    ...extra,
  };
}
