# Plebiapplet

[![conformance](https://github.com/BIMbeamFLX/Plebiapplet/actions/workflows/conformance.yml/badge.svg)](https://github.com/BIMbeamFLX/Plebiapplet/actions/workflows/conformance.yml)

A watch-only [Plebeian Market](https://plebeian.market) storefront, built as a
**napplet** — a sandboxed Nostr iframe app under [NIP-5D](https://github.com/nostr-protocol/nips/pull/2303).

It discovers kind-30402 product listings across relays, lets you search and filter
them, renders a full product detail view, and hands checkout to plebeian.market.
Any NIP-5D shell can load it.

## What a napplet is

One self-contained `/index.html` that the shell loads into an
`iframe sandbox="allow-scripts"` with **no** `allow-same-origin`. That means an
opaque origin and no ambient browser authority: the app cannot `fetch`, cannot
open a WebSocket, cannot touch `localStorage`, and never holds a key. Everything
privileged is proxied to the host shell over postMessage through named
capabilities called NAPs.

So this storefront browses a whole Nostr marketplace without owning a single relay
connection. The shell does the routing; the napplet asks.

## What it does

- **Browse** every listing the shell's outbox reaches, with live top-up and
  `until`-based pagination.
- **Search and filter** client-side — text, category, digital/physical, currency,
  in-stock-only, hide pre-order — and sort by newest or price.
- **Product detail** — image carousel, price with subscription frequency, stock and
  pre-order badges, merchant row, specs, shipping options, location, variations,
  collections, reviews, shareable `naddr`.
- **Merchant**, **collection** and **favourites** views.
- **Checkout handoff** to plebeian.market.

Watch-only by design: **no cart, no orders, no payments** inside the napplet. Those
are v2 candidates, blocked on protocol gaps rather than effort — see
[SPEC.md §10](SPEC.md).

## Layout

```
SPEC.md                   the approved v1 build spec
DEPLOY.md                 Linux deployment runbook (key registration, publish)
plebiapplet-storefront/   the napplet itself — see its README for depth
skills/                   napplet design/build/test authoring skills
.github/workflows/        conformance CI
```

## Quick start

```bash
git clone https://github.com/BIMbeamFLX/Plebiapplet.git
cd Plebiapplet/plebiapplet-storefront
pnpm install
```

```bash
pnpm verify && pnpm test:conformance
```

`verify` type-checks and produces the single-file artifact; `test:conformance`
loads that artifact into a real sandboxed iframe driven by a reference shell and
fails on boot errors, malformed envelopes, forbidden browser-authority references,
or a crash when no NAP domains are injected. It must print `RESULT: CONFORMANT`.

Deploying is a separate, key-signed step: see [DEPLOY.md](DEPLOY.md).

## Shell requirements

`outbox` is the **only** hard requirement. Every other domain is optional and has a
rendered fallback, so a thinner shell costs a feature, never the app:

| Domain | Absent → |
| --- | --- |
| `outbox` | **required** — the napplet explains it cannot read listings |
| `resource` | lettered placeholder tiles instead of product images |
| `storage` | favourites and preferences last the session, and the UI says so |
| `common` | merchant shown as a truncated npub from bundled bech32 |
| `count` | review totals fall back to the reviews actually loaded |
| `link` | checkout URL rendered as a selectable field instead of a button |
| `theme` | bundled dark palette |
| `identity` | nothing — identity is cosmetic here |

The napplet's About view reports which of these the current shell provided.

## Status

v1 is built and conformance-passing. Not yet deployed — publishing needs the
signing key and is a maintainer step.

## Contributing

`main` is always stable. Work in `feature/*` or `fix/*` branches, use
[Conventional Commits](https://www.conventionalcommits.org/), and open a PR
explaining **why**, not just what. If you add behaviour, add coverage.

Before changing anything protocol-facing, read
[`plebiapplet-storefront/docs/boundaries.md`](plebiapplet-storefront/docs/boundaries.md)
— the sandbox authority contract is a build gate, not a style preference.

## License

MIT — see [`plebiapplet-storefront/LICENSE`](plebiapplet-storefront/LICENSE).
