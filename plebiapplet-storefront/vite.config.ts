import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { nip5aManifest } from '@napplet/vite-plugin';

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
    nip5aManifest({
      // Build-local fallback for the deployment d-tag; `napplet init` metadata
      // takes precedence at deploy time.
      nappletType: 'plebeian-storefront',
      title: 'Plebeian Market Storefront',
      description:
        'Watch-only storefront for Plebeian Market: browse kind-30402 listings, ' +
        'inspect a product, and hand checkout to plebeian.market.',
      // OUTBOX is the only hard requirement (SPEC 5). Every other domain the
      // napplet touches is optional and has a rendered fallback, so declaring it
      // here would refuse loads the napplet can serve perfectly well.
      requires: ['outbox'],
      artifactMode: 'single-file',
    }),
  ],
});
