import { Injectable, Logger, Optional } from "@nestjs/common";
import { createHash } from "node:crypto";

type Entry = { value: unknown; expiresAt: number; namespace: string };
export type CacheStats = { hits: number; misses: number; entries: number; hitRate: number };

export interface CacheAdapter {
  get<T>(namespace: string, key: string): T | undefined;
  set<T>(namespace: string, key: string, value: T, ttlMs: number): void;
  invalidate(namespace: string): void;
}

@Injectable()
export class ApplicationCache implements CacheAdapter {
  private readonly logger = new Logger(ApplicationCache.name);
  private readonly entries = new Map<string, Entry>();
  private hits = 0;
  private misses = 0;
  private readonly maxEntries: number;
  constructor(@Optional() maxEntries?: number) { this.maxEntries = maxEntries ?? 500; }

  private storageKey(namespace: string, key: string) { return `${namespace}:${key}`; }
  private keyHash(key: string) { return createHash("sha256").update(key).digest("hex").slice(0, 12); }
  private trace(namespace: string, key: string, hit: boolean, ttl: number, started: number) {
    this.logger.debug(`CacheTrace ${JSON.stringify({ namespace, hit, miss: !hit, keyHash: this.keyHash(key), ttl, latencyMs: Date.now() - started })}`);
  }
  get<T>(namespace: string, key: string): T | undefined {
    const started = Date.now();
    const storageKey = this.storageKey(namespace, key);
    const entry = this.entries.get(storageKey);
    if (!entry || entry.expiresAt <= Date.now()) {
      if (entry) this.entries.delete(storageKey);
      this.misses++;
      this.trace(namespace, key, false, 0, started);
      return undefined;
    }
    this.entries.delete(storageKey);
    this.entries.set(storageKey, entry);
    this.hits++;
    this.trace(namespace, key, true, entry.expiresAt - Date.now(), started);
    return entry.value as T;
  }
  set<T>(namespace: string, key: string, value: T, ttlMs: number) {
    const storageKey = this.storageKey(namespace, key);
    this.entries.delete(storageKey);
    this.entries.set(storageKey, { value, expiresAt: Date.now() + ttlMs, namespace });
    while (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value!);
  }
  async getOrLoad<T>(namespace: string, key: string, ttlMs: number, loader: () => Promise<T>) {
    const cached = this.get<T>(namespace, key);
    if (cached !== undefined) return cached;
    const value = await loader();
    this.set(namespace, key, value, ttlMs);
    return value;
  }
  invalidate(namespace: string) {
    for (const [key, entry] of this.entries) if (entry.namespace === namespace || entry.namespace.startsWith(`${namespace}:`)) this.entries.delete(key);
  }
  invalidateCustomerData() {
    for (const namespace of ["location-aliases", "property-search", "aggregation", "project-public", "developer-public", "project-media", "project-documents"]) this.invalidate(namespace);
  }
  stats(): CacheStats {
    const total = this.hits + this.misses;
    return { hits: this.hits, misses: this.misses, entries: this.entries.size, hitRate: total ? this.hits / total : 0 };
  }
}
