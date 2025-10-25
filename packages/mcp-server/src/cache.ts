import Redis from 'ioredis';

export class QueryCache {
  private redis?: Redis;
  private mem = new Map<string, { v: any; exp: number }>();
  constructor(url?: string) {
    if (url) {
      try { this.redis = new Redis(url); } catch { this.redis = undefined; }
    }
  }
  async get(key: string): Promise<any | undefined> {
    if (this.redis) {
      const v = await this.redis.get(key);
      return v ? JSON.parse(v) : undefined;
    }
    const e = this.mem.get(key);
    if (!e) return undefined;
    if (Date.now() > e.exp) { this.mem.delete(key); return undefined; }
    return e.v;
  }
  async set(key: string, value: any, ttlSec: number) {
    if (this.redis) {
      await this.redis.set(key, JSON.stringify(value), 'EX', ttlSec);
      return;
    }
    this.mem.set(key, { v: value, exp: Date.now() + ttlSec * 1000 });
  }
}
