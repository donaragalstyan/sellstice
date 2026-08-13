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
