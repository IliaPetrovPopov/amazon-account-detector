// Keyboard behaviour of the popup's marketplace dropdown: a select-only combobox, as described in
// the WAI-ARIA Authoring Practices. Focus stays on the combobox; the active option is announced
// through aria-activedescendant. Kept free of the DOM so every key can be tested.

export type ComboAction =
  | { type: 'open'; active: number }
  | { type: 'move'; active: number }
  | { type: 'select'; index: number }
  | { type: 'close' }
  | { type: 'none' };

export function comboKey(key: string, open: boolean, active: number, count: number, altKey = false): ComboAction {
  const last = count - 1;
  if (!open) {
    switch (key) {
      case 'ArrowDown':
      case 'ArrowUp':
      case 'Enter':
      case ' ':
        return { type: 'open', active };
      case 'Home':
        return { type: 'open', active: 0 };
      case 'End':
        return { type: 'open', active: last };
      default:
        return { type: 'none' };
    }
  }
  switch (key) {
    case 'ArrowDown':
      return { type: 'move', active: Math.min(active + 1, last) };
    case 'ArrowUp':
      // Alt+Up commits the choice, as a native select does.
      return altKey ? { type: 'select', index: active } : { type: 'move', active: Math.max(active - 1, 0) };
    case 'Home':
    case 'PageUp':
      return { type: 'move', active: 0 };
    case 'End':
    case 'PageDown':
      return { type: 'move', active: last };
    case 'Enter':
    case ' ':
    case 'Tab':
      return { type: 'select', index: active };
    case 'Escape':
      return { type: 'close' };
    default:
      return { type: 'none' };
  }
}

/**
 * Type to find: the next option after `from` with a word that starts with the typed text,
 * so "d" finds Germany by its code DE and "it" finds Italy. Typing the same letter again
 * moves on to the next match. -1 when nothing matches.
 */
export function typeahead(labels: string[], typed: string, from: number): number {
  const query = typed.trim().toLowerCase();
  if (!query) return -1;
  for (let step = 1; step <= labels.length; step += 1) {
    const index = (from + step) % labels.length;
    const words = (labels[index] ?? '').toLowerCase().split(/[^\p{L}\p{N}]+/u);
    if (words.some((word) => word.startsWith(query))) return index;
  }
  return -1;
}
