# Plebiapplet — Build Spec v1

**Napplet:** Plebeian Market Storefront (watch-only)
**Status:** Spec approved for build · no code yet
**Date:** 2026-07-25
**Protocol truth:** NIP-5D (nostr-protocol/nips PR #2303) · NAPs track (github.com/napplet/naps) · Plebeian Market "gamma" marketplace spec (`gamma_spec.md` in PlebeianApp/market)

---

## 1. Purpose (single-purpose job)

A sandboxed Nostr iframe app (napplet) that lets any user of a NIP-5D shell **browse the whole Plebeian Market**: discover kind-30402 product listings across relays, search and filter them, view product details (images, price, stock, shipping, merchant, reviews), and hand off to plebeian.market for checkout.

Watch-only per the gamma spec's "watch-only client" class: product rendering plus collection/review/shipping lookup. **No cart, no orders, no payments inside the napplet in v1** (see §10).

## 2. Locked decisions

| Decision | Value |
| --- | --- |
| Scope v1 | Storefront/browser, watch-only |
| Data source | Whole market: all kind-30402 listings reachable via shell outbox + relay hints |
| UI language | English |
| Checkout | Link-out to plebeian.market via `link` NAP |
| Deliverable now | This spec only; build is a separate step |

## 3. Sandbox authority contract (hard constraints)

The napplet is one self-contained `/index.html` loaded in `sandbox="allow-scripts"` (opaque origin, no `allow-same-origin`). Everything below is a build gate, not a guideline:

- No `fetch`, XHR, WebSocket, `localStorage`/`sessionStorage`/IndexedDB/cookies, `window.nostr`, relay pools, or signing in napplet code.
- No external `<script src>`, `<link href>`, `<img src=https://…>`, CSS `url(https://…)`, or dynamic `import("https://…")`. All JS/CSS inline; all build-time assets folded in (`artifactMode: 'single-file'`).
- Product images and any external bytes flow through `resource.bytes` / `resource.bytesAsObjectURL` only.
- Persistence flows through `storage` (512 KB quota, async).
- All Nostr reads flow through `outbox` (plus `common`/`count` where they own the intent). **No `relay` escape hatch in this napplet** — every read is expressible through outbox.
- External navigation flows through `link`.
- Implementation is SDK-first: named imports from `@napplet/sdk`; `window.napplet?.<domain>` only as post-injection optional-domain fallback checks. No `shell.ready()`, no capability probing, no hand-built envelope clients.

## 4. Build brief (make-napplet format)

```
deployment name / d-tag:   plebeian-storefront
CLI metadata initialized:  via `napplet create` + `napplet init` at build time
new build or port:         new build
boilerplate substrate:     @napplet/boilerplate via `napplet create` (Vite + TS + pnpm; preserve substrate)
single-purpose job:        browse + inspect Plebeian Market (30402) listings; checkout handoff
must-have user flows:      browse grid → search/filter → product detail → link-out to checkout
optional user flows:       merchant view, collection view, reviews, favorites, share (npub/naddr copy)
target shell assumptions:  outbox present (hard requirement); all other domains optional
known protocol/package gaps: no wallet/zap NAP; dm NAP not designed for kind-16/17 order flow (out of scope v1);
                             NAP-CONFIG manifest encoding not interoperable (no config schema in v1)
```

## 5. Canonical design spec (design-napplet format)

```
nappletType: plebeian-storefront
purpose: watch-only storefront for Plebeian Market (NIP-99/gamma kind-30402 listings)
NAPs used: outbox (req), storage (opt), resource (opt), common (opt), count (opt),
           link (opt), theme (opt); identity is only shown in the About pane,
           never asked for, so it is not in requires
requires: ['outbox', 'resource', 'link', 'storage', 'common', 'count', 'theme']
                                  # every domain the code asks the shell for;
                                  # outbox is the only hard requirement at runtime
optional domains and fallbacks:
  resource -> render bundled placeholder tile instead of product images
  storage  -> favorites + UI prefs disabled, in-memory only for the session
  common   -> merchant shown as truncated npub, no avatar/name; NIP-19 encode done with bundled code
  count    -> review counts hidden; reviews still listed when opened (via outbox)
  link     -> "Open on plebeian.market" button hidden; show copyable URL text instead
  theme    -> explicit local dark fallback palette incl. page background
  identity -> no personalization (identity is cosmetic only in this napplet)
SDK helpers: outbox.query, outbox.subscribe, common.getProfile, count.query,
             storage.getItem/setItem/keys, resource.bytesAsObjectURL, link (open), themeGet, themeOnChanged
config schema: none (v1)
layout: tiny = single-column compact list w/ thumbnail+title+price; large = responsive card grid + master/detail
theme: optional; map background/text onto :root/html/body/app root; primary/surface/border/muted tokens;
       subscribe themeOnChanged; local fallback palette with explicit dark background
data flow: read-only outbox queries for kinds 30402/30405/30406/31555 + kind 0 via common; no publishes
relay escape hatches: none
```

## 6. Data model (gamma spec) and parsing rules

### 6.1 Product — kind 30402 (addressable)

Content = markdown description. Address = `30402:<pubkey>:<d>`.

Required tags: `d`, `title`, `price` = `[amount, currency, frequency?]` (amount decimal string; currency ISO 4217 or `BTC`/`btc`; frequency ISO 8601 duration unit for subscriptions).

Optional tags the napplet MUST parse:

| Tag | Format | Render rule |
| --- | --- | --- |
| `type` | `[simple\|variable\|variation, digital\|physical]`, default `simple, digital` | Hide `variation` events from browse grid; on a `variable` parent's detail view, list its variations (query 30402 with `#a` = parent address) |
| `visibility` | `hidden\|on-sale\|pre-order`, default `on-sale` | Never render `hidden`; badge `pre-order` |
| `stock` | integer | Show; `0` → "sold out" badge, de-emphasize card |
| `summary` | string | Card subtitle; fall back to first line of content |
| `image` | `[url, "WxH"?, sort-order?]`, repeatable | Sort by order (ascending, arbitrary start); carousel on detail, first image on card; load via `resource` only |
| `spec` | `[key, value]`, repeatable | Key-value table on detail view |
| `weight` / `dim` | ISO 80000-1 units | Detail view, SI as-is |
| `location` / `g` | string / geohash | Detail view text; no map in v1 |
| `t` | category, repeatable | Category chips + client-side filter |
| `a` | `30405:<pk>:<d>` collection refs (repeatable) or single `30402:...` parent ref | Collection linkage / variation parent |
| `shipping_option` | `[30406\|30405:<pk>:<d>, extra-cost?]`, repeatable | Resolve referenced 30406 events; add extra-cost in product currency |

Also handle: NIP-99 `status` tag (`active`/`sold`) from pre-gamma listings — treat `sold` like stock 0; `published_at` for display date fallback.

### 6.2 Collection — kind 30405

`d`, `title`, repeatable `a` → `30402:...` product refs; optional `image`, `summary`, `location`, `g`, `shipping_option`. No cascading: products only inherit what they explicitly reference.

### 6.3 Shipping option — kind 30406

`d`, `title`, `price` = `[base_cost, currency]`, `country` (ISO 3166-1 alpha-2 array), `service` (`standard|express|overnight|pickup`); optional `carrier`, `region` (ISO 3166-2), `duration` = `[min, max, H|D|W]`. Render as read-only "ships to / from cost" info on the product detail view.

### 6.4 Review — kind 31555

`d` = `"a:30402:<merchant-pubkey>:<product-d>"`; required `["rating", score, "thumb"]` with score 0–1; optional category ratings (`value`, `quality`, `delivery`, `communication`, custom). Aggregate score = `thumb×0.5 + 0.5×(Σcategories/n)`. Render: percentage + thumb count + individual review texts (content).

### 6.5 Merchant — kind 0 via `common.getProfile`

Display name, picture (via `resource`), nip05, about. Parse `payment_preference` tag (`manual|ecash|lud16`) for display only ("accepts Lightning" badge) — no payment logic in v1.

## 7. NAP boundaries and query plan

### 7.1 Queries (all read-only, all via outbox)

| View | Filter | Options |
| --- | --- | --- |
| Browse (initial) | `[{ kinds: [30402], limit: 60 }]` | `relays: PM_RELAY_HINTS, timeoutMs: 5000` |
| Browse (live top-up) | same filter via `outbox.subscribe`; `sub.close()` on teardown | same |
| Pagination | `[{ kinds: [30402], limit: 40, until: <oldest created_at> }]` | same |
| Category | `[{ kinds: [30402], '#t': [tag], limit: 60 }]` | same |
| Merchant view | `[{ kinds: [30402], authors: [pk], limit: 100 }]` | `authors: [pk]` for outbox routing |
| Variations | `[{ kinds: [30402], '#a': ['30402:<pk>:<d>'] }]` | `authors: [pk]` |
| Collection | `outbox.getEvent` per `a` ref / `[{ kinds: [30405], authors: [pk] }]` | `author: pk` |
| Shipping | `[{ kinds: [30406], authors: [pk], '#d': [d] }]` (batch per merchant) | `authors: [pk]` |
| Reviews | `[{ kinds: [31555], '#d': ['a:30402:<pk>:<d>'] }]` | — |
| Review count | `count.query({ kinds: [31555], '#d': [...] })` when `window.napplet?.count` | — |

Relay hints (seed candidates handed to outbox; shell policy decides):
`wss://relay.plebeian.market` (primary market relay) plus the market's own public defaults `wss://nos.lol`, `wss://relay.damus.io`, `wss://relay.nostr.net`, `wss://nostr.mom`, `wss://sendit.nosflare.com`, `wss://relay.minibits.cash`.

Rules: addressable-event dedup by `(kind, pubkey, d)` keeping newest `created_at`; drop events failing required-tag parse; read events from `RelayEventResult.event`; allowed outbox option fields only (`authors`, `relays`, `limit`, `timeoutMs` — no `strategy`, no subscribe `live`).

### 7.2 Client-side processing (in-napplet, no NAP)

Search over title/summary/`t`/content (lowercased substring, later fuzzy); sort by newest / price asc / price desc (numeric compare only within same currency, otherwise group by currency); filters: category, physical/digital, currency, "in stock only", "hide pre-order".

### 7.3 Storage layout (optional domain)

| Key | Value |
| --- | --- |
| `favorites` | JSON array of `30402:<pk>:<d>` addresses |
| `prefs` | JSON: last sort, filters, view density |

Budget well under 512 KB; never store event bodies, only addresses.

### 7.4 Images via resource

`resource.bytesAsObjectURL(url)` per image; revoke handles on view teardown; branch on rejection `code` (`not-found`, `blocked-by-policy`, `timeout`, `too-large`, …) → placeholder tile with initial letter. Trust the shell's sniffed MIME, never the upstream one. Lazy-load: only fetch images for cards entering the viewport (IntersectionObserver), hard cap of concurrent fetches (4).

### 7.5 Checkout handoff via link

Button "Buy on plebeian.market" → `link` open of `https://plebeian.market/products/<event-id-hex>` (verified: the market's `/products/$productId` route accepts a raw event id; d-tag form needs seller pubkey, so event id is the robust choice). If `link` absent: render the URL as selectable text with a copy button (clipboard via `document.execCommand`-free path: `navigator.clipboard` is unavailable in opaque origin — show the text selected instead; flag if a clipboard NAP appears later).

## 8. UI / layout spec

Views (hash-free internal router, plain state machine): **Browse** (default) · **Product detail** · **Merchant** · **Collection** · **Favorites** · **About/empty states**.

Responsive strategy: container-driven, no viewport assumptions.

- **Tiny state** (< ~360 px wide or < ~300 px high): single-column compact list — 48 px thumbnail, title (1 line ellipsis), price; search collapses to icon; detail view becomes full-pane with back button.
- **Medium**: 2–3 column card grid (`repeat(auto-fill, minmax(180px, 1fr))`), sticky search/filter bar.
- **Large state**: 4+ column grid, master/detail split (detail as right pane ≥ 960 px), filter sidebar.
- No horizontal overflow at any size; interactive targets ≥ 40 px; test extremes explicitly.

States to design, not improvise: initial skeleton loading; empty result ("no listings match"); outbox timeout/error with retry button; image placeholder; signed-out (no difference — watch-only); shell without optional domains (features hidden, never broken).

Product detail contents in order: image carousel → title + price (+ frequency suffix for subscriptions) + badges (pre-order/sold out/digital/physical) → merchant row (avatar, name, "accepts ⚡" badge, link to merchant view) → buy/link-out button → summary → markdown description (bundled minimal renderer: headings, bold/italic, lists, links routed through `link`, images through `resource`; no raw HTML pass-through) → specs table → shipping info → location → reviews.

## 9. Theme

Optional NAP-THEME, whole-surface per skill contract: map `theme.colors.background`/`text` onto `:root`, `html`, `body`, app root; map primary/surface/border/muted tokens to CSS custom properties (`--pm-bg`, `--pm-fg`, `--pm-primary`, `--pm-surface`, `--pm-border`, `--pm-muted`); derive missing tokens in one local function; subscribe `themeOnChanged` and repaint everything. Fallback palette: explicit dark theme (bg `#111418`, fg `#e8eaed`, primary `#f7931a`) with explicit page background — never a browser-white canvas. Verify against a dark and a light runtime theme, including empty/loading/error states.

## 10. Non-goals in v1 (v2 candidates, in order)

1. **Cart + NIP-17 order flow** (gamma kinds 14/16/17 with `type` 1–4 order messages): blocked on verifying whether the `dm` NAP can carry kind-16/17 encrypted payloads; likely a NAP/package gap to flag upstream, not to fake.
2. **Zaps / in-napplet payment**: no wallet/zap NAP exists; do not simulate.
3. **Merchant tooling** (publish 30402 via `outbox.publish`): separate napplet, per single-purpose rule.
4. Currency conversion to sats (needs external rate bytes via `resource` + policy; display raw amounts in v1).
5. NSFW filtering beyond `visibility`, map view for `g` geohashes, NIP-89 recommended-app routing.

## 11. Risks and open flags

| Risk | Mitigation |
| --- | --- |
| Whole-market query volume on default relays | limit+until pagination, dedup, subscribe only for top-of-feed |
| Mixed pre-gamma NIP-99 listings (different tag usage) | tolerant parser: gamma first, NIP-99 `status`/`published_at` fallbacks, drop unparseable |
| `/products/<event-id>` URL shape changes on plebeian.market | isolate in one `buildProductUrl()`; re-verify at build time |
| Markdown/XSS via listing content | bundled renderer with allowlist, no innerHTML of raw content |
| Bundle size (single file) | no heavy deps; hand-rolled renderer + vanilla TS or preact-sized lib max |
| Shell relay hints ignored by policy | acceptable — outbox defaults still return listings; empty-state copy explains |

## 12. Project setup and verification plan (for the build step)

```bash
napplet create plebiapplet-storefront && cd plebiapplet-storefront
napplet init                      # d-tag: plebeian-storefront, title, description
# implement per this spec: src/main.ts, src/styles.css, index.html title, vite.config.ts requires: every domain the code asks for (§5)
pnpm install
pnpm verify                       # type-check + single-file build
pnpm test:conformance             # napplet-conformance ./dist
napplet paja -- pnpm vite --host 127.0.0.1   # runtime preview URL for the report
```

Completion checklist (from build/test skills): no forbidden browser authority in the artifact; `requires` lists every domain the code asks the shell for (`outbox` plus the optional ones, §5); every optional domain gated with fallback; theme applied whole-surface incl. fallback background; tiny + large layouts verified without overflow; conformance passing; Paja preview URL reported (or Paja explicitly reported unavailable — never a raw Vite URL). Deploy (nsite/NIP-5A via CLI, needs signing key) is a separate later step.

## 13. Sources

- napplet protocol + tooling: napplet.run · NIP-5D PR nostr-protocol/nips#2303 · github.com/napplet/naps · npm `@napplet/{sdk,core,vite-plugin,boilerplate,conformance,skills}`
- Plebeian Market: github.com/PlebeianApp/market (`gamma_spec.md`, `src/lib/constants.ts` relays, `/products/$productId` route) · plebeian.market · NIP-99 pivot announcement (plebeianmarket.substack.com, 2025-11-29)
- NIPs: NIP-99 (30402/30403) · NIP-15 (legacy) · NIP-17 (order DMs) · NIP-51 · NIP-89
