/**
 * AI Provider Pricing — current as of July 2026.
 *
 * All prices are per 1 MILLION tokens, in USD (what the provider charges).
 * We convert to INR at the rate below for display purposes.
 *
 * Sources:
 *   Gemini: https://ai.google.dev/pricing
 *   OpenAI: https://openai.com/api/pricing/
 *   Groq:   https://groq.com/pricing/
 *
 * When a provider changes prices, just update the number here — the cost
 * calculator will automatically use the new rate for all future calls.
 * Historical calls keep their original cost (stored in AiUsageLog.costInr).
 */

// 💰 AUDIT FIX A2: USD to INR exchange rate is now configurable via env var.
// Was hardcoded at 84.5 which drifts over time and makes cost tracking
// inaccurate. Now reads from USD_TO_INR env var with 84.5 as fallback.
// Update the env var in Vercel when the exchange rate changes significantly.
export const USD_TO_INR = parseFloat(process.env.USD_TO_INR || '84.5')

export interface ModelPricing {
  inputPer1M: number   // USD per 1 million input tokens
  outputPer1M: number  // USD per 1 million output tokens
}

export const AI_PRICING: Record<string, Record<string, ModelPricing>> = {
  gemini: {
    'gemini-3.5-flash': {
      inputPer1M: 0.30,   // $0.30/1M input
      outputPer1M: 2.50,  // $2.50/1M output
    },
    'gemini-2.5-flash': {
      inputPer1M: 0.30,   // $0.30/1M input
      outputPer1M: 2.50,  // $2.50/1M output
    },
    'gemini-2.5-flash-lite': {
      inputPer1M: 0.10,
      outputPer1M: 0.40,
    },
    'gemini-2.0-flash': {
      inputPer1M: 0.10,
      outputPer1M: 0.40,
    },
    'gemini-2.5-pro': {
      inputPer1M: 1.25,
      outputPer1M: 10.00,
    },
  },
  openai: {
    'gpt-4o-mini': {
      inputPer1M: 0.15,
      outputPer1M: 0.60,
    },
    'gpt-4o': {
      inputPer1M: 2.50,
      outputPer1M: 10.00,
    },
  },
  groq: {
    'meta-llama/llama-4-scout-17b-16e-instruct': {
      inputPer1M: 0.11,
      outputPer1M: 0.34,
    },
    'llama-3.3-70b-versatile': {
      inputPer1M: 0.59,
      outputPer1M: 0.79,
    },
  },
  // Legacy/fallback pricing when model name is unknown.
  // Stored as a "provider" with a single "_default" model so the type
  // structure stays consistent (Record<string, Record<string, ModelPricing>>).
  _default: {
    _default: {
      inputPer1M: 0.30,
      outputPer1M: 2.50,
    },
  },
}

/**
 * Calculates the cost of an AI call in INR.
 *
 * @param provider - 'gemini' | 'openai' | 'groq' | 'vlm' | 'zai-sdk'
 * @param model - the specific model name (e.g. 'gemini-2.5-flash')
 * @param inputTokens - number of input tokens used
 * @param outputTokens - number of output tokens used
 * @returns cost in INR (paisa precision)
 */
export function calculateCostInr(
  provider: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const providerPricing = AI_PRICING[provider] || AI_PRICING._default
  const pricing = providerPricing[model] || AI_PRICING._default._default

  const inputCostUsd = (inputTokens / 1_000_000) * pricing.inputPer1M
  const outputCostUsd = (outputTokens / 1_000_000) * pricing.outputPer1M
  const totalCostUsd = inputCostUsd + outputCostUsd

  return totalCostUsd * USD_TO_INR
}

/**
 * Formats a cost in INR for display.
 * Less than 1 rupee → shows in paise (e.g. "2.2 paise")
 * 1+ rupee → shows in rupees (e.g. "₹1.50")
 */
export function formatCostInr(costInr: number): string {
  if (costInr < 1) {
    return `${(costInr * 100).toFixed(2)} paise`
  }
  return `₹${costInr.toFixed(2)}`
}

/**
 * Returns the pricing info for a provider+model combo, for display.
 */
export function getPricingInfo(provider: string, model: string): ModelPricing {
  const providerPricing = AI_PRICING[provider] || AI_PRICING._default
  return providerPricing[model] || AI_PRICING._default._default
}
