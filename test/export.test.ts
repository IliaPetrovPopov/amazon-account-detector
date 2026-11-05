import { describe as group, expect, it } from 'vitest';
import { CSV_HEADER, csvCell, csvFileName, historyCsv, historyStats, localTimestamp, type History } from '../src/export';
import type { HistoryEvent } from '../src/types';

const at = (day: number, hour: number, minute = 0) => new Date(2026, 10, day, hour, minute, 0).getTime();

function history(partial: Partial<History>): History {
  return { com: [], 'co.uk': [], de: [], it: [], fr: [], ...partial };
}

/** Parses the simple CSV the export writes: every cell quoted, CRLF between lines. */
function parse(csv: string): string[][] {
  return csv
    .replace(/^﻿/, '')
    .trimEnd()
    .split('\r\n')
    .map((line) => [...line.matchAll(/"((?:[^"]|"")*)"/g)].map((match) => (match[1] ?? '').replaceAll('""', '"')));
}

group('csvCell', () => {
  it('quotes every cell and doubles quotes inside', () => {
    expect(csvCell('plain')).toBe('"plain"');
    expect(csvCell('say "hi", then go')).toBe('"say ""hi"", then go"');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
  });

  it('keeps a spreadsheet from running a cell as a formula', () => {
    expect(csvCell('+44 7700 900123')).toBe(`"'+44 7700 900123"`);
    expect(csvCell('=HYPERLINK("http://x")')).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(csvCell('-1')).toBe(`"'-1"`);
    expect(csvCell('@SUM(A1)')).toBe(`"'@SUM(A1)"`);
    expect(csvCell('alice@example.test')).toBe('"alice@example.test"');
  });
});

group('historyCsv', () => {
  const events: HistoryEvent[] = [
    { at: at(4, 9), email: null },
    { at: at(4, 10, 30), email: 'alice@example.test' },
    { at: at(5, 8, 15), email: 'bob@example.test' },
  ];

  it('writes one line per stretch of time, oldest first, with "To" empty for the current one', () => {
    const rows = parse(historyCsv(history({ de: events }), {}));
    expect(rows[0]).toEqual(CSV_HEADER);
    expect(rows.slice(1)).toEqual([
      ['amazon.de', 'Signed out', '', '', '2026-11-04 09:00:00', '2026-11-04 10:30:00'],
      ['amazon.de', 'Signed in', 'alice@example.test', '', '2026-11-04 10:30:00', '2026-11-05 08:15:00'],
      ['amazon.de', 'Signed in', 'bob@example.test', '', '2026-11-05 08:15:00', ''],
    ]);
  });

  it('adds nicknames, groups by marketplace in the usual order, and sorts events that arrive out of order', () => {
    const rows = parse(
      historyCsv(
        history({
          fr: [{ at: at(5, 7), email: 'alice@example.test' }],
          com: [
            { at: at(5, 6), email: 'Alice@Example.test' },
            { at: at(5, 5), email: null },
          ],
        }),
        { 'alice@example.test': 'Main buyer' },
      ),
    );
    expect(rows.slice(1).map((row) => [row[0], row[2], row[3], row[4]])).toEqual([
      ['amazon.com', '', '', '2026-11-05 05:00:00'],
      ['amazon.com', 'Alice@Example.test', 'Main buyer', '2026-11-05 06:00:00'],
      ['amazon.fr', 'alice@example.test', 'Main buyer', '2026-11-05 07:00:00'],
    ]);
  });

  it('opens cleanly in Excel: byte order mark, CRLF line ends, phone accounts kept as text', () => {
    const csv = historyCsv(history({ it: [{ at: at(5, 9), email: '+44 7700 900123' }] }), {});
    expect(csv.startsWith('﻿"Marketplace"')).toBe(true);
    expect(csv.endsWith('\r\n')).toBe(true);
    expect(csv.split('\r\n')).toHaveLength(3);
    expect(csv).toContain(`"'+44 7700 900123"`);
  });

  it('is just the header when there is no history', () => {
    expect(parse(historyCsv(history({}), {}))).toEqual([CSV_HEADER]);
  });
});

group('export helpers', () => {
  it('formats local time the way spreadsheets read it', () => {
    expect(localTimestamp(new Date(2026, 0, 2, 3, 4, 5).getTime())).toBe('2026-01-02 03:04:05');
  });

  it('names the file after the day', () => {
    expect(csvFileName(at(5, 23, 59))).toBe('amazon-accounts-2026-11-05.csv');
  });

  it('counts the stretches and finds the oldest', () => {
    expect(historyStats(history({}))).toEqual({ periods: 0, since: null });
    expect(historyStats(history({ de: [{ at: at(5, 9), email: null }], it: [{ at: at(3, 9), email: 'a@example.test' }] }))).toEqual({
      periods: 2,
      since: at(3, 9),
    });
  });
});
