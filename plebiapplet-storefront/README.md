# plebiapplet-storefront

A watch-only Plebeian Market storefront, built as a NIP-5D napplet. It discovers
kind-30402 product listings across relays, lets you search and filter them, shows
a full product detail view, and hands checkout to plebeian.market.

Implements [`../SPEC.md`](../SPEC.md).

## What it does

- **Browse** every listing the shell's outbox reaches, with live top-up and
  `until`-based pagination.
- **Search and filter** client-side: text, category chips, digital/physical,
  currency, in-stock-only, hide pre-order; sort by newest or price.
- **Product detail**: image carousel, price (with subscription frequency), stock
  and pre-order badges, merchant row, specs, shipping options, location,
  variations, collections, reviews, and a shareable `naddr`.
- **Merchant** and **collection** views, plus **favourites**.
- **Checkout handoff** — `link.open('https://plebeian.market/products/<id>')`.

No cart, no orders, no payments. Those are v2 candidates (SPEC §10).

## NAP boundaries

`outbox` is the only hard requirement. Every other domain is optional and has a
rendered fallback, so the napplet degrades instead of breaking:

| Domain | Absent → |
| --- | --- |
| `outbox` | **required** — the napplet explains it cannot read listings |
| `resource` | lettered placeholder tiles instead of product images |
| `storage` | favourites and preferences last for the session, and the UI says so |
| `common` | merchant shown as a truncated npub from the bundled bech32 encoder |
| `count` | review totals fall back to the reviews actually loaded |
| `link` | the checkout URL is rendered as a selectable field instead of a button |
| `theme` | bundled dark palette (`#111418` / `#e8eaed` / `#f7931a`) |
| `identity` | nothing — identity is cosmetic here |

The About view reports which of these the current shell provided.

What the napplet never does: `fetch`, `XMLHttpRequest`, `WebSocket`,
`localStorage`/`sessionStorage`/IndexedDB/cookies, `window.nostr`, external
`<script src>`/`<link href>`/`<img src>`, or any relay pool of its own. External
bytes go through `resource`, persistence through `storage`, all Nostr reads
through `outbox`, external navigation through `link`. There is **no NAP-RELAY
escape hatch** — every read in `src/market.ts` is expressible through outbox.

## Layout

Container-driven, no viewport assumptions (`#app` is the query container):

- **tiny** (≤360 px wide **or** ≤300 px tall): single-column list, 48 px
  thumbnails, search collapsed to an icon.
- **medium**: `repeat(auto-fill, minmax(180px, 1fr))` card grid, sticky toolbar.
- **large** (≥960 px): wider grid plus a master/detail split with the listing
  detail as a right-hand pane.

## Source map

```
src/
  main.ts      entry point, teardown wiring
  app.ts       view state machine and data orchestration
  views.ts     rendering for every view and state
  market.ts    the outbox read plan (SPEC §7.1) + buildProductUrl
  model.ts     gamma-spec parsers for 30402 / 30405 / 30406 / 31555
  filters.ts   client-side search, filter, sort
  nap.ts       optional-domain gates and guarded NAP wrappers
  images.ts    lazy resource-backed images (4 concurrent, revoked on teardown)
  markdown.ts  minimal DOM-building markdown renderer (no innerHTML)
  merchant.ts  kind-0 lookup with a bundled-npub fallback
  nip19.ts     bundled bech32 npub/naddr encoding
  store.ts     favourites and preferences
  theme.ts     whole-surface theming with a dark fallback palette
  dom.ts       element builders
```

## Verify

```bash
pnpm install
pnpm verify              # type-check + single-file build
pnpm test:conformance    # build + NAP protocol conformance in real Chromium
```

Conformance loads `dist/index.html` into a `sandbox="allow-scripts"` iframe with
a reference shell and fails on boot errors, malformed envelopes, forbidden
browser-authority references, or a crash when no NAP domains are injected.

The three `manifest/*` checks report `SKIP` because `@napplet/conformance-cli`
0.2.15 never resolves a manifest event in directory mode. To inspect the manifest
directly, build with a key and read the sidecar:

```bash
VITE_DEV_PRIVKEY_HEX=<32-byte hex> pnpm build && cat dist/.nip5a-manifest.json
```

That should show kind `35129`, `["d","plebeian-storefront"]`, a `path` tag for
`/index.html`, an aggregate `x` tag, and exactly one `requires` tag: `outbox`.

## Deploy

Deployment is `napplet deploy` (nsite / NIP-5A) and needs a signing key, so it is
run by a maintainer, not by CI or an agent:

```bash
napplet init            # confirm d-tag, title, description in .napplet/config.json
napplet deploy --dry-run
napplet deploy
```

## Package scripts

```bash
pnpm dev                  # local Vite dev server (serves the artifact, not a runtime)
pnpm type-check           # TypeScript strict-mode check
pnpm build                # single-file production build
pnpm verify               # type-check + build
pnpm test:conformance     # headless conformance, CI exit code
pnpm test:conformance:ui  # live conformance runtime, re-runs on change
```

`pnpm dev`/`pnpm preview` only serve the artifact — they do not inject
`window.napplet`. A real runtime preview needs `napplet paja -- pnpm vite --host
127.0.0.1`.

## Authoring context

`docs/nip-5d.md`, `docs/boundaries.md`, `docs/design-patterns.md`,
`docs/package-surfaces.md`, `docs/new-nap-proposals.md`,
`docs/authoring-checklist.md`.
