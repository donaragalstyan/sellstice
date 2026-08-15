import type { ZodType } from "zod";

export interface ImageInput {
  base64: string;
  mediaType: "image/jpeg" | "image/png" | "image/webp";
}

/**
 * Every AI capability in the app goes through this interface rather than
 * calling a specific vendor SDK directly, so swapping or adding a provider
 * later doesn't touch call sites.
 */
export interface AIProvider {
  analyzeImages<T>(params: {
    images: ImageInput[];
    instructions: string;
    schema: ZodType<T>;
  }): Promise<T>;
}

export class AIProviderError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "AIProviderError";
  }
}
