import * as sdk from '@breeztech/breez-sdk-spark-react-native';
import { BIP32Interface } from 'bip32';
import { createHash } from 'crypto';
import { Buffer } from 'buffer';
import { address, networks, payments } from 'bitcoinjs-lib';
import { Wallet, UTXO } from '../types';
import { fetchUTXOs } from './bitcoin';
import { loadExit, saveExit } from './exitStorage';
import { Broadcaster, broadcastExitTransaction, testBroadcaster } from './packageBroadcaster';

export type ExitSdk = Awaited<ReturnType<typeof sdk.connect>>;
export type FundingCoin = UTXO & { chain: number; index: number; pubkey: string };
export type ExitRecord = {
    schema: 1; network: 'mainnet'; owner: string; destination: string; createdAt: number;
    phase: 'building' | 'active' | 'redo' | 'done';
    quote: sdk.PrepareUnilateralExitResponse;
    funding: FundingCoin;
    exitState: string;
    response?: sdk.UnilateralExitResponse;
    reason?: string;
};
export type ExitAccess = { sdk: ExitSdk; wallet: Wallet; root: BIP32Interface; assertCurrent: () => void };
export type RunExit = <T>(operation: (access: ExitAccess) => Promise<T>, recoveryOnly?: boolean) => Promise<T>;
const owner = (root: BIP32Interface) => createHash('sha256').update(root.publicKey).digest('hex');
const fundingPath = (coin: { chain: number; index: number }) => `m/84'/0'/0'/${coin.chain}/${coin.index}`;

export async function recoveryCoins(access: ExitAccess): Promise<FundingCoin[]> {
    if (access.wallet.scriptType && access.wallet.scriptType !== 'p2wpkh') throw new Error('This first recovery version requires a native SegWit (P2WPKH) on-chain wallet.');
    const derived = [
        ...access.wallet.derivedReceiveAddresses.map(a => ({ ...a, chain: 0 })),
        ...access.wallet.derivedChangeAddresses.map(a => ({ ...a, chain: 1 })),
    ];
    const coins = await fetchUTXOs(derived.map(a => a.address));
    access.assertCurrent();
    return coins.filter(c => c.status.confirmed).flatMap(coin => {
        const found = derived.find(a => a.address === coin.address);
        if (!found) return [];
        const child = access.root.derivePath(fundingPath(found));
        if (payments.p2wpkh({ pubkey: child.publicKey, network: networks.bitcoin }).address !== coin.address) return [];
        return [{ ...coin, chain: found.chain, index: found.index, pubkey: child.publicKey.toString('hex') }];
    });
}
export async function quoteExit(access: ExitAccess, destination: string, fee: string, previous?: ExitRecord) {
    address.toOutputScript(destination, networks.bitcoin);
    if (!/^[1-9]\d{0,3}$/.test(fee)) throw new Error('Enter a whole-number fee rate between 1 and 9999 sat/vB.');
    if (!previous && await loadExit(access.wallet.id)) throw new Error('An exit is already saved for this wallet. Resume it instead.');
    if (previous) {
        validateExitRecord(previous, access);
        await access.sdk.importUnilateralExitState({ exitState: previous.exitState });
        access.assertCurrent();
    }
    const quote = await access.sdk.prepareUnilateralExit({
        destination, feeRateSatPerVbyte: BigInt(fee), fundingKind: new sdk.CpfpFundingKind.P2wpkh(),
        selection: previous ? new sdk.ExitLeafSelection.Specific({ leafIds: previous.quote.leaves.map(l => l.leafId) }) : new sdk.ExitLeafSelection.Auto(),
    });
    access.assertCurrent();
    if (!quote.leaves.length) throw new Error('No recoverable leaves at this fee rate. Try a lower rate or check whether recovery already completed.');
    if (quote.recoverableValueSat <= quote.totalFeeSat) throw new Error('The quoted fees equal or exceed the recoverable balance. Do not fund this exit.');
    return quote;
}
export async function buildExit(access: ExitAccess, quote: sdk.PrepareUnilateralExitResponse, coin: FundingCoin, previous?: ExitRecord): Promise<ExitRecord> {
    if (previous) validateExitRecord(previous, access);
    else {
        if (await loadExit(access.wallet.id)) throw new Error('An exit already exists. Resume it.');
        const live = (await recoveryCoins(access)).find(c => c.txid === coin.txid && c.vout === coin.vout);
        if (!live || live.value !== coin.value) throw new Error('The fee-funding output is no longer available. Refresh the quote and funding list.');
        if (BigInt(live.value) < quote.singleUtxoFundingSat) throw new Error('The selected output is too small for this exit.');
    }
    // The review may precede a session restart. Revalidate before signing rather
    // than building against a quote whose leaves or chain state have changed.
    const fresh = await access.sdk.prepareUnilateralExit({
        destination: quote.destination, feeRateSatPerVbyte: quote.feeRateSatPerVbyte,
        fundingKind: new sdk.CpfpFundingKind.P2wpkh(),
        selection: new sdk.ExitLeafSelection.Specific({ leafIds: quote.leaves.map(l => l.leafId) }),
    });
    access.assertCurrent();
    if (fresh.totalFeeSat !== quote.totalFeeSat || fresh.singleUtxoFundingSat !== quote.singleUtxoFundingSat ||
        fresh.recoverableValueSat !== quote.recoverableValueSat || fresh.leaves.length !== quote.leaves.length ||
        !fresh.leaves.every(l => quote.leaves.some(old => old.leafId === l.leafId && old.value === l.value))) {
        throw new Error('The recovery quote changed. Get a new quote and review it before building.');
    }
    quote = fresh;
    const key = access.root.derivePath(fundingPath(coin));
    if (!key.privateKey || key.publicKey.toString('hex') !== coin.pubkey) throw new Error('Funding key does not match this wallet.');
    const record: ExitRecord = {
        schema: 1, network: 'mainnet', owner: owner(access.root), destination: quote.destination,
        createdAt: previous?.createdAt || Date.now(), phase: 'building', quote, funding: coin,
        exitState: previous?.exitState || (await access.sdk.exportUnilateralExitState()).exitState,
        response: previous?.response,
    };
    access.assertCurrent();
    // Persist intent first, reserving this wallet's funds even if building is interrupted.
    await saveExit(access.wallet.id, record);
    const bytes = Uint8Array.from(key.privateKey);
    try {
        const response = await access.sdk.unilateralExit({
            prepared: quote,
            fundingInputs: previous?.response?.fundingInputs || [new sdk.CpfpInput.P2wpkh({ txid: coin.txid, vout: coin.vout, value: BigInt(coin.value), pubkey: coin.pubkey })],
        }, sdk.singleKeyCpfpSigner(bytes.buffer));
        access.assertCurrent();
        const next: ExitRecord = { ...record, phase: 'active', response };
        await saveExit(access.wallet.id, next);
        return next;
    } finally { bytes.fill(0); }
}
export function validateExitRecord(record: ExitRecord, access: ExitAccess) {
    if (!record || record.schema !== 1 || record.network !== 'mainnet' || record.owner !== owner(access.root) || !record.quote?.leaves?.length || typeof record.exitState !== 'string') throw new Error('This backup does not belong to this mainnet wallet or has an unsupported format.');
    if (!['building', 'active', 'redo', 'done'].includes(record.phase) || !record.funding ||
        !/^[0-9a-f]{64}$/i.test(record.funding.txid) || !Number.isSafeInteger(record.funding.vout) || record.funding.vout < 0 ||
        !Number.isSafeInteger(record.funding.value) || record.funding.value <= 0 ||
        typeof record.quote.feeRateSatPerVbyte !== 'bigint' || record.quote.feeRateSatPerVbyte <= 0n ||
        !record.quote.leaves.every(l => typeof l.leafId === 'string' && typeof l.value === 'bigint') ||
        (record.response && (!Array.isArray(record.response.transactions) || !record.response.transactions.length || !record.response.fundingInputs?.length))) {
        throw new Error('Incomplete or invalid recovery backup.');
    }
    address.toOutputScript(record.destination, networks.bitcoin);
    if (record.destination !== record.quote.destination) throw new Error('Recovery destination mismatch.');
    if (![0, 1].includes(record.funding.chain) || !Number.isSafeInteger(record.funding.index) || record.funding.index < 0) throw new Error('Invalid funding derivation.');
    if (access.root.derivePath(fundingPath(record.funding)).publicKey.toString('hex') !== record.funding.pubkey) throw new Error('Recovery funding does not belong to this wallet.');
}
export async function checkExit(access: ExitAccess, record: ExitRecord): Promise<ExitRecord> {
    validateExitRecord(record, access);
    if (!record.response) return record;
    const checked = await access.sdk.checkUnilateralExit({ exit: record.response });
    access.assertCurrent();
    const hasSweep = checked.exit.transactions.some(tx => tx.kind === sdk.UnilateralExitTxKind.Sweep);
    const needsSweep = checked.verdict.tag === 'Done' && !hasSweep;
    if (checked.verdict.tag === 'Done' && checked.exit.transactions.some(tx => tx.status.tag !== 'Confirmed')) throw new Error('The SDK has not confirmed every recovery transaction. Check progress again.');
    const next: ExitRecord = { ...record, response: checked.exit,
        phase: needsSweep ? 'redo' : checked.verdict.tag === 'Done' ? 'done' : checked.verdict.tag === 'Redo' ? 'redo' : 'active',
        reason: needsSweep ? 'The exit steps confirmed. Rebuild once more to create the final sweep to your destination.' : checked.verdict.tag === 'Redo' ? 'The chain has changed. Rebuild the remaining exit using its original leaves and funding.' : undefined,
    };
    await saveExit(access.wallet.id, next);
    return next;
}
export async function broadcastReady(access: ExitAccess, record: ExitRecord, config: Broadcaster): Promise<ExitRecord> {
    await testBroadcaster(config);
    let checked = await checkExit(access, record);
    if (checked.phase !== 'active' || !checked.response) return checked;
    const confirmed = new Set(checked.response.transactions.filter(t => t.status.tag === 'Confirmed').map(t => t.txid));
    for (const tx of checked.response.transactions) {
        if (tx.status.tag !== 'Ready' || !tx.dependsOn.every(id => confirmed.has(id))) continue;
        access.assertCurrent();
        try { await broadcastExitTransaction(config, tx); }
        catch (error) {
            // Acceptance can be ambiguous after a timeout. Reconcile before any retry.
            await checkExit(access, checked);
            throw error;
        }
    }
    checked = await checkExit(access, checked);
    return checked;
}
export async function restoreExit(access: ExitAccess, record: ExitRecord): Promise<ExitRecord> {
    validateExitRecord(record, access);
    if (await loadExit(access.wallet.id)) throw new Error('This wallet already has a saved exit. Keep the current record to avoid replacing newer progress.');
    // Import never trusts a saved Done flag to authorize normal spending.
    const pending: ExitRecord = { ...record, phase: record.response ? 'active' : 'building' };
    await saveExit(access.wallet.id, pending);
    await access.sdk.importUnilateralExitState({ exitState: record.exitState });
    return checkExit(access, pending);
}
