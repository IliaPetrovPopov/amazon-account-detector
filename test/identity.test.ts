import { describe as group, expect, it } from 'vitest';
import {
  ACCOUNT_COLORS,
  NAME_MAX_LENGTH,
  accountColor,
  accountLabel,
  accountsInOrder,
  assignColors,
  cleanName,
  initials,
  monogram,
  nameFor,
  pinState,
  sameColors,
  withName,
} from '../src/identity';

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

group('account colours', () => {
  it('carry white initials at 4.5:1 or better', () => {
    for (const color of ACCOUNT_COLORS) expect(contrast('#FFFFFF', color)).toBeGreaterThanOrEqual(4.5);
  });

  it('stand out at 3:1 on the light surface and on both dark surfaces', () => {
    for (const color of ACCOUNT_COLORS) {
      for (const surface of ['#FFFFFF', '#F5F7FB', '#101A2E', '#0B1424']) {
        expect(contrast(color, surface)).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('are all different', () => {
    expect(new Set(ACCOUNT_COLORS).size).toBe(ACCOUNT_COLORS.length);
  });
});

group('assignColors', () => {
  it('gives accounts the first free colours, in the order they appeared', () => {
    expect(assignColors({}, ['a@x.test', 'b@x.test', 'a@x.test', 'c@x.test'])).toEqual({
      'a@x.test': 0,
      'b@x.test': 1,
      'c@x.test': 2,
    });
  });

  it('keeps the colour an account already has', () => {
    expect(assignColors({ 'b@x.test': 3 }, ['a@x.test', 'b@x.test'])).toEqual({ 'b@x.test': 3, 'a@x.test': 0 });
  });

  it('frees the colour of an account that is gone, and hands it to the next new one', () => {
    expect(assignColors({ 'a@x.test': 0, 'b@x.test': 1 }, ['b@x.test', 'c@x.test'])).toEqual({
      'b@x.test': 1,
      'c@x.test': 0,
    });
  });

  it('treats case and spaces as the same account', () => {
    expect(assignColors({}, [' Alice@Example.test', 'alice@example.test '])).toEqual({ 'alice@example.test': 0 });
  });

  it('gives as many accounts as there are colours a colour each', () => {
    const emails = ACCOUNT_COLORS.map((_, i) => `user${i}@x.test`);
    expect(new Set(Object.values(assignColors({}, emails))).size).toBe(ACCOUNT_COLORS.length);
  });

  it('only shares a colour once there are more accounts than colours', () => {
    const emails = [...ACCOUNT_COLORS, 'extra'].map((_, i) => `user${i}@x.test`);
    const slots = assignColors({}, emails);
    expect(Object.keys(slots)).toHaveLength(emails.length);
    for (const slot of Object.values(slots)) expect(slot).toBeLessThan(ACCOUNT_COLORS.length);
  });

  it('ignores a stored colour that is not in the palette', () => {
    expect(assignColors({ 'a@x.test': 99 }, ['a@x.test'])).toEqual({ 'a@x.test': 0 });
  });

  it('returns nothing when no account is around', () => {
    expect(assignColors({ 'a@x.test': 0 }, [])).toEqual({});
  });
});

group('accountColor', () => {
  it('uses the stored colour', () => {
    expect(accountColor({ 'alice@x.test': 2 }, ' ALICE@x.test')).toBe(ACCOUNT_COLORS[2]);
  });

  it('before one is stored, shows the colour that is about to be handed out', () => {
    expect(accountColor({}, 'bob@x.test')).toBe(ACCOUNT_COLORS[0]);
    expect(accountColor({ 'alice@x.test': 0, 'carol@x.test': 1 }, 'bob@x.test')).toBe(ACCOUNT_COLORS[2]);
    const full = Object.fromEntries(ACCOUNT_COLORS.map((_, i) => [`user${i}@x.test`, i]));
    expect(accountColor(full, 'new@x.test')).toBe(accountColor(full, ' NEW@x.test'));
    expect(ACCOUNT_COLORS).toContain(accountColor(full, 'new@x.test'));
  });

  it('ignores a stored colour that is not in the palette', () => {
    expect(accountColor({ 'alice@x.test': 42 }, 'alice@x.test')).toBe(ACCOUNT_COLORS[0]);
  });
});

group('accountsInOrder', () => {
  it('lists history first, oldest event first, then current answers and pins', () => {
    const history = [
      { at: 30, email: 'c@x.test' },
      { at: 10, email: 'a@x.test' },
      { at: 20, email: null },
    ];
    expect(accountsInOrder(history, ['b@x.test', null, 'a@x.test'])).toEqual(['a@x.test', 'c@x.test', 'b@x.test', 'a@x.test']);
  });
});

group('sameColors', () => {
  it('compares every account', () => {
    expect(sameColors({ a: 0, b: 1 }, { b: 1, a: 0 })).toBe(true);
    expect(sameColors({ a: 0 }, { a: 1 })).toBe(false);
    expect(sameColors({ a: 0 }, { a: 0, b: 1 })).toBe(false);
  });
});

group('monogram', () => {
  it.each([
    ['alice.lindqvist@example.com', 'AL'],
    ['bob@example.com', 'B'],
    ['j.doe99@example.com', 'JD'],
    ['carol_dupont+amazon@example.com', 'CD'],
    ['élodie.brun@example.fr', 'ÉB'],
    ['"odd@local"@example.com', 'OL'],
    ['+44 7700 900123', ''],
    ['12345@example.com', ''],
  ])('%s shows %s', (email, expected) => {
    expect(monogram(email)).toBe(expected);
  });
});

group('pinState', () => {
  it('has nothing to compare without a pin or a signed-in email', () => {
    expect(pinState(null, 'alice@example.test')).toBe('none');
    expect(pinState(undefined, 'alice@example.test')).toBe('none');
    expect(pinState('', 'alice@example.test')).toBe('none');
    expect(pinState('alice@example.test', null)).toBe('none');
  });

  it('matches regardless of case and spaces', () => {
    expect(pinState(' ALICE@example.test', 'alice@example.test ')).toBe('match');
  });

  it('flags a different account', () => {
    expect(pinState('alice@example.test', 'bob@example.test')).toBe('mismatch');
  });
});

group('cleanName', () => {
  it('keeps one tidy line', () => {
    expect(cleanName('  Main   buyer  ')).toBe('Main buyer');
    expect(cleanName('Main\nbuyer\tUK')).toBe('Main buyer UK');
    expect(cleanName('   ')).toBe('');
  });

  it('drops control characters and direction overrides that could disguise the text', () => {
    expect(cleanName('Bob\u202E  the\u0007 builder')).toBe('Bob the builder');
    expect(cleanName('\u2066Shop\u2069')).toBe('Shop');
  });

  it('keeps at most 40 characters, never splitting an emoji or an accented letter', () => {
    expect(cleanName('x'.repeat(60))).toHaveLength(NAME_MAX_LENGTH);
    const family = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}';
    const capped = cleanName(`${'a'.repeat(39)}${family}tail`);
    expect(capped.endsWith(family)).toBe(true);
    expect(cleanName('Zoë Ølstad')).toBe('Zoë Ølstad');
  });
});

group('nicknames', () => {
  const names = { 'alice@example.com': 'Main buyer' };

  it('are found by email whatever its case', () => {
    expect(nameFor(names, 'Alice@Example.com')).toBe('Main buyer');
    expect(nameFor(names, 'bob@example.com')).toBeNull();
    expect(nameFor(names, null)).toBeNull();
  });

  it('never replace the email in a sentence', () => {
    expect(accountLabel(names, 'alice@example.com')).toBe('Main buyer (alice@example.com)');
    expect(accountLabel(names, 'bob@example.com')).toBe('bob@example.com');
  });

  it('are set cleaned, and removed when nothing is left', () => {
    expect(withName({}, 'Bob@Example.com', '  Backup  ')).toEqual({ 'bob@example.com': 'Backup' });
    expect(withName(names, 'alice@example.com', '   ')).toEqual({});
    expect(withName(names, 'alice@example.com', 'UK account')).toEqual({ 'alice@example.com': 'UK account' });
    expect(names).toEqual({ 'alice@example.com': 'Main buyer' });
  });

  it('give avatars their initials, digits included', () => {
    expect(initials('Main buyer')).toBe('MB');
    expect(initials('Buyer 3')).toBe('B3');
    expect(initials('über konto')).toBe('ÜK');
    expect(initials('\u{1F6D2}')).toBe('');
  });
});
