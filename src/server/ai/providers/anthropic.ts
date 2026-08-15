import type { ZodType } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { AIProvider, ImageInput } from "../provider";
import { AIProviderError } from "../provider";

const DEFAULT_MAX_TOKENS = 2048;

export class AnthropicProvider implements AIProvider {
  private client: Anthropic;
  private readonly maxTokens: number;

  // Model (and, if needed, output length) is supplied by the caller rather
  // than hardcoded here — different capabilities (routine extraction vs. a
  // harder task that warrants a stronger model or more output room) can each
  // instantiate this class with their own choice, without touching the
  // provider mechanism itself.
  constructor(
    private readonly model: string,
    maxTokens: number = DEFAULT_MAX_TOKENS,
  ) {
    this.maxTokens = maxTokens;
    // The SDK retries 429/5xx/connection errors twice by default, which
    // silently multiplies API spend on a failing request. A failed analysis
    // should surface immediately as one billed attempt — any retry should be
    // a deliberate, visible user action (clicking Analyze again), not
    // automatic background repetition.
    this.client = new Anthropic({ maxRetries: 0 });
  }

  async analyzeImages<T>({
    images,
    instructions,
    schema,
  }: {
    images: ImageInput[];
    instructions: string;
    schema: ZodType<T>;
  }): Promise<T> {
    let response;
    try {
      response = await this.client.messages.parse({
        model: this.model,
        max_tokens: this.maxTokens,
        // No `effort` here: it's only valid on models with adaptive-thinking
        // support (Opus/Sonnet/Fable tier) and 400s on others, including the
        // default claude-haiku-4-5 — since this provider is now instantiated
        // with an arbitrary configured model, the request has to stay valid
        // across all of them rather than assume one model family.
        output_config: {
          format: zodOutputFormat(schema),
        },
        messages: [
          {
            role: "user",
            content: [
              ...images.map((image) => ({
                type: "image" as const,
                source: {
                  type: "base64" as const,
                  media_type: image.mediaType,
                  data: image.base64,
                },
              })),
              { type: "text" as const, text: instructions },
            ],
          },
        ],
      });
    } catch (err) {
      throw new AIProviderError("The AI request failed.", err);
    }

    if (response.stop_reason === "refusal") {
      throw new AIProviderError("The model declined to analyze these photos.");
    }
    if (response.parsed_output === null) {
      throw new AIProviderError("The model's response didn't match the expected format.");
    }
    return response.parsed_output;
  }
}
