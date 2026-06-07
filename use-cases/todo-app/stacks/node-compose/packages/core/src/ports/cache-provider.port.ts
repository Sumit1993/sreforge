export interface ICacheProvider {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, data: T, ttlMs?: number): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
}
