import { isInTerminalSalesPeriod, terminalSalesPeriodBounds } from '../../services/terminalSalesPeriod';

it('uses inclusive local midnight and exclusive next midnight for today', () => {
  const day = new Date(2026, 9, 20, 15, 42);
  const start = new Date(2026, 9, 20).getTime();
  const end = new Date(2026, 9, 21).getTime();
  expect(terminalSalesPeriodBounds('today', day)).toEqual({ start, end });
  expect(isInTerminalSalesPeriod(start, 'today', day)).toBe(true);
  expect(isInTerminalSalesPeriod(end - 1, 'today', day)).toBe(true);
  expect(isInTerminalSalesPeriod(start - 1, 'today', day)).toBe(false);
  expect(isInTerminalSalesPeriod(end, 'today', day)).toBe(false);
  expect(terminalSalesPeriodBounds('all', day)).toBeNull();
  expect(isInTerminalSalesPeriod(start - 1, 'all', day)).toBe(true);
});

it('starts the rolling week six calendar days before today, across a year boundary', () => {
  const day = new Date(2026, 0, 2, 18);
  expect(terminalSalesPeriodBounds('week', day)).toEqual({
    start: new Date(2025, 11, 27).getTime(),
    end: new Date(2026, 0, 3).getTime(),
  });
  expect(isInTerminalSalesPeriod(new Date(2025, 11, 26, 23, 59).getTime(), 'week', day)).toBe(false);
  expect(isInTerminalSalesPeriod(new Date(2025, 11, 27).getTime(), 'week', day)).toBe(true);
});

it('starts month to date on the first, including leap day and excluding tomorrow', () => {
  const day = new Date(2024, 1, 29, 8);
  expect(terminalSalesPeriodBounds('month', day)).toEqual({
    start: new Date(2024, 1, 1).getTime(),
    end: new Date(2024, 2, 1).getTime(),
  });
  expect(isInTerminalSalesPeriod(new Date(2024, 0, 31, 23, 59).getTime(), 'month', day)).toBe(false);
  expect(isInTerminalSalesPeriod(new Date(2024, 1, 29, 23, 59).getTime(), 'month', day)).toBe(true);
  expect(isInTerminalSalesPeriod(new Date(2024, 2, 1).getTime(), 'month', day)).toBe(false);
});

it('uses calendar arithmetic through daylight saving transitions', () => {
  // Use a real transition in the runner's timezone. Set TZ=America/New_York
  // before starting Jest to exercise both 23-hour and 25-hour days.
  const durations = new Set<number>();
  for (let month = 0; month < 12; month++) {
    for (let date = 1; date <= new Date(2026, month + 1, 0).getDate(); date++) {
      const day = new Date(2026, month, date, 12);
      const bounds = terminalSalesPeriodBounds('today', day)!;
      expect(bounds.start).toBe(new Date(2026, month, date).getTime());
      expect(bounds.end).toBe(new Date(2026, month, date + 1).getTime());
      durations.add((bounds.end - bounds.start) / 3_600_000);
    }
  }
  if (new Date(2026, 0, 1).getTimezoneOffset() !== new Date(2026, 6, 1).getTimezoneOffset()) {
    expect(durations).toContain(23);
    expect(durations).toContain(25);
  }
});

it('rejects invalid periods, dates, and timestamps', () => {
  expect(() => terminalSalesPeriodBounds('bad' as never, new Date())).toThrow();
  expect(() => terminalSalesPeriodBounds('all', new Date(NaN))).toThrow();
  expect(() => isInTerminalSalesPeriod(NaN, 'all', new Date())).toThrow();
});
