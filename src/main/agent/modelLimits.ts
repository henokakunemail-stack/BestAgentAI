// Pure model limits and billing weights (no electron/SDK imports, so scripts/selfcheck.mts can test it).
export const DEFAULT_CONTEXT_WINDOW = 200_000
export const INITIAL_MAX_TOKENS = 16_000

const TABLE: Array<[RegExp, { contextWindow: number; maxOutput: number }]> = [
  [/opus-5|fable-5/i, { contextWindow: 200_000, maxOutput: 32_000 }],
  [/sonnet-5/i, { contextWindow: 200_000, maxOutput: 64_000 }],
  [/haiku-5/i, { contextWindow: 200_000, maxOutput: 32_000 }],
  [/gemini/i, { contextWindow: 1_000_000, maxOutput: 32_000 }],
  [/gpt-|(^|[^a-z])o\d/i, { contextWindow: 128_000, maxOutput: 16_000 }]
]

/**
 * Context window and output ceiling for a model id.
 * ponytail: a settings.contextWindow different from the stored default counts as the user's override; one number cannot say
 * "auto" vs "200000 on purpose". Upgrade path: explicit contextWindowAuto setting + toggle.
 */
export function limitsFor(model: string, settingsWindow?: number): { contextWindow: number; maxOutput: number } {
  const hit = TABLE.find(([re]) => re.test(model))?.[1] ?? { contextWindow: DEFAULT_CONTEXT_WINDOW, maxOutput: INITIAL_MAX_TOKENS }
  const overridden = typeof settingsWindow === 'number' && settingsWindow > 0 && settingsWindow !== DEFAULT_CONTEXT_WINDOW
  return { contextWindow: overridden ? settingsWindow : hit.contextWindow, maxOutput: hit.maxOutput }
}

/** First request asks for at most INITIAL_MAX_TOKENS; the max_tokens recovery path may raise it to the model ceiling. */
export const initialMaxTokens = (maxOutput: number): number => Math.min(maxOutput, INITIAL_MAX_TOKENS)

/** Tokens a goal budget should be charged: cache reads cost about a tenth, cache writes count in full. */
export const billableTokens = (u: { input: number; output: number; cacheRead: number; cacheWrite: number }): number =>
  u.input + u.output + u.cacheWrite + Math.round(u.cacheRead * 0.1)
