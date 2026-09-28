# Package Surfaces

## Runtime Packages

If no package exposes the named interface or wire format you need, do not add a
new private message domain in this app. Read `docs/new-nap-proposals.md` and
propose protocol-level work in `https://github.com/napplet/naps` only when the
guardrails are met.

### `@napplet/shim`

The first-party `window.napplet` installer, consumed by **runtimes** — not by
napplets. A NIP-5D runtime injects the namespace before napplet code runs, so
this project does not depend on the shim at all.

### `@napplet/sdk`

Named helpers for napplet app code. This is the only `@napplet` runtime
dependency the storefront carries.

```ts
import { outbox, storage, identity, common, resource } from '@napplet/sdk';
```

Use this for most app code. It wraps `window.napplet` at call time and re-exports
types and constants for common NAPs.

### `@napplet/nap`

Domain-specific subpaths. Use these when you need granular imports.

```ts
import { relaySubscribe } from '@napplet/nap/relay/sdk';
import type { ResourceBytesMessage } from '@napplet/nap/resource/types';
```

Do not import from the `@napplet/nap` root. Import a domain subpath.

## Build Package

### `@napplet/vite-plugin`

Vite plugin for local development metadata and local manifest/hash workflow.

```ts
import { nip5aManifest } from '@napplet/vite-plugin';
```

With `@napplet/vite-plugin` 0.14 the plugin sets the page title and description
from its options, folds the config schema into the manifest, hashes every file
in `dist/` into the `path` and aggregate `x` tags, and writes
`dist/.nip5a-manifest.json` on every build (unsigned; `VITE_DEV_PRIVKEY_HEX`
additionally signs it). It no longer injects the `napplet-type` and
`napplet-requires` meta tags: the repo's own `transformIndexHtml` helper in
`vite.config.ts` stamps them from the same constants it hands `nip5aManifest`.

Production relay publishing is intentionally outside this boilerplate.
