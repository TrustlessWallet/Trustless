import { Transaction } from '../types';
import { NETWORK, CUSTOM_NODE_URL_KEY } from '../constants/network';
import { address as btcAddress } from 'bitcoinjs-lib';
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

export const DUST_THRESHOLD = 546;

const chunkArray = <T>(array: T[], size: number): T[][] => {
  const chunked: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunked.push(array.slice(i, i + size));
  }
  return chunked;
};

export const calculateVSize = (nInputs: number, nOutputs: number): number => {
  return Math.ceil((nInputs * 68) + (nOutputs * 31) + 10.5);
};

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

  if (change > DUST_THRESHOLD) {
    const vsizeTwo = calculateVSize(nInputs, 2);
    const feeTwo = Math.ceil(vsizeTwo * feeRate);
    const changeTwo = totalInputValue - amount - feeTwo;
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
            status: { confirmed: u.height > 0, block_height: u.height }
        }));
    });

    const results = await Promise.all(promises);
    return results.flat();
  } catch (err) {
      return [];
  }
};

// --- DATA HYDRATION ---
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

    return txs.map(tx => {
        const hydratedVin = tx.vin.map((input: any) => {
            if (input.coinbase) return input;

            const parent = parentMap.get(input.txid);
            if (parent && parent.vout && parent.vout[input.vout]) {
                const sourceOutput = parent.vout[input.vout];
                
                let val = sourceOutput.value;
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


const processTransaction = (tx: any, walletAddresses: Set<string>): Transaction => {
    let voutTotal = 0;
    let walletVoutTotal = 0;
    let walletVinTotal = 0; 

    // 1. Process Outputs
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

    // 2. Process Inputs
    const normalizedVin = tx.vin.map((input: any) => {
        const prevout = input.prevout || { 
            scriptpubkey_address: 'Unknown', 
            value: 0 
        };

        if (prevout.scriptpubkey_address && walletAddresses.has(prevout.scriptpubkey_address)) {
            walletVinTotal += prevout.value;
        }

        return {
            ...input,
            prevout
        };
    });

    // 3. Determine Type
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

    // 4. Status & Time Logic (FIXED FOR UNCONFIRMED)
    const isConfirmed = (tx.confirmations || 0) > 0;
    // If unconfirmed, give it "Current Time" so it sorts to the top.
    // If confirmed but missing time (rare), give it 0.
    const effectiveTime = isConfirmed 
        ? (tx.time || tx.blocktime || 0) 
        : Math.floor(Date.now() / 1000);

    return { 
        txid: tx.txid || tx.hash,
        version: tx.version,
        locktime: tx.locktime,
        size: tx.size,
        weight: tx.weight,
        fee: 0, 
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

export const fetchAddressTransactions = async (addresses: string[]): Promise<Transaction[]> => {
  if (addresses.length === 0) return [];

  try {
      const map = addresses.map(addr => ({ addr, hash: addressToScriptHash(addr) }));
      const hashes = map.map(m => m.hash);

      const histories = await electrumBatchGetHistory(hashes) as any[];
      const txIds = new Set<string>();
      
      histories.forEach((h: any) => {
          (h.result as any[]).forEach((item: any) => txIds.add(item.tx_hash));
      });

      const uniqueIds = Array.from(txIds);
      if (uniqueIds.length === 0) return [];

      const batches = chunkArray(uniqueIds, 10);
      let fullTxs: any[] = [];
      
      for (const batch of batches) {
          const results = await electrumBatchGetTransactions(batch) as any[];
          results.forEach((r: any) => fullTxs.push(r.result));
      }

      const hydratedTxs = await hydrateInputDetails(fullTxs);
      const walletAddressSet = new Set(addresses);
      const processed = hydratedTxs.map(tx => processTransaction(tx, walletAddressSet));

      // Sort by Time Descending (Unconfirmed 'Now' -> Oldest)
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

export const fetchFeeEstimates = async (): Promise<{ fast: number; normal: number; slow: number; }> => {
  try {
    const [fast, normal, slow] = await Promise.all([
        electrumEstimateFee(1),
        electrumEstimateFee(5),
        electrumEstimateFee(25)
    ]) as [any, any, any];

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
    return { fast: 20, normal: 10, slow: 5 };
  }
};

export const fetchBalanceDetails = async (addresses: string[]): Promise<{ totalBalance: number; availableToSend: number }> => {
    const utxos = await fetchUTXOs(addresses);
    const total = utxos.reduce((acc: number, u: any) => acc + u.value, 0);
    return { totalBalance: total, availableToSend: total };
};

export const getTransactionDetails = async (txid: string, walletAddresses: string[]): Promise<Transaction> => {
    const tx = await electrumGetTransaction(txid);
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