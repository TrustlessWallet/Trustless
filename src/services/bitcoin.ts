import { Transaction } from '../types';
import { NETWORK, CUSTOM_NODE_URL_KEY, NETWORK_NAME, IS_TESTNET } from '../constants/network';
import { address as btcAddress, networks, Transaction as BitcoinTransaction } from 'bitcoinjs-lib';
import { BIP32Factory } from 'bip32';
import * as secp from '@bitcoinerlab/secp256k1';
import { Buffer } from 'buffer';
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
        const map = addresses.map(addr => ({ addr, hash: addressToScriptHash(addr) }));
        const hashes = map.map(m => m.hash);

        const balances = await electrumBatchGetBalance(hashes) as any[];
        const histories = await electrumBatchGetHistory(hashes) as any[];

        return map.map((item, index) => {
            const bal_data = balances[index].result as any;
            const hist_data = histories[index].result as any[];
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

export const fetchBitcoinBalance = async (address: string): Promise<number> => {
    const [info] = await fetchAddressInfoBatch([address]);
    return info ? info.balance : 0;
};

export const fetchUTXOs = async (addresses: string[]) => {
    if (addresses.length === 0) return [];

    try {
        const promises = addresses.map(async (addr) => {
            const hash = addressToScriptHash(addr);
            const utxos = await electrumListUnspent(hash) as any[];
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
        });

        const results = await Promise.all(promises);
        return results.flat();
    } catch (err) {
        return [];
    }
};

const hydrateInputDetails = async (txs: any[]) => {
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
            results.forEach((r: any) => {
                if (r && r.result) {
                    const raw_tx_hex = r.result as string;
                    const decoded_tx = BitcoinTransaction.fromHex(raw_tx_hex);
                    const txid = decoded_tx.getId();

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
        } catch (e) { }
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

export const fetchAddressTransactions = async (addresses: string[]): Promise<Transaction[]> => {
    if (addresses.length === 0) return [];

    try {
        const tip_height = await getTipHeight();
        const map = addresses.map(addr => ({ addr, hash: addressToScriptHash(addr) }));
        const hashes = map.map(m => m.hash);

        const histories = await electrumBatchGetHistory(hashes) as any[];
        const tx_ids = new Set<string>();
        const height_map = new Map<string, number>();
        const unique_heights = new Set<number>();

        histories.forEach((h: any) => {
            if (!h.result) return;
            (h.result as any[]).forEach((item: any) => {
                tx_ids.add(item.tx_hash);
                if (item.height > 0) {
                    height_map.set(item.tx_hash, item.height);
                    unique_heights.add(item.height);
                }
            });
        });

        const time_map = new Map<number, number>();
        const height_arr = Array.from(unique_heights);

        if (height_arr.length > 0) {
            const client = await getElectrumClient();
            const chunks = chunkArray(height_arr, 10);
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

        const unique_ids = Array.from(tx_ids);
        if (unique_ids.length === 0) return [];

        const batches = chunkArray(unique_ids, 10);
        let full_txs: any[] = [];

        for (const batch of batches) {
            const results = await electrumBatchGetTransactions(batch) as any[];
            results.forEach((r: any, index: number) => {
                if (r.result) {
                    const raw_tx_hex = r.result as string;
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

        const hydrated_txs = await hydrateInputDetails(full_txs);
        const wallet_address_set = new Set(addresses);
        const processed = hydrated_txs.map(tx => processTransaction(tx, wallet_address_set, tip_height));

        return processed.sort((a, b) => (b.status.block_time || 0) - (a.status.block_time || 0));
    } catch (err) {
        return [];
    }
};

export const broadcastTransaction = async (tx_hex: string) => {
    try {
        return await electrumBroadcast(tx_hex);
    } catch (err: any) {
        throw new Error(err.message || 'Broadcast failed');
    }
};

export const fetchFeeEstimates = async (): Promise<{ fast: number; normal: number; slow: number; }> => {
    const isTestnet = IS_TESTNET;

    // 1. Try Mempool.space
    try {
        const baseUrl = isTestnet
            ? 'https://mempool.space/testnet/api/v1/fees/recommended'
            : 'https://mempool.space/api/v1/fees/recommended';

        const response = await fetch(baseUrl);
        const data = await response.json();

        if (data && data.fastestFee) {
            return {
                fast: data.fastestFee,
                normal: data.halfHourFee,
                slow: data.hourFee
            };
        }
    } catch (e) {
        console.warn(`Mempool ${isTestnet ? 'Testnet' : 'Mainnet'} API failed`);
    }

    // 2. Fallback to Electrum
    try {
        const [fast, normal, slow] = await Promise.all([
            electrumEstimateFee(1),
            electrumEstimateFee(5),
            electrumEstimateFee(25)
        ]);

        const to_sats_vb = (btc_per_kb: any, fallback: number) => {
            const val = Number(btc_per_kb);
            if (isNaN(val) || val <= 0) return fallback;

            const sats_vb = Math.ceil((val * 100000000) / 1000);

            // Mainnet high-fee ghosting protection
            if (!isTestnet && sats_vb > 300) return fallback;

            return sats_vb;
        };

        return {
            fast: to_sats_vb(fast, isTestnet ? 1.5 : 20),
            normal: to_sats_vb(normal, isTestnet ? 1.1 : 10),
            slow: to_sats_vb(slow, 1)
        };
    } catch (err) {
        // Default safety values
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