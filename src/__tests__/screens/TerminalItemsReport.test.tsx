import React from 'react';
import { FlatList } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import TerminalItemsReport from '../../components/TerminalItemsReport';
import { createTerminalItemPerformanceSnapshot, readTerminalItemPerformancePage, removeTerminalItemPerformanceSnapshot } from '../../services/terminalItemPerformance';

jest.mock('../../services/terminalItemsExport', () => ({ exportTerminalItemsCsv: jest.fn() }));
jest.mock('../../components/GlassIconButton', () => { const React = require('react'); const { TouchableOpacity } = require('react-native'); return ({ children, ...props }: any) => <TouchableOpacity {...props}>{children}</TouchableOpacity>; });

jest.mock('../../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: { colors: { background: '#fff', primary: '#000', surface: '#eee', muted: '#888', border: '#ccc', bitcoin: '#f90' } } }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('../../services/terminalItemPerformance', () => ({
  createTerminalItemPerformanceSnapshot: jest.fn(),
  readTerminalItemPerformancePage: jest.fn(),
  removeTerminalItemPerformanceSnapshot: jest.fn(async () => undefined),
  formatTerminalItemGross: (gross: bigint, unit: string) => `${unit} ${gross}`,
}));

const row = (index: number, unit: 'USD' | 'EUR' | 'CHF' | 'sats' = 'USD') => ({ itemId: `item-${index}`, name: `Readable item ${index}`, unit, quantity: BigInt(index), gross: BigInt(index * 100) });
const props = { walletId: 'wallet-a', network: 'mainnet' as const, scope: 'mainnet:wallet-a', range: { start: 100, end: 200 }, visible: true, revision: 0, listHeader: <></> };

beforeEach(() => {
  jest.clearAllMocks();
  (createTerminalItemPerformanceSnapshot as jest.Mock).mockResolvedValue({ token: 'token-a', totalCount: 0, paidWithoutItems: 0 });
  (readTerminalItemPerformancePage as jest.Mock).mockResolvedValue({ items: [], nextSeq: null });
});

it('pages all item rows in batches and retries a failed page without losing rows', async () => {
  const first = Array.from({ length: 20 }, (_, index) => row(index + 1));
  const last = Array.from({ length: 5 }, (_, index) => row(index + 21));
  (createTerminalItemPerformanceSnapshot as jest.Mock).mockResolvedValue({ token: 'paged-token', totalCount: 25, paidWithoutItems: 2 });
  (readTerminalItemPerformancePage as jest.Mock)
    .mockResolvedValueOnce({ items: first, nextSeq: 20 })
    .mockRejectedValueOnce(new Error('page failed'))
    .mockResolvedValueOnce({ items: last, nextSeq: null });
  const view = render(<TerminalItemsReport {...props} />);
  await waitFor(() => expect(view.UNSAFE_getByType(FlatList).props.data).toHaveLength(20));
  act(() => { view.UNSAFE_getByType(FlatList).props.onEndReached(); });
  await waitFor(() => expect(view.getByLabelText('Retry loading more items')).toBeTruthy());
  expect(view.getByText('Readable item 1')).toBeTruthy();
  fireEvent.press(view.getByLabelText('Retry loading more items'));
  await waitFor(() => expect(view.UNSAFE_getByType(FlatList).props.data).toHaveLength(25));
  expect(readTerminalItemPerformancePage).toHaveBeenLastCalledWith('paged-token', 20, 20);
  expect(view.getByText('2 paid sales without item details excluded.')).toBeTruthy();
});

it('requires a currency for gross sorting and returning to All restores quantity sorting', async () => {
  const view = render(<TerminalItemsReport {...props} />);
  await waitFor(() => expect(createTerminalItemPerformanceSnapshot).toHaveBeenCalledWith('wallet-a', 'mainnet', props.range, { sort: 'quantity', unit: null }));
  const allList = view.getByTestId('terminal-items-report');
  const gross = view.getByLabelText('Sort items by gross');
  expect(gross.props.accessibilityState.disabled).toBe(true);
  expect(gross.props.accessibilityHint).toBe('Choose a currency to sort by gross sales');
  fireEvent.press(view.getByLabelText('Item currency All'));
  fireEvent.press(view.getByLabelText('Item currency option USD'));
  await waitFor(() => expect(createTerminalItemPerformanceSnapshot).toHaveBeenLastCalledWith('wallet-a', 'mainnet', props.range, { sort: 'quantity', unit: 'USD' }));
  expect(view.getByTestId('terminal-items-report')).not.toBe(allList);
  expect(view.getByText('0 results · USD')).toBeTruthy();
  fireEvent.press(view.getByLabelText('Sort items by gross'));
  await waitFor(() => expect(createTerminalItemPerformanceSnapshot).toHaveBeenLastCalledWith('wallet-a', 'mainnet', props.range, { sort: 'gross', unit: 'USD' }));
  fireEvent.press(view.getByLabelText('Item currency USD'));
  fireEvent.press(view.getByLabelText('Item currency option All'));
  await waitFor(() => expect(createTerminalItemPerformanceSnapshot).toHaveBeenLastCalledWith('wallet-a', 'mainnet', props.range, { sort: 'quantity', unit: null }));
});

it('removes every late snapshot across an A-B-A filter sequence and after unmount', async () => {
  const finishes: Array<(value: unknown) => void> = [];
  (createTerminalItemPerformanceSnapshot as jest.Mock).mockImplementation(() => new Promise(resolve => finishes.push(resolve)));
  const view = render(<TerminalItemsReport {...props} />);
  await waitFor(() => expect(finishes).toHaveLength(1));
  fireEvent.press(view.getByLabelText('Item currency All'));
  fireEvent.press(view.getByLabelText('Item currency option EUR'));
  await waitFor(() => expect(finishes).toHaveLength(2));
  fireEvent.press(view.getByLabelText('Item currency EUR'));
  fireEvent.press(view.getByLabelText('Item currency option All'));
  await waitFor(() => expect(finishes).toHaveLength(3));
  await act(async () => { finishes[2]({ token: 'current-a', totalCount: 0, paidWithoutItems: 0 }); });
  await waitFor(() => expect(readTerminalItemPerformancePage).toHaveBeenCalledWith('current-a', 0, 20));
  await act(async () => { finishes[1]({ token: 'late-b', totalCount: 0, paidWithoutItems: 0 }); finishes[0]({ token: 'late-a', totalCount: 0, paidWithoutItems: 0 }); });
  await waitFor(() => expect(removeTerminalItemPerformanceSnapshot).toHaveBeenCalledWith('late-b'));
  expect(removeTerminalItemPerformanceSnapshot).toHaveBeenCalledWith('late-a');
  view.unmount();
  await waitFor(() => expect(removeTerminalItemPerformanceSnapshot).toHaveBeenCalledWith('current-a'));

  let finishUnmounted!: (value: unknown) => void;
  (createTerminalItemPerformanceSnapshot as jest.Mock).mockImplementationOnce(() => new Promise(resolve => { finishUnmounted = resolve; }));
  const second = render(<TerminalItemsReport {...props} />);
  await waitFor(() => expect(finishUnmounted).toBeDefined());
  second.unmount();
  await act(async () => { finishUnmounted({ token: 'after-unmount', totalCount: 0, paidWithoutItems: 0 }); });
  await waitFor(() => expect(removeTerminalItemPerformanceSnapshot).toHaveBeenCalledWith('after-unmount'));
});

it('keeps loaded rows when a background revision refresh fails and retries the current report', async () => {
  (createTerminalItemPerformanceSnapshot as jest.Mock)
    .mockResolvedValueOnce({ token: 'stable-token', totalCount: 1, paidWithoutItems: 0 })
    .mockRejectedValueOnce(new Error('refresh failed'))
    .mockResolvedValueOnce({ token: 'retry-token', totalCount: 1, paidWithoutItems: 0 });
  (readTerminalItemPerformancePage as jest.Mock).mockResolvedValue({ items: [row(1, 'sats')], nextSeq: null });
  const view = render(<TerminalItemsReport {...props} />);
  await waitFor(() => expect(view.getByText('Readable item 1')).toBeTruthy());
  const list = view.getByTestId('terminal-items-report');
  view.rerender(<TerminalItemsReport {...props} revision={1} />);
  await waitFor(() => expect(view.getByText('Couldn’t refresh item report')).toBeTruthy());
  expect(view.getByTestId('terminal-items-report')).toBe(list);
  expect(view.getByText('Readable item 1')).toBeTruthy();
  act(() => { view.UNSAFE_getByType(FlatList).props.onEndReached(); });
  expect(readTerminalItemPerformancePage).toHaveBeenCalledTimes(1);
  fireEvent.press(view.getByLabelText('Retry item report'));
  await waitFor(() => expect(createTerminalItemPerformanceSnapshot).toHaveBeenCalledTimes(3));
  expect(view.getByText('Readable item 1')).toBeTruthy();
});

it('exports the applied currency and sort, blocks duplicate taps and cancels when selection changes', async () => {
  let finish!: () => void;
  const { exportTerminalItemsCsv } = require('../../services/terminalItemsExport');
  exportTerminalItemsCsv.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  const selection = { period: 'custom' as const, day: new Date(2026, 9, 27), customRange: { startDate: '2026-10-01', endDate: '2026-10-20' } };
  const header = (button: React.ReactNode) => <>{button}</>;
  const view = render(<TerminalItemsReport {...props} exportSelection={selection} renderSheetHeader={header} />);
  fireEvent.press(view.getByLabelText('Item currency All'));
  fireEvent.press(view.getByLabelText('Item currency option EUR'));
  fireEvent.press(view.getByLabelText('Sort items by gross'));
  fireEvent.press(view.getByLabelText('Export item report'));
  fireEvent.press(view.getByLabelText('Export item report'));
  expect(exportTerminalItemsCsv).toHaveBeenCalledTimes(1);
  const captured = exportTerminalItemsCsv.mock.calls[0][0];
  expect(captured).toEqual(expect.objectContaining({ walletId: 'wallet-a', network: 'mainnet', ...selection, unit: 'EUR', sort: 'gross' }));
  expect(captured.isCurrent()).toBe(true);
  fireEvent.press(view.getByLabelText('Item currency EUR'));
  fireEvent.press(view.getByLabelText('Item currency option USD'));
  expect(captured.isCurrent()).toBe(false);
  await act(async () => { finish(); });
  exportTerminalItemsCsv.mockRejectedValueOnce(new Error('disk failed'));
  fireEvent.press(view.getByLabelText('Export item report'));
  await waitFor(() => expect(view.getByText('Couldn’t export items. Try again.')).toBeTruthy());
  view.rerender(<TerminalItemsReport {...props} visible={false} exportSelection={selection} renderSheetHeader={header} />);
  expect(view.queryByText('Couldn’t export items. Try again.')).toBeNull();
});

it('invalidates hidden exports even after reopening and lets the new selection export immediately', async () => {
  const { exportTerminalItemsCsv } = require('../../services/terminalItemsExport');
  const finishes: Array<() => void> = [];
  exportTerminalItemsCsv.mockImplementation(() => new Promise<void>(resolve => finishes.push(resolve)));
  const extra = { exportSelection: { period: 'all' as const, day: new Date(2026, 9, 27) }, renderSheetHeader: (button: React.ReactNode) => <>{button}</> };
  const view = render(<TerminalItemsReport {...props} {...extra} />);
  fireEvent.press(view.getByLabelText('Export item report'));
  const old = exportTerminalItemsCsv.mock.calls[0][0];
  view.rerender(<TerminalItemsReport {...props} {...extra} visible={false} />);
  expect(old.isCurrent()).toBe(false);
  view.rerender(<TerminalItemsReport {...props} {...extra} />);
  expect(old.isCurrent()).toBe(false);
  fireEvent.press(view.getByLabelText('Export item report'));
  expect(finishes).toHaveLength(2);
  const current = exportTerminalItemsCsv.mock.calls[1][0];
  expect(current.isCurrent()).toBe(true);
  await act(async () => { finishes[0](); });
  fireEvent.press(view.getByLabelText('Export item report'));
  expect(finishes).toHaveLength(2);
  view.unmount();
  expect(current.isCurrent()).toBe(false);
  await act(async () => { finishes[1](); });
});
