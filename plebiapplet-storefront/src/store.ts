/**
 * Favourites and UI preferences (SPEC 7.3).
 *
 * Persistence is optional: with NAP-STORAGE the two keys below survive reloads,
 * without it the same state lives in memory for the session and the UI says so.
 * Only addresses are ever stored — never event bodies — to stay far under the
 * 512 KB quota.
 */
import { readStored, writeStored, hasDomain } from './nap';
import type { SortMode } from './filters';

const FAVORITES_KEY = 'favorites';
const PREFS_KEY = 'prefs';
const MAX_FAVORITES = 500;

/** Persisted browse preferences. */
export interface Prefs {
  sort: SortMode;
  medium: 'all' | 'digital' | 'physical';
  currency: string | null;
  inStockOnly: boolean;
  hidePreOrder: boolean;
  density: 'comfortable' | 'compact';
}

const DEFAULT_PREFS: Prefs = {
  sort: 'newest',
  medium: 'all',
  currency: null,
  inStockOnly: false,
  hidePreOrder: false,
  density: 'comfortable',
};

function parseFavorites(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => typeof entry === 'string');
  } catch {
    return [];
  }
}

function parsePrefs(raw: string | null): Prefs {
  if (!raw) return { ...DEFAULT_PREFS };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_PREFS };
    return { ...DEFAULT_PREFS, ...(parsed as Partial<Prefs>) };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

/** Session state that persists through NAP-STORAGE when the domain exists. */
export class Store {
  private favoriteAddresses: string[] = [];
  private preferences: Prefs = { ...DEFAULT_PREFS };

  /** True when writes actually survive a reload. */
  readonly persistent: boolean = hasDomain('storage');

  /** Load favourites and preferences; falls back to defaults without storage. */
  async load(): Promise<void> {
    if (!this.persistent) return;
    const [favorites, prefs] = await Promise.all([
      readStored(FAVORITES_KEY),
      readStored(PREFS_KEY),
    ]);
    this.favoriteAddresses = parseFavorites(favorites);
    this.preferences = parsePrefs(prefs);
  }

  /** Favourited product addresses, newest first. */
  get favorites(): string[] {
    return [...this.favoriteAddresses];
  }

  /** True when the address is favourited. */
  isFavorite(address: string): boolean {
    return this.favoriteAddresses.includes(address);
  }

  /** Toggle a favourite and persist; returns the new state. */
  async toggleFavorite(address: string): Promise<boolean> {
    const next = this.favoriteAddresses.filter((entry) => entry !== address);
    const added = next.length === this.favoriteAddresses.length;
    if (added) next.unshift(address);
    this.favoriteAddresses = next.slice(0, MAX_FAVORITES);
    if (this.persistent) {
      await writeStored(FAVORITES_KEY, JSON.stringify(this.favoriteAddresses));
    }
    return added;
  }

  /** Current browse preferences. */
  get prefs(): Prefs {
    return { ...this.preferences };
  }

  /** Merge and persist browse preferences. */
  async savePrefs(update: Partial<Prefs>): Promise<void> {
    this.preferences = { ...this.preferences, ...update };
    if (this.persistent) await writeStored(PREFS_KEY, JSON.stringify(this.preferences));
  }
}
