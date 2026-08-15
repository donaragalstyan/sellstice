const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export function formatCents(cents: number): string {
  return currencyFormatter.format(cents / 100);
}

export function formatConfidence(confidence: number | null): string | null {
  if (confidence == null) return null;
  const clamped = Math.min(1, Math.max(0, confidence));
  return `${Math.round(clamped * 100)}% confidence`;
}
