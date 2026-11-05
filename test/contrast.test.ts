import { readFileSync } from 'node:fs';
import { describe as group, expect, it } from 'vitest';

// Reads the real design tokens, so the contrast promises in the README cannot drift from the CSS.
const css = readFileSync(new URL('../static/theme.css', import.meta.url), 'utf8');
const darkStart = css.indexOf('@media (prefers-color-scheme: dark)');
const themes = {
  light: css.slice(css.indexOf(':root {'), darkStart),
  dark: css.slice(darkStart, css.indexOf('*,', darkStart)),
};

function token(theme: keyof typeof themes, name: string): string {
  // Dark mode only overrides some tokens; the rest come from the light block.
  for (const block of theme === 'dark' ? [themes.dark, themes.light] : [themes.light]) {
    const match = block.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})\\b`));
    if (match?.[1]) return match[1];
  }
  throw new Error(`Missing token --${name}`);
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

const THEMES = ['light', 'dark'] as const;

group('text reaches WCAG AA (4.5:1) in both themes', () => {
  const pairs: Array<[string, string]> = [
    ['text', 'page'],
    ['text', 'canvas'],
    ['text', 'surface'],
    ['text', 'surface-2'],
    ['text', 'surface-3'],
    ['text-2', 'page'],
    ['text-2', 'canvas'],
    ['text-2', 'surface'],
    ['text-2', 'surface-2'],
    ['text-2', 'surface-3'],
    ['link', 'page'],
    ['link', 'canvas'],
    ['link', 'surface'],
    ['ok-text', 'ok-tint'],
    ['off-text', 'off-tint'],
    ['warn-text', 'warn-tint'],
    ['alert-text', 'alert-tint'],
    ['alert-text', 'surface'],
    ['on-blue', 'blue'],
    ['on-blue', 'blue-hover'],
    ['on-blue', 'blue-press'],
  ];
  for (const theme of THEMES) {
    it.each(pairs)(`${theme}: --%s on --%s`, (text, background) => {
      expect(contrast(token(theme, text), token(theme, background))).toBeGreaterThanOrEqual(4.5);
    });
  }
});

group('status dots, focus rings and pressed icons reach 3:1', () => {
  const pairs: Array<[string, string]> = [
    ['ok', 'surface'],
    ['warn', 'surface'],
    ['alert', 'surface'],
    ['off', 'surface'],
    ['focus', 'surface'],
    ['focus', 'canvas'],
    ['link', 'surface-3'],
  ];
  for (const theme of THEMES) {
    it.each(pairs)(`${theme}: --%s on --%s`, (mark, background) => {
      expect(contrast(token(theme, mark), token(theme, background))).toBeGreaterThanOrEqual(3);
    });
  }
});
