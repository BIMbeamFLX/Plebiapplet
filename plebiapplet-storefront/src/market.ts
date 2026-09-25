/**
 * The storefront's read plan.
 *
 * Every query in SPEC 7.1 lives here, expressed through NAP-OUTBOX only — no
 * relay escape hatch, no app-owned relay routing. Relay hints are seed
 * candidates handed to the shell, which owns the final relay policy.
 */
import type { NostrFilter, OutboxSubscription, RelayEventResult } from '@napplet/sdk';
import {
  countEvents,
  queryEvents,
  subscribeEvents,
  type ReadOptions,
  type ReadResult,
} from './nap';
import {
  KIND_COLLECTION,
  KIND_PRODUCT,
  KIND_REVIEW,
  KIND_SHIPPING,
  dedupeAddressable,
  parseCollection,
  parseProduct,
  parseReview,
  parseShippingOption,
  reviewTarget,
  splitAddress,
  type Collection,
  type Product,
  type Review,
  type ShippingOption,
} from './model';

/** Seed relay candidates for the market; the shell decides what it actually uses. */
export const PM_RELAY_HINTS = [
  'wss://relay.plebeian.market',
  'wss://nos.lol',
  'wss://relay.damus.io',
  'wss://relay.nostr.net',
  'wss://nostr.mom',
  'wss://sendit.nosflare.com',
  'wss://relay.minibits.cash',
];

const BROWSE_TIMEOUT_MS = 5000;
const BROWSE_PAGE_SIZE = 60;
const NEXT_PAGE_SIZE = 40;

function browseOptions(limit: number): ReadOptions {
  return { relays: PM_RELAY_HINTS, limit, timeoutMs: BROWSE_TIMEOUT_MS };
}

/** A page of listings plus the failure reason when the read did not complete. */
export interface ProductPage {
  products: Product[];
  error?: string;
  incomplete: boolean;
}

/** Parse, drop unparseable/hidden listings, and keep the newest revision of each. */
export function toProducts(events: RelayEventResult[]): Product[] {
  const parsed = events
    .map((result) => parseProduct(result.event))
    .filter((product): product is Product => product !== null)
    .filter((product) => product.visibility !== 'hidden');
  return dedupeAddressable(parsed);
}

function toPage(result: ReadResult): ProductPage {
  return { products: toProducts(result.events), error: result.error, incomplete: result.incomplete };
}

/** First browse page: newest listings across the whole market. */
export async function loadBrowsePage(): Promise<ProductPage> {
  const filter: NostrFilter = { kinds: [KIND_PRODUCT], limit: BROWSE_PAGE_SIZE };
  return toPage(await queryEvents(filter, browseOptions(BROWSE_PAGE_SIZE)));
}

/** Next browse page, anchored on the oldest listing already held. */
export async function loadMorePage(oldestCreatedAt: number): Promise<ProductPage> {
  const filter: NostrFilter = {
    kinds: [KIND_PRODUCT],
    limit: NEXT_PAGE_SIZE,
    until: oldestCreatedAt,
  };
  return toPage(await queryEvents(filter, browseOptions(NEXT_PAGE_SIZE)));
}

/** Listings carrying a category tag. */
export async function loadCategory(category: string): Promise<ProductPage> {
  const filter: NostrFilter = {
    kinds: [KIND_PRODUCT],
    '#t': [category],
    limit: BROWSE_PAGE_SIZE,
  };
  return toPage(await queryEvents(filter, browseOptions(BROWSE_PAGE_SIZE)));
}

/** Everything a single merchant sells. */
export async function loadMerchantProducts(pubkey: string): Promise<ProductPage> {
  const filter: NostrFilter = { kinds: [KIND_PRODUCT], authors: [pubkey], limit: 100 };
  return toPage(
    await queryEvents(filter, {
      authors: [pubkey],
      relays: PM_RELAY_HINTS,
      limit: 100,
      timeoutMs: BROWSE_TIMEOUT_MS,
    }),
  );
}

/** Variations of a `variable` parent listing. */
export async function loadVariations(parent: Product): Promise<Product[]> {
  const filter: NostrFilter = { kinds: [KIND_PRODUCT], '#a': [parent.address] };
  const result = await queryEvents(filter, {
    authors: [parent.pubkey],
    relays: PM_RELAY_HINTS,
    timeoutMs: BROWSE_TIMEOUT_MS,
  });
  return toProducts(result.events).filter((product) => product.address !== parent.address);
}

/** Resolve one addressable listing by `30402:<pubkey>:<d>`. */
export async function loadProductByAddress(address: string): Promise<Product | null> {
  const parts = splitAddress(address);
  if (!parts || parts.kind !== KIND_PRODUCT) return null;
  const filter: NostrFilter = {
    kinds: [KIND_PRODUCT],
    authors: [parts.pubkey],
    '#d': [parts.identifier],
  };
  const result = await queryEvents(filter, {
    authors: [parts.pubkey],
    relays: PM_RELAY_HINTS,
    timeoutMs: BROWSE_TIMEOUT_MS,
  });
  return toProducts(result.events)[0] ?? null;
}

/** Resolve one addressable collection by `30405:<pubkey>:<d>`. */
export async function loadCollection(address: string): Promise<Collection | null> {
  const parts = splitAddress(address);
  if (!parts || parts.kind !== KIND_COLLECTION) return null;
  const filter: NostrFilter = {
    kinds: [KIND_COLLECTION],
    authors: [parts.pubkey],
    '#d': [parts.identifier],
  };
  const result = await queryEvents(filter, {
    authors: [parts.pubkey],
    relays: PM_RELAY_HINTS,
    timeoutMs: BROWSE_TIMEOUT_MS,
  });
  const collections = dedupeAddressable(
    result.events
      .map((entry) => parseCollection(entry.event))
      .filter((collection): collection is Collection => collection !== null),
  );
  return collections[0] ?? null;
}

/** Resolve the listings referenced by a collection. */
export async function loadCollectionProducts(collection: Collection): Promise<Product[]> {
  const resolved = await Promise.all(collection.productRefs.map(loadProductByAddress));
  return resolved.filter((product): product is Product => product !== null);
}

/** Resolve the shipping options a listing references, batched per merchant. */
export async function loadShippingOptions(product: Product): Promise<ShippingOption[]> {
  const perAuthor = new Map<string, string[]>();
  for (const ref of product.shippingRefs) {
    const parts = splitAddress(ref.address);
    if (!parts || parts.kind !== KIND_SHIPPING) continue;
    const identifiers = perAuthor.get(parts.pubkey) ?? [];
    identifiers.push(parts.identifier);
    perAuthor.set(parts.pubkey, identifiers);
  }

  const batches = await Promise.all(
    [...perAuthor.entries()].map(async ([pubkey, identifiers]) => {
      const filter: NostrFilter = {
        kinds: [KIND_SHIPPING],
        authors: [pubkey],
        '#d': identifiers,
      };
      const result = await queryEvents(filter, {
        authors: [pubkey],
        relays: PM_RELAY_HINTS,
        timeoutMs: BROWSE_TIMEOUT_MS,
      });
      return result.events;
    }),
  );

  return dedupeAddressable(
    batches
      .flat()
      .map((entry) => parseShippingOption(entry.event))
      .filter((option): option is ShippingOption => option !== null),
  );
}

/** Reviews addressed to a listing, newest first. */
export async function loadReviews(product: Product): Promise<Review[]> {
  const filter: NostrFilter = { kinds: [KIND_REVIEW], '#d': [reviewTarget(product)] };
  const result = await queryEvents(filter, {
    relays: PM_RELAY_HINTS,
    timeoutMs: BROWSE_TIMEOUT_MS,
  });
  return result.events
    .map((entry) => parseReview(entry.event))
    .filter((review): review is Review => review !== null)
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** Review count via NAP-COUNT; null hides the counter rather than guessing. */
export async function countReviews(product: Product): Promise<number | null> {
  return countEvents({ kinds: [KIND_REVIEW], '#d': [reviewTarget(product)] });
}

/** Live top-of-feed stream for the browse view; null when outbox is absent. */
export function subscribeToListings(
  onProduct: (product: Product) => void,
): OutboxSubscription | null {
  const filter: NostrFilter = { kinds: [KIND_PRODUCT], limit: BROWSE_PAGE_SIZE };
  return subscribeEvents(filter, browseOptions(BROWSE_PAGE_SIZE), (result) => {
    const product = parseProduct(result.event);
    if (product && product.visibility !== 'hidden') onProduct(product);
  });
}

/**
 * Checkout URL on plebeian.market.
 *
 * Isolated here per SPEC 11 so a route change on the market is a one-line fix.
 * The `/products/$productId` route accepts a raw event id; the d-tag form would
 * additionally need the seller pubkey.
 */
export function buildProductUrl(product: Product): string {
  return `https://plebeian.market/products/${product.id}`;
}
