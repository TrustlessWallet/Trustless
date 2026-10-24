import { Transaction } from '../types';
import { NETWORK, CUSTOM_NODE_URL_KEY, NETWORK_NAME, IS_TESTNET, DERIVATION_PARENT_PATH } from '../constants/network';
import { address as btcAddress, networks, Transaction as BitcoinTransaction, Psbt, payments } from 'bitcoinjs-lib';
import { BIP32Factory } from 'bip32';
import * as secp from '@bitcoinerlab/secp256k1';
import { Buffer } from 'buffer';
import { UR, UREncoder } from '@ngraveio/bc-ur';
import { cborEncode } from '@ngraveio/bc-ur/dist/cbor';
import {
    getElectrumClient,
    addressToScriptHash,
    electrumBatchGetBalance,
    electrumBatchGetHistory,
    electrumListUnspent,
    electrumBatchGetTransactions,
    electrumBroadcast,
    electrumEstimateFee,
    electrumGetTransaction,
    electrumGetHeader
} from './electrum';

const bip32 = BIP32Factory(secp);

export const DUST_THRESHOLD = 546;

// Opt-in for views that must distinguish a fetch failure from an empty address.
// Existing wallet/discovery callers retain their current best-effort behavior.
type AddressFetchOptions = { strict?: boolean };

const requireBatchResults = (responses: any[], count: number, valid: (result: any) => boolean) => {
    if (!Array.isArray(responses) || responses.length !== count ||
        responses.some(response => !response || response.error || !valid(response.result))) {
        throw new Error('Incomplete address response');
    }
};
const validHistory = (value: any) => Array.isArray(value) && value.every(item =>
    item && typeof item.tx_hash === 'string' && Number.isInteger(item.height));

const ALT_NETWORKS = {
    bitcoin: [
        { ...networks.bitcoin, bip32: { public: 0x04b24746, private: 0x04b2430c } },
        { ...networks.bitcoin, bip32: { public: 0x049d7cb2, private: 0x049d7878 } },
    ],
    testnet: [
        { ...networks.testnet, bip32: { public: 0x045f1cf6, private: 0x045f18bc } },
        { ...networks.testnet, bip32: { public: 0x044a5262, private: 0x044a4e28 } },
    ]
};

export const getBip32Node = (key: string, network: any) => {
    try {
        return bip32.fromBase58(key, network);
    } catch (e) { }

    const is_mainnet = network.bech32 === 'bc';
    const alts = is_mainnet ? ALT_NETWORKS.bitcoin : ALT_NETWORKS.testnet;

    for (const alt_net of alts) {
        try {
            return bip32.fromBase58(key, alt_net);
        } catch (e) { }
    }

    throw new Error("Invalid Network Key or Format");
};

export const inferScriptType = (key: string): 'p2wpkh' | 'p2sh-p2wpkh' => {
    if (key.startsWith('ypub') || key.startsWith('upub')) {
        return 'p2sh-p2wpkh';
    }
    return 'p2wpkh';
};

export type WatchOnlyImport = {
    xpub: string;
    fingerprint: string;
    derivation_path: string;
    scriptType: 'p2wpkh' | 'p2sh-p2wpkh';
};

/** Validate the account origin and key together before any address is derived or stored. */
export const validateWatchOnlyImport = (
    xpub: string, fingerprint: string, derivationPath: string, network: typeof networks.bitcoin = NETWORK
): WatchOnlyImport => {
    const key = xpub.trim();
    if (!/^[a-f\d]{8}$/i.test(fingerprint)) throw new Error('Master fingerprint must be eight hexadecimal characters.');
    const path = derivationPath.replace(/h/gi, "'");
    const match = /^m\/(49|84)'\/(0|1)'\/(0|[1-9]\d*)'$/.exec(path);
    if (!match || Number(match[3]) > 0x7fffffff) {
        throw new Error("Use a hardened BIP49 or BIP84 account origin, such as m/84'/0'/0'. BIP44 is not supported.");
    }
    const expectedCoin = network.bech32 === 'bc' ? '0' : '1';
    if (match[2] !== expectedCoin) throw new Error('Account origin belongs to a different Bitcoin network.');

    const prefix = key.slice(0, 4);
    if (['xprv', 'yprv', 'zprv', 'tprv', 'uprv', 'vprv'].includes(prefix)) {
        throw new Error('Import an extended public key, not a private key.');
    }
    const allowed = expectedCoin === '0' ? ['xpub', 'ypub', 'zpub'] : ['tpub', 'upub', 'vpub'];
    if (!allowed.includes(prefix)) throw new Error('Extended public key is invalid or belongs to a different Bitcoin network.');
    const scriptType = match[1] === '49' ? 'p2sh-p2wpkh' : 'p2wpkh';
    const expectedPrefix = expectedCoin === '0'
        ? (scriptType === 'p2wpkh' ? 'zpub' : 'ypub')
        : (scriptType === 'p2wpkh' ? 'vpub' : 'upub');
    if (prefix !== expectedPrefix && prefix !== (expectedCoin === '0' ? 'xpub' : 'tpub')) {
        throw new Error('Extended public key format conflicts with its account origin.');
    }
    const node = getBip32Node(key, network);
    if (!node.isNeutered()) throw new Error('Import an extended public key, not a private key.');
    if (node.depth !== 3 || node.index !== (Number(match[3]) + 0x80000000)) {
        throw new Error('Extended public key must be the account key at the stated hardened origin.');
    }
    return { xpub: key, fingerprint: fingerprint.toLowerCase(), derivation_path: path, scriptType };
};

export const format_public_key = (xpub: string, script_type: string, network_name: string): string => {
    if (!xpub) return '';
    try {
        const is_testnet = network_name.toLowerCase() === 'testnet';
        const node = getBip32Node(xpub, is_testnet ? networks.testnet : networks.bitcoin);

        let target_bip32_header = { public: 0x0488b21e, private: 0x0488ade4 };
        if (is_testnet) {
            if (script_type === 'p2wpkh') target_bip32_header = { public: 0x045f1cf6, private: 0x045f18bc };
            else if (script_type === 'p2sh-p2wpkh') target_bip32_header = { public: 0x044a5262, private: 0x044a4e28 };
            else target_bip32_header = { public: 0x043587cf, private: 0x04358394 };
        } else {
            if (script_type === 'p2wpkh') target_bip32_header = { public: 0x04b24746, private: 0x04b2430c };
            else if (script_type === 'p2sh-p2wpkh') target_bip32_header = { public: 0x049d7cb2, private: 0x049d7878 };
        }

        const target_network = {
            ...(is_testnet ? networks.testnet : networks.bitcoin),
            bip32: target_bip32_header
        };

        (node as any).network = target_network;
        return node.toBase58();
    } catch (e) {
        return xpub;
    }
};

const chunkArray = <T>(array: T[], size: number): T[][] => {
    const chunked: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
        chunked.push(array.slice(i, i + size));
    }
    return chunked;
};

export const calculateVSize = (n_inputs: number, n_outputs: number): number => {
    return Math.ceil((n_inputs * 68) + (n_outputs * 31) + 10.5);
};

export const calculateTransactionMetrics = (
    n_inputs: number,
    amount: number,
    total_input_value: number,
    fee_rate: number
): { vsize: number; fee: number; change: number; numOutputs: number } => {
    let numOutputs = 1;
    let vsize = calculateVSize(n_inputs, numOutputs);
    let fee = Math.ceil(vsize * fee_rate);
    let change = total_input_value - amount - fee;

    if (change > DUST_THRESHOLD) {
        const vsize_two = calculateVSize(n_inputs, 2);
        const fee_two = Math.ceil(vsize_two * fee_rate);
        const change_two = total_input_value - amount - fee_two;

        if (change_two > DUST_THRESHOLD) {
            numOutputs = 2;
            vsize = vsize_two;
            fee = fee_two;
            change = change_two;
        }
    }
    return { vsize, fee, change, numOutputs };
};

export const testNodeConnection = async (custom_url: string): Promise<boolean> => {
    try { return true; } catch (error) { return false; }
};

export const fetchAddressInfoBatch = async (
    addresses: string[]
): Promise<{ address: string; balance: number; tx_count: number }[]> => {
    if (addresses.length === 0) return [];
    try {
        // Filter out invalid addresses that hash to empty strings (non-hex hash fix)
        const map = addresses
            .map(addr => ({ addr, hash: addressToScriptHash(addr) }))
            .filter(m => m.hash !== '');

        const hashes = map.map(m => m.hash);

        // Chunk size = 25 for faster background syncing
        const hashChunks = chunkArray(hashes, 25);
        let balances: any[] = [];
        let histories: any[] = [];

        for (const chunk of hashChunks) {
            const b = await electrumBatchGetBalance(chunk) as any[];
            const h = await electrumBatchGetHistory(chunk) as any[];
            balances = balances.concat(b);
            histories = histories.concat(h);
        }

        return map.map((item, index) => {
            const bal_data = balances[index]?.result as any;
            const hist_data = histories[index]?.result as any[];

            const total_balance = (bal_data?.confirmed || 0) + (bal_data?.unconfirmed || 0);
            const tx_count = hist_data ? hist_data.length : 0;

            return {
                address: item.addr,
                balance: total_balance,
                tx_count: tx_count
            };
        });
    } catch (err) {
        throw err;
    }
};

export const fetchAddressBalances = async (addresses: string[]): Promise<number[]> => {
    const info = await fetchAddressInfoBatch(addresses);
    const map = new Map(info.map(i => [i.address, i.balance]));
    return addresses.map(a => map.get(a) || 0);
};

export const fetchBitcoinBalance = async (address: string, options: AddressFetchOptions = {}): Promise<number> => {
    if (options.strict) {
        const hash = addressToScriptHash(address);
        if (!hash) throw new Error('Invalid address');
        // The balance view needs no history request.
        const responses = await electrumBatchGetBalance([hash]) as any[];
        requireBatchResults(responses, 1, value => value &&
            Number.isSafeInteger(value.confirmed) && value.confirmed >= 0 &&
            Number.isSafeInteger(value.unconfirmed));
        const balance = responses[0].result.confirmed + responses[0].result.unconfirmed;
        if (!Number.isSafeInteger(balance) || balance < 0) throw new Error('Invalid address balance');
        return balance;
    }
    const [info] = await fetchAddressInfoBatch([address]);
    return info ? info.balance : 0;
};

export const fetchUTXOs = async (addresses: string[], options: AddressFetchOptions = {}) => {
    if (addresses.length === 0) return [];
    try {
        // Filter invalid addresses and increase chunking speed
        const validAddresses = addresses.filter(a => addressToScriptHash(a) !== '');
        if (options.strict && validAddresses.length !== addresses.length) throw new Error('Invalid address');
        const chunks = chunkArray(validAddresses, 10);
        const allUtxos = [];

        for (const chunk of chunks) {
            const promises = chunk.map(async (addr) => {
                const hash = addressToScriptHash(addr);
                try {
                    const utxos = await electrumListUnspent(hash) as any[];
                    if (options.strict && (!Array.isArray(utxos) || utxos.some(u =>
                        !u || typeof u.tx_hash !== 'string' || !Number.isInteger(u.tx_pos) || u.tx_pos < 0 ||
                        !Number.isSafeInteger(u.value) || u.value < 0 || !Number.isInteger(u.height)))) {
                        throw new Error('Incomplete coin response');
                    }
                    if (!utxos) return [];
                    return utxos.map((u: any) => ({
                        txid: u.tx_hash,
                        vout: u.tx_pos,
                        value: u.value,
                        address: addr,
                        status: {
                            confirmed: u.height > 0,
                            block_height: u.height,
                            block_hash: null,
                            block_time: null
                        }
                    }));
                } catch (e) {
                    if (options.strict) throw e;
                    return [];
                }
            });
            const results = await Promise.all(promises);
            allUtxos.push(...results.flat());
        }
        return allUtxos;
    } catch (err) {
        if (options.strict) throw err;
        return [];
    }
};

const hydrateInputDetails = async (txs: any[], options: AddressFetchOptions = {}) => {
    const parent_ids = new Set<string>();
    txs.forEach(tx => {
        if (tx.vin) {
            tx.vin.forEach((input: any) => {
                if (input.txid && !input.coinbase) {
                    parent_ids.add(input.txid);
                }
            });
        }
    });

    const unique_parents = Array.from(parent_ids);
    if (unique_parents.length === 0) return txs;

    const batches = chunkArray(unique_parents, 10);
    const parent_map = new Map<string, any>();

    for (const batch of batches) {
        try {
            const results = await electrumBatchGetTransactions(batch) as any[];
            if (options.strict) requireBatchResults(results, batch.length, value => typeof value === 'string' && value.length > 0);
            results.forEach((r: any, index: number) => {
                if (r && r.result) {
                    const raw_tx_hex = r.result as string;
                    const decoded_tx = BitcoinTransaction.fromHex(raw_tx_hex);
                    const txid = decoded_tx.getId();
                    if (options.strict && txid !== batch[index]) throw new Error('Mismatched parent transaction');

                    const parsed_outputs = decoded_tx.outs.map(output => {
                        let output_address = null;
                        try {
                            output_address = btcAddress.fromOutputScript(output.script, NETWORK);
                        } catch (parsing_error) {
                            output_address = 'unknown_script';
                        }
                        return {
                            value: output.value,
                            scriptPubKey: { address: output_address }
                        };
                    });

                    parent_map.set(txid, { vout: parsed_outputs });
                }
            });
        } catch (e) {
            if (options.strict) throw e;
        }
    }

    return txs.map(tx => {
        const hydrated_vin = tx.vin.map((input: any) => {
            if (input.coinbase) return input;

            const parent = parent_map.get(input.txid);
            if (parent && parent.vout && parent.vout[input.vout]) {
                const source_output = parent.vout[input.vout];
                const val = source_output.value;
                const addr = source_output.scriptPubKey?.address || source_output.scriptPubKey?.addresses?.[0];

                return {
                    ...input,
                    prevout: {
                        value: val,
                        scriptpubkey_address: addr || 'Unknown'
                    }
                };
            }
            if (options.strict) throw new Error('Missing transaction input');
            return input;
        });

        return { ...tx, vin: hydrated_vin };
    });
};

const processTransaction = (tx: any, wallet_addresses: Set<string>, tip_height: number): Transaction => {
    let vout_total = 0;
    let wallet_vout_total = 0;
    let wallet_vin_total = 0;
    let vin_total = 0;

    const normalized_vout = tx.vout.map((output: any) => {
        const sats = output.value;
        const address = output.scriptPubKey?.address || output.scriptPubKey?.addresses?.[0] || output.scriptpubkey_address;

        if (wallet_addresses.has(address)) {
            wallet_vout_total += sats;
        }
        vout_total += sats;

        return {
            ...output,
            value: sats,
            scriptpubkey_address: address
        };
    });

    const normalized_vin = tx.vin.map((input: any) => {
        const prevout = input.prevout || {
            scriptpubkey_address: 'Unknown',
            value: 0
        };

        vin_total += prevout.value || 0;

        if (prevout.scriptpubkey_address && wallet_addresses.has(prevout.scriptpubkey_address)) {
            wallet_vin_total += prevout.value;
        }

        return {
            ...input,
            prevout
        };
    });

    let type: 'send' | 'receive' | 'internal' = 'receive';
    let amount = 0;

    if (wallet_vin_total > 0 && wallet_vout_total === 0) {
        type = 'send';
        amount = wallet_vin_total;
    } else if (wallet_vin_total > wallet_vout_total) {
        type = 'send';
        amount = wallet_vin_total - wallet_vout_total;
    } else {
        type = 'receive';
        amount = wallet_vout_total - wallet_vin_total;
    }

    let confirmations = 0;
    if (tx.blockheight && tx.blockheight > 0) {
        if (tip_height > 0) {
            confirmations = Math.max(1, tip_height - tx.blockheight + 1);
        } else {
            confirmations = 1;
        }
    }

    const is_confirmed = confirmations > 0;
    const effective_time = tx.blocktime || tx.time || Math.floor(Date.now() / 1000);
    const tx_fee = Math.max(0, vin_total - vout_total);

    const result: any = {
        txid: tx.txid || tx.hash,
        version: tx.version,
        locktime: tx.locktime,
        size: tx.size,
        weight: tx.weight,
        fee: tx_fee,
        vin: normalized_vin,
        vout: normalized_vout,
        confirmations: confirmations,
        status: {
            confirmed: is_confirmed,
            block_time: effective_time,
            block_height: tx.blockheight || null,
            block_hash: tx.blockhash || null
        },
        type,
        amount,
    };

    return result as Transaction;
};

export const fetchAddressTransactions = async (
    addresses: string[],
    limit?: number,
    offset: number = 0,
    options: AddressFetchOptions = {},
): Promise<Transaction[]> => {
    if (addresses.length === 0) return [];

    try {
        const tip_height = await getTipHeight();
        const map = addresses.map(addr => ({ addr, hash: addressToScriptHash(addr) }));
        const hashes = map.map(m => m.hash);
        if (options.strict && hashes.some(hash => !hash)) throw new Error('Invalid address');

        const histories = await electrumBatchGetHistory(hashes) as any[];
        if (options.strict) requireBatchResults(histories, hashes.length, validHistory);
        const tx_ids = new Set<string>();
        const height_map = new Map<string, number>();

        histories.forEach((h: any) => {
            if (!h.result) return;
            (h.result as any[]).forEach((item: any) => {
                tx_ids.add(item.tx_hash);
                if (item.height > 0) {
                    height_map.set(item.tx_hash, item.height);
                }
            });
        });

        let ordered_tx_ids = Array.from(tx_ids);

        if (limit !== undefined) {
            const historyOrder = new Map<string, { height: number; order: number }>();

            histories.forEach((h: any) => {
                if (!h.result) return;

                (h.result as any[]).forEach((item: any, index: number) => {
                    const existing = historyOrder.get(item.tx_hash);

                    if (!existing) {
                        historyOrder.set(item.tx_hash, {
                            height: item.height || 0,
                            order: index,
                        });
                        return;
                    }

                    // Keep the highest known height for transactions appearing
                    // in multiple wallet addresses.
                    if ((item.height || 0) > existing.height) {
                        existing.height = item.height || 0;
                    }
                });
            });

            ordered_tx_ids.sort((a, b) => {
                const aInfo = historyOrder.get(a);
                const bInfo = historyOrder.get(b);

                if (!aInfo && !bInfo) return 0;
                if (!aInfo) return 1;
                if (!bInfo) return -1;

                // Unconfirmed transactions (height 0) first.
                if (aInfo.height === 0 && bInfo.height !== 0) return -1;
                if (aInfo.height !== 0 && bInfo.height === 0) return 1;

                // Newest confirmed block first.
                if (aInfo.height !== bInfo.height) {
                    return bInfo.height - aInfo.height;
                }

                // Stable ordering for transactions with the same height.
                return bInfo.order - aInfo.order;
            });

            ordered_tx_ids = ordered_tx_ids.slice(offset, offset + limit);
        }

        const unique_ids = ordered_tx_ids;

        if (unique_ids.length === 0) return [];

        // Fetch timestamps only for transactions on this page. History is still
        // needed to order the page, but older blocks need no header requests.
        const time_map = new Map<number, number>();
        const heights_on_page = new Set<number>();
        unique_ids.forEach(txid => {
            const height = height_map.get(txid);
            if (height && height > 0) heights_on_page.add(height);
        });

        if (heights_on_page.size > 0) {
            const client = await getElectrumClient();
            const chunks = chunkArray(Array.from(heights_on_page), 10);
            for (const chunk of chunks) {
                await Promise.all(chunk.map(async (h) => {
                    try {
                        const r = await client.request('blockchain.block.header', [h]) as string;
                        if (r && typeof r === 'string' && r.length >= 160) {
                            const time_hex = r.substring(136, 144);
                            const timestamp = Buffer.from(time_hex, 'hex').readUInt32LE(0);
                            time_map.set(h, timestamp);
                        }
                    } catch (e) { }
                }));
            }
        }

        const batches = chunkArray(unique_ids, 10);
        
        let full_txs: any[] = [];

        for (const batch of batches) {
            const results = await electrumBatchGetTransactions(batch) as any[];
            if (options.strict) requireBatchResults(results, batch.length, value => typeof value === 'string' && value.length > 0);
            results.forEach((r: any, index: number) => {
                if (r.result) {
                    const raw_tx_hex = r.result as string;
                    const decoded_tx = BitcoinTransaction.fromHex(raw_tx_hex);

                    if (options.strict && decoded_tx.getId() !== batch[index]) throw new Error('Mismatched transaction');
                    const transaction_inputs = decoded_tx.ins.map(input => {
                        return {
                            txid: Buffer.from(input.hash).reverse().toString('hex'),
                            vout: input.index,
                            sequence: input.sequence,
                            ...(options.strict && decoded_tx.isCoinbase() ? { coinbase: true } : {}),
                        };
                    });

                    const transaction_outputs = decoded_tx.outs.map(output => {
                        let output_address = null;
                        try {
                            output_address = btcAddress.fromOutputScript(output.script, NETWORK);
                        } catch (parsing_error) {
                            output_address = 'unknown_script';
                        }

                        return {
                            value: output.value,
                            scriptpubkey_address: output_address,
                            scriptPubKey: { address: output_address }
                        };
                    });

                    const tx_hash = batch[index];
                    const height = height_map.get(tx_hash) || null;
                    const blocktime = height ? time_map.get(height) : undefined;

                    const tx = {
                        txid: decoded_tx.getId(),
                        hash: decoded_tx.getId(),
                        version: decoded_tx.version,
                        locktime: decoded_tx.locktime,
                        size: decoded_tx.byteLength(),
                        weight: decoded_tx.weight(),
                        vin: transaction_inputs,
                        vout: transaction_outputs,
                        blockheight: height,
                        blocktime: blocktime
                    };

                    full_txs.push(tx);
                }
            });
        }

        const hydrated_txs = await hydrateInputDetails(full_txs, options);
        const wallet_address_set = new Set(addresses);
        const processed = hydrated_txs.map(tx => processTransaction(tx, wallet_address_set, tip_height));

        return processed.sort((a, b) => (b.status.block_time || 0) - (a.status.block_time || 0));
    } catch (err) {
        if (options.strict) throw err;
        return [];
    }
};

export const broadcastTransaction = async (tx_hex: string): Promise<string> => {
    try {
        return (await electrumBroadcast(tx_hex)) as string;
    } catch (err: any) {
        throw new Error(err.message || 'Broadcast failed');
    }
};

export const fetchFeeEstimates = async (): Promise<{ fast: number; normal: number; slow: number; }> => {
    const isTestnet = IS_TESTNET;
    try {
        const baseUrl = isTestnet
            ? 'https://mempool.space/testnet/api/v1/fees/recommended'
            : 'https://mempool.space/api/v1/fees/recommended';

        // 1. Setup the fetch request with headers
        const fetchPromise = fetch(baseUrl, {
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'TrustlessWallet/1.0'
            }
        });

        // 2. Setup a strict 3-second timeout
        const timeoutPromise = new Promise<Response>((_, reject) =>
            setTimeout(() => reject(new Error('Mempool timeout')), 3000)
        );

        // 3. Race the fetch against the timeout. If it takes longer than 3s, it fails instantly.
        const response = await Promise.race([fetchPromise, timeoutPromise]);

        if (!response.ok) throw new Error('Mempool API error');

        const data = await response.json();
        if (data && data.fastestFee) {
            return {
                fast: data.fastestFee,
                normal: data.halfHourFee,
                slow: data.hourFee
            };
        }
    } catch (e) {
        console.warn(`Mempool ${isTestnet ? 'Testnet' : 'Mainnet'} API failed or timed out`);
    }

    // 4. Fallback to Electrum node fee estimation
    try {
        const [fast, normal, slow] = await Promise.all([
            electrumEstimateFee(1),
            electrumEstimateFee(5),
            electrumEstimateFee(25)
        ]);

        const to_sats_vb = (btc_per_kb: any, fallback: number) => {
            const val = Number(btc_per_kb);
            // Some Electrum testnet nodes return -1. This handles it gracefully.
            if (isNaN(val) || val <= 0) return fallback;
            const sats_vb = Math.ceil((val * 100000000) / 1000);
            if (!isTestnet && sats_vb > 300) return fallback;
            return sats_vb;
        };

        return {
            fast: to_sats_vb(fast, isTestnet ? 1.5 : 20),
            normal: to_sats_vb(normal, isTestnet ? 1.1 : 10),
            slow: to_sats_vb(slow, 1)
        };
    } catch (err) {
        return isTestnet
            ? { fast: 2, normal: 1, slow: 1 }
            : { fast: 25, normal: 12, slow: 1 };
    }
};

export const fetchBalanceDetails = async (addresses: string[]): Promise<{ totalBalance: number; availableToSend: number }> => {
    const utxos = await fetchUTXOs(addresses);
    const total = utxos.reduce((acc: number, u: any) => acc + u.value, 0);
    return { totalBalance: total, availableToSend: total };
};

export const getTransactionDetails = async (txid: string, wallet_addresses: string[]): Promise<Transaction> => {
    const raw_tx_hex = (await electrumGetTransaction(txid)) as string;
    const decoded_tx = BitcoinTransaction.fromHex(raw_tx_hex);

    const transaction_inputs = decoded_tx.ins.map(input => {
        return {
            txid: Buffer.from(input.hash).reverse().toString('hex'),
            vout: input.index,
            sequence: input.sequence
        };
    });

    const transaction_outputs = decoded_tx.outs.map(output => {
        let output_address = null;
        try {
            output_address = btcAddress.fromOutputScript(output.script, NETWORK);
        } catch (parsing_error) {
            output_address = 'unknown_script';
        }

        return {
            value: output.value,
            scriptpubkey_address: output_address,
            scriptPubKey: { address: output_address }
        };
    });

    const tx: any = {
        txid: decoded_tx.getId(),
        hash: decoded_tx.getId(),
        version: decoded_tx.version,
        locktime: decoded_tx.locktime,
        size: decoded_tx.byteLength(),
        weight: decoded_tx.weight(),
        vin: transaction_inputs,
        vout: transaction_outputs,
    };

    const tip_height = await getTipHeight();
    const [hydrated] = await hydrateInputDetails([tx]);
    return processTransaction(hydrated, new Set(wallet_addresses), tip_height);
};

export const getTipHeight = async (): Promise<number> => {
    try {
        const client = await getElectrumClient();
        const header = await client.request('blockchain.headers.subscribe') as any;
        return header.height || header.block_height || 0;
    } catch (e) {
        return 0;
    }
};

export const validateBitcoinAddress = (address: string): boolean => {
    try {
        btcAddress.toOutputScript(address, NETWORK);
        return true;
    } catch (e) {
        return false;
    }
};

export const buildPSBT = (
    activeWallet: any,
    recipientAddress: string,
    amount: string,
    unit: string,
    fee: number,
    utxos: any[]
): string => {
    if (!activeWallet || activeWallet.type !== 'watch-only') throw new Error("Invalid wallet type");
    if (!/^[a-f\d]{8}$/i.test(activeWallet.fingerprint || '') || !activeWallet.xpub) {
        throw new Error("Wallet is missing a valid master fingerprint or xpub.");
    }
    if (!Array.isArray(utxos) || utxos.length === 0) throw new Error('Select at least one UTXO.');
    if (!Number.isSafeInteger(fee) || fee < 0) throw new Error('Invalid transaction fee.');
    const cleanAmount = amount.trim().replace(',', '.');
    if (unit !== 'BTC' && unit !== 'sats') throw new Error('Invalid amount unit.');
    if (unit === 'BTC' ? !/^\d+(?:\.\d{1,8})?$/.test(cleanAmount) : !/^\d+$/.test(cleanAmount)) {
        throw new Error('Invalid transaction amount.');
    }
    const amountSatoshis = unit === 'BTC' ? Math.round(Number(cleanAmount) * 100000000) : Number(cleanAmount);
    if (!Number.isSafeInteger(amountSatoshis) || amountSatoshis < DUST_THRESHOLD) {
        throw new Error('Recipient amount is below the spendable minimum.');
    }
    btcAddress.toOutputScript(recipientAddress, NETWORK);
    const totalInput = utxos.reduce((sum, u) => {
        if (!Number.isSafeInteger(u.value) || u.value <= 0) throw new Error('Invalid UTXO value.');
        if (!/^[a-f\d]{64}$/i.test(u.txid) || !Number.isSafeInteger(u.vout) || u.vout < 0 || u.vout > 0xffffffff) {
            throw new Error('Invalid UTXO outpoint.');
        }
        const next = sum + u.value;
        if (!Number.isSafeInteger(next)) throw new Error('UTXO total is too large.');
        return next;
    }, 0);
    const change = totalInput - amountSatoshis - fee;
    if (!Number.isSafeInteger(change) || change < 0) throw new Error('Insufficient funds for amount and fee.');
    if (change > 0 && change < DUST_THRESHOLD) throw new Error('Change is below the spendable minimum.');
    const outpoints = new Set(utxos.map(u => `${u.txid.toLowerCase()}:${u.vout}`));
    if (outpoints.size !== utxos.length) throw new Error('Duplicate UTXO selected.');

    const psbt = new Psbt({ network: NETWORK });
    const rootNode = getBip32Node(activeWallet.xpub, NETWORK);
    if (!rootNode.isNeutered()) throw new Error('Wallet key must be public.');
    const masterFingerprint = Buffer.from(activeWallet.fingerprint, 'hex');
    const scriptType = activeWallet.scriptType || inferScriptType(activeWallet.xpub);
    if (scriptType !== 'p2wpkh' && scriptType !== 'p2sh-p2wpkh') throw new Error('Unsupported wallet script type.');
    const paymentFor = (pubkey: Buffer) => {
        const witness = payments.p2wpkh({ pubkey, network: NETWORK });
        if (scriptType === 'p2wpkh') return { address: witness.address!, output: witness.output!, redeemScript: undefined };
        const wrapped = payments.p2sh({ redeem: witness, network: NETWORK });
        return { address: wrapped.address!, output: wrapped.output!, redeemScript: witness.output! };
    };

    let basePath = activeWallet.derivation_path || DERIVATION_PARENT_PATH;
    if (basePath.startsWith('m/')) basePath = basePath.slice(2);
    basePath = basePath.replace(/'/g, 'h');

    utxos.forEach(utxo => {
        const recvInfo = activeWallet.derivedReceiveAddresses.find((a: any) => a.address === utxo.address);
        const changeInfo = recvInfo ? null : activeWallet.derivedChangeAddresses.find((a: any) => a.address === utxo.address);

        if (!recvInfo && !changeInfo) throw new Error("Derivation info missing for UTXO");

        const chain = changeInfo ? 1 : 0;
        const index = changeInfo ? changeInfo.index : recvInfo!.index;
        if (!Number.isSafeInteger(index) || index < 0 || index > 0x7fffffff) throw new Error('Invalid UTXO derivation index.');
        const pathSuffix = `${chain}/${index}`;
        const fullPath = `m/${basePath}/${pathSuffix}`.replace(/h/g, "'");

        const childNode = rootNode.derivePath(pathSuffix);
        const payment = paymentFor(childNode.publicKey);
        if (payment.address !== utxo.address) throw new Error('UTXO address does not match the wallet derivation.');

        psbt.addInput({
            hash: utxo.txid,
            index: utxo.vout,
            witnessUtxo: { script: payment.output, value: utxo.value },
            ...(payment.redeemScript ? { redeemScript: payment.redeemScript } : {}),
            bip32Derivation: [{
                masterFingerprint,
                path: fullPath,
                pubkey: childNode.publicKey
            }]
        });
    });

    psbt.addOutput({ address: recipientAddress, value: amountSatoshis });

    if (change > 0) {
        let verifiedChangeIndex = activeWallet.changeAddressIndex ?? 0;
        if (!Number.isSafeInteger(verifiedChangeIndex) || verifiedChangeIndex < 0 || verifiedChangeIndex > 0x7fffffff) {
            throw new Error('Invalid change derivation index.');
        }
        const changeSet = new Set(activeWallet.derivedChangeAddresses.map((a: any) => a.address));
        for (let i = verifiedChangeIndex; i < activeWallet.derivedChangeAddresses.length + 20; i++) {
            const info = activeWallet.derivedAddressInfoCache.find((c: any) => c.index === i && changeSet.has(c.address));
            if (!info || info.tx_count === 0) {
                verifiedChangeIndex = i;
                break;
            }
        }

        const changeNode = rootNode.derivePath(`1/${verifiedChangeIndex}`);
        const changePayment = paymentFor(changeNode.publicKey);
        const fullChangePath = `m/${basePath}/1/${verifiedChangeIndex}`.replace(/h/g, "'");

        psbt.addOutput({
            address: changePayment.address,
            value: change,
            ...(changePayment.redeemScript ? { redeemScript: changePayment.redeemScript } : {}),
            bip32Derivation: [{
                masterFingerprint,
                path: fullChangePath,
                pubkey: changeNode.publicKey
            }]
        });
    }

    return psbt.toBase64();
};

export const encodePSBTtoUR = (base64Psbt: string): string[] => {
    const psbtBytes = Buffer.from(base64Psbt, 'base64');
    const ur = new UR(cborEncode(psbtBytes), 'crypto-psbt');
    const encoder = new UREncoder(ur, 120);
    return encoder.encodeWhole();
};

export const finalizeAndBroadcastPSBT = async (unsignedPsbtBase64: string, signedPsbtBase64: string): Promise<string> => {
    const basePsbt = Psbt.fromBase64(unsignedPsbtBase64, { network: NETWORK });
    const signedPsbt = Psbt.fromBase64(signedPsbtBase64, { network: NETWORK });

    basePsbt.combine(signedPsbt);
    basePsbt.finalizeAllInputs();
    const txHex = basePsbt.extractTransaction().toHex();

    return await broadcastTransaction(txHex);
};
