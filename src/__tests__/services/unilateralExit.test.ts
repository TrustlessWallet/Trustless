import { Buffer } from 'buffer';
import { Transaction } from 'bitcoinjs-lib';
import { encodeExit, decodeExit, exportExitBackup, importExitBackup } from '../../services/exitCodec';
import { broadcastExitTransaction, testBroadcaster, verifyPackageResult } from '../../services/packageBroadcaster';
import { checkExit } from '../../services/unilateralExit';
import { saveExit } from '../../services/exitStorage';
import { createHash } from 'crypto';

jest.mock('react-native-randombytes', () => ({ randomBytes: require('node:crypto').randomBytes }));
jest.mock('react-native-keychain', () => ({}));
jest.mock('../../services/bitcoin', () => ({}));
jest.mock('../../services/exitStorage', () => ({ saveExit: jest.fn(async () => {}), loadExit: jest.fn(async () => null) }));
jest.mock('@breeztech/breez-sdk-spark-react-native', () => ({ UnilateralExitTxKind: { Sweep: 3 } }));
const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; jest.clearAllMocks(); });
const raw = () => {
    const tx = new Transaction();
    tx.addInput(Buffer.alloc(32, 1), 0);
    tx.addOutput(Buffer.from('0014' + '11'.repeat(20), 'hex'), 1000);
    return tx;
};
it('preserves SDK amounts and statuses and authenticates encrypted backups', async () => {
    const record = { value: 2100000000000000n, status: { tag: 'Confirmed', inner: { blockHeight: 800000 } } };
    expect(decodeExit(encodeExit(record))).toEqual(record);
    const password = 'a long unique backup password';
    const encrypted = await exportExitBackup(record, password);
    expect(encrypted).not.toContain('Confirmed');
    expect(await importExitBackup(encrypted, password)).toEqual(record);
    await expect(importExitBackup(encrypted, 'another long password')).rejects.toThrow('Incorrect');
    const outer = JSON.parse(encrypted), inner = JSON.parse(outer.payload);
    inner.tag = (inner.tag[0] === '0' ? '1' : '0') + inner.tag.slice(1);
    outer.payload = JSON.stringify(inner);
    await expect(importExitBackup(JSON.stringify(outer), password)).rejects.toThrow('damaged');
});
it('rejects partially accepted packages even with HTTP success', () => {
    const tx = raw();
    const child = raw(); child.version = 2;
    const packet: any = { txid: tx.getId(), cpfpTxHex: child.toHex() };
    expect(() => verifyPackageResult({ package_msg: 'success', 'tx-results': { a: { txid: tx.getId() } } }, packet)).toThrow('complete');
    expect(() => verifyPackageResult({ package_msg: 'success', 'tx-results': { a: { txid: tx.getId(), error: 'rejected' } } }, packet)).toThrow('complete');
    expect(() => verifyPackageResult({ package_msg: 'success', 'tx-results': { a: { txid: tx.getId() }, b: { txid: child.getId() } } }, packet)).not.toThrow();
});
it('probes capabilities without sending signed transactions and rejects the wrong network', async () => {
    const fetchMock = jest.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ result: { chain: 'main', initialblockdownload: false } }) }).mockResolvedValueOnce({ ok: true, json: async () => ({ error: { code: -8 } }) });
    global.fetch = fetchMock;
    await testBroadcaster({ url: 'https://example.com/rpc' });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ method: 'submitpackage', params: [[]] });
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ result: { chain: 'test' } }) });
    await expect(testBroadcaster({ url: 'https://example.com/rpc' })).rejects.toThrow('mainnet');
    expect(fetchMock).toHaveBeenCalledTimes(3);
});
it('never broadcasts a waiting transaction or one with a mismatched ID', async () => {
    const fetchMock = jest.fn(); global.fetch = fetchMock;
    const tx = raw();
    await expect(broadcastExitTransaction({ url: 'https://example.com' }, { status: { tag: 'WaitingForDependencies' } } as any)).rejects.toThrow('not ready');
    await expect(broadcastExitTransaction({ url: 'https://example.com' }, { status: { tag: 'Ready' }, txHex: tx.toHex(), txid: 'wrong' } as any)).rejects.toThrow('mismatch');
    expect(fetchMock).not.toHaveBeenCalled();
});
it('requires a confirmed final sweep before unlocking normal spending', async () => {
    const publicKey = Buffer.alloc(33, 2);
    const destination = '1BoatSLRHtKNngkdXEeobR76b53LETtpyT';
    const record: any = { schema: 1, network: 'mainnet', owner: createHash('sha256').update(publicKey).digest('hex'), destination, phase: 'active', exitState: 'state',
        quote: { destination, feeRateSatPerVbyte: 1n, leaves: [{ leafId: 'leaf', value: 10000n }] },
        funding: { chain: 0, index: 0, pubkey: publicKey.toString('hex'), txid: 'aa'.repeat(32), vout: 0, value: 1000 },
        response: { transactions: [{ kind: 2, status: { tag: 'Confirmed' } }], fundingInputs: [{}] } };
    const access: any = { wallet: { id: 'a' }, root: { publicKey, derivePath: () => ({ publicKey }) }, assertCurrent: jest.fn(), sdk: { checkUnilateralExit: jest.fn(async () => ({ verdict: { tag: 'Done' }, exit: record.response })) } };
    expect((await checkExit(access, record)).phase).toBe('redo');
    expect(saveExit).toHaveBeenLastCalledWith('a', expect.objectContaining({ phase: 'redo' }));
    record.response.transactions.push({ kind: 3, status: { tag: 'Confirmed' } });
    expect((await checkExit(access, record)).phase).toBe('done');
});
