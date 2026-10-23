import { Transaction as BitcoinTransaction, address as btcAddress, networks } from 'bitcoinjs-lib';
import { fetchBitcoinBalance, fetchUTXOs, fetchAddressTransactions } from '../../services/bitcoin';
import * as electrum from '../../services/electrum';

jest.mock('../../services/electrum', () => ({
  addressToScriptHash: jest.fn(() => 'script-hash'),
  electrumBatchGetBalance: jest.fn(),
  electrumBatchGetHistory: jest.fn(),
  electrumListUnspent: jest.fn(),
  electrumBatchGetTransactions: jest.fn(),
  electrumGetHeader: jest.fn(() => Promise.resolve({ height: 800000 })),
}));

beforeEach(() => {
  jest.clearAllMocks();
  (electrum.electrumBatchGetBalance as jest.Mock).mockResolvedValue([{ result: { confirmed: 0, unconfirmed: 0 } }]);
  (electrum.electrumBatchGetHistory as jest.Mock).mockResolvedValue([{ result: [] }]);
  (electrum.electrumListUnspent as jest.Mock).mockResolvedValue([]);
  (electrum.electrumBatchGetTransactions as jest.Mock).mockResolvedValue([]);
});

it('fetches strict balance without downloading history and accepts legitimate zero and outgoing unconfirmed balance', async () => {
  expect(await fetchBitcoinBalance('address', { strict: true })).toBe(0);
  (electrum.electrumBatchGetBalance as jest.Mock).mockResolvedValueOnce([{ result: { confirmed: 1000, unconfirmed: -200 } }]);
  expect(await fetchBitcoinBalance('address', { strict: true })).toBe(800);
  expect(electrum.electrumBatchGetHistory).not.toHaveBeenCalled();
});

it.each([[], [{ error: { code: 1 }, result: { confirmed: 0, unconfirmed: 0 } }], [{ result: { confirmed: 1 } }], [{ result: { confirmed: '100', unconfirmed: 0 } }]].map(response => ({ response })))('rejects incomplete strict balance responses: %j', async ({ response }) => {
  (electrum.electrumBatchGetBalance as jest.Mock).mockResolvedValueOnce(response);
  await expect(fetchBitcoinBalance('address', { strict: true })).rejects.toThrow();
});

it('distinguishes coin errors from a valid empty list without changing legacy callers', async () => {
  expect(await fetchUTXOs(['address'], { strict: true })).toEqual([]);
  (electrum.electrumListUnspent as jest.Mock).mockRejectedValueOnce(new Error('offline'));
  await expect(fetchUTXOs(['address'], { strict: true })).rejects.toThrow('offline');
  (electrum.electrumListUnspent as jest.Mock).mockRejectedValueOnce(new Error('offline'));
  expect(await fetchUTXOs(['address'])).toEqual([]);
  (electrum.electrumListUnspent as jest.Mock).mockResolvedValueOnce(null);
  await expect(fetchUTXOs(['address'], { strict: true })).rejects.toThrow('Incomplete coin response');
});

it('distinguishes failed history from empty history without changing legacy callers', async () => {
  expect(await fetchAddressTransactions(['address'], undefined, undefined, { strict: true })).toEqual([]);
  (electrum.electrumBatchGetHistory as jest.Mock).mockResolvedValueOnce([{ error: { code: 1 } }]);
  await expect(fetchAddressTransactions(['address'], undefined, undefined, { strict: true })).rejects.toThrow('Incomplete address response');
  (electrum.electrumBatchGetHistory as jest.Mock).mockRejectedValueOnce(new Error('offline'));
  expect(await fetchAddressTransactions(['address'])).toEqual([]);
});

it('rejects a missing transaction body instead of silently dropping a known transaction', async () => {
  (electrum.electrumBatchGetHistory as jest.Mock).mockResolvedValueOnce([{ result: [{ tx_hash: 'pending-tx', height: 0 }] }]);
  await expect(fetchAddressTransactions(['address'], undefined, undefined, { strict: true })).rejects.toThrow('Incomplete address response');
});

const fixtureAddress = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';
const coinbaseFixture = () => {
  const tx = new BitcoinTransaction();
  tx.addInput(Buffer.alloc(32), 0xffffffff);
  tx.addOutput(btcAddress.toOutputScript(fixtureAddress, networks.bitcoin), 1000);
  return tx;
};

it('accepts a complete coinbase body without trying to fetch a nonexistent parent', async () => {
  const tx = coinbaseFixture();
  (electrum.electrumBatchGetHistory as jest.Mock).mockResolvedValueOnce([{ result: [{ tx_hash: tx.getId(), height: 0 }] }]);
  (electrum.electrumBatchGetTransactions as jest.Mock).mockResolvedValueOnce([{ result: tx.toHex() }]);
  const result = await fetchAddressTransactions([fixtureAddress], undefined, undefined, { strict: true });
  expect(result[0]).toMatchObject({ txid: tx.getId(), type: 'receive', amount: 1000 });
  expect(electrum.electrumBatchGetTransactions).toHaveBeenCalledTimes(1);
});

it('rejects failed parent hydration instead of inventing an input value, then processes a complete send correctly', async () => {
  const parent = coinbaseFixture();
  const child = new BitcoinTransaction();
  child.addInput(Buffer.from(parent.getId(), 'hex').reverse(), 0);
  child.addOutput(btcAddress.toOutputScript(fixtureAddress, networks.bitcoin), 800);
  (electrum.electrumBatchGetHistory as jest.Mock).mockResolvedValue([{ result: [{ tx_hash: child.getId(), height: 0 }] }]);
  (electrum.electrumBatchGetTransactions as jest.Mock)
    .mockResolvedValueOnce([{ result: child.toHex() }])
    .mockResolvedValueOnce([{ error: { code: 1 } }]);
  await expect(fetchAddressTransactions([fixtureAddress], undefined, undefined, { strict: true })).rejects.toThrow('Incomplete address response');
  (electrum.electrumBatchGetTransactions as jest.Mock)
    .mockResolvedValueOnce([{ result: child.toHex() }])
    .mockResolvedValueOnce([{ result: parent.toHex() }]);
  const result = await fetchAddressTransactions([fixtureAddress], undefined, undefined, { strict: true });
  expect(result[0]).toMatchObject({ type: 'send', amount: 200, fee: 200 });
});

it('rejects a body whose transaction id does not match the history', async () => {
  (electrum.electrumBatchGetHistory as jest.Mock).mockResolvedValueOnce([{ result: [{ tx_hash: 'incorrect-id', height: 0 }] }]);
  (electrum.electrumBatchGetTransactions as jest.Mock).mockResolvedValueOnce([{ result: coinbaseFixture().toHex() }]);
  await expect(fetchAddressTransactions([fixtureAddress], undefined, undefined, { strict: true })).rejects.toThrow('Mismatched transaction');
});

it('rejects malformed coin entries instead of displaying invented values', async () => {
  (electrum.electrumListUnspent as jest.Mock).mockResolvedValueOnce([{ tx_hash: 'tx', tx_pos: 0, height: 1 }]);
  await expect(fetchUTXOs(['address'], { strict: true })).rejects.toThrow('Incomplete coin response');
});
