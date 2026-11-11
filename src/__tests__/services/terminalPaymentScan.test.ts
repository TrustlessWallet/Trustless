import { TerminalPaymentScan } from '../../services/terminalPaymentScan';

it('bounds each check and reaches old targets across repeated checks', async () => {
  const scanner = new TerminalPaymentScan<number>();
  const rows = Array.from({ length: 1252 }, (_, i) => i);
  const read = jest.fn(async (offset, limit) => rows.slice(offset, offset + limit));
  for (let i = 0; i < 5; i++) {
    expect(await scanner.find('invoice', read, n => n === 1251, () => {})).toBeNull();
    expect(read).toHaveBeenCalledTimes((i + 1) * 5);
  }
  expect(await scanner.find('invoice', read, n => n === 1251, () => {})).toBe(1251);
});

it('retries the failed page without losing successful progress', async () => {
  const scanner = new TerminalPaymentScan<number>();
  const read = jest.fn().mockResolvedValueOnce(Array(50).fill(0)).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([1]);
  await expect(scanner.find('a', read, n => n === 1, () => {})).rejects.toThrow('offline');
  expect(await scanner.find('a', read, n => n === 1, () => {})).toBe(1);
  expect(read.mock.calls.map(([offset]) => offset)).toEqual([0, 50, 50]);
});

it('coalesces overlapping checks and rejects stale responses without advancing', async () => {
  const scanner = new TerminalPaymentScan<number>();
  let finish!: (rows: number[]) => void;
  const read = jest.fn(() => new Promise<number[]>(resolve => { finish = resolve; }));
  let current = true;
  const assertCurrent = () => { if (!current) throw new Error('changed'); };
  const first = scanner.find('old', read, n => n === 1, assertCurrent);
  const second = scanner.find('old', read, n => n === 1, assertCurrent);
  expect(read).toHaveBeenCalledTimes(1);
  current = false;
  finish([1]);
  await expect(first).rejects.toThrow('changed');
  await expect(second).rejects.toThrow('changed');
  const fresh = jest.fn(async () => [2]);
  expect(await scanner.find('new', fresh, n => n === 2, () => {})).toBe(2);
  expect(fresh).toHaveBeenCalledWith(0, 50);
});

it('leaves unmatched and duplicate pages unresolved, then restarts after exhaustion', async () => {
  const scanner = new TerminalPaymentScan<number>();
  const read = jest.fn().mockResolvedValueOnce(Array(50).fill(0)).mockResolvedValueOnce(Array(50).fill(0)).mockResolvedValueOnce([]).mockResolvedValueOnce([1]);
  expect(await scanner.find('a', read, n => n === 1, () => {})).toBeNull();
  expect(await scanner.find('a', read, n => n === 1, () => {})).toBe(1);
  expect(read.mock.calls.map(([offset]) => offset)).toEqual([0, 50, 100, 0]);
});
