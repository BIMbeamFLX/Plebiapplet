/**
 * Minimal DOM builders.
 *
 * Every text value is assigned through `textContent`, never `innerHTML`, so
 * listing content coming off relays can never inject markup (SPEC 11, XSS row).
 */

/** Declarative properties accepted by {@link el}. */
export interface ElProps {
  class?: string;
  text?: string;
  title?: string;
  type?: string;
  role?: string;
  dataset?: Record<string, string>;
  attrs?: Record<string, string>;
  on?: Record<string, (event: Event) => void>;
}

/** Create an element with class/text/attributes/listeners and optional children. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: ElProps = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.class) node.className = props.class;
  if (props.text !== undefined) node.textContent = props.text;
  if (props.title) node.title = props.title;
  if (props.role) node.setAttribute('role', props.role);
  if (props.type && 'type' in node) (node as HTMLInputElement).type = props.type;
  for (const [key, value] of Object.entries(props.dataset ?? {})) node.dataset[key] = value;
  for (const [key, value] of Object.entries(props.attrs ?? {})) node.setAttribute(key, value);
  for (const [event, handler] of Object.entries(props.on ?? {})) {
    node.addEventListener(event, handler);
  }
  for (const child of children) {
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

/** Create a `<button type="button">` with a click handler. */
export function button(label: string, className: string, onClick: () => void): HTMLButtonElement {
  return el('button', { class: className, text: label, type: 'button', on: { click: onClick } });
}

/** Replace every child of `host` with `children`. */
export function replace(host: HTMLElement, ...children: (Node | string)[]): void {
  host.replaceChildren(...children);
}

/** Look up a required element, throwing a descriptive error when the markup drifts. */
export function requireElement<T extends HTMLElement>(selector: string): T {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`Missing required element: ${selector}`);
  return node;
}
