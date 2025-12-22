import { Transaction } from '../types';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { IS_TESTNET, EXPLORER_API_URL, FALLBACK_API_URL, GENESIS_HASH, NETWORK } from '../constants/network';
import { address as btcAddress } from 'bitcoinjs-lib';

export const CUSTOM_NODE_URL_KEY = '@customNodeUrl';
export const DUST_THRESHOLD = 546;

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const chunkArray = <T>(array: T[], size: number): T[][] => {
  const chunked: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunked.push(array.slice(i, i + size));
  }
  return chunked;
};

const performRequest = async (baseUrl: string, method: 'GET' | 'POST', endpoint: string, data?: any) => {
  const url = `${baseUrl}${endpoint}`;
  
  const headers: HeadersInit = {};
  if (method === 'POST') {
    headers['Content-Type'] = 'text/plain';
  }

  const options: RequestInit = {
    method,
    headers,
    body: data ? data : undefined,
  };

  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);

    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || `HTTP ${response.status}`);
    }

    const contentType = response.headers.get("content-type");
    if (contentType && contentType.includes("application/json")) {
      return await response.json();
    }
    return await response.text();

  } catch (err: any) {
    clearTimeout(id);
    throw err;
  }
};

const apiRequest = async (method: 'GET' | 'POST', endpoint: string, data?: any) => {
  let baseUrl = EXPLORER_API_URL;
  let useCustomNode = false;

  try {
    const customUrl = await AsyncStorage.getItem(CUSTOM_NODE_URL_KEY);
    if (customUrl) {
      baseUrl = customUrl.endsWith('/') ? customUrl.slice(0, -1) : customUrl;
      useCustomNode = true;
    }
  } catch (storageError) {
    console.warn("Failed to read custom node settings", storageError);
  }

  try {
    return await performRequest(baseUrl, method, endpoint, data);
  } catch (err: any) {
    const isNetworkError = err.message === 'Network request failed' || err.name === 'AbortError';
    const isServerSideError = err.message.includes('HTTP 5') || err.message.includes('HTTP 429') || err.message.includes('Too Many Requests');

    if (!useCustomNode && (isNetworkError || isServerSideError)) {
      console.warn(`Primary API (${baseUrl}) failed. Switching to fallback (${FALLBACK_API_URL}). Error:`, err.message);
      
      try {
        return await performRequest(FALLBACK_API_URL, method, endpoint, data);
      } catch (fallbackErr: any) {
        console.warn(`Fallback API also failed. Endpoint: ${endpoint}`, fallbackErr);
        throw err;
      }
    }
    
    console.warn(`API ${method} to ${baseUrl} failed. Endpoint: ${endpoint}`, err);
    throw err;
  }
};

const apiGet = (endpoint: string) => apiRequest('GET', endpoint);
const apiPost = (endpoint: string, payload: any) => apiRequest('POST', endpoint, payload);

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
    try {
        const baseUrl = customUrl.endsWith('/') ? customUrl.slice(0, -1) : customUrl;
        const url = `${baseUrl}/block-height/0`;
        
        const response = await fetch(url);
        if (!response.ok) return false;
        
        const actualHash = (await response.text()).trim();
        
        if (actualHash === GENESIS_HASH) {
            return true;
        }
        
        if (IS_TESTNET) {
             const TESTNET4_GENESIS = '000000000933ea01ad0ee984209779baaec3ced90fa3f408719526f8d77f4943';
             if (actualHash === TESTNET4_GENESIS) return true;
        }
        
        console.warn(`Test connection failed: Network mismatch. Got ${actualHash}, expected ${GENESIS_HASH}`);
        return false;
    } catch (error) {
        console.warn("Test connection failed:", error);
        return false;
    }
};

export const fetchAddressInfoBatch = async (
  addresses: string[]
): Promise<{ address: string; balance: number; tx_count: number }[]> => {
  if (addresses.length === 0) return [];

  const fetchSingle = async (address: string) => {
    try {
      const data = await apiGet(`/address/${address}`);
      const { funded_txo_sum, spent_txo_sum } = data.chain_stats;
      return { 
        address, 
        balance: funded_txo_sum - spent_txo_sum, 
        tx_count: data.chain_stats.tx_count 
      };
    } catch (err) {
      console.error(`Error fetching info for ${address}:`, err);
      return { address, balance: 0, tx_count: 0 };
    }
  };

  try {
    const batches = chunkArray(addresses, 5);
    let results: { address: string; balance: number; tx_count: number }[] = [];
    
    for (const batch of batches) {
      const batchResults = await Promise.all(batch.map(addr => fetchSingle(addr)));
      results = [...results, ...batchResults];
      if (batches.length > 1) await delay(100); 
    }
    return results;
  } catch (err) {
    console.error(`Error fetching info batch:`, err);
    return addresses.map(address => ({ address, balance: 0, tx_count: 0 }));
  }
};

export const fetchAddressBalances = async (addresses: string[]): Promise<number[]> => {
  if (addresses.length === 0) return [];
  try {
    const info = await fetchAddressInfoBatch(addresses);
    const balanceMap = new Map(info.map(i => [i.address, i.balance]));
    return addresses.map(addr => balanceMap.get(addr) ?? 0);
  } catch (err) {
    return Array(addresses.length).fill(0);
  }
};

export const fetchBitcoinBalance = async (address: string): Promise<number> => {
    try {
      const data = await apiGet(`/address/${address}`);
      const { funded_txo_sum, spent_txo_sum } = data.chain_stats;
      return funded_txo_sum - spent_txo_sum;
    } catch (err) {
      return 0;
    }
};

const processTransaction = (tx: any, walletAddresses: Set<string>): Transaction => {
    let vinTotal = 0;
    let voutTotal = 0;
    let walletVinTotal = 0;
    let walletVoutTotal = 0;

    tx.vin.forEach((input: any) => {
        vinTotal += input.prevout?.value || 0;
        if (walletAddresses.has(input.prevout?.scriptpubkey_address)) {
            walletVinTotal += input.prevout?.value || 0;
        }
    });

    tx.vout.forEach((output: any) => {
        voutTotal += output.value || 0;
        if (walletAddresses.has(output.scriptpubkey_address)) {
            walletVoutTotal += output.value || 0;
        }
    });

    const fee = Math.max(0, vinTotal - voutTotal);
    const isSending = walletVinTotal > walletVoutTotal;
    const isReceiving = walletVoutTotal > walletVinTotal;

    let type: 'send' | 'receive' | 'internal' = 'internal';
    let amount = 0;

    if (isSending) {
        type = 'send';
        const externalSendAmount = tx.vout
            .filter((o: any) => !walletAddresses.has(o.scriptpubkey_address))
            .reduce((sum: number, o: any) => sum + o.value, 0);
        amount = externalSendAmount; 
    } else if (isReceiving) {
        type = 'receive';
        amount = walletVoutTotal - walletVinTotal;
    } else { 
        type = 'internal';
        amount = fee;
    }

    return { ...tx, type, amount, fee };
};

export const fetchUTXOs = async (addresses: string[]) => {
  if (addresses.length === 0) return [];

  const fetchSingle = async (address: string) => {
    try {
      const data = await apiGet(`/address/${address}/utxo`);
      return data.map((utxo: any) => ({ ...utxo, address }));
    } catch (err) {
      console.warn(`Failed to fetch UTXOs for ${address}`);
      return [];
    }
  };

  try {
      const batches = chunkArray(addresses, 5);
      let results: any[] = [];
      for (const batch of batches) {
        const batchResults = await Promise.all(batch.map(addr => fetchSingle(addr)));
        batchResults.forEach(res => results.push(...res));
        if (batches.length > 1) await delay(150);
      }
      return results;
  } catch (err) {
      console.error(`Error fetching UTXOs:`, err);
      throw new Error('Unknown error fetching UTXOs');
  }
};

export const fetchAddressTransactions = async (addresses: string[]): Promise<Transaction[]> => {
  if (addresses.length === 0) return [];

  const fetchSingle = async (address: string) => {
    try {
       const data = await apiGet(`/address/${address}/txs`);
       return data;
    } catch (err) {
       console.warn(`Failed to fetch Txs for ${address}`);
       return [];
    }
  };

  try {
    const batches = chunkArray(addresses, 5); 
    let allTxs: any[] = [];
    
    for (const batch of batches) {
        const batchResults = await Promise.all(batch.map(addr => fetchSingle(addr)));
        batchResults.forEach(res => allTxs.push(...res));
        if (batches.length > 1) await delay(200);
    }

    const uniqueTxs = Array.from(new Map(allTxs.map(tx => [tx.txid, tx])).values());
    const walletAddressSet = new Set(addresses);

    uniqueTxs.sort((a, b) => {
        if (a.status.confirmed !== b.status.confirmed) return a.status.confirmed ? 1 : -1;
        if (a.status.confirmed) return (b.status.block_time || 0) - (a.status.block_time || 0);
        return 0;
    });

    return uniqueTxs.map((tx: any) => processTransaction(tx, walletAddressSet));
  } catch (err) {
    console.error(`Error fetching transactions:`, err);
    throw new Error('Failed to fetch transaction history.');
  }
};

export const broadcastTransaction = async (txHex: string) => {
  try {
      const data = await apiPost(`/tx`, txHex);
      return data;
  } catch (err: any) {
      let errorMessage = 'Unknown error broadcasting transaction';
      if (typeof err.message === 'string') {
          errorMessage = err.message;
      }
      console.error('Error broadcasting transaction:', errorMessage);
      throw new Error(errorMessage);
  }
};

export const fetchFeeEstimates = async (): Promise<{ fast: number; normal: number; slow: number; }> => {
  try {
    const data = await apiGet(`/v1/fees/recommended`);
    return {
        fast: Math.ceil(data.fastestFee),
        normal: Math.ceil(data.halfHourFee),
        slow: Math.ceil(data.hourFee),
    };
  } catch (err) {
    console.error('Error fetching fee estimates:', err);
    throw new Error('Unknown error fetching fee estimates');
  }
};

export const fetchBalanceDetails = async (addresses: string[]): Promise<{ totalBalance: number; availableToSend: number }> => {
    if (addresses.length === 0) return { totalBalance: 0, availableToSend: 0 };
    try {
        const allUtxos = await fetchUTXOs(addresses);
        const totalBalance = allUtxos.reduce((acc: number, utxo: any) => acc + utxo.value, 0);
        return { totalBalance, availableToSend: totalBalance };
    } catch (error) {
        console.error("Error in fetchBalanceDetails:", error);
        return { totalBalance: 0, availableToSend: 0 };
    }
};

export const getTransactionDetails = async (txid: string, walletAddresses: string[]): Promise<Transaction> => {
    try {
        const data = await apiGet(`/tx/${txid}`);
        const walletAddressSet = new Set(walletAddresses);
        return processTransaction(data, walletAddressSet);
    } catch (err) {
        console.error(`Error fetching tx details for ${txid}:`, err);
        throw new Error('Failed to fetch transaction details.');
    }
};

export const getTipHeight = async (): Promise<number> => {
  try {
    const data = await apiGet(`/blocks/tip/height`);
    return Number(data);
  } catch (err) {
    console.error('Error fetching tip height:', err);
    throw new Error('Failed to fetch tip height');
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