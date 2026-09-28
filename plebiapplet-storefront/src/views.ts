/**
 * Rendering for every storefront view (SPEC 8).
 *
 * Views are pure: they take a model plus an action set and produce DOM. All
 * loading, empty, error and missing-domain states are designed here rather than
 * improvised at call sites.
 */
import { button, el, replace } from './dom';
import type { ImageLoader } from './images';
import { renderMarkdown } from './markdown';
import type { Merchant } from './merchant';
import {
  formatPrice,
  type Collection,
  type Product,
  type Review,
  type ShippingOption,
} from './model';
import type { FilterState, SortMode } from './filters';

/** Everything a view can ask the app to do. */
export interface Actions {
  openBrowse: () => void;
  openFavorites: () => void;
  openAbout: () => void;
  openProduct: (address: string) => void;
  openMerchant: (pubkey: string) => void;
  openCollection: (address: string) => void;
  closeDetail: () => void;
  setFilters: (patch: Partial<FilterState>) => void;
  toggleFilterPanel: () => void;
  loadMore: () => void;
  retry: () => void;
  toggleFavorite: (address: string) => void;
  openExternal: (url: string) => void;
}

/** Shared per-render dependencies. */
export interface ViewDeps {
  actions: Actions;
  images: ImageLoader;
}

/* ── the 480x320 Totem panel: page, never scroll ─────────────────────────── */
const PANEL = typeof window !== 'undefined' && window.matchMedia('(max-height: 400px)').matches;
const PANEL_CARDS = 2;
let panelListPage = 0;
let panelDetailPage = 0;
let panelDetailFor = '';

function panelPager(
  page: number,
  pages: number,
  go: (next: number) => void,
): HTMLElement {
  const back = button('‹', 'pager-step', () => go(Math.max(0, page - 1)));
  (back as HTMLButtonElement).disabled = page === 0;
  const forward = button('›', 'pager-step', () => go(Math.min(pages - 1, page + 1)));
  (forward as HTMLButtonElement).disabled = page >= pages - 1;
  return el('nav', { class: 'panel-pager' }, [
    back,
    el('span', { class: 'pager-count', text: `${page + 1} / ${pages}` }),
    forward,
  ]);
}

/** Model for the primary (list) pane. */
export interface ListModel {
  heading: string;
  subheading?: string;
  status: 'loading' | 'ready' | 'error';
  error?: string;
  products: Product[];
  filters: FilterState;
  categories: { tag: string; count: number }[];
  currencies: string[];
  canLoadMore: boolean;
  busy: boolean;
  showFilters: boolean;
  emptyMessage: string;
  merchant?: Merchant;
  collection?: Collection;
  activeAddress?: string;
  favorites: Set<string>;
  persistentFavorites: boolean;
}

/** Model for the detail pane. */
export interface DetailModel {
  status: 'loading' | 'ready' | 'error';
  error?: string;
  product?: Product;
  merchant?: Merchant;
  variations: Product[];
  shipping: ShippingOption[];
  reviews: Review[];
  reviewCount: number | null;
  favorite: boolean;
  checkoutUrl: string;
  linkAvailable: boolean;
  naddr?: string;
}

const SORT_LABELS: [SortMode, string][] = [
  ['newest', 'Newest'],
  ['price-asc', 'Price ↑'],
  ['price-desc', 'Price ↓'],
];

function badge(text: string, kind: string): HTMLElement {
  return el('span', { class: 'badge', text, dataset: { kind } });
}

function productBadges(product: Product): HTMLElement[] {
  const badges: HTMLElement[] = [];
  if (product.soldOut) badges.push(badge('Sold out', 'sold'));
  if (product.visibility === 'pre-order') badges.push(badge('Pre-order', 'preorder'));
  badges.push(badge(product.medium === 'physical' ? 'Physical' : 'Digital', product.medium));
  if (product.form === 'variable') badges.push(badge('Variants', 'variants'));
  return badges;
}

function favoriteButton(
  product: Product,
  favorite: boolean,
  deps: ViewDeps,
  persistent: boolean,
): HTMLButtonElement {
  const label = favorite ? 'Remove from favourites' : 'Add to favourites';
  const control = el('button', {
    class: 'icon-button favorite',
    type: 'button',
    text: favorite ? '★' : '☆',
    title: persistent ? label : `${label} (this session only — storage unavailable)`,
    attrs: { 'aria-label': label, 'aria-pressed': String(favorite) },
    on: {
      click: (event: Event) => {
        event.stopPropagation();
        deps.actions.toggleFavorite(product.address);
      },
    },
  });
  return control;
}

function productCard(
  product: Product,
  deps: ViewDeps,
  favorite: boolean,
  active: boolean,
  persistent: boolean,
): HTMLElement {
  const thumb = el('div', { class: 'thumb' });
  deps.images.mount(thumb, product.images[0]?.url, product.title);

  const card = el(
    'article',
    {
      class: 'card',
      dataset: { active: String(active), sold: String(product.soldOut) },
      attrs: { tabindex: '0', role: 'button' },
      on: {
        click: () => deps.actions.openProduct(product.address),
        keydown: (event: Event) => {
          const key = (event as KeyboardEvent).key;
          if (key === 'Enter' || key === ' ') {
            event.preventDefault();
            deps.actions.openProduct(product.address);
          }
        },
      },
    },
    [
      thumb,
      el('div', { class: 'card-body' }, [
        el('h3', { class: 'card-title', text: product.title, title: product.title }),
        el('p', { class: 'card-price', text: formatPrice(product.price) }),
        el('p', { class: 'card-summary', text: product.summary }),
        el('div', { class: 'badge-row' }, productBadges(product)),
      ]),
      favoriteButton(product, favorite, deps, persistent),
    ],
  );
  return card;
}

function skeletonGrid(): HTMLElement {
  const grid = el('div', { class: 'grid', attrs: { 'aria-hidden': 'true' } });
  for (let index = 0; index < 8; index += 1) {
    grid.append(
      el('div', { class: 'card skeleton' }, [
        el('div', { class: 'thumb' }),
        el('div', { class: 'card-body' }, [
          el('div', { class: 'skeleton-line' }),
          el('div', { class: 'skeleton-line short' }),
        ]),
      ]),
    );
  }
  return grid;
}

function notice(title: string, body: string, action?: { label: string; run: () => void }): HTMLElement {
  const children: (Node | string)[] = [
    el('h3', { class: 'notice-title', text: title }),
    el('p', { class: 'notice-body', text: body }),
  ];
  if (action) children.push(button(action.label, 'primary-button', action.run));
  return el('div', { class: 'notice' }, children);
}

function searchRow(model: ListModel, deps: ViewDeps): HTMLElement {
  const input = el('input', {
    class: 'search-input',
    type: 'search',
    attrs: {
      placeholder: 'Search listings',
      value: model.filters.search,
      'aria-label': 'Search listings',
    },
    on: {
      input: (event: Event) => {
        deps.actions.setFilters({ search: (event.target as HTMLInputElement).value });
      },
    },
  });
  // A label wrapper so the magnifier stays a tap target when the field collapses
  // to icon width in the tiny layout (SPEC 8).
  const field = el('label', { class: 'search-field' }, [
    el('span', { class: 'search-icon', text: '🔎', attrs: { 'aria-hidden': 'true' } }),
    input,
  ]);

  const sort = el('select', {
    class: 'sort-select',
    attrs: { 'aria-label': 'Sort listings' },
    on: {
      change: (event: Event) => {
        deps.actions.setFilters({ sort: (event.target as HTMLSelectElement).value as SortMode });
      },
    },
  });
  for (const [value, label] of SORT_LABELS) {
    const option = el('option', { text: label, attrs: { value } });
    if (model.filters.sort === value) option.selected = true;
    sort.append(option);
  }

  const toggle = el('button', {
    class: 'icon-button filter-toggle',
    type: 'button',
    text: '⚙',
    title: 'Filters',
    attrs: { 'aria-label': 'Toggle filters', 'aria-expanded': String(model.showFilters) },
    on: { click: () => deps.actions.toggleFilterPanel() },
  });

  return el('div', { class: 'search-row' }, [field, sort, toggle]);
}

function filterPanel(model: ListModel, deps: ViewDeps): HTMLElement {
  const panel = el('div', { class: 'filter-panel' });

  const chips = el('div', { class: 'chip-row' });
  chips.append(
    el('button', {
      class: 'chip',
      type: 'button',
      text: 'All categories',
      dataset: { on: String(model.filters.category === null) },
      on: { click: () => deps.actions.setFilters({ category: null }) },
    }),
  );
  for (const { tag, count } of model.categories.slice(0, 24)) {
    chips.append(
      el('button', {
        class: 'chip',
        type: 'button',
        text: `${tag} (${count})`,
        dataset: { on: String(model.filters.category === tag) },
        on: { click: () => deps.actions.setFilters({ category: tag }) },
      }),
    );
  }
  panel.append(chips);

  const mediumRow = el('div', { class: 'filter-row' });
  for (const value of ['all', 'digital', 'physical'] as const) {
    mediumRow.append(
      el('button', {
        class: 'chip',
        type: 'button',
        text: value === 'all' ? 'Any type' : value,
        dataset: { on: String(model.filters.medium === value) },
        on: { click: () => deps.actions.setFilters({ medium: value }) },
      }),
    );
  }
  panel.append(mediumRow);

  if (model.currencies.length > 1) {
    const currencyRow = el('div', { class: 'filter-row' });
    currencyRow.append(
      el('button', {
        class: 'chip',
        type: 'button',
        text: 'Any currency',
        dataset: { on: String(model.filters.currency === null) },
        on: { click: () => deps.actions.setFilters({ currency: null }) },
      }),
    );
    for (const currency of model.currencies) {
      currencyRow.append(
        el('button', {
          class: 'chip',
          type: 'button',
          text: currency,
          dataset: { on: String(model.filters.currency === currency) },
          on: { click: () => deps.actions.setFilters({ currency }) },
        }),
      );
    }
    panel.append(currencyRow);
  }

  const toggles = el('div', { class: 'filter-row' }, [
    el('button', {
      class: 'chip',
      type: 'button',
      text: 'In stock only',
      dataset: { on: String(model.filters.inStockOnly) },
      on: { click: () => deps.actions.setFilters({ inStockOnly: !model.filters.inStockOnly }) },
    }),
    el('button', {
      class: 'chip',
      type: 'button',
      text: 'Hide pre-order',
      dataset: { on: String(model.filters.hidePreOrder) },
      on: { click: () => deps.actions.setFilters({ hidePreOrder: !model.filters.hidePreOrder }) },
    }),
  ]);
  panel.append(toggles);
  return panel;
}

function merchantHeader(merchant: Merchant, deps: ViewDeps): HTMLElement {
  const avatar = el('div', { class: 'avatar' });
  deps.images.mount(avatar, merchant.picture, merchant.name);
  const meta = el('div', { class: 'merchant-meta' }, [
    el('h2', { class: 'merchant-name', text: merchant.name }),
    el('p', { class: 'merchant-sub', text: merchant.nip05 ?? merchant.npub }),
  ]);
  if (merchant.acceptsLightning) meta.append(badge('accepts ⚡', 'lightning'));
  if (merchant.about) meta.append(el('p', { class: 'merchant-about', text: merchant.about }));
  return el('header', { class: 'merchant-header' }, [avatar, meta]);
}

/** Render the primary pane: header, search, filters, and the listing grid. */
export function renderList(host: HTMLElement, model: ListModel, deps: ViewDeps): void {
  const header = el('div', { class: 'pane-header' }, [
    el('h2', { class: 'pane-title', text: model.heading }),
  ]);
  if (model.subheading) {
    header.append(el('p', { class: 'pane-sub', text: model.subheading }));
  }
  if (!model.persistentFavorites) {
    header.append(
      el('p', {
        class: 'pane-hint',
        text: 'Favourites last for this session only — the shell offers no storage.',
      }),
    );
  }

  const toolbar = el('div', { class: 'toolbar' }, [searchRow(model, deps)]);
  if (model.showFilters) toolbar.append(filterPanel(model, deps));

  const body = el('div', { class: 'pane-body' });
  if (model.status === 'loading') {
    body.append(skeletonGrid());
  } else if (model.status === 'error') {
    body.append(
      notice('Could not reach the market', model.error ?? 'The outbox read failed.', {
        label: 'Retry',
        run: deps.actions.retry,
      }),
    );
  } else if (model.products.length === 0) {
    body.append(notice('No listings match', model.emptyMessage));
  } else {
    const grid = el('div', { class: 'grid' });
    const pages = PANEL ? Math.max(1, Math.ceil(model.products.length / PANEL_CARDS)) : 1;
    if (PANEL) panelListPage = Math.min(panelListPage, pages - 1);
    const shown = PANEL
      ? model.products.slice(panelListPage * PANEL_CARDS, panelListPage * PANEL_CARDS + PANEL_CARDS)
      : model.products;
    for (const product of shown) {
      grid.append(
        productCard(
          product,
          deps,
          model.favorites.has(product.address),
          model.activeAddress === product.address,
          model.persistentFavorites,
        ),
      );
    }
    body.append(grid);
    if (PANEL && pages > 1) {
      body.append(
        panelPager(panelListPage, pages, (next) => {
          panelListPage = next;
          renderList(host, model, deps);
        }),
      );
    }
    if (model.canLoadMore && (!PANEL || panelListPage >= pages - 1)) {
      body.append(
        button(model.busy ? 'Loading…' : 'Load more', 'secondary-button load-more', () =>
          deps.actions.loadMore(),
        ),
      );
    }
  }

  const children: (Node | string)[] = [];
  if (model.merchant) children.push(merchantHeader(model.merchant, deps));
  if (model.collection) {
    const collectionHeader = el('header', { class: 'collection-header' }, [
      el('h2', { class: 'pane-title', text: model.collection.title }),
    ]);
    if (model.collection.summary) {
      collectionHeader.append(el('p', { class: 'pane-sub', text: model.collection.summary }));
    }
    children.push(collectionHeader);
  }
  children.push(header, toolbar, body);
  replace(host, ...children);
}

function priceBlock(product: Product): HTMLElement {
  const block = el('div', { class: 'detail-price-row' }, [
    el('p', { class: 'detail-price', text: formatPrice(product.price) }),
    el('div', { class: 'badge-row' }, productBadges(product)),
  ]);
  if (product.stock !== null && !product.soldOut) {
    block.append(el('p', { class: 'detail-stock', text: `${product.stock} in stock` }));
  }
  return block;
}

function carousel(product: Product, deps: ViewDeps): HTMLElement {
  const strip = el('div', { class: 'carousel' });
  if (product.images.length === 0) {
    const tile = el('div', { class: 'carousel-item' });
    deps.images.mount(tile, undefined, product.title);
    strip.append(tile);
    return strip;
  }
  for (const image of product.images) {
    const tile = el('div', { class: 'carousel-item' });
    deps.images.mount(tile, image.url, product.title);
    strip.append(tile);
  }
  return strip;
}

function checkoutBlock(model: DetailModel, deps: ViewDeps): HTMLElement {
  if (model.linkAvailable) {
    return el('div', { class: 'checkout' }, [
      button('Buy on plebeian.market', 'primary-button buy', () =>
        deps.actions.openExternal(model.checkoutUrl),
      ),
    ]);
  }
  const field = el('input', {
    class: 'url-field',
    type: 'text',
    attrs: { readonly: 'readonly', value: model.checkoutUrl, 'aria-label': 'Checkout URL' },
    on: { focus: (event: Event) => (event.target as HTMLInputElement).select() },
  });
  return el('div', { class: 'checkout' }, [
    el('p', { class: 'checkout-hint', text: 'This shell cannot open links. Copy the URL:' }),
    field,
    button('Select URL', 'secondary-button', () => field.select()),
  ]);
}

function specTable(product: Product): HTMLElement | null {
  const rows: [string, string][] = [...product.specs];
  if (product.weight) rows.push(['Weight', product.weight]);
  if (product.dimensions) rows.push(['Dimensions', product.dimensions]);
  if (rows.length === 0) return null;

  const table = el('dl', { class: 'spec-table' });
  for (const [key, value] of rows) {
    table.append(el('dt', { text: key }), el('dd', { text: value }));
  }
  return el('section', { class: 'detail-section' }, [
    el('h3', { class: 'section-title', text: 'Specifications' }),
    table,
  ]);
}

function shippingSection(options: ShippingOption[], refCount: number): HTMLElement | null {
  if (refCount === 0) return null;
  const list = el('ul', { class: 'shipping-list' });
  if (options.length === 0) {
    list.append(el('li', { class: 'muted-line', text: 'Shipping options could not be resolved.' }));
  }
  for (const option of options) {
    const countries = option.countries.length ? option.countries.join(', ') : 'unspecified';
    const detail = [
      `${option.baseCost} ${option.currency.toUpperCase()}`,
      option.service,
      option.carrier,
      option.duration,
    ]
      .filter(Boolean)
      .join(' · ');
    list.append(
      el('li', {}, [
        el('span', { class: 'shipping-title', text: option.title }),
        el('span', { class: 'shipping-detail', text: detail }),
        el('span', { class: 'shipping-countries', text: `ships to ${countries}` }),
      ]),
    );
  }
  return el('section', { class: 'detail-section' }, [
    el('h3', { class: 'section-title', text: 'Shipping' }),
    list,
  ]);
}

function reviewSection(model: DetailModel): HTMLElement | null {
  const { reviews, reviewCount } = model;
  if (reviews.length === 0 && reviewCount === null) return null;

  const header = el('h3', { class: 'section-title', text: 'Reviews' });
  const section = el('section', { class: 'detail-section' }, [header]);

  if (reviews.length > 0) {
    const average = reviews.reduce((sum, review) => sum + review.score, 0) / reviews.length;
    const thumbs = reviews.filter((review) => review.thumb >= 0.5).length;
    section.append(
      el('p', {
        class: 'review-summary',
        text: `${Math.round(average * 100)}% · ${thumbs} 👍 of ${reviewCount ?? reviews.length}`,
      }),
    );
    const list = el('ul', { class: 'review-list' });
    for (const review of reviews.slice(0, 20)) {
      const entry = el('li', {}, [
        el('span', { class: 'review-score', text: `${Math.round(review.score * 100)}%` }),
      ]);
      if (review.content.trim()) {
        entry.append(el('p', { class: 'review-text', text: review.content.trim() }));
      }
      if (review.categories.length > 0) {
        entry.append(
          el('span', {
            class: 'review-categories',
            text: review.categories
              .map(([label, value]) => `${label} ${Math.round(value * 100)}%`)
              .join(' · '),
          }),
        );
      }
      list.append(entry);
    }
    section.append(list);
  } else {
    section.append(el('p', { class: 'muted-line', text: `${reviewCount} review(s) published.` }));
  }
  return section;
}

function variationSection(model: DetailModel, deps: ViewDeps): HTMLElement | null {
  if (model.variations.length === 0) return null;
  const list = el('ul', { class: 'variation-list' });
  for (const variation of model.variations) {
    list.append(
      el('li', {}, [
        button(
          `${variation.title} — ${formatPrice(variation.price)}`,
          'link-button',
          () => deps.actions.openProduct(variation.address),
        ),
      ]),
    );
  }
  return el('section', { class: 'detail-section' }, [
    el('h3', { class: 'section-title', text: 'Variations' }),
    list,
  ]);
}

function merchantRow(model: DetailModel, deps: ViewDeps): HTMLElement {
  const merchant = model.merchant;
  const row = el('div', { class: 'merchant-row' });
  if (!merchant) {
    row.append(el('p', { class: 'muted-line', text: 'Merchant unavailable' }));
    return row;
  }
  const avatar = el('div', { class: 'avatar small' });
  deps.images.mount(avatar, merchant.picture, merchant.name);
  const identity = el('div', { class: 'merchant-identity' }, [
    button(merchant.name, 'link-button merchant-link', () =>
      deps.actions.openMerchant(merchant.pubkey),
    ),
    el('span', { class: 'merchant-npub', text: merchant.nip05 ?? merchant.npub }),
  ]);
  row.append(avatar, identity);
  if (merchant.acceptsLightning) row.append(badge('accepts ⚡', 'lightning'));
  return row;
}

/** Render the detail pane for one listing. */
export function renderDetail(host: HTMLElement, model: DetailModel, deps: ViewDeps): void {
  const back = button('← Back', 'secondary-button back', () => deps.actions.closeDetail());

  if (model.status === 'loading') {
    replace(host, back, el('div', { class: 'detail-skeleton' }, [el('div', { class: 'skeleton-line' })]));
    return;
  }
  if (model.status === 'error' || !model.product) {
    replace(
      host,
      back,
      notice('Listing unavailable', model.error ?? 'This listing could not be read.', {
        label: 'Retry',
        run: deps.actions.retry,
      }),
    );
    return;
  }

  const product = model.product;
  const sections: (Node | string)[] = [
    back,
    carousel(product, deps),
    el('h2', { class: 'detail-title', text: product.title }),
    priceBlock(product),
    merchantRow(model, deps),
    checkoutBlock(model, deps),
  ];

  const favorite = el('div', { class: 'detail-actions' }, [
    button(model.favorite ? '★ Favourited' : '☆ Add to favourites', 'secondary-button', () =>
      deps.actions.toggleFavorite(product.address),
    ),
  ]);
  sections.push(favorite);

  if (product.summary) sections.push(el('p', { class: 'detail-summary', text: product.summary }));

  if (product.content.trim()) {
    const description = el('div', { class: 'detail-description' });
    description.append(
      renderMarkdown(product.content, {
        onLink: (url) => deps.actions.openExternal(url),
        mountImage: (imageHost, url, alt) => deps.images.mount(imageHost, url, alt),
      }),
    );
    sections.push(description);
  }

  const variations = variationSection(model, deps);
  if (variations) sections.push(variations);

  const specs = specTable(product);
  if (specs) sections.push(specs);

  const shipping = shippingSection(model.shipping, product.shippingRefs.length);
  if (shipping) sections.push(shipping);

  if (product.location || product.geohash) {
    const parts = [product.location, product.geohash ? `geohash ${product.geohash}` : undefined]
      .filter(Boolean)
      .join(' · ');
    sections.push(
      el('section', { class: 'detail-section' }, [
        el('h3', { class: 'section-title', text: 'Location' }),
        el('p', { class: 'muted-line', text: parts }),
      ]),
    );
  }

  if (product.collectionRefs.length > 0) {
    const list = el('ul', { class: 'collection-list' });
    for (const address of product.collectionRefs) {
      list.append(
        el('li', {}, [
          button(address, 'link-button', () => deps.actions.openCollection(address)),
        ]),
      );
    }
    sections.push(
      el('section', { class: 'detail-section' }, [
        el('h3', { class: 'section-title', text: 'Collections' }),
        list,
      ]),
    );
  }

  const reviews = reviewSection(model);
  if (reviews) sections.push(reviews);

  if (model.naddr) {
    const share = el('input', {
      class: 'url-field',
      type: 'text',
      attrs: { readonly: 'readonly', value: model.naddr, 'aria-label': 'Listing address (naddr)' },
      on: { focus: (event: Event) => (event.target as HTMLInputElement).select() },
    });
    sections.push(
      el('section', { class: 'detail-section' }, [
        el('h3', { class: 'section-title', text: 'Share' }),
        share,
      ]),
    );
  }

  const date = new Date((product.publishedAt ?? product.createdAt) * 1000);
  sections.push(
    el('p', { class: 'detail-meta', text: `Published ${date.toLocaleDateString()}` }),
  );

  if (!PANEL) {
    replace(host, ...sections);
    return;
  }

  // The panel walks the listing one screen at a time: back + hero first,
  // then each remaining section behind the pager. Nothing scrolls.
  if (panelDetailFor !== product.address) {
    panelDetailFor = product.address;
    panelDetailPage = 0;
  }
  const hero: (Node | string)[] = sections.slice(0, 4); // back, carousel, title, price
  const rest = sections.slice(4);
  const screens: (Node | string)[][] = [hero, ...rest.map((section) => [back, section])];
  panelDetailPage = Math.min(panelDetailPage, screens.length - 1);
  const screen = el('div', { class: 'detail-screen' });
  for (const node of screens[panelDetailPage]) screen.append(node);
  const walk = screens.length > 1
    ? [panelPager(panelDetailPage, screens.length, (next) => {
        panelDetailPage = next;
        renderDetail(host, model, deps);
      })]
    : [];
  replace(host, screen, ...walk);
}

/** Render the about pane, including which optional domains this load has. */
export function renderAbout(
  host: HTMLElement,
  domains: { name: string; available: boolean; fallback: string }[],
): void {
  const list = el('dl', { class: 'domain-list' });
  for (const domain of domains) {
    list.append(
      el('dt', { text: domain.name }),
      el('dd', {
        text: domain.available ? 'available' : `unavailable — ${domain.fallback}`,
        dataset: { state: domain.available ? 'on' : 'off' },
      }),
    );
  }
  replace(
    host,
    el('h2', { class: 'pane-title', text: 'About this napplet' }),
    el('p', {
      class: 'pane-sub',
      text:
        'A watch-only storefront for Plebeian Market listings. Browsing and lookup happen ' +
        'here; checkout is handed to plebeian.market. No cart, orders or payments run inside ' +
        'this napplet.',
    }),
    el('h3', { class: 'section-title', text: 'Shell surface for this load' }),
    list,
  );
}

/** Render a full-pane message, used for the no-runtime and hard-failure states. */
export function renderMessage(
  host: HTMLElement,
  title: string,
  body: string,
  action?: { label: string; run: () => void },
): void {
  replace(host, notice(title, body, action));
}
