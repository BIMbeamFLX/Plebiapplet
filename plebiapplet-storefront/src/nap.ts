/**
 * NAP domain access for the storefront.
 *
 * `outbox` is the only hard requirement (SPEC 5); every other domain is optional
 * and each wrapper here degrades to a documented fallback instead of throwing.
 * Availability comes from the runtime-injected `window.napplet` namespace — this
 * napplet performs no capability probe and no readiness handshake.
 */
import { common, count, link, outbox, resource, storage } from '@napplet/sdk';
import type {
  CommonProfileResult,
  NostrFilter,
  OutboxSubscription,
  RelayEventResult,
} from '@napplet/sdk';

declare global {
  interface Window {
    /** Runtime-injected NAP namespace; used only for optional-domain presence checks. */
    napplet?: Record<string, unknown>;
  }
}

/** Domains this napplet feature-detects. */
export type DomainName =
  | 'outbox'
  | 'storage'
  | 'resource'
  | 'common'
  | 'count'
  | 'link'
  | 'theme'
  | 'identity';

/** True when the runtime injected the named domain for this load. */
export function hasDomain(name: DomainName): boolean {
  return Boolean(window.napplet?.[name]);
}

/** Options accepted by outbox reads (SPEC 7.1 allows these fields only). */
export interface ReadOptions {
  authors?: string[];
  relays?: string[];
  limit?: number;
  timeoutMs?: number;
}

/** Outcome of a read: events plus a human-readable failure reason when it broke. */
export interface ReadResult {
  events: RelayEventResult[];
  incomplete: boolean;
  error?: string;
}

function reason(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : 'unknown error';
}

/** One-shot outbox read; never throws, reports failure as `error`. */
export async function queryEvents(
  filters: NostrFilter | NostrFilter[],
  options: ReadOptions = {},
): Promise<ReadResult> {
  if (!hasDomain('outbox')) {
    return { events: [], incomplete: true, error: 'outbox-unavailable' };
  }
  try {
    const result = await outbox.query(filters, options);
    return {
      events: result.events ?? [],
      incomplete: Boolean(result.incomplete),
      error: result.error,
    };
  } catch (error: unknown) {
    return { events: [], incomplete: true, error: reason(error) };
  }
}

/** Live outbox stream for the top of the browse feed; null when unavailable. */
export function subscribeEvents(
  filters: NostrFilter | NostrFilter[],
  options: ReadOptions,
  onEvent: (result: RelayEventResult) => void,
): OutboxSubscription | null {
  if (!hasDomain('outbox')) return null;
  try {
    const subscription = outbox.subscribe(filters, options);
    subscription.on('event', onEvent);
    return subscription;
  } catch {
    return null;
  }
}

/** Fetch a single event by id through outbox routing; null when it cannot be read. */
export async function getEvent(
  eventId: string,
  options: { author?: string; relays?: string[]; timeoutMs?: number } = {},
): Promise<RelayEventResult | null> {
  if (!hasDomain('outbox')) return null;
  try {
    const result = await outbox.getEvent(eventId, options);
    return result.result ?? null;
  } catch {
    return null;
  }
}

/** Count matching events via NAP-COUNT; null when the domain is absent or refuses. */
export async function countEvents(filter: NostrFilter): Promise<number | null> {
  if (!hasDomain('count')) return null;
  try {
    const result = await count.query(filter);
    return result.ok && typeof result.count === 'number' ? result.count : null;
  } catch {
    return null;
  }
}

/**
 * Resolve merchant metadata via NAP-COMMON; null when the domain is absent.
 * The full result is returned because the backing kind-0 event carries the
 * `payment_preference` tag the merchant row renders (SPEC 6.5).
 */
export async function loadProfile(pubkey: string): Promise<CommonProfileResult | null> {
  if (!hasDomain('common')) return null;
  try {
    const result = await common.getProfile(pubkey);
    return result.ok ? result : null;
  } catch {
    return null;
  }
}

/** Encode `npub`/`naddr` through NAP-COMMON; null when the domain is absent. */
export async function encodeNip19(
  input: { type: 'npub'; hex: string } | { type: 'naddr'; identifier: string; pubkey: string; kind: number },
): Promise<string | null> {
  if (!hasDomain('common')) return null;
  try {
    const result = await common.encodeNip19(input);
    return result.ok ? (result.value ?? null) : null;
  } catch {
    return null;
  }
}

/** Result of asking the shell to open an external URL. */
export type OpenOutcome = 'opened' | 'denied' | 'unavailable';

/** Hand an external URL to NAP-LINK (SPEC 7.5); never navigates on its own. */
export async function openExternal(url: string, label?: string): Promise<OpenOutcome> {
  if (!hasDomain('link')) return 'unavailable';
  try {
    const result = await link.open(url, label ? { label } : undefined);
    return result.status === 'opened' ? 'opened' : 'denied';
  } catch {
    return 'denied';
  }
}

/** Read a scoped storage key; null when storage is absent or the key is unset. */
export async function readStored(key: string): Promise<string | null> {
  if (!hasDomain('storage')) return null;
  try {
    return await storage.getItem(key);
  } catch {
    return null;
  }
}

/** Write a scoped storage key; false when storage is absent or over quota. */
export async function writeStored(key: string, value: string): Promise<boolean> {
  if (!hasDomain('storage')) return false;
  try {
    await storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Fetch external bytes through NAP-RESOURCE.
 *
 * `resource.bytes` is used rather than `bytesAsObjectURL` because SPEC 7.4
 * requires branching on the rejection `code`, which only the promise form
 * exposes; the object URL is created and revoked by {@link ../images.ts}.
 */
export async function fetchBytes(url: string, signal?: AbortSignal): Promise<Blob> {
  if (!hasDomain('resource')) throw new Error('resource-unavailable');
  return resource.bytes(url, signal ? { signal } : undefined);
}

/** Machine-readable `code` carried by a resource rejection, or `unknown`. */
export function resourceErrorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return 'unknown';
}
