/**
 * Storefront state machine.
 *
 * A plain, hash-free router over five views (SPEC 8) plus the data orchestration
 * behind them. Nothing here talks to the network directly — every read goes
 * through {@link ./market.ts}, which speaks NAP-OUTBOX only.
 */
import { button, el, replace } from './dom';
import {
  DEFAULT_FILTERS,
  applyFilters,
  collectCategories,
  collectCurrencies,
  hasActiveFilters,
  type FilterState,
} from './filters';
import { ImageLoader } from './images';
import {
  buildProductUrl,
  countReviews,
  loadBrowsePage,
  loadCategory,
  loadCollection,
  loadCollectionProducts,
  loadMerchantProducts,
  loadMorePage,
  loadProductByAddress,
  loadReviews,
  loadShippingOptions,
  loadVariations,
  subscribeToListings,
} from './market';
import { resolveMerchant, type Merchant } from './merchant';
import { hasDomain, openExternal, type DomainName } from './nap';
import { encodeNaddr } from './nip19';
import { KIND_PRODUCT, type Collection, type Product } from './model';
import { Store } from './store';
import {
  renderAbout,
  renderDetail,
  renderList,
  renderMessage,
  type Actions,
  type DetailModel,
  type ListModel,
  type ViewDeps,
} from './views';

/** The pane the primary view is showing. */
type Primary =
  | { kind: 'browse' }
  | { kind: 'favorites' }
  | { kind: 'about' }
  | { kind: 'merchant'; pubkey: string }
  | { kind: 'collection'; address: string };

/** Optional domains, with the fallback the About pane advertises. */
const DOMAIN_FALLBACKS: { name: DomainName; fallback: string }[] = [
  { name: 'outbox', fallback: 'no listings can be read' },
  { name: 'resource', fallback: 'placeholder tiles instead of product images' },
  { name: 'storage', fallback: 'favourites and preferences last for this session only' },
  { name: 'common', fallback: 'merchants shown as a truncated npub' },
  { name: 'count', fallback: 'review counts hidden' },
  { name: 'link', fallback: 'the checkout URL is shown as copyable text' },
  { name: 'theme', fallback: 'bundled dark palette' },
  { name: 'identity', fallback: 'no personalisation (cosmetic here)' },
];

const SEARCH_DEBOUNCE_MS = 200;

/** DOM anchors the app renders into. */
export interface AppRoots {
  app: HTMLElement;
  nav: HTMLElement;
  list: HTMLElement;
  detail: HTMLElement;
  toast: HTMLElement;
}

/** Owns view state, data loading, and teardown for the whole napplet. */
export class Storefront {
  private readonly roots: AppRoots;
  private readonly store = new Store();
  private readonly actions: Actions;

  private listImages = new ImageLoader();
  private detailImages = new ImageLoader();

  private primary: Primary = { kind: 'browse' };
  private detailAddress: string | null = null;

  private catalogue = new Map<string, Product>();
  private listStatus: ListModel['status'] = 'loading';
  private listError: string | undefined;
  private filters: FilterState = { ...DEFAULT_FILTERS };
  private showFilters = false;
  private busy = false;
  private merchant: Merchant | undefined;
  private collection: Collection | undefined;

  private detail: DetailModel = emptyDetail();
  private listToken = 0;
  private detailToken = 0;
  private searchTimer = 0;
  private toastTimer = 0;
  private liveSubscription: { close: () => void } | null = null;

  constructor(roots: AppRoots) {
    this.roots = roots;
    this.actions = {
      openBrowse: () => this.setPrimary({ kind: 'browse' }),
      openFavorites: () => this.setPrimary({ kind: 'favorites' }),
      openAbout: () => this.setPrimary({ kind: 'about' }),
      openProduct: (address) => void this.openProduct(address),
      openMerchant: (pubkey) => this.setPrimary({ kind: 'merchant', pubkey }),
      openCollection: (address) => this.setPrimary({ kind: 'collection', address }),
      closeDetail: () => {
        this.detailAddress = null;
        this.detail = emptyDetail();
        this.render();
      },
      setFilters: (patch) => this.setFilters(patch),
      toggleFilterPanel: () => {
        this.showFilters = !this.showFilters;
        this.render();
      },
      loadMore: () => void this.loadMore(),
      retry: () => void this.reload(),
      toggleFavorite: (address) => void this.toggleFavorite(address),
      openExternal: (url) => void this.openLink(url),
    };
  }

  /** Boot the napplet: load preferences, render, and start the first read. */
  async start(): Promise<void> {
    await this.store.load();
    const prefs = this.store.prefs;
    this.filters = {
      ...this.filters,
      sort: prefs.sort,
      medium: prefs.medium,
      currency: prefs.currency,
      inStockOnly: prefs.inStockOnly,
      hidePreOrder: prefs.hidePreOrder,
    };

    if (!hasDomain('outbox')) {
      this.listStatus = 'error';
      this.renderNav();
      renderMessage(
        this.roots.list,
        'No Nostr access in this shell',
        'This napplet reads Plebeian Market listings through the shell’s outbox service. ' +
          'The current runtime did not provide it, so there is nothing to browse.',
      );
      return;
    }

    this.render();
    await this.reload();
    this.startLiveFeed();
  }

  /** Close subscriptions and release image handles. Idempotent. */
  dispose(): void {
    this.liveSubscription?.close();
    this.liveSubscription = null;
    this.listImages.release();
    this.detailImages.release();
    window.clearTimeout(this.searchTimer);
    window.clearTimeout(this.toastTimer);
  }

  private get deps(): ViewDeps {
    return { actions: this.actions, images: this.listImages };
  }

  private setPrimary(primary: Primary): void {
    this.primary = primary;
    this.merchant = undefined;
    this.collection = undefined;
    this.showFilters = false;
    this.listImages.release();
    this.listImages = new ImageLoader();
    void this.reload();
  }

  private setFilters(patch: Partial<FilterState>): void {
    const wasSearch = 'search' in patch;
    this.filters = { ...this.filters, ...patch };
    void this.store.savePrefs({
      sort: this.filters.sort,
      medium: this.filters.medium,
      currency: this.filters.currency,
      inStockOnly: this.filters.inStockOnly,
      hidePreOrder: this.filters.hidePreOrder,
    });

    if (patch.category) void this.topUpCategory(patch.category);

    if (wasSearch) {
      window.clearTimeout(this.searchTimer);
      this.searchTimer = window.setTimeout(() => this.render(), SEARCH_DEBOUNCE_MS);
      return;
    }
    this.render();
  }

  /** Reload the data behind the current primary view. */
  private async reload(): Promise<void> {
    const token = ++this.listToken;
    this.listStatus = 'loading';
    this.listError = undefined;
    this.render();

    if (this.primary.kind === 'about') {
      this.listStatus = 'ready';
      this.render();
      return;
    }

    if (this.primary.kind === 'merchant') {
      const pubkey = this.primary.pubkey;
      const [merchant, page] = await Promise.all([
        resolveMerchant(pubkey),
        loadMerchantProducts(pubkey),
      ]);
      if (token !== this.listToken) return;
      this.merchant = merchant;
      this.mergeProducts(page.products);
      this.finishLoad(page.error, page.products.length);
      return;
    }

    if (this.primary.kind === 'collection') {
      const collection = await loadCollection(this.primary.address);
      if (token !== this.listToken) return;
      if (!collection) {
        this.listStatus = 'error';
        this.listError = 'This collection could not be read.';
        this.render();
        return;
      }
      this.collection = collection;
      const products = await loadCollectionProducts(collection);
      if (token !== this.listToken) return;
      this.mergeProducts(products);
      this.finishLoad(undefined, products.length);
      return;
    }

    if (this.primary.kind === 'favorites') {
      const missing = this.store.favorites.filter((address) => !this.catalogue.has(address));
      const resolved = await Promise.all(missing.map(loadProductByAddress));
      if (token !== this.listToken) return;
      this.mergeProducts(resolved.filter((product): product is Product => product !== null));
      this.finishLoad(undefined, this.store.favorites.length);
      return;
    }

    const page = await loadBrowsePage();
    if (token !== this.listToken) return;
    this.mergeProducts(page.products);
    this.finishLoad(page.error, page.products.length);
  }

  private finishLoad(error: string | undefined, received: number): void {
    if (error && received === 0) {
      this.listStatus = 'error';
      this.listError = error;
    } else {
      this.listStatus = 'ready';
      this.listError = undefined;
    }
    this.render();
  }

  private mergeProducts(products: Product[]): void {
    for (const product of products) {
      const existing = this.catalogue.get(product.address);
      if (!existing || product.createdAt > existing.createdAt) {
        this.catalogue.set(product.address, product);
      }
    }
  }

  /** Pull relay-side results for a newly selected category (SPEC 7.1). */
  private async topUpCategory(category: string): Promise<void> {
    const page = await loadCategory(category);
    if (page.products.length === 0) return;
    this.mergeProducts(page.products);
    this.render();
  }

  private async loadMore(): Promise<void> {
    if (this.busy || this.primary.kind !== 'browse') return;
    const oldest = [...this.catalogue.values()].reduce(
      (min, product) => Math.min(min, product.createdAt),
      Number.MAX_SAFE_INTEGER,
    );
    if (!Number.isFinite(oldest) || oldest === Number.MAX_SAFE_INTEGER) return;

    this.busy = true;
    this.render();
    const page = await loadMorePage(oldest);
    this.mergeProducts(page.products);
    this.busy = false;
    this.render();
  }

  private startLiveFeed(): void {
    this.liveSubscription = subscribeToListings((product) => {
      const existing = this.catalogue.get(product.address);
      if (existing && existing.createdAt >= product.createdAt) return;
      this.catalogue.set(product.address, product);
      if (this.primary.kind === 'browse' && this.listStatus === 'ready') this.render();
    });
  }

  private async toggleFavorite(address: string): Promise<void> {
    await this.store.toggleFavorite(address);
    if (this.detailAddress === address) {
      this.detail = { ...this.detail, favorite: this.store.isFavorite(address) };
    }
    if (this.primary.kind === 'favorites') {
      await this.reload();
      return;
    }
    this.render();
  }

  private async openLink(url: string): Promise<void> {
    const outcome = await openExternal(url, 'Open on plebeian.market');
    if (outcome === 'opened') return;
    this.showToast(
      outcome === 'denied'
        ? 'The shell declined to open that link.'
        : 'This shell cannot open links — copy the URL instead.',
    );
  }

  private async openProduct(address: string): Promise<void> {
    const token = ++this.detailToken;
    this.detailAddress = address;
    this.detailImages.release();
    this.detailImages = new ImageLoader();
    this.detail = { ...emptyDetail(), status: 'loading' };
    this.render();

    const known = this.catalogue.get(address);
    const product = known ?? (await loadProductByAddress(address));
    if (token !== this.detailToken) return;
    if (!product) {
      this.detail = { ...emptyDetail(), status: 'error', error: 'Listing not found on the relays reached.' };
      this.render();
      return;
    }
    this.catalogue.set(product.address, product);

    const [merchant, variations, shipping, reviews, reviewCount] = await Promise.all([
      resolveMerchant(product.pubkey),
      product.form === 'variable' ? loadVariations(product) : Promise.resolve([]),
      product.shippingRefs.length > 0 ? loadShippingOptions(product) : Promise.resolve([]),
      loadReviews(product),
      countReviews(product),
    ]);
    if (token !== this.detailToken) return;

    this.detail = {
      status: 'ready',
      product,
      merchant,
      variations,
      shipping,
      reviews,
      reviewCount,
      favorite: this.store.isFavorite(product.address),
      checkoutUrl: buildProductUrl(product),
      linkAvailable: hasDomain('link'),
      naddr: encodeNaddr(KIND_PRODUCT, product.pubkey, product.identifier) ?? undefined,
    };
    this.render();
  }

  private showToast(message: string): void {
    this.roots.toast.textContent = message;
    this.roots.toast.dataset.visible = 'true';
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.roots.toast.dataset.visible = 'false';
    }, 4000);
  }

  private sourceProducts(primary: Primary): Product[] {
    const all = [...this.catalogue.values()];
    switch (primary.kind) {
      case 'favorites':
        return this.store.favorites
          .map((address) => this.catalogue.get(address))
          .filter((product): product is Product => product !== undefined);
      case 'merchant':
        return all.filter((product) => product.pubkey === primary.pubkey);
      case 'collection':
        return all.filter((product) => this.collection?.productRefs.includes(product.address));
      default:
        return all;
    }
  }

  private listModel(): ListModel {
    const primary = this.primary;
    const favorites = new Set(this.store.favorites);
    const source = this.sourceProducts(primary);

    const heading =
      primary.kind === 'favorites'
        ? 'Favourites'
        : primary.kind === 'merchant'
          ? 'Merchant listings'
          : primary.kind === 'collection'
            ? 'Collection'
            : 'Plebeian Market';

    const products = applyFilters(source, this.filters);
    const empty =
      primary.kind === 'favorites'
        ? 'Star a listing to keep it here.'
        : hasActiveFilters(this.filters)
          ? 'Try clearing the search or filters.'
          : 'No listings came back from the relays this shell reached.';

    return {
      heading,
      subheading: `${products.length} of ${source.length} listings`,
      status: this.listStatus,
      error: this.listError,
      products,
      filters: this.filters,
      categories: collectCategories(source),
      currencies: collectCurrencies(source),
      canLoadMore: primary.kind === 'browse' && this.listStatus === 'ready',
      busy: this.busy,
      showFilters: this.showFilters,
      emptyMessage: empty,
      merchant: primary.kind === 'merchant' ? this.merchant : undefined,
      collection: primary.kind === 'collection' ? this.collection : undefined,
      activeAddress: this.detailAddress ?? undefined,
      favorites,
      persistentFavorites: this.store.persistent,
    };
  }

  private renderNav(): void {
    const tabs: [string, Primary['kind'], () => void][] = [
      ['Browse', 'browse', this.actions.openBrowse],
      ['Favourites', 'favorites', this.actions.openFavorites],
      ['About', 'about', this.actions.openAbout],
    ];
    const nav = el('nav', { class: 'tabs', attrs: { 'aria-label': 'Views' } });
    for (const [label, kind, run] of tabs) {
      const tab = button(label, 'tab', run);
      tab.dataset.on = String(this.primary.kind === kind);
      nav.append(tab);
    }
    replace(
      this.roots.nav,
      el('span', { class: 'brand', text: 'Plebeian Market' }),
      nav,
    );
  }

  private render(): void {
    this.renderNav();

    if (this.primary.kind === 'about') {
      renderAbout(
        this.roots.list,
        DOMAIN_FALLBACKS.map((domain) => ({
          name: domain.name,
          available: hasDomain(domain.name),
          fallback: domain.fallback,
        })),
      );
    } else {
      renderList(this.roots.list, this.listModel(), this.deps);
    }

    if (this.detailAddress) {
      this.roots.app.dataset.detail = 'open';
      renderDetail(this.roots.detail, this.detail, {
        actions: this.actions,
        images: this.detailImages,
      });
    } else {
      this.roots.app.dataset.detail = 'closed';
      this.roots.detail.replaceChildren();
    }
  }
}

function emptyDetail(): DetailModel {
  return {
    status: 'loading',
    variations: [],
    shipping: [],
    reviews: [],
    reviewCount: null,
    favorite: false,
    checkoutUrl: '',
    linkAvailable: hasDomain('link'),
  };
}
