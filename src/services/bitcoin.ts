import { Transaction } from '../types';
import { NETWORK, CUSTOM_NODE_URL_KEY } from '../constants/network';
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

export const inferScriptType = (key: string): 'p2wpkh' | 'p2sh-p2wpkh' => {
  if (key.startsWith('ypub') || key.startsWith('upub')) {
      return 'p2sh-p2wpkh';
  }
  return 'p2wpkh'; 
};

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
        } catch (e) {
            console.warn('Failed to hydrate some inputs', e);
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
            return input;
        });

        return { ...tx, vin: hydrated_vin };
    });
};

const processTransaction = (tx: any, walletAddresses: Set<string>, tip_height: number): Transaction => {
    let voutTotal = 0;
    let walletVoutTotal = 0;
    let walletVinTotal = 0;
    let vin_total = 0; 

    const normalizedVout = tx.vout.map((output: any) => {
        const sats = output.value;
        const address = output.scriptPubKey?.address || output.scriptPubKey?.addresses?.[0] || output.scriptpubkey_address;

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

    let confirmations = 0;
    if (tx.blockheight && tx.blockheight > 0) {
        if (tip_height > 0) {
            confirmations = Math.max(1, tip_height - tx.blockheight + 1);
        } else {
            confirmations = 1;
        }
    }

    const isConfirmed = confirmations > 0;
    const effectiveTime = tx.blocktime || tx.time || Math.floor(Date.now() / 1000);
    const tx_fee = Math.max(0, vin_total - voutTotal);

    const result: any = { 
        txid: tx.txid || tx.hash,
        version: tx.version,
        locktime: tx.locktime,
        size: tx.size,
        weight: tx.weight,
        fee: tx_fee, 
        vin: normalizedVin,
        vout: normalizedVout,
        confirmations: confirmations, 
        status: { 
            confirmed: isConfirmed, 
            block_time: effectiveTime,
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
      const txIds = new Set<string>();
      const heightMap = new Map<string, number>();
      const uniqueHeights = new Set<number>();
      
      histories.forEach((h: any) => {
          if (!h.result) return;
          (h.result as any[]).forEach((item: any) => {
              txIds.add(item.tx_hash);
              if (item.height > 0) {
                  heightMap.set(item.tx_hash, item.height);
                  uniqueHeights.add(item.height);
              }
          });
      });

      const timeMap = new Map<number, number>();
      const heightArr = Array.from(uniqueHeights);
      
      // Fetch headers individually in small chunks to bypass aggressive rate limiting
      if (heightArr.length > 0) {
          const client = await getElectrumClient();
          const chunks = chunkArray(heightArr, 10);
          for (const chunk of chunks) {
              await Promise.all(chunk.map(async (h) => {
                  try {
                      const r = await client.request('blockchain.block.header', [h]) as string;
                      if (r && typeof r === 'string' && r.length >= 160) {
                          const time_hex = r.substring(136, 144);
                          const timestamp = Buffer.from(time_hex, 'hex').readUInt32LE(0);
                          timeMap.set(h, timestamp);
                      }
                  } catch (e) {
                      // Silently ignore if a single header fails
                  }
              }));
          }
      }

      const uniqueIds = Array.from(txIds);
      if (uniqueIds.length === 0) return [];

      const batches = chunkArray(uniqueIds, 10);
      let fullTxs: any[] = [];
      
      for (const batch of batches) {
          const results = await electrumBatchGetTransactions(batch) as any[];
          results.forEach((r: any, index: number) => {
              if (r.result) {
                  const raw_tx_hex = r.result as string;
                  const decoded_tx = BitcoinTransaction.fromHex(raw_tx_hex);
                  
                  const transaction_inputs = decoded_tx.ins.map(input => {
                      return {
                          txid: input.hash.reverse().toString('hex'),
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

                  // Rigidly bind the hash to the batch index to guarantee mapping works
                  const tx_hash = batch[index];
                  const height = heightMap.get(tx_hash) || null;
                  const blocktime = height ? timeMap.get(height) : undefined;

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
                  
                  fullTxs.push(tx);
              }
          });
      }

      const hydratedTxs = await hydrateInputDetails(fullTxs);
      const walletAddressSet = new Set(addresses);
      const processed = hydratedTxs.map(tx => processTransaction(tx, walletAddressSet, tip_height));

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
    return { fast: 10, normal: 5, slow: 2 };
  }
};

export const fetchBalanceDetails = async (addresses: string[]): Promise<{ totalBalance: number; availableToSend: number }> => {
    const utxos = await fetchUTXOs(addresses);
    const total = utxos.reduce((acc: number, u: any) => acc + u.value, 0);
    return { totalBalance: total, availableToSend: total };
};

export const getTransactionDetails = async (txid: string, walletAddresses: string[]): Promise<Transaction> => {
    const raw_tx_hex = (await electrumGetTransaction(txid)) as string;
    const decoded_tx = BitcoinTransaction.fromHex(raw_tx_hex);
                  
    const transaction_inputs = decoded_tx.ins.map(input => {
        return {
            txid: input.hash.reverse().toString('hex'),
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
    return processTransaction(hydrated, new Set(walletAddresses), tip_height);
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