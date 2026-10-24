// Model context limits and list prices, loaded from config/models.default.json
// merged with the user's override file (see apps/server/src/usage/models.ts).

export interface Price {
  /** USD per million tokens. */
  input: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
  output: number;
}

export interface ModelInfo {
  contextLimit: number;
  /** False when the limit couldn't be confirmed against the official docs. */
  contextVerified: boolean;
  price?: Price;
  /** Higher prices for requests whose prompt exceeds `promptTokens` (e.g. Haiku 5.5). */
  priceOverThreshold?: Price & { promptTokens: number };
}

export interface ModelConfig {
  limitsSource?: string;
  limitsCheckedAt?: string;
  pricesSource?: string;
  pricesAsOf?: string;
  defaultContextLimit: number;
  models: Record<string, ModelInfo>;
}

export interface ResolvedModel extends ModelInfo {
  /** The config key that matched, or undefined for an unknown model. */
  key?: string;
}

/** Looks a model id up, tolerating suffixes such as "[1m]" or a date. */
export function resolveModel(config: ModelConfig, model: string | undefined): ResolvedModel {
  if (model) {
    const candidates = [model, model.replace(/\[.*\]$/, ""), model.replace(/-\d{8}$/, "")];
    for (const c of candidates) {
      const info = config.models[c];
      if (info) return { ...info, key: c };
    }
  }
  return { contextLimit: config.defaultContextLimit, contextVerified: false };
}

/** Merges a user override over the defaults, per model and per field. */
export function mergeModelConfig(base: ModelConfig, override: Partial<ModelConfig> | undefined): ModelConfig {
  if (!override) return base;
  const models: Record<string, ModelInfo> = { ...base.models };
  for (const [id, info] of Object.entries(override.models ?? {})) {
    const prev = models[id];
    models[id] = {
      ...(prev ?? { contextLimit: base.defaultContextLimit, contextVerified: false }),
      ...info,
      ...(prev?.price || info.price ? { price: { ...prev?.price, ...info.price } as Price } : {}),
    };
  }
  return { ...base, ...override, models };
}

export interface TokenCounts {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
}

export const ZERO_TOKENS: TokenCounts = { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 };

export function addTokens(a: TokenCounts, b: TokenCounts): TokenCounts {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite5m: a.cacheWrite5m + b.cacheWrite5m,
    cacheWrite1h: a.cacheWrite1h + b.cacheWrite1h,
  };
}

/** Prompt size of one request: everything the model read. */
export function promptTokens(t: TokenCounts): number {
  return t.input + t.cacheRead + t.cacheWrite5m + t.cacheWrite1h;
}

/**
 * Estimated list-price cost in USD of one request. Threshold pricing (Haiku
 * 5.5) is decided per request, so call this per message, not on totals.
 */
export function messageCost(model: ResolvedModel, t: TokenCounts): number | undefined {
  const over = model.priceOverThreshold;
  const p = over && promptTokens(t) > over.promptTokens ? over : model.price;
  if (!p) return undefined;
  return (
    (t.input * p.input +
      t.cacheWrite5m * p.cacheWrite5m +
      t.cacheWrite1h * p.cacheWrite1h +
      t.cacheRead * p.cacheRead +
      t.output * p.output) /
    1_000_000
  );
}

/** 1234 → "1.2K", 1_234_567 → "1.2M". */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, "")}K`;
  return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 2 : 1).replace(/\.?0+$/, "")}M`;
}
