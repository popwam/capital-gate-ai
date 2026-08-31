import { Inject, Injectable, Logger, Optional } from "@nestjs/common";

export type FxQuote = { rate: number; asOf: Date; source: string };
export interface FxRateProvider { getRate(from: string, to: string): Promise<FxQuote>; }
export const FX_RATE_PROVIDER = Symbol("FX_RATE_PROVIDER");

@Injectable()
export class HttpFxRateProvider implements FxRateProvider {
  async getRate(from: string, to: string): Promise<FxQuote> {
    const configured = process.env.FX_API_URL?.trim();
    if (!configured) throw Object.assign(new Error("FX provider is not configured"), { code: "FX_NOT_CONFIGURED" });
    const url = configured.includes("{from}") || configured.includes("{to}")
      ? configured.replaceAll("{from}", encodeURIComponent(from)).replaceAll("{to}", encodeURIComponent(to))
      : `${configured}${configured.includes("?") ? "&" : "?"}from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    const timeoutMs = Math.min(5_000, Math.max(500, Number(process.env.FX_TIMEOUT_MS ?? 2_000)));
    const response = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: process.env.FX_API_KEY ? { authorization: `Bearer ${process.env.FX_API_KEY}` } : undefined,
    });
    if (!response.ok) throw Object.assign(new Error("FX provider failed"), { code: "FX_PROVIDER_FAILED" });
    const payload = await response.json() as Record<string, unknown>;
    const rates = payload.rates && typeof payload.rates === "object"
      ? payload.rates as Record<string, unknown>
      : undefined;
    const rate = Number(payload.rate ?? rates?.[to]);
    const asOfValue = payload.asOf ?? payload.date ?? Date.now();
    const asOf = new Date(typeof asOfValue === "number" ? asOfValue : String(asOfValue));
    if (!Number.isFinite(rate) || rate <= 0 || Number.isNaN(asOf.getTime())) throw Object.assign(new Error("Invalid FX response"), { code: "FX_INVALID_RESPONSE" });
    return { rate, asOf, source: String(payload.source ?? new URL(url).hostname).slice(0, 120) };
  }
}

@Injectable()
export class FxRateService {
  private readonly logger = new Logger(FxRateService.name);
  private readonly cache = new Map<string, { quote: FxQuote; fetchedAt: number }>();
  constructor(
    @Optional() @Inject(FX_RATE_PROVIDER) private readonly provider?: FxRateProvider,
  ) {}

  async getRate(from: string, to = "EGP"): Promise<FxQuote> {
    const source = from.toUpperCase();
    const target = to.toUpperCase();
    if (source === target) return { rate: 1, asOf: new Date(), source: "IDENTITY" };
    const key = `${source}:${target}`;
    const now = Date.now();
    const ttlMs = Math.min(3_600_000, Math.max(60_000, Number(process.env.FX_CACHE_TTL_MS ?? 900_000)));
    const staleMs = Math.min(86_400_000, Math.max(ttlMs, Number(process.env.FX_STALE_MAX_MS ?? 21_600_000)));
    const cached = this.cache.get(key);
    if (cached && now - cached.fetchedAt <= ttlMs) return cached.quote;
    try {
      if (!this.provider) throw Object.assign(new Error("FX provider unavailable"), { code: "FX_NOT_CONFIGURED" });
      const quote = await this.provider.getRate(source, target);
      this.cache.set(key, { quote, fetchedAt: now });
      this.logger.log(`FxRate ${JSON.stringify({ from: source, to: target, source: quote.source, asOf: quote.asOf.toISOString(), cached: false })}`);
      return quote;
    } catch (error) {
      if (cached && now - cached.fetchedAt <= staleMs) {
        this.logger.warn(`FxRate ${JSON.stringify({ from: source, to: target, source: cached.quote.source, asOf: cached.quote.asOf.toISOString(), cached: true, stale: true })}`);
        return cached.quote;
      }
      throw Object.assign(new Error("Verified FX rate is unavailable"), { code: "FX_UNAVAILABLE", cause: error });
    }
  }

  async normalize(originalAmount: number, originalCurrency: string) {
    const currency = originalCurrency.toUpperCase();
    const quote = await this.getRate(currency, "EGP");
    return {
      originalAmount,
      originalCurrency: currency,
      normalizedAmount: Number((originalAmount * quote.rate).toFixed(2)),
      normalizedCurrency: "EGP" as const,
      fxRate: quote.rate,
      fxAsOf: quote.asOf.toISOString(),
      fxSource: quote.source,
      fxStatus: "VERIFIED" as const,
    };
  }
}
