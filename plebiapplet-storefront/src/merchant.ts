/**
 * Merchant identity for the product and merchant views (SPEC 6.5).
 *
 * NAP-COMMON supplies the kind-0 profile and NIP-19 encoding when present. When
 * it is absent the merchant degrades to a truncated npub encoded by the bundled
 * bech32 code — the row is never blank and never broken.
 */
import { encodeNip19, loadProfile } from './nap';
import { encodeNpub, truncateId } from './nip19';

/** Everything the UI shows about a seller. */
export interface Merchant {
  pubkey: string;
  npub: string;
  name: string;
  picture?: string;
  nip05?: string;
  about?: string;
  acceptsLightning: boolean;
  resolved: boolean;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/** Resolve a merchant, degrading to a bundled-npub identity without `common`. */
export async function resolveMerchant(pubkey: string): Promise<Merchant> {
  const shellNpub = await encodeNip19({ type: 'npub', hex: pubkey });
  const npub = shellNpub ?? encodeNpub(pubkey) ?? pubkey;
  const result = await loadProfile(pubkey);
  const profile = result?.profile ?? null;

  const preference = result?.result?.event.tags.find(
    (tag) => tag[0] === 'payment_preference',
  )?.[1];
  const lud16 = readString(profile?.lud16);

  return {
    pubkey,
    npub,
    name:
      readString(profile?.displayName) ?? readString(profile?.name) ?? truncateId(npub),
    picture: readString(profile?.picture),
    nip05: readString(profile?.nip05),
    about: readString(profile?.about),
    acceptsLightning: preference === 'lud16' || Boolean(lud16),
    resolved: Boolean(profile),
  };
}
