/**
 * Lazy, policy-respecting product imagery.
 *
 * Bytes only ever arrive through NAP-RESOURCE (SPEC 7.4): nothing here sets an
 * external `src`. Images are fetched when their tile enters the viewport, at
 * most four at a time, and every object URL is revoked on view teardown.
 */
import { el } from './dom';
import { fetchBytes, hasDomain, resourceErrorCode } from './nap';

const MAX_CONCURRENT_FETCHES = 4;

interface PendingImage {
  host: HTMLElement;
  url: string;
  label: string;
}

function placeholder(label: string): HTMLElement {
  const initial = label.trim().charAt(0).toUpperCase() || '?';
  return el('span', { class: 'thumb-placeholder', text: initial, attrs: { 'aria-hidden': 'true' } });
}

/**
 * Owns the object URLs and observers for one view.
 *
 * Create one per view, call {@link ImageLoader.release} when that view is torn
 * down, and never share an instance across views.
 */
export class ImageLoader {
  private readonly observer: IntersectionObserver;
  private readonly pending = new Map<Element, PendingImage>();
  private readonly objectUrls = new Map<string, string>();
  private readonly queue: PendingImage[] = [];
  private active = 0;
  private released = false;

  constructor() {
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const request = this.pending.get(entry.target);
          if (!request) continue;
          this.pending.delete(entry.target);
          this.observer.unobserve(entry.target);
          this.enqueue(request);
        }
      },
      { rootMargin: '200px' },
    );
  }

  /**
   * Render an image into `host`, deferring the byte fetch until it is visible.
   * Falls back to a lettered placeholder when `resource` is absent or refuses.
   */
  mount(host: HTMLElement, url: string | undefined, label: string): void {
    if (!url || !hasDomain('resource')) {
      host.replaceChildren(placeholder(label));
      return;
    }
    const cached = this.objectUrls.get(url);
    if (cached) {
      host.replaceChildren(this.imageElement(cached, label));
      return;
    }
    host.replaceChildren(placeholder(label));
    this.pending.set(host, { host, url, label });
    this.observer.observe(host);
  }

  /** Revoke every object URL and stop observing. Idempotent. */
  release(): void {
    if (this.released) return;
    this.released = true;
    this.observer.disconnect();
    this.pending.clear();
    this.queue.length = 0;
    for (const objectUrl of this.objectUrls.values()) URL.revokeObjectURL(objectUrl);
    this.objectUrls.clear();
  }

  private imageElement(objectUrl: string, label: string): HTMLImageElement {
    const image = el('img', {
      class: 'thumb-image',
      attrs: { alt: label, decoding: 'async' },
    });
    image.src = objectUrl;
    return image;
  }

  private enqueue(request: PendingImage): void {
    this.queue.push(request);
    this.drain();
  }

  private drain(): void {
    while (this.active < MAX_CONCURRENT_FETCHES && this.queue.length > 0) {
      const request = this.queue.shift();
      if (!request) return;
      this.active += 1;
      void this.load(request).finally(() => {
        this.active -= 1;
        if (!this.released) this.drain();
      });
    }
  }

  private async load(request: PendingImage): Promise<void> {
    try {
      const blob = await fetchBytes(request.url);
      if (this.released) return;
      const objectUrl = URL.createObjectURL(blob);
      this.objectUrls.set(request.url, objectUrl);
      const image = this.imageElement(objectUrl, request.label);
      image.addEventListener('error', () => {
        request.host.replaceChildren(placeholder(request.label));
      });
      request.host.replaceChildren(image);
    } catch (error: unknown) {
      if (this.released) return;
      const code = resourceErrorCode(error);
      const tile = placeholder(request.label);
      tile.dataset.reason = code;
      request.host.replaceChildren(tile);
    }
  }
}
