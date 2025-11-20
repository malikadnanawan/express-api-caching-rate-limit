export interface CacheStats {
  hits: number;
  misses: number;
  size: number;
}

interface CacheEntry<V> {
  value: V;
  expiresAt: number;
}

export class LRUCache<K, V> {
  private maxSize: number;
  private ttlMs: number;
  private map: Map<K, CacheEntry<V>>;
  private _hits = 0;
  private _misses = 0;

  constructor(options: { maxSize: number; ttlMs: number }) {
    this.maxSize = options.maxSize;
    this.ttlMs = options.ttlMs;
    this.map = new Map<K, CacheEntry<V>>();
  }

  get(key: K): V | undefined {
    const entry = this.map.get(key);
    const now = Date.now();

    if (!entry) {
      this._misses++;
      return undefined;
    }

    if (entry.expiresAt <= now) {
      // stale
      this.map.delete(key);
      this._misses++;
      return undefined;
    }

    // LRU: move to the end
    this.map.delete(key);
    this.map.set(key, entry);
    this._hits++;
    return entry.value;
  }

  set(key: K, value: V): void {
    const now = Date.now();
    const expiresAt = now + this.ttlMs;

    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.maxSize) {
      // evict least recently used
      const oldestKey = this.map.keys().next().value;
      if (oldestKey !== undefined) {
        this.map.delete(oldestKey);
      }
    }

    this.map.set(key, { value, expiresAt });
  }

  has(key: K): boolean {
    const entry = this.map.get(key);
    if (!entry) return false;

    const now = Date.now();
    if (entry.expiresAt <= now) {
      this.map.delete(key);
      return false;
    }
    return true;
  }

  clear(): void {
    this.map.clear();
    this._hits = 0;
    this._misses = 0;
  }

  purgeStale(): void {
    const now = Date.now();
    for (const [key, entry] of this.map.entries()) {
      if (entry.expiresAt <= now) {
        this.map.delete(key);
      }
    }
  }

  get stats(): CacheStats {
    return {
      hits: this._hits,
      misses: this._misses,
      size: this.map.size
    };
  }
}
