// No shared singleton here: each capability instantiates AnthropicProvider
// with the model appropriate to its own cost/quality tradeoff (see
// item-analysis.ts for an example) rather than all sharing one default.
export { AnthropicProvider } from "./providers/anthropic";
export { AIProviderError } from "./provider";
export type { AIProvider, ImageInput } from "./provider";
