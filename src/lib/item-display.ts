export function getItemDisplayLabel(item: {
  brand?: string | null;
  color?: string | null;
  category?: string | null;
}): string {
  return [item.brand, item.color, item.category].filter(Boolean).join(" ") || "Untitled item";
}

export const ITEM_CONDITION_LABELS: Record<string, string> = {
  NEW_WITH_TAGS: "New with tags",
  NEW_WITHOUT_TAGS: "New without tags",
  LIKE_NEW: "Like new",
  GOOD: "Good",
  FAIR: "Fair",
};

export const ITEM_STATUS_LABELS: Record<string, string> = {
  INVENTORY: "In inventory",
  READY_TO_LIST: "Ready to list",
  LISTED: "Listed",
  SOLD: "Sold",
  ARCHIVED: "Archived",
};

export const MISSING_SHOT_LABELS: Record<string, string> = {
  BRAND_TAG: "Add a brand tag photo.",
  SIZE_TAG: "Add a size tag photo.",
  MATERIAL_TAG: "Add a material/care label photo.",
  BACK_VIEW: "Add a back view.",
  FLAW_CLOSEUP: "Add a close-up of the flaw.",
  MODELED_PHOTO: "Try a modeled photo.",
  FLAT_LAY: "Try a clean flat lay.",
};
