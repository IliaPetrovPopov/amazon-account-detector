import { describe as group, expect, it } from 'vitest';
import { comboKey, typeahead } from '../src/listbox';

const COUNT = 5;

group('comboKey while the list is closed', () => {
  it.each(['ArrowDown', 'ArrowUp', 'Enter', ' '])('%s opens on the current option', (key) => {
    expect(comboKey(key, false, 2, COUNT)).toEqual({ type: 'open', active: 2 });
  });

  it('Home and End open on the first and last option', () => {
    expect(comboKey('Home', false, 2, COUNT)).toEqual({ type: 'open', active: 0 });
    expect(comboKey('End', false, 2, COUNT)).toEqual({ type: 'open', active: 4 });
  });

  it('leaves other keys alone, Tab and Escape included', () => {
    for (const key of ['Tab', 'Escape', 'a', 'Shift']) expect(comboKey(key, false, 2, COUNT)).toEqual({ type: 'none' });
  });
});

group('comboKey while the list is open', () => {
  it('arrows move one option and stop at the ends', () => {
    expect(comboKey('ArrowDown', true, 2, COUNT)).toEqual({ type: 'move', active: 3 });
    expect(comboKey('ArrowDown', true, 4, COUNT)).toEqual({ type: 'move', active: 4 });
    expect(comboKey('ArrowUp', true, 2, COUNT)).toEqual({ type: 'move', active: 1 });
    expect(comboKey('ArrowUp', true, 0, COUNT)).toEqual({ type: 'move', active: 0 });
  });

  it('Home, End, PageUp and PageDown jump to the ends', () => {
    expect(comboKey('Home', true, 3, COUNT)).toEqual({ type: 'move', active: 0 });
    expect(comboKey('PageUp', true, 3, COUNT)).toEqual({ type: 'move', active: 0 });
    expect(comboKey('End', true, 1, COUNT)).toEqual({ type: 'move', active: 4 });
    expect(comboKey('PageDown', true, 1, COUNT)).toEqual({ type: 'move', active: 4 });
  });

  it('Enter, Space, Tab and Alt+Up choose the active option', () => {
    for (const key of ['Enter', ' ', 'Tab']) expect(comboKey(key, true, 3, COUNT)).toEqual({ type: 'select', index: 3 });
    expect(comboKey('ArrowUp', true, 3, COUNT, true)).toEqual({ type: 'select', index: 3 });
  });

  it('Escape closes without choosing', () => {
    expect(comboKey('Escape', true, 3, COUNT)).toEqual({ type: 'close' });
  });
});

group('typeahead', () => {
  const labels = [
    'US United States amazon.com',
    'UK United Kingdom amazon.co.uk',
    'DE Germany amazon.de',
    'IT Italy amazon.it',
    'FR France amazon.fr',
  ];

  it('finds a marketplace by its code, its country or its domain', () => {
    expect(typeahead(labels, 'd', 0)).toBe(2);
    expect(typeahead(labels, 'g', 0)).toBe(2);
    expect(typeahead(labels, 'fr', 0)).toBe(4);
    expect(typeahead(labels, 'ital', 0)).toBe(3);
    expect(typeahead(labels, 'co', 0)).toBe(1);
  });

  it('moves on to the next match when the same letter is typed again', () => {
    expect(typeahead(labels, 'u', 0)).toBe(1);
    expect(typeahead(labels, 'u', 1)).toBe(0);
  });

  it('ignores case and surrounding spaces', () => {
    expect(typeahead(labels, ' IT ', 0)).toBe(3);
  });

  it('reports no match', () => {
    expect(typeahead(labels, 'x', 0)).toBe(-1);
    expect(typeahead(labels, '', 0)).toBe(-1);
  });
});
