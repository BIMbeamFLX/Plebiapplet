/**
 * Napplet entry point.
 *
 * The runtime injects `window.napplet` before this module runs; there is no
 * readiness handshake and no capability probe. Boot is wrapped so that a shell
 * with no NAP domains at all still gets a rendered, explanatory surface instead
 * of an uncaught error.
 */
import './styles.css';
import { Storefront } from './app';
import { requireElement } from './dom';
import { renderMessage } from './views';
import { startTheme } from './theme';

const themeSubscription = startTheme();

function boot(): Storefront | null {
  try {
    const storefront = new Storefront({
      app: requireElement<HTMLElement>('#app'),
      nav: requireElement<HTMLElement>('#nav'),
      list: requireElement<HTMLElement>('#list'),
      detail: requireElement<HTMLElement>('#detail'),
      toast: requireElement<HTMLElement>('#toast'),
    });
    void storefront.start().catch((error: unknown) => {
      renderMessage(
        requireElement<HTMLElement>('#list'),
        'Storefront failed to start',
        error instanceof Error ? error.message : 'Unknown startup failure.',
      );
    });
    return storefront;
  } catch {
    return null;
  }
}

const app = boot();

window.addEventListener('pagehide', () => {
  themeSubscription?.close();
  app?.dispose();
});
