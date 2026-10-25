import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import TerminalRefundScreen from '../../screens/TerminalRefundScreen';
import { useWallet } from '../../contexts/WalletContext';
import { authenticate_terminal_refund } from '../../services/authState';
import { recordTerminalSale, updateTerminalSalePayment } from '../../services/terminalSales';
import { listTerminalRefunds } from '../../services/terminalRefunds';
import { TerminalRequest } from '../../services/terminal';
import { clearTerminalRateCacheForTests } from '../../services/terminalRates';

jest.mock('@react-navigation/native', () => ({ ...jest.requireActual('@react-navigation/native'), useIsFocused: () => true }));

jest.mock('../../contexts/WalletContext', () => ({ useWallet: jest.fn() }));
jest.mock('../../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: { colors: { background: '#fff', primary: '#000', inversePrimary: '#fff', surface: '#eee', muted: '#888', border: '#ccc', bitcoin: '#f90' }, LAYOUT: { radius: 8, inputHeight: 56 } } }) }));
jest.mock('../../components/GlassView', () => ({ GlassView: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('../../components/StyledInput', () => ({ StyledInput: (props: any) => require('react').createElement(require('react-native').TextInput, props) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('@expo/vector-icons', () => ({ Feather: () => null }));
jest.mock('uuid', () => ({ v4: () => 'refund-test-id' }));
jest.mock('../../services/authState', () => ({ authenticate_terminal_refund: jest.fn() }));

const prepareTerminalRefund = jest.fn();
const sendTerminalRefund = jest.fn();
const verifyTerminalRefund = jest.fn();
const request: TerminalRequest = {
  id: 'sale-one', walletId: 'wallet-a', network: 'mainnet', invoice: 'lnbcsaleoneabc', amountSats: 1200,
  createdAt: Date.now(), expiresAt: Date.now() + 60_000,
};

beforeEach(async () => {
  await AsyncStorage.clear();
  clearTerminalRateCacheForTests();
  (global as any).fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { currency: 'BTC', rates: { USD: '100000', EUR: '90000', CHF: '80000' } } }) });
  prepareTerminalRefund.mockReset().mockImplementation(async (invoice, amountSats) => ({ quoteId: 'quote-one', invoice, amountSats, feeSats: 12, expiresAt: Date.now() + 120_000 }));
  sendTerminalRefund.mockReset().mockResolvedValue({ status: 'complete', paymentId: 'payment-one' });
  verifyTerminalRefund.mockReset();
  (authenticate_terminal_refund as jest.Mock).mockReset().mockResolvedValue(true);
  (useWallet as jest.Mock).mockReturnValue({ activeWallet: { id: 'wallet-a' }, isLightningInitialized: true, prepareTerminalRefund, sendTerminalRefund, verifyTerminalRefund });
});

it.each([true, false])('captures a new refund rate at reservation, with outage=%s', async outage => {
  const previous = { currency: 'CHF' as const, rate: '40000', fetchedAt: 1000,
    source: 'coinbase' as const, status: 'stale' as const };
  const original = { ...request, reportingRate: previous };
  await recordTerminalSale(original);
  const sale = await updateTerminalSalePayment(original, { status: 'received' });
  (global as any).fetch = outage ? jest.fn().mockRejectedValue(new Error('provider down')) :
    jest.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { currency: 'BTC', rates: { USD: '100000', EUR: '90000', CHF: '80000' } } }) });
  const view = render(<TerminalRefundScreen sale={sale} attempts={[]} onClose={jest.fn()} />);
  await review(view);
  fireEvent.press(view.getByLabelText('Authorize refund'));
  await waitFor(() => expect(sendTerminalRefund).toHaveBeenCalledTimes(1));
  const [saved] = await listTerminalRefunds('wallet-a', 'mainnet');
  expect(saved.reportingRate).toEqual(outage ? null : {
    currency: 'CHF', rate: '80000', fetchedAt: expect.any(Number), source: 'coinbase', status: 'fresh',
  });
  expect(saved.reportingRate).not.toEqual(previous);
});

it('does not reserve a refund if the screen closes during reporting lookup', async () => {
  const sale = await paidSale();
  (global as any).fetch = jest.fn().mockImplementation(() => new Promise(() => {}));
  const view = render(<TerminalRefundScreen sale={sale} attempts={[]} onClose={jest.fn()} />);
  await review(view);
  fireEvent.press(view.getByLabelText('Authorize refund'));
  await waitFor(() => expect((global as any).fetch).toHaveBeenCalled());
  view.rerender(<TerminalRefundScreen sale={sale} attempts={[]} onClose={jest.fn()} visible={false} />);
  await new Promise(resolve => setTimeout(resolve, 1100));
  expect(await listTerminalRefunds('wallet-a', 'mainnet')).toEqual([]);
  expect(sendTerminalRefund).not.toHaveBeenCalled();
});

async function paidSale() {
  await recordTerminalSale(request);
  return updateTerminalSalePayment(request, { status: 'received', paymentId: 'received-one' });
}

async function review(view: ReturnType<typeof render>) {
  fireEvent.changeText(view.getByLabelText('Customer Lightning invoice'), 'lnbccustomerabc');
  fireEvent.press(view.getByLabelText('Review refund'));
  await waitFor(() => expect(view.getByLabelText('Authorize refund')).toBeTruthy());
}

it('does not reserve or send when device authentication is cancelled', async () => {
  const sale = await paidSale();
  (authenticate_terminal_refund as jest.Mock).mockResolvedValue(false);
  const view = render(<TerminalRefundScreen sale={sale} attempts={[]} onClose={jest.fn()} />);
  await review(view);
  fireEvent.press(view.getByLabelText('Authorize refund'));
  await waitFor(() => expect(authenticate_terminal_refund).toHaveBeenCalledTimes(1));
  expect(sendTerminalRefund).not.toHaveBeenCalled();
  expect(await listTerminalRefunds('wallet-a', 'mainnet')).toEqual([]);
});

it('sends once when authorize is pressed twice', async () => {
  const sale = await paidSale();
  let finishAuth!: (value: boolean) => void;
  (authenticate_terminal_refund as jest.Mock).mockImplementation(() => new Promise(resolve => { finishAuth = resolve; }));
  const view = render(<TerminalRefundScreen sale={sale} attempts={[]} onClose={jest.fn()} />);
  await review(view);
  const authorize = view.getByLabelText('Authorize refund');
  fireEvent.press(authorize);
  fireEvent.press(authorize);
  await act(async () => { finishAuth(true); });
  await waitFor(() => expect(sendTerminalRefund).toHaveBeenCalledTimes(1));
  expect((await listTerminalRefunds('wallet-a', 'mainnet'))[0].status).toBe('complete');
});

it('does not send when reservation storage fails', async () => {
  const sale = await paidSale();
  const original = (AsyncStorage.setItem as jest.Mock).getMockImplementation()!;
  (AsyncStorage.setItem as jest.Mock).mockImplementation((key: string, value: string) => key.startsWith('@terminalRefunds') ? Promise.reject(new Error('disk full')) : original(key, value));
  try {
    const view = render(<TerminalRefundScreen sale={sale} attempts={[]} onClose={jest.fn()} />);
    await review(view);
    fireEvent.press(view.getByLabelText('Authorize refund'));
    await waitFor(() => expect(view.getByText('Refund was not sent. Review the invoice and try again.')).toBeTruthy());
    expect(sendTerminalRefund).not.toHaveBeenCalled();
  } finally { (AsyncStorage.setItem as jest.Mock).mockImplementation(original); }
});

it('keeps an unknown result visible and blocks another refund after restart', async () => {
  const sale = await paidSale();
  sendTerminalRefund.mockResolvedValue({ status: 'unknown' });
  const view = render(<TerminalRefundScreen sale={sale} attempts={[]} onClose={jest.fn()} />);
  await review(view);
  fireEvent.press(view.getByLabelText('Authorize refund'));
  await waitFor(() => expect(view.getByText('Refund outcome is uncertain. Check its status before trying again.')).toBeTruthy());
  const attempts = await listTerminalRefunds('wallet-a', 'mainnet');
  expect(attempts[0].status).toBe('unknown');
  view.unmount();
  const reopened = render(<TerminalRefundScreen sale={sale} attempts={attempts} onClose={jest.fn()} />);
  expect(reopened.getByText('A refund has an unresolved outcome. Check it before starting another refund.')).toBeTruthy();
  expect(reopened.queryByLabelText('Review refund')).toBeNull();
  expect(verifyTerminalRefund).not.toHaveBeenCalled();
});

it('releases the reservation and shows the exact preflight failure when payment never began', async () => {
  const sale = await paidSale();
  sendTerminalRefund.mockRejectedValue(Object.assign(new Error('Refund quote expired. Prepare it again.'), { mayHaveSent: false }));
  const view = render(<TerminalRefundScreen sale={sale} attempts={[]} onClose={jest.fn()} />);
  await review(view);
  fireEvent.press(view.getByLabelText('Authorize refund'));
  await waitFor(() => expect(view.getByText('Refund quote expired. Prepare it again.')).toBeTruthy());
  expect((await listTerminalRefunds('wallet-a', 'mainnet'))[0].status).toBe('failed');
});

it('records a completed send even after the refund view closes', async () => {
  const sale = await paidSale();
  let finishSend!: (result: { status: 'complete'; paymentId: string }) => void;
  sendTerminalRefund.mockImplementation(() => new Promise(resolve => { finishSend = resolve; }));
  const view = render(<TerminalRefundScreen sale={sale} attempts={[]} onClose={jest.fn()} />);
  await review(view);
  fireEvent.press(view.getByLabelText('Authorize refund'));
  await waitFor(() => expect(sendTerminalRefund).toHaveBeenCalledTimes(1));
  view.unmount();
  await act(async () => { finishSend({ status: 'complete', paymentId: 'payment-late' }); });
  await waitFor(async () => expect((await listTerminalRefunds('wallet-a', 'mainnet'))[0].status).toBe('complete'));
});
