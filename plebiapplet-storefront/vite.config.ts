import { defineConfig, type Plugin } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { nip5aManifest } from '@napplet/vite-plugin';

// Build-local fallback for the deployment d-tag; `napplet init` metadata
// takes precedence at deploy time.
const NAPPLET_TYPE = 'plebeian-storefront';

// Every domain the napplet asks the shell for, optional ones included. A
// shell grants a napplet only the domains it declares (the Hangar: granted =
// declared AND served), so a domain missing here is never offered. At runtime
// OUTBOX is still the only hard requirement (SPEC 5): each other domain keeps
// its rendered fallback and the napplet degrades when a shell refuses it.
const REQUIRES = ['outbox', 'resource', 'link', 'storage', 'common', 'count', 'theme'];

/**
 * Stamp `napplet-type` and `napplet-requires` into the built `<head>`.
 * `@napplet/vite-plugin` 0.14 writes them only to the manifest sidecar, but
 * the Hangar's `check:napplets`, its napplet board and its publish form read
 * them from the artifact itself.
 */
function nappletMeta(): Plugin {
  return {
    name: 'napplet-meta',
    transformIndexHtml: () =>
      [
        { name: 'napplet-type', content: NAPPLET_TYPE },
        { name: 'napplet-requires', content: REQUIRES.join(',') },
      ].map((attrs) => ({ tag: 'meta', attrs, injectTo: 'head-prepend' as const })),
  };
}

export default defineConfig({
  build: {
    // Vite's modulepreload polyfill calls `fetch` to warm `<link rel=modulepreload>`
    // targets. A single-file napplet has no external chunks to preload, and any
    // `fetch` reference — even an unreachable one — is forbidden browser authority
    // inside the sandbox, so the polyfill is disabled outright.
    modulePreload: false,
  },
  plugins: [
    // Inline all JS/CSS into a single `index.html`. NIP-5D loads a napplet as a
    // single self-contained `/index.html` via `iframe.srcdoc` with
    // `sandbox="allow-scripts"` and no `allow-same-origin` (an opaque origin):
    // there is no served origin from which the shell could fetch an external
    // `<script src>`/`<link href>`, so the whole napplet must be one inlined
    // file. `vite-plugin-singlefile` produces that artifact; `nip5aManifest`
    // then content-addresses it for the NIP-5A manifest.
    viteSingleFile(),
    nappletMeta(),
    nip5aManifest({
      nappletType: NAPPLET_TYPE,
      title: 'Plebeian Market Storefront',
      description:
        'Watch-only storefront for Plebeian Market: browse kind-30402 listings, ' +
        'inspect a product, and hand checkout to plebeian.market.',
      requires: REQUIRES,
      artifactMode: 'single-file',
    }),
  ],
});
