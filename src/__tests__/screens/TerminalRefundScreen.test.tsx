let mockCameraScan: ((value: { data: string }) => void) | undefined;
jest.mock('expo-camera', () => ({ useCameraPermissions: () => [{ granted: true }, jest.fn()], CameraView: (props: any) => { mockCameraScan = props.onBarcodeScanned; return null; } }));
import { resetTerminalSqlite, failNextTerminalSqliteWrite } from '../helpers/terminalSqlite';
import { getTerminalDatabase } from '../../services/terminalDatabase';
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
import TerminalRefundScreen from '../../screens/TerminalRefundScreen';
import { useWallet } from '../../contexts/WalletContext';
import { authenticate_terminal_refund } from '../../services/authState';
import { recordTerminalSale, updateTerminalSalePayment } from '../../services/terminalSales';
import { listTerminalRefunds, reserveTerminalRefund } from '../../services/terminalRefunds';
import { TerminalRequest } from '../../services/terminal';
import { clearTerminalRateCacheForTests } from '../../services/terminalRates';

jest.mock('@react-navigation/native', () => ({ ...jest.requireActual('@react-navigation/native'), useIsFocused: () => true }));

jest.mock('../../contexts/WalletContext', () => ({ useWallet: jest.fn() }));
jest.mock('../../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: { colors: { background: '#fff', primary: '#000', inversePrimary: '#fff', surface: '#eee', muted: '#888', border: '#ccc', bitcoin: '#f90' }, LAYOUT: { radius: 8, inputHeight: 56 } } }) }));
jest.mock('../../components/GlassView', () => ({ GlassView: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('../../components/StyledInput', () => ({ StyledInput: ({ rightElement, ...props }: any) => require('react').createElement(require('react-native').View, null, require('react').createElement(require('react-native').TextInput, props), rightElement) }));
jest.mock('expo-clipboard', () => ({ getStringAsync: jest.fn() }));
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
  await resetTerminalSqlite();
  clearTerminalRateCacheForTests();
  (global as any).fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { currency: 'BTC', rates: { USD: '100000', EUR: '90000', CHF: '80000' } } }) });
  (Clipboard.getStringAsync as jest.Mock).mockReset();
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
  failNextTerminalSqliteWrite(new Error('disk full'));
  try {
    const view = render(<TerminalRefundScreen sale={sale} attempts={[]} onClose={jest.fn()} />);
    await review(view);
    fireEvent.press(view.getByLabelText('Authorize refund'));
    await waitFor(() => expect(view.getByText('Refund was not sent. Review the invoice and try again.')).toBeTruthy());
    expect(sendTerminalRefund).not.toHaveBeenCalled();
  } finally { /* The write failure is consumed once. */ }
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

it.each(['unknown', 'failure', 'offline'])('shows status-check feedback for an unresolved refund with %s result', async outcome => {
  const sale = await updateTerminalSalePayment(request, { status: 'received' });
  const attempt = await reserveTerminalRefund(sale, { id: 'pending-check', invoice: 'lnbcpendingcheckabc', amountSats: 100, feeSats: 1, quoteExpiresAt: Date.now() + 60000 });
  if (outcome === 'offline') (useWallet as jest.Mock).mockReturnValue({ activeWallet: { id: 'wallet-a' }, isLightningInitialized: false, prepareTerminalRefund, sendTerminalRefund, verifyTerminalRefund });
  else if (outcome === 'failure') verifyTerminalRefund.mockRejectedValueOnce(new Error('offline'));
  else verifyTerminalRefund.mockResolvedValueOnce({ status: 'unknown' });
  const view = render(<TerminalRefundScreen sale={sale} attempts={[attempt]} onClose={jest.fn()} />);
  expect(view.queryByLabelText('Customer Lightning invoice')).toBeNull();
  fireEvent.press(view.getByLabelText('Check refund pending-check'));
  const message = outcome === 'offline' ? 'Open this wallet and connect to Lightning to check the refund.' : outcome === 'failure' ? 'Couldn’t check this refund. Try again later.' : 'No matching refund found yet. Check again later.';
  await waitFor(() => expect(view.getByText(message)).toBeTruthy());
  expect(sendTerminalRefund).not.toHaveBeenCalled();
});

it('does not overwrite a manually edited invoice with a delayed clipboard result', async () => {
  const sale = await paidSale();
  let finishPaste!: (value: string) => void;
  (Clipboard.getStringAsync as jest.Mock).mockImplementation(() => new Promise(resolve => { finishPaste = resolve; }));
  const view = render(<TerminalRefundScreen sale={sale} attempts={[]} onClose={jest.fn()} />);
  fireEvent.press(view.getByLabelText('Paste invoice'));
  fireEvent.changeText(view.getByLabelText('Customer Lightning invoice'), 'lnbcnewcustomerabc');
  await act(async () => { finishPaste('lnbcoldclipboardabc'); });
  expect(view.getByLabelText('Customer Lightning invoice').props.value).toBe('lnbcnewcustomerabc');
});

it('ignores a paste result after leaving and returning to the refund form', async () => {
  const sale = await paidSale();
  let finishPaste!: (value: string) => void;
  (Clipboard.getStringAsync as jest.Mock).mockImplementation(() => new Promise(resolve => { finishPaste = resolve; }));
  const props = { sale, attempts: [], onClose: jest.fn() };
  const view = render(<TerminalRefundScreen {...props} />);
  fireEvent.press(view.getByLabelText('Paste invoice'));
  view.rerender(<TerminalRefundScreen {...props} visible={false} />);
  view.rerender(<TerminalRefundScreen {...props} visible />);
  await act(async () => { finishPaste('lnbcoldclipboardabc'); });
  expect(view.getByLabelText('Customer Lightning invoice').props.value).toBe('');
});

it('locks paste while preparing a quote and discards an earlier paste', async () => {
  const sale = await paidSale();
  let finishPaste!: (value: string) => void;
  (Clipboard.getStringAsync as jest.Mock).mockImplementation(() => new Promise(resolve => { finishPaste = resolve; }));
  prepareTerminalRefund.mockImplementation(() => new Promise(() => {}));
  const view = render(<TerminalRefundScreen sale={sale} attempts={[]} onClose={jest.fn()} />);
  fireEvent.changeText(view.getByLabelText('Customer Lightning invoice'), 'lnbccustomerabc');
  fireEvent.press(view.getByLabelText('Paste invoice'));
  fireEvent.press(view.getByLabelText('Review refund'));
  fireEvent.press(view.getByLabelText('Paste invoice'));
  expect(Clipboard.getStringAsync).toHaveBeenCalledTimes(1);
  await act(async () => { finishPaste('lnbcothercustomerabc'); });
  expect(view.getByLabelText('Customer Lightning invoice').props.value).toBe('lnbccustomerabc');
  expect(prepareTerminalRefund).toHaveBeenCalledWith('lnbccustomerabc', 1200);
  expect(sendTerminalRefund).not.toHaveBeenCalled();
});

it('applies only the newest clipboard request and trims the invoice', async () => {
  const sale = await paidSale();
  const results: ((value: string) => void)[] = [];
  (Clipboard.getStringAsync as jest.Mock).mockImplementation(() => new Promise(resolve => { results.push(resolve); }));
  const view = render(<TerminalRefundScreen sale={sale} attempts={[]} onClose={jest.fn()} />);
  fireEvent.press(view.getByLabelText('Paste invoice'));
  fireEvent.press(view.getByLabelText('Paste invoice'));
  await act(async () => { results[1]('  lnbcnewcustomerabc  '); results[0]('lnbcoldcustomerabc'); });
  expect(view.getByLabelText('Customer Lightning invoice').props.value).toBe('lnbcnewcustomerabc');
});

it('scans a customer Lightning invoice and returns it to the refund form', async () => {
  await recordTerminalSale(request);
  const sale = await updateTerminalSalePayment(request, { status: 'received' });
  const view = render(<TerminalRefundScreen sale={sale} attempts={[]} onClose={jest.fn()} />);
  fireEvent.press(view.getByLabelText('Scan customer invoice'));
  act(() => mockCameraScan?.({ data: 'lightning:lnbc123abc' }));
  expect(view.getByLabelText('Customer Lightning invoice').props.value).toBe('lnbc123abc');
  expect(view.queryByLabelText('Close invoice scanner')).toBeNull();
});
it('does not accept a delayed camera result after the active wallet changes', async () => {
  await recordTerminalSale(request);
  const sale = await updateTerminalSalePayment(request, { status: 'received' });
  const view = render(<TerminalRefundScreen sale={sale} attempts={[]} onClose={jest.fn()} />);
  fireEvent.press(view.getByLabelText('Scan customer invoice'));
  const delayed = mockCameraScan;
  (useWallet as jest.Mock).mockReturnValue({ activeWallet: { id: 'different-wallet' }, isLightningInitialized: true });
  view.rerender(<TerminalRefundScreen sale={sale} attempts={[]} onClose={jest.fn()} />);
  act(() => delayed?.({ data: 'lnbc123abc' }));
  expect(view.getByLabelText('Customer Lightning invoice').props.value).toBe('');
});
