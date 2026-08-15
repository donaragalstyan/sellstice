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
