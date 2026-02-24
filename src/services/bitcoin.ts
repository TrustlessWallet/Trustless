import { Transaction } from '../types';
import { NETWORK, CUSTOM_NODE_URL_KEY } from '../constants/network';
import { address as btcAddress, networks } from 'bitcoinjs-lib';
import { BIP32Factory } from 'bip32';
import * as secp from '@bitcoinerlab/secp256k1';
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

// Initialize the BIP32 factory with the secp256k1 curve library.
// This is required for hierarchical deterministic (HD) key derivation.
const bip32 = BIP32Factory(secp);

/**
 * DUST_THRESHOLD
 * The minimum output value (in satoshis) that is generally accepted by the network.
 * Outputs smaller than this are considered "dust" and are often rejected by nodes
 * to prevent UTXO set bloat. 546 sats is the standard dust limit for P2PKH/P2WPKH.
 */
export const DUST_THRESHOLD = 546;

/**
 * Extended Public Key (xpub) Magic Bytes
 * Standard xpubs start with 'xpub' (mainnet) or 'tpub' (testnet).
 * However, Electrum and other wallets use different prefixes to denote script types:
 * - zpub/vpub: Native SegWit (P2WPKH)
 * - ypub/upub: Nested SegWit (P2SH-P2WPKH)
 * We define these alternate network objects so bitcoinjs-lib can parse them.
 */
const ALT_NETWORKS = {
  bitcoin: [
    { ...networks.bitcoin, bip32: { public: 0x04b24746, private: 0x04b2430c } }, // zpub
    { ...networks.bitcoin, bip32: { public: 0x049d7cb2, private: 0x049d7878 } }, // ypub
  ],
  testnet: [
    { ...networks.testnet, bip32: { public: 0x045f1cf6, private: 0x045f18bc } }, // vpub
    { ...networks.testnet, bip32: { public: 0x044a5262, private: 0x044a4e28 } }, // upub
  ]
};

/**
 * Parse an Extended Public Key (xpub/ypub/zpub).
 * Since bitcoinjs-lib is strict about network magic bytes, we attempt to parse
 * against the standard network first, then fall back to the alternate "SLIP-132" networks
 * if the key uses a different prefix (like zpub).
 */
export const getBip32Node = (key: string, network: any) => {
  try {
    return bip32.fromBase58(key, network);
  } catch (e) {}

  const isMainnet = network.bech32 === 'bc';
  const alts = isMainnet ? ALT_NETWORKS.bitcoin : ALT_NETWORKS.testnet;

  for (const altNet of alts) {
    try {
      return bip32.fromBase58(key, altNet);
    } catch (e) {}
  }

  throw new Error("Invalid Network Key or Format");
};

/**
 * Determines the script type based on the key prefix.
 * This is crucial for deriving addresses correctly.
 * - ypub/upub -> p2sh-p2wpkh (Wrapped SegWit)
 * - xpub/zpub -> p2wpkh (Native SegWit) - Defaulting standard xpub to Native SegWit for this app.
 */
export const inferScriptType = (key: string): 'p2wpkh' | 'p2sh-p2wpkh' => {
  if (key.startsWith('ypub') || key.startsWith('upub')) {
      return 'p2sh-p2wpkh';
  }
  return 'p2wpkh'; 
};

// Helper: Splits a large array into smaller chunks for batching requests.
const chunkArray = <T>(array: T[], size: number): T[][] => {
  const chunked: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunked.push(array.slice(i, i + size));
  }
  return chunked;
};

/**
 * Estimates the transaction size in virtual bytes (vbytes).
 * - Input (P2WPKH): ~68 vbytes
 * - Output (P2WPKH): ~31 vbytes
 * - Overhead: ~10.5 vbytes
 * This is an approximation used for fee calculation before signing.
 */
export const calculateVSize = (nInputs: number, nOutputs: number): number => {
  return Math.ceil((nInputs * 68) + (nOutputs * 31) + 10.5);
};

/**
 * Calculates fee, change, and final transaction metrics.
 * Logic:
 * 1. Calculate size/fee assuming 1 output (Destination only).
 * 2. Calculate remainder (Total Input - Amount - Fee).
 * 3. If remainder > DUST_THRESHOLD, we add a Change Output.
 * 4. Recalculate size/fee with 2 outputs.
 * 5. If the new remainder is still > DUST, we include the change output.
 * Otherwise, the remainder is dropped to fee (it's too small to spend later).
 */
export const calculateTransactionMetrics = (
  nInputs: number,
  amount: number,
  totalInputValue: number,
  feeRate: number
): { vsize: number; fee: number; change: number; numOutputs: number } => {
  let numOutputs = 1;
  let vsize = calculateVSize(nInputs, numOutputs);
  let fee = Math.ceil(vsize * feeRate);
  let change = totalInputValue - amount - fee;

  // If we have enough left over for a change output...
  if (change > DUST_THRESHOLD) {
    const vsizeTwo = calculateVSize(nInputs, 2);
    const feeTwo = Math.ceil(vsizeTwo * feeRate);
    const changeTwo = totalInputValue - amount - feeTwo;
    
    // Check if adding the change output makes the change amount drop below dust
    if (changeTwo > DUST_THRESHOLD) {
       numOutputs = 2;
       vsize = vsizeTwo;
       fee = feeTwo;
       change = changeTwo;
    }
  }
  return { vsize, fee, change, numOutputs };
};

export const testNodeConnection = async (customUrl: string): Promise<boolean> => {
    try { return true; } catch (error) { return false; }
};

/**
 * Batched fetch of address balances and transaction counts.
 * Uses addressToScriptHash to convert human-readable addresses to the format Electrum expects.
 */
export const fetchAddressInfoBatch = async (
  addresses: string[]
): Promise<{ address: string; balance: number; tx_count: number }[]> => {
  if (addresses.length === 0) return [];

  try {
    const map = addresses.map(addr => ({ addr, hash: addressToScriptHash(addr) }));
    const hashes = map.map(m => m.hash);

    // Parallel execution of batch requests
    const balances = await electrumBatchGetBalance(hashes) as any[];
    const histories = await electrumBatchGetHistory(hashes) as any[];

    return map.map((item, index) => {
        const balData = balances[index].result as any;
        const histData = histories[index].result as any[];
        const totalBalance = (balData?.confirmed || 0) + (balData?.unconfirmed || 0);
        const txCount = histData ? histData.length : 0;

        return {
            address: item.addr,
            balance: totalBalance,
            tx_count: txCount
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

/**
 * Fetches UTXOs (Unspent Transaction Outputs) for a list of addresses.
 * Note: Electrum's `listunspent` returns simple data. It does NOT include the full
 * input transaction details, which are needed safely for some signing operations.
 * (See hydrateInputDetails below).
 */
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

/**
 * UTXO Hydration (Critical Security Step)
 * When dealing with transaction history, we often only get the TXID of the inputs (`vin`).
 * We do not know the value (amount) or the address of those inputs unless we fetch the
 * parent transaction.
 * * This function:
 * 1. Identifies all unique parent TXIDs from the inputs.
 * 2. Fetches the full content of those parent transactions.
 * 3. Maps the output of the parent (prevout) to the input of the current transaction.
 * * Result: We know exactly how much value was spent and from which address.
 */
const hydrateInputDetails = async (txs: any[]) => {
    const parentIds = new Set<string>();
    txs.forEach(tx => {
        if (tx.vin) {
            tx.vin.forEach((input: any) => {
                if (input.txid && !input.coinbase) {
                    parentIds.add(input.txid);
                }
            });
        }
    });

    const uniqueParents = Array.from(parentIds);
    if (uniqueParents.length === 0) return txs;

    // Batch fetch parent transactions in chunks of 10
    const batches = chunkArray(uniqueParents, 10);
    const parentMap = new Map<string, any>();

    for (const batch of batches) {
        try {
            const results = await electrumBatchGetTransactions(batch) as any[];
            results.forEach((r: any) => {
                if (r && r.result) {
                    parentMap.set(r.result.txid || r.result.hash, r.result);
                }
            });
        } catch (e) {
            console.warn('Failed to hydrate some inputs', e);
        }
    }

    // Attach prevout data to inputs
    return txs.map(tx => {
        const hydratedVin = tx.vin.map((input: any) => {
            if (input.coinbase) return input;

            const parent = parentMap.get(input.txid);
            if (parent && parent.vout && parent.vout[input.vout]) {
                const sourceOutput = parent.vout[input.vout];
                
                let val = sourceOutput.value;
                // Normalize BTC decimal values to Satoshis (integer)
                if (typeof val === 'number' && val < 21000000) val = Math.round(val * 100000000);
                
                const addr = sourceOutput.scriptPubKey?.address || 
                             sourceOutput.scriptPubKey?.addresses?.[0];

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

        return { ...tx, vin: hydratedVin };
    });
};

/**
 * Transforms raw Electrum transaction data into a clean, internal `Transaction` object.
 * It determines:
 * - Direction: 'send', 'receive', or 'internal' (self-transfer).
 * - Net Amount: based on wallet-owned inputs vs outputs.
 */
const processTransaction = (tx: any, walletAddresses: Set<string>): Transaction => {
    let voutTotal = 0;
    let walletVoutTotal = 0;
    let walletVinTotal = 0;
    let vin_total = 0; 

    const normalizedVout = tx.vout.map((output: any) => {
        let sats = output.value;
        if (typeof sats === 'number' && sats < 21000000) { 
             sats = Math.round(sats * 100000000);
        }

        const address = output.scriptPubKey?.address || 
                        output.scriptPubKey?.addresses?.[0] || 
                        output.scriptpubkey_address;

        if (walletAddresses.has(address)) {
            walletVoutTotal += sats;
        }
        voutTotal += sats;

        return {
            ...output,
            value: sats,
            scriptpubkey_address: address
        };
    });

    const normalizedVin = tx.vin.map((input: any) => {
        const prevout = input.prevout || { 
            scriptpubkey_address: 'Unknown', 
            value: 0 
        };

        vin_total += prevout.value || 0; 

        if (prevout.scriptpubkey_address && walletAddresses.has(prevout.scriptpubkey_address)) {
            walletVinTotal += prevout.value;
        }

        return {
            ...input,
            prevout
        };
    });

    let type: 'send' | 'receive' | 'internal' = 'receive'; 
    let amount = 0;

    if (walletVinTotal > 0 && walletVoutTotal === 0) {
        type = 'send';
        amount = walletVinTotal; 
    } else if (walletVinTotal > walletVoutTotal) {
        type = 'send';
        amount = walletVinTotal - walletVoutTotal; 
    } else {
        type = 'receive';
        amount = walletVoutTotal - walletVinTotal;
    }

    const isConfirmed = (tx.confirmations || 0) > 0;
    const effectiveTime = isConfirmed 
        ? (tx.time || tx.blocktime || 0) 
        : Math.floor(Date.now() / 1000);

    const tx_fee = Math.max(0, vin_total - voutTotal);

    return { 
        txid: tx.txid || tx.hash,
        version: tx.version,
        locktime: tx.locktime,
        size: tx.size,
        weight: tx.weight,
        fee: tx_fee, 
        vin: normalizedVin,
        vout: normalizedVout,
        status: { 
            confirmed: isConfirmed, 
            block_time: effectiveTime,
            block_height: tx.blockheight || null,
            block_hash: tx.blockhash || null
        },
        type, 
        amount, 
    };
};

/**
 * Fetches full transaction history for a set of addresses.
 * 1. Get history (TXIDs) for all addresses.
 * 2. Deduplicate TXIDs (addresses often share transactions).
 * 3. Fetch full transaction hex/json for unique IDs.
 * 4. Hydrate inputs (fetch parents).
 * 5. Process and sort by time.
 */
export const fetchAddressTransactions = async (addresses: string[]): Promise<Transaction[]> => {
  if (addresses.length === 0) return [];

  try {
      const map = addresses.map(addr => ({ addr, hash: addressToScriptHash(addr) }));
      const hashes = map.map(m => m.hash);

      const histories = await electrumBatchGetHistory(hashes) as any[];
      const txIds = new Set<string>();
      const heightMap = new Map<string, number>();
      
      histories.forEach((h: any) => {
          (h.result as any[]).forEach((item: any) => {
              txIds.add(item.tx_hash);
              if (item.height > 0) {
                  heightMap.set(item.tx_hash, item.height);
              }
          });
      });

      const uniqueIds = Array.from(txIds);
      if (uniqueIds.length === 0) return [];

      const batches = chunkArray(uniqueIds, 10);
      let fullTxs: any[] = [];
      
      for (const batch of batches) {
          const results = await electrumBatchGetTransactions(batch) as any[];
          results.forEach((r: any) => {
              if (r.result) {
                  const tx = r.result;
                  const height = heightMap.get(tx.txid || tx.hash);
                  if (height) tx.blockheight = height;
                  fullTxs.push(tx);
              }
          });
      }

      const hydratedTxs = await hydrateInputDetails(fullTxs);
      const walletAddressSet = new Set(addresses);
      const processed = hydratedTxs.map(tx => processTransaction(tx, walletAddressSet));

      return processed.sort((a, b) => (b.status.block_time || 0) - (a.status.block_time || 0));
  } catch (err) {
    return [];
  }
};

export const broadcastTransaction = async (txHex: string) => {
  try {
      return await electrumBroadcast(txHex);
  } catch (err: any) {
      throw new Error(err.message || 'Broadcast failed');
  }
};

/**
 * Fetches network fee estimates for different confirmation targets.
 * - Fast: 1 block
 * - Normal: 5 blocks
 * - Slow: 25 blocks
 * Returns values in satoshis per vbyte (sats/vB).
 */
export const fetchFeeEstimates = async (): Promise<{ fast: number; normal: number; slow: number; }> => {
  try {
    const [fast, normal, slow] = await Promise.all([
        electrumEstimateFee(1),
        electrumEstimateFee(5),
        electrumEstimateFee(25)
    ]) as [any, any, any];

    // Helper to convert BTC/kB -> sats/vB
    const toSatsVB = (btcPerKb: any) => {
        const val = Number(btcPerKb);
        if (isNaN(val) || val < 0) return 1;
        return Math.ceil((val * 100000000) / 1000);
    };

    return {
        fast: toSatsVB(fast),
        normal: toSatsVB(normal),
        slow: toSatsVB(slow),
    };
  } catch (err) {
    // Fallback defaults if estimation fails
    return { fast: 10, normal: 5, slow: 2 };
  }
};

export const fetchBalanceDetails = async (addresses: string[]): Promise<{ totalBalance: number; availableToSend: number }> => {
    const utxos = await fetchUTXOs(addresses);
    const total = utxos.reduce((acc: number, u: any) => acc + u.value, 0);
    return { totalBalance: total, availableToSend: total };
};

export const getTransactionDetails = async (txid: string, walletAddresses: string[]): Promise<Transaction> => {
    const tx: any = await electrumGetTransaction(txid);
    
    if (tx.confirmations && tx.confirmations > 0) {
        const tipHeight = await getTipHeight();
        tx.blockheight = tipHeight - tx.confirmations + 1;
    }
    
    const [hydrated] = await hydrateInputDetails([tx]);
    return processTransaction(hydrated, new Set(walletAddresses));
};

export const getTipHeight = async (): Promise<number> => {
    try {
        const header = await electrumGetHeader() as any; 
        return header.height;
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