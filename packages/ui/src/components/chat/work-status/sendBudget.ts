import { DEFAULT_CONTEXT_LIMIT } from './contextUsage'

// Text-length heuristic (chars/4), not a real tokenizer
export function estimatePromptTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

export type SendBudgetResult =
  | { allowed: true; resolvedLimit: number; estimatedTokens: number }
  | { allowed: false; reason: 'over-budget'; resolvedLimit: number; estimatedTokens: number }

export function evaluateSendBudget(input: {
  estimatedTokens: number
  contextLimit: number
}): SendBudgetResult {
  const resolvedLimit = input.contextLimit > 0 ? input.contextLimit : DEFAULT_CONTEXT_LIMIT
  // Non-finite estimates (NaN, ±Infinity) fail safe by blocking instead of allowing
  if (!Number.isFinite(input.estimatedTokens)) {
    return { allowed: false, reason: 'over-budget', resolvedLimit, estimatedTokens: input.estimatedTokens }
  }
  if (input.estimatedTokens > resolvedLimit) {
    return { allowed: false, reason: 'over-budget', resolvedLimit, estimatedTokens: input.estimatedTokens }
  }
  return { allowed: true, resolvedLimit, estimatedTokens: input.estimatedTokens }
}
