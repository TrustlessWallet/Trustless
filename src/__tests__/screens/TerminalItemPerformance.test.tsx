import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import TerminalItemPerformance from '../../components/TerminalItemPerformance';
import { getTerminalItemPerformance } from '../../services/terminalItemPerformance';

jest.mock('../../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: { colors: { primary: '#000', border: '#ccc', muted: '#888', bitcoin: '#f90' } } }) }));
jest.mock('../../services/terminalItemPerformance', () => ({
  getTerminalItemPerformance: jest.fn(),
  formatTerminalItemGross: (gross: bigint, unit: string) => unit === 'sats' ? `${gross} sats` : `${unit} ${gross}`,
}));

const summary = (receivedCount = 2) => ({ activityCount: receivedCount, receivedCount, sats: 0n, bitcoinSats: 0n, fiatMinor: {} });
const props = { walletId: 'wallet-a', network: 'mainnet' as const, scope: 'mainnet:wallet-a', range: { start: 100, end: 200 }, visible: true, currentSummary: summary(), currentRefunds: 25n };

beforeEach(() => jest.clearAllMocks());

it('renders paid snapshot names with quantity, currency-visible gross, and exclusion notes', async () => {
  (getTerminalItemPerformance as jest.Mock).mockResolvedValue({
    items: [
      { itemId: 'coffee', name: 'Original paid snapshot', unit: 'USD', quantity: 7n, gross: 1250n },
      { itemId: 'tip', name: 'Tips', unit: 'sats', quantity: 3n, gross: 900n },
    ],
    hasMore: false,
    paidWithoutItems: 1,
  });
  const view = render(<TerminalItemPerformance {...props} />);
  await waitFor(() => expect(view.getByText('Original paid snapshot')).toBeTruthy());
  expect(view.getByLabelText('Original paid snapshot, quantity 7, gross USD 1250')).toBeTruthy();
  expect(view.getByLabelText('Tips, quantity 3, gross 900 sats')).toBeTruthy();
  expect(view.getByText('By quantity · gross sales')).toBeTruthy();
  expect(view.getByText('Refunds aren’t assigned to items.')).toBeTruthy();
  expect(view.getByText('1 paid sale without item details excluded')).toBeTruthy();
});

it('clears an old result immediately and ignores it after wallet and range change', async () => {
  let finishOld!: (value: unknown) => void;
  let finishNew!: (value: unknown) => void;
  (getTerminalItemPerformance as jest.Mock)
    .mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }))
    .mockImplementationOnce(() => new Promise(resolve => { finishNew = resolve; }));
  const view = render(<TerminalItemPerformance {...props} />);
  await waitFor(() => expect(finishOld).toBeDefined());
  view.rerender(<TerminalItemPerformance {...props} walletId="wallet-b" scope="mainnet:wallet-b" range={{ start: 200, end: 300 }} />);
  expect(view.queryByText('Old item')).toBeNull();
  await waitFor(() => expect(finishNew).toBeDefined());
  await act(async () => { finishNew({ items: [{ itemId: 'new', name: 'New item', unit: 'EUR', quantity: 2n, gross: 400n }], hasMore: false, paidWithoutItems: 0 }); });
  await waitFor(() => expect(view.getByText('New item')).toBeTruthy());
  await act(async () => { finishOld({ items: [{ itemId: 'old', name: 'Old item', unit: 'USD', quantity: 99n, gross: 999n }], hasMore: false, paidWithoutItems: 0 }); });
  expect(view.queryByText('Old item')).toBeNull();
  expect(view.getByText('New item')).toBeTruthy();
});

it('shows a compact retry without disturbing the supplied current summary', async () => {
  (getTerminalItemPerformance as jest.Mock).mockRejectedValueOnce(new Error('failed'));
  const view = render(<TerminalItemPerformance {...props} />);
  await waitFor(() => expect(view.getByText('Item performance unavailable')).toBeTruthy());
  (getTerminalItemPerformance as jest.Mock).mockResolvedValueOnce({ items: [{ itemId: 'retry', name: 'Recovered item', unit: 'CHF', quantity: 1n, gross: 500n }], hasMore: false, paidWithoutItems: 0 });
  fireEvent.press(view.getByLabelText('Retry top items'));
  await waitFor(() => expect(view.getByText('Recovered item')).toBeTruthy());
  expect(getTerminalItemPerformance).toHaveBeenCalledTimes(2);
});

it('uses the item fallback only when paid sales exist', async () => {
  (getTerminalItemPerformance as jest.Mock).mockResolvedValue({ items: [], hasMore: false, paidWithoutItems: 2 });
  const view = render(<TerminalItemPerformance {...props} currentRefunds={0n} />);
  await waitFor(() => expect(view.getByText('No item sales in this period')).toBeTruthy());
  expect(view.getByText('2 paid sales without item details excluded')).toBeTruthy();
  view.rerender(<TerminalItemPerformance {...props} currentSummary={summary(0)} currentRefunds={0n} />);
  expect(view.queryByText('No item sales in this period')).toBeNull();
});
