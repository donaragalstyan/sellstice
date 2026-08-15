import { z } from "zod";

export const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  name: z.string().trim().min(1).max(100).optional(),
});

export const goalSchema = z.object({
  targetAmount: z.coerce
    .number({ message: "Enter a target amount" })
    .positive("Enter an amount greater than $0")
    .max(10_000_000, "That amount looks too large"),
  deadline: z.coerce.date({ message: "Enter a valid date" }).refine(
    (date) => date.getTime() > Date.now(),
    "Deadline must be in the future",
  ),
});

export const ITEM_CONDITIONS = [
  "NEW_WITH_TAGS",
  "NEW_WITHOUT_TAGS",
  "LIKE_NEW",
  "GOOD",
  "FAIR",
] as const;

export const itemSchema = z.object({
  brand: z.string().trim().max(100).optional(),
  color: z.string().trim().max(100).optional(),
  category: z.string().trim().max(100).optional(),
  size: z.string().trim().max(50).optional(),
  condition: z.enum(ITEM_CONDITIONS).optional(),
  notableDetails: z.string().trim().max(2000).optional(),
  acquisitionCost: z.coerce
    .number()
    .nonnegative("Enter a value of $0 or more")
    .max(1_000_000, "That amount looks too large")
    .optional(),
});

export const COMPARABLE_PRICE_TYPES = ["ASKING", "SOLD", "UNKNOWN"] as const;

export const manualComparableSchema = z.object({
  title: z.string().trim().min(1, "Enter a title").max(200),
  marketplace: z.string().trim().max(100).optional(),
  price: z.coerce
    .number()
    .nonnegative("Enter a value of $0 or more")
    .max(1_000_000, "That amount looks too large")
    .optional(),
  priceType: z.enum(COMPARABLE_PRICE_TYPES).default("UNKNOWN"),
  url: z.string().trim().max(2000).url("Enter a valid URL").optional().or(z.literal("")),
  condition: z.string().trim().max(100).optional(),
  recency: z.string().trim().max(100).optional(),
});
