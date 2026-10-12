import * as Keychain from 'react-native-keychain';
import { Buffer } from 'buffer';
import { Transaction } from 'bitcoinjs-lib';
import type { UnilateralExitTransaction } from '@breeztech/breez-sdk-spark-react-native';

export type Broadcaster = { url: string; username?: string; password?: string };
const service = 'com.btc.trustless.package-broadcaster';
export function validateBroadcaster(config: Broadcaster): void {
    const url = new URL(config.url);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('Use an HTTPS RPC URL. Enter RPC credentials in the separate fields.');
}
export async function saveBroadcaster(config: Broadcaster) {
    validateBroadcaster(config);
    await Keychain.setGenericPassword('rpc', JSON.stringify(config), { service, accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
}
export async function loadBroadcaster(): Promise<Broadcaster | null> {
    const saved = await Keychain.getGenericPassword({ service });
    return saved ? JSON.parse(saved.password) : null;
}
async function rpc(config: Broadcaster, method: string, params: unknown[]): Promise<any> {
    validateBroadcaster(config);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
        const response = await fetch(config.url, {
            method: 'POST', redirect: 'error', signal: controller.signal,
            headers: { 'Content-Type': 'application/json', ...(config.username ? { Authorization: `Basic ${Buffer.from(`${config.username}:${config.password || ''}`).toString('base64')}` } : {}) },
            body: JSON.stringify({ jsonrpc: '2.0', id: 'trustless-exit', method, params }),
        });
        if (!response.ok) throw new Error(`RPC HTTP ${response.status}`);
        const body = await response.json();
        if (body.error) throw new Error(`RPC rejected ${method} (code ${body.error.code}).`);
        if (!('result' in body)) throw new Error('Invalid RPC response.');
        return body.result;
    } catch (error) {
        // Never surface a fetch error containing an API-key URL or credentials.
        if (error instanceof Error && /^RPC |^Invalid RPC/.test(error.message)) throw error;
        throw new Error('Broadcaster connection failed or timed out. Check the endpoint and credentials; no automatic retry was made.');
    } finally { clearTimeout(timer); }
}
export async function testBroadcaster(config: Broadcaster) {
    const chain = await rpc(config, 'getblockchaininfo', []);
    if (chain.chain !== 'main' || chain.initialblockdownload) throw new Error('Use a fully synchronized Bitcoin mainnet broadcaster.');
    // A harmless, deliberately invalid package probes method availability without broadcasting.
    // Core returns a parameter error when submitpackage exists; providers may restrict it.
    try { await rpc(config, 'submitpackage', [[]]); }
    catch (error) {
        if (!(error instanceof Error) || !/code -8\)/.test(error.message)) throw error;
    }
}
export function verifyPackageResult(result: any, tx: UnilateralExitTransaction): void {
    const wanted = [tx.txid, Transaction.fromHex(tx.cpfpTxHex!).getId()];
    const entries = Object.values(result?.['tx-results'] || {}) as any[];
    if (result?.package_msg !== 'success' || !wanted.every(id => entries.some(entry => entry.txid === id && !entry.error))) {
        throw new Error('The node did not accept the complete transaction package. Check progress before retrying; part of it may already be known.');
    }
}
export async function broadcastExitTransaction(config: Broadcaster, tx: UnilateralExitTransaction) {
    if (tx.status.tag !== 'Ready') throw new Error('This transaction is not ready to broadcast.');
    if (Transaction.fromHex(tx.txHex).getId() !== tx.txid) throw new Error('Recovery transaction ID mismatch.');
    if (tx.cpfpTxHex) {
        verifyPackageResult(await rpc(config, 'submitpackage', [[tx.txHex, tx.cpfpTxHex]]), tx);
    } else {
        const result = await rpc(config, 'sendrawtransaction', [tx.txHex]);
        if (result !== tx.txid) throw new Error('The broadcaster returned an unexpected transaction ID.');
    }
}
