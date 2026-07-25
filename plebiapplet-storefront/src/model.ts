/**
 * Plebeian Market ("gamma") data model and tolerant parsers.
 *
 * Parsing is deliberately forgiving: gamma tags are read first, pre-gamma NIP-99
 * fallbacks (`status`, `published_at`) are honoured, and any event that fails a
 * required-tag parse is dropped rather than rendered half-formed (SPEC 6, 11).
 */
import type { NostrEvent } from '@napplet/sdk';

/** Addressable product listing. */
export const KIND_PRODUCT = 30402;
/** Addressable product collection. */
export const KIND_COLLECTION = 30405;
/** Addressable shipping option. */
export const KIND_SHIPPING = 30406;
/** Addressable product review. */
export const KIND_REVIEW = 31555;

/** Product price as published in the `price` tag. */
export interface Price {
  amount: number;
  currency: string;
  frequency?: string;
}

/** One entry of the `image` tag, ordered by its optional sort value. */
export interface ProductImage {
  url: string;
  dimensions?: string;
  order: number;
}

/** A referenced shipping option plus the product-currency surcharge. */
export interface ShippingRef {
  address: string;
  extraCost?: number;
}

/** Parsed kind-30402 listing. */
export interface Product {
  id: string;
  pubkey: string;
  identifier: string;
  address: string;
  createdAt: number;
  publishedAt?: number;
  title: string;
  summary: string;
  content: string;
  price: Price;
  form: 'simple' | 'variable' | 'variation';
  medium: 'digital' | 'physical';
  visibility: 'hidden' | 'on-sale' | 'pre-order';
  stock: number | null;
  soldOut: boolean;
  images: ProductImage[];
  specs: [string, string][];
  weight?: string;
  dimensions?: string;
  location?: string;
  geohash?: string;
  categories: string[];
  collectionRefs: string[];
  parentRef?: string;
  shippingRefs: ShippingRef[];
}

/** Parsed kind-30405 collection. */
export interface Collection {
  id: string;
  pubkey: string;
  identifier: string;
  address: string;
  createdAt: number;
  title: string;
  summary?: string;
  image?: string;
  location?: string;
  productRefs: string[];
}

/** Parsed kind-30406 shipping option. */
export interface ShippingOption {
  pubkey: string;
  identifier: string;
  address: string;
  createdAt: number;
  title: string;
  baseCost: number;
  currency: string;
  countries: string[];
  regions: string[];
  service: string;
  carrier?: string;
  duration?: string;
}

/** Parsed kind-31555 review. */
export interface Review {
  id: string;
  pubkey: string;
  createdAt: number;
  target: string;
  thumb: number;
  categories: [string, number][];
  score: number;
  content: string;
}

/** Anything addressable enough to dedupe by `(kind, pubkey, d)`. */
interface Addressable {
  address: string;
  createdAt: number;
}

function tagsNamed(event: NostrEvent, name: string): string[][] {
  return event.tags.filter((tag) => tag[0] === name);
}

function tagValue(event: NostrEvent, name: string): string | undefined {
  const tag = event.tags.find((candidate) => candidate[0] === name);
  return tag?.[1]?.trim() ? tag[1].trim() : undefined;
}

function joinTag(event: NostrEvent, name: string): string | undefined {
  const tag = event.tags.find((candidate) => candidate[0] === name);
  if (!tag) return undefined;
  const value = tag.slice(1).filter(Boolean).join(' ').trim();
  return value || undefined;
}

function toNumber(value: string | undefined): number | null {
  if (value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parsePrice(event: NostrEvent): Price | null {
  const tag = event.tags.find((candidate) => candidate[0] === 'price');
  if (!tag) return null;
  const amount = toNumber(tag[1]);
  const currency = tag[2]?.trim();
  if (amount === null || !currency) return null;
  const frequency = tag[3]?.trim();
  return frequency ? { amount, currency, frequency } : { amount, currency };
}

function parseImages(event: NostrEvent): ProductImage[] {
  return tagsNamed(event, 'image')
    .map((tag, index) => {
      const url = tag[1]?.trim();
      if (!url) return null;
      const order = toNumber(tag[3]);
      const image: ProductImage = { url, order: order ?? index };
      if (tag[2]?.trim()) image.dimensions = tag[2].trim();
      return image;
    })
    .filter((image): image is ProductImage => image !== null)
    .sort((a, b) => a.order - b.order);
}

function parseShippingRefs(event: NostrEvent): ShippingRef[] {
  return tagsNamed(event, 'shipping_option')
    .map((tag) => {
      const address = tag[1]?.trim();
      if (!address) return null;
      const extraCost = toNumber(tag[2]);
      const ref: ShippingRef = { address };
      if (extraCost !== null) ref.extraCost = extraCost;
      return ref;
    })
    .filter((ref): ref is ShippingRef => ref !== null);
}

function firstLine(content: string): string {
  const line = content.split('\n').find((candidate) => candidate.trim().length > 0);
  return line ? line.trim().slice(0, 200) : '';
}

/** Parse a kind-30402 event, or null when a required gamma tag is missing. */
export function parseProduct(event: NostrEvent): Product | null {
  if (event.kind !== KIND_PRODUCT) return null;
  const identifier = tagValue(event, 'd');
  const title = tagValue(event, 'title');
  const price = parsePrice(event);
  if (!identifier || !title || !price) return null;

  const typeTag = event.tags.find((tag) => tag[0] === 'type');
  const form = typeTag?.[1] === 'variable' || typeTag?.[1] === 'variation' ? typeTag[1] : 'simple';
  const medium = typeTag?.[2] === 'physical' ? 'physical' : 'digital';

  const visibilityTag = tagValue(event, 'visibility');
  const visibility =
    visibilityTag === 'hidden' || visibilityTag === 'pre-order' ? visibilityTag : 'on-sale';

  const stock = toNumber(tagValue(event, 'stock'));
  const status = tagValue(event, 'status');
  const addressRefs = tagsNamed(event, 'a')
    .map((tag) => tag[1]?.trim())
    .filter((value): value is string => Boolean(value));

  return {
    id: event.id,
    pubkey: event.pubkey,
    identifier,
    address: `${KIND_PRODUCT}:${event.pubkey}:${identifier}`,
    createdAt: event.created_at,
    publishedAt: toNumber(tagValue(event, 'published_at')) ?? undefined,
    title,
    summary: tagValue(event, 'summary') ?? firstLine(event.content),
    content: event.content,
    price,
    form,
    medium,
    visibility,
    stock: stock === null ? null : Math.trunc(stock),
    soldOut: status === 'sold' || stock === 0,
    images: parseImages(event),
    specs: tagsNamed(event, 'spec')
      .filter((tag) => tag[1] && tag[2])
      .map((tag) => [tag[1], tag[2]] as [string, string]),
    weight: joinTag(event, 'weight'),
    dimensions: joinTag(event, 'dim'),
    location: tagValue(event, 'location'),
    geohash: tagValue(event, 'g'),
    categories: tagsNamed(event, 't')
      .map((tag) => tag[1]?.trim().toLowerCase())
      .filter((value): value is string => Boolean(value)),
    collectionRefs: addressRefs.filter((ref) => ref.startsWith(`${KIND_COLLECTION}:`)),
    parentRef: addressRefs.find((ref) => ref.startsWith(`${KIND_PRODUCT}:`)),
    shippingRefs: parseShippingRefs(event),
  };
}

/** Parse a kind-30405 collection, or null when `d`/`title` are missing. */
export function parseCollection(event: NostrEvent): Collection | null {
  if (event.kind !== KIND_COLLECTION) return null;
  const identifier = tagValue(event, 'd');
  const title = tagValue(event, 'title');
  if (!identifier || !title) return null;
  return {
    id: event.id,
    pubkey: event.pubkey,
    identifier,
    address: `${KIND_COLLECTION}:${event.pubkey}:${identifier}`,
    createdAt: event.created_at,
    title,
    summary: tagValue(event, 'summary'),
    image: tagValue(event, 'image'),
    location: tagValue(event, 'location'),
    productRefs: tagsNamed(event, 'a')
      .map((tag) => tag[1]?.trim())
      .filter((value): value is string => Boolean(value) && value.startsWith(`${KIND_PRODUCT}:`)),
  };
}

/** Parse a kind-30406 shipping option, or null when a required tag is missing. */
export function parseShippingOption(event: NostrEvent): ShippingOption | null {
  if (event.kind !== KIND_SHIPPING) return null;
  const identifier = tagValue(event, 'd');
  const title = tagValue(event, 'title');
  const priceTag = event.tags.find((tag) => tag[0] === 'price');
  const baseCost = toNumber(priceTag?.[1]);
  const currency = priceTag?.[2]?.trim();
  if (!identifier || !title || baseCost === null || !currency) return null;

  const durationTag = event.tags.find((tag) => tag[0] === 'duration');
  const duration =
    durationTag && durationTag[1] && durationTag[2] && durationTag[3]
      ? `${durationTag[1]}–${durationTag[2]}${durationTag[3]}`
      : undefined;

  return {
    pubkey: event.pubkey,
    identifier,
    address: `${KIND_SHIPPING}:${event.pubkey}:${identifier}`,
    createdAt: event.created_at,
    title,
    baseCost,
    currency,
    countries: tagsNamed(event, 'country').flatMap((tag) => tag.slice(1).filter(Boolean)),
    regions: tagsNamed(event, 'region').flatMap((tag) => tag.slice(1).filter(Boolean)),
    service: tagValue(event, 'service') ?? 'standard',
    carrier: tagValue(event, 'carrier'),
    duration,
  };
}

/**
 * Aggregate a review score as `thumb×0.5 + 0.5×(Σcategories/n)` (SPEC 6.4).
 * With no category ratings the thumb rating stands on its own.
 */
function aggregateScore(thumb: number, categories: [string, number][]): number {
  if (categories.length === 0) return thumb;
  const mean = categories.reduce((sum, [, value]) => sum + value, 0) / categories.length;
  return thumb * 0.5 + 0.5 * mean;
}

/** Parse a kind-31555 review, or null when the `thumb` rating is missing. */
export function parseReview(event: NostrEvent): Review | null {
  if (event.kind !== KIND_REVIEW) return null;
  const target = tagValue(event, 'd');
  if (!target) return null;

  let thumb: number | null = null;
  const categories: [string, number][] = [];
  for (const tag of tagsNamed(event, 'rating')) {
    const value = toNumber(tag[1]);
    const label = tag[2]?.trim();
    if (value === null || !label) continue;
    const clamped = Math.min(1, Math.max(0, value));
    if (label === 'thumb') thumb = clamped;
    else categories.push([label, clamped]);
  }
  if (thumb === null) return null;

  return {
    id: event.id,
    pubkey: event.pubkey,
    createdAt: event.created_at,
    target,
    thumb,
    categories,
    score: aggregateScore(thumb, categories),
    content: event.content,
  };
}

/** Review `d` value addressing a product (SPEC 6.4). */
export function reviewTarget(product: Pick<Product, 'address'>): string {
  return `a:${product.address}`;
}

/** Keep the newest revision of each addressable event (SPEC 7.1 dedup rule). */
export function dedupeAddressable<T extends Addressable>(items: T[]): T[] {
  const newest = new Map<string, T>();
  for (const item of items) {
    const existing = newest.get(item.address);
    if (!existing || item.createdAt > existing.createdAt) newest.set(item.address, item);
  }
  return [...newest.values()];
}

/** Split an addressable coordinate into its `kind:pubkey:d` parts. */
export function splitAddress(
  address: string,
): { kind: number; pubkey: string; identifier: string } | null {
  const separator = address.indexOf(':');
  const second = address.indexOf(':', separator + 1);
  if (separator < 0 || second < 0) return null;
  const kind = Number(address.slice(0, separator));
  const pubkey = address.slice(separator + 1, second);
  const identifier = address.slice(second + 1);
  if (!Number.isFinite(kind) || !pubkey) return null;
  return { kind, pubkey, identifier };
}

/** Format a price for display, with a frequency suffix for subscriptions. */
export function formatPrice(price: Price): string {
  const amount = Number.isInteger(price.amount)
    ? price.amount.toLocaleString('en-US')
    : price.amount.toLocaleString('en-US', { maximumFractionDigits: 8 });
  const base = `${amount} ${price.currency.toUpperCase()}`;
  return price.frequency ? `${base} / ${price.frequency}` : base;
}
