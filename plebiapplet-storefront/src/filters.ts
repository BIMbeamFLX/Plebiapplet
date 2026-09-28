/**
 * Client-side search, filter, and sort (SPEC 7.2).
 *
 * All of this runs inside the napplet on events already returned by outbox — no
 * NAP call belongs here.
 */
import type { Product } from './model';

/** Sort orders offered in the browse toolbar. */
export type SortMode = 'newest' | 'price-asc' | 'price-desc';

/** The full browse filter state. */
export interface FilterState {
  search: string;
  category: string | null;
  medium: 'all' | 'digital' | 'physical';
  currency: string | null;
  inStockOnly: boolean;
  hidePreOrder: boolean;
  sort: SortMode;
}

/** Filter state for a fresh session. */
export const DEFAULT_FILTERS: FilterState = {
  search: '',
  category: null,
  medium: 'all',
  currency: null,
  inStockOnly: false,
  hidePreOrder: false,
  sort: 'newest',
};

function matchesSearch(product: Product, needle: string): boolean {
  if (!needle) return true;
  const haystack = [product.title, product.summary, product.content, ...product.categories]
    .join('\n')
    .toLowerCase();
  return haystack.includes(needle);
}

/**
 * Compare by price.
 *
 * Amounts are only comparable within one currency, so listings are grouped by
 * currency first and ordered numerically inside each group (SPEC 7.2).
 */
function comparePrice(a: Product, b: Product, direction: 1 | -1): number {
  const currencyOrder = a.price.currency.localeCompare(b.price.currency);
  if (currencyOrder !== 0) return currencyOrder;
  return (a.price.amount - b.price.amount) * direction;
}

/** Apply search, filters, and sort to a listing set. */
export function applyFilters(products: Product[], filters: FilterState): Product[] {
  const needle = filters.search.trim().toLowerCase();
  const visible = products.filter((product) => {
    if (product.form === 'variation') return false;
    if (!matchesSearch(product, needle)) return false;
    if (filters.category && !product.categories.includes(filters.category)) return false;
    if (filters.medium !== 'all' && product.medium !== filters.medium) return false;
    if (filters.currency && product.price.currency.toUpperCase() !== filters.currency) return false;
    if (filters.inStockOnly && product.soldOut) return false;
    if (filters.hidePreOrder && product.visibility === 'pre-order') return false;
    return true;
  });

  const sorted = [...visible];
  if (filters.sort === 'price-asc') sorted.sort((a, b) => comparePrice(a, b, 1));
  else if (filters.sort === 'price-desc') sorted.sort((a, b) => comparePrice(a, b, -1));
  else sorted.sort((a, b) => b.createdAt - a.createdAt);
  return sorted;
}

/** Category chips with counts, most frequent first. */
export function collectCategories(products: Product[]): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const product of products) {
    if (product.form === 'variation') continue;
    for (const tag of product.categories) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/** Distinct currencies present in a listing set, alphabetically. */
export function collectCurrencies(products: Product[]): string[] {
  const currencies = new Set(products.map((product) => product.price.currency.toUpperCase()));
  return [...currencies].sort();
}

/** True when any filter deviates from the defaults. */
export function hasActiveFilters(filters: FilterState): boolean {
  return (
    filters.search.trim() !== '' ||
    filters.category !== null ||
    filters.medium !== 'all' ||
    filters.currency !== null ||
    filters.inStockOnly ||
    filters.hidePreOrder
  );
}
