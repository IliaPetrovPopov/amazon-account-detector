import { monogram } from './identity';

// Small DOM helpers. Everything is built with createElement and textContent, never from HTML strings.

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element as T;
}

/** Shows text, or hides the element when there is none. */
export function setText(element: HTMLElement, text: string | null): void {
  element.textContent = text ?? '';
  element.hidden = text === null;
}

// 16 px line icons, drawn on a 16-unit grid with a 1.5 stroke.
const ICON_PATHS = {
  board: 'M2.5 4h1.5M2.5 8h1.5M2.5 12h1.5M6.5 4h7M6.5 8h7M6.5 12h7',
  panel: 'M3.5 2.5h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1zM9.5 2.5v11',
  copy: 'M6.5 5.5h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1zM3.5 10.5h-.5a.5.5 0 0 1-.5-.5V3a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 .5.5v.5',
  done: 'M3.5 8.5l3 3 6-7',
  pin: 'M6.5 2.5h3V6l2 2.5V10h-7V8.5l2-2.5zM5.5 2.5h5M8 10v4',
  chevron: 'M4.5 6.5L8 10l3.5-3.5',
  refresh: 'M14 8a6 6 0 1 1-6-6c1.68 0 3.29.67 4.49 1.83L14 5.3M14 2v3.3h-3.3',
  alert: 'M14.5 12L9.2 2.7a1.3 1.3 0 0 0-2.3 0L1.5 12a1.3 1.3 0 0 0 1.2 2h10.7a1.3 1.3 0 0 0 1.1-2zM8 6v2.7M8 11.3h.01',
  info: 'M8 14.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM8 7.5v3.5M8 5h.01',
  user: 'M8 8a2.75 2.75 0 1 0 0-5.5A2.75 2.75 0 0 0 8 8zM3 14c.7-2.6 2.7-4 5-4s4.3 1.4 5 4',
  history: 'M2 8a6 6 0 1 0 6-6 6.5 6.5 0 0 0-4.49 1.83L2 5.3M2 2v3.3h3.3M8 4.7V8l2.7 1.3',
} as const;

export type IconName = keyof typeof ICON_PATHS;

export function icon(name: IconName, className = ''): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('icon', `icon-${name}`);
  if (className) svg.classList.add(className);
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', ICON_PATHS[name]);
  svg.append(path);
  return svg;
}

export function setIcon(host: HTMLElement, name: IconName): void {
  const current = host.querySelector('svg.icon');
  const next = icon(name);
  if (current) current.replaceWith(next);
  else host.prepend(next);
}

/**
 * Fills an avatar: the account's initials on its colour, or an outlined person when no account
 * is signed in. The colour arrives as a custom property so light and dark mode can share it.
 */
export function paintAvatar(host: HTMLElement, email: string | null, color: string | null): void {
  const letters = email ? monogram(email) : '';
  const key = `${email ?? ''}|${color ?? ''}`;
  if (host.dataset.key === key) return;
  host.dataset.key = key;
  host.classList.toggle('avatar-empty', !email);
  if (email && color) host.style.setProperty('--avatar-color', color);
  else host.style.removeProperty('--avatar-color');
  host.replaceChildren(letters ? letters : icon('user'));
}

export function avatar(email: string | null, color: string | null, className = ''): HTMLSpanElement {
  const host = el('span', `avatar${className ? ` ${className}` : ''}`);
  host.setAttribute('aria-hidden', 'true');
  paintAvatar(host, email, color);
  return host;
}

export const prefersReducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** A short fade and rise that says "this just changed". Skipped when motion is reduced. */
export function settleIn(element: HTMLElement): void {
  if (prefersReducedMotion()) return;
  element.animate(
    [
      { opacity: 0, transform: 'translateY(3px)' },
      { opacity: 1, transform: 'none' },
    ],
    { duration: 240, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)' },
  );
}

/** localStorage can be missing or throw (private windows, blocked storage). It only holds conveniences. */
export const memory = {
  read<T>(key: string, fallback: T): T {
    try {
      const raw = window.localStorage.getItem(key);
      return raw === null ? fallback : (JSON.parse(raw) as T);
    } catch {
      return fallback;
    }
  },
  write(key: string, value: unknown): void {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Nothing to do: the page works without it.
    }
  },
};
