import * as bitcoin from 'bitcoinjs-lib';
import { NETWORK, IS_TESTNET } from '../constants/network';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { EventEmitter } from 'events';

const TcpSocket = require('react-native-tcp-socket').default || require('react-native-tcp-socket');

const CUSTOM_NODE_KEY = '@customNodeUrl'; 

class CustomElectrumClient extends EventEmitter {
  private socket: any = null;
  private host: string = '';
  private port: number = 0;
  private protocol: 'tcp' | 'tls' = 'tcp';
  private id: number = 0;
  private requests: Map<number, { resolve: Function; reject: Function }> = new Map();
  private buffer: string = '';
  public isConnected: boolean = false;
  private keepAliveInterval: any = null;

  constructor(host: string, port: number, protocol: 'tcp' | 'tls' = 'tcp') {
    super();
    this.host = host;
    this.port = port;
    this.protocol = protocol;
  }

  async connect() {
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (!this.isConnected) {
            this.forceClose();
            reject(new Error(`Connection timeout: ${this.host}`));
        }
      }, 10000);

      try {
        const options: any = {
          port: this.port,
          host: this.host,
          rejectUnauthorized: false,
        };

        const onConnect = () => {
            console.log(`⚡ Socket Opened: ${this.host} (${this.protocol})`);
            const handshake = JSON.stringify({ 
                jsonrpc: '2.0', 
                id: 'handshake', 
                method: 'server.version', 
                params: ["TrustlessWallet", "1.4"] 
            }) + '\n';
            if (this.socket) this.socket.write(handshake);
        };

        if (this.protocol === 'tls') {
          // @ts-ignore
          this.socket = TcpSocket.connectTLS(options, onConnect);
        } else {
          // @ts-ignore
          this.socket = TcpSocket.createConnection(options, onConnect);
        }

        this.socket.setEncoding('utf8');

        this.socket.on('data', (data: Buffer | string) => {
          const chunk = typeof data === 'string' ? data : data.toString('utf8');
          this.buffer += chunk;
          
          if (!this.isConnected) {
             this.isConnected = true;
             clearTimeout(timeout);
             this.startKeepAlive();
             console.log(`✅ Data received from ${this.host}`);
             resolve(); 
          }
          this.processBuffer();
        });

        this.socket.on('error', (error: any) => {
          if (!this.isConnected) {
              clearTimeout(timeout);
              reject(error);
          }
          this.forceClose();
        });

        this.socket.on('close', () => {
          this.forceClose();
        });

      } catch (err) {
        clearTimeout(timeout);
        this.forceClose();
        reject(err);
      }
    });
  }

  private processBuffer() {
    let newlineIndex = this.buffer.indexOf('\n');
    while (newlineIndex !== -1) {
      const message = this.buffer.slice(0, newlineIndex);
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (message.trim()) {
        try {
          const json = JSON.parse(message);
          this.handleMessage(json);
        } catch (e) {}
      }
      newlineIndex = this.buffer.indexOf('\n');
    }
  }

  private handleMessage(response: any) {
    if (response.method && response.method.endsWith('.subscribe')) {
      this.emit(response.method, response.params);
      return;
    }
    if (response.id === 'handshake') return;

    if (response.id !== undefined) {
      const req = this.requests.get(response.id);
      if (req) {
        this.requests.delete(response.id);
        if (response.error) {
          req.reject(new Error(response.error.message || 'Electrum Error'));
        } else {
          req.resolve(response.result);
        }
      }
    }
  }

  async request(method: string, params: any[] = []) {
    if (!this.isConnected || !this.socket) throw new Error('Not connected');

    this.id += 1;
    const reqId = this.id;
    const payload = JSON.stringify({ jsonrpc: '2.0', id: reqId, method, params }) + '\n';

    return new Promise((resolve, reject) => {
      this.requests.set(reqId, { resolve, reject });
      setTimeout(() => {
        if (this.requests.has(reqId)) {
          this.requests.delete(reqId);
          reject(new Error(`Timeout: ${method}`));
        }
      }, 10000); 

      try {
        this.socket.write(payload);
      } catch (e) {
        this.requests.delete(reqId);
        reject(e);
      }
    });
  }

  async batch(requests: { method: string; params: any[] }[]) {
     return Promise.all(
       requests.map(req => 
         this.request(req.method, req.params)
           .then(result => ({ result, error: null }))
           .catch(error => ({ result: null, error }))
       )
     );
  }

  private startKeepAlive() {
      if (this.keepAliveInterval) clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = setInterval(() => {
          if (this.isConnected) {
              this.request('server.ping').catch(() => {});
          }
      }, 60000);
  }

  public forceClose() {
      this.isConnected = false;
      if (this.keepAliveInterval) clearInterval(this.keepAliveInterval);
      if (this.socket) {
          try { this.socket.destroy(); } catch (e) {}
          this.socket = null;
      }
      this.emit('close');
  }
}

const PEERS = {
  mainnet: [
    { host: 'electrum.blockstream.info', port: 50001, protocol: 'tcp' as const },
    { host: 'electrum.emzy.de', port: 50001, protocol: 'tcp' as const },
  ],
  testnet: [
    { host: 'testnet.qtornado.com', port: 51001, protocol: 'tcp' as const },
    { host: 'electrum.blockstream.info', port: 60001, protocol: 'tcp' as const },
    { host: 'testnet.qtornado.com', port: 51002, protocol: 'tls' as const },
    { host: 'electrum.blockstream.info', port: 60002, protocol: 'tls' as const },
  ],
};

let client: CustomElectrumClient | null = null;
let currentNetworkIsTestnet: boolean | null = null;
let connectionPromise: Promise<CustomElectrumClient> | null = null;

export const addressToScriptHash = (address: string): string => {
  try {
    const script = bitcoin.address.toOutputScript(address, NETWORK);
    const hash = bitcoin.crypto.sha256(script);
    return Buffer.from(hash).reverse().toString('hex');
  } catch (e) {
    return '';
  }
};

export const getElectrumClient = async () => {
  if (client && client.isConnected && currentNetworkIsTestnet === IS_TESTNET) {
    return client;
  }
  if (connectionPromise) return connectionPromise;

  connectionPromise = (async () => {
    try {
        if (client) {
            client.forceClose();
            client = null;
        }

        const peerList = IS_TESTNET ? PEERS.testnet : PEERS.mainnet;
        
        try {
            let custom = await AsyncStorage.getItem(CUSTOM_NODE_KEY);
            if (custom) {

                custom = custom.replace(/^https?:\/\//, '');
                
                const parts = custom.split(':');
                const host = parts[0];
                
                let port = 50001;
                let protocol: 'tcp' | 'tls' = 'tcp';

                if (parts.length > 1) {
                    port = parseInt(parts[1]) || 50001;
                }
                
                if (parts.length > 2) {
                    protocol = (parts[2].toLowerCase() as 'tcp' | 'tls') || 'tcp';
                }

                if (host) {
                    console.log(`🔌 Custom Node: ${host}:${port} (${protocol})`);
                    const cl = new CustomElectrumClient(host, port, protocol);
                    await cl.connect();
                    client = cl;
                    currentNetworkIsTestnet = IS_TESTNET;
                    return client;
                }
            }
        } catch (e) {
            console.warn('Custom node failed, falling back to peers', e);
        }

        // Sequential Try
        for (const peer of peerList) {
            try {
                console.log(`🔌 Connecting to ${peer.host}:${peer.port} (${peer.protocol})...`);
                const cl = new CustomElectrumClient(peer.host, peer.port, peer.protocol);
                await cl.connect();
                
                client = cl;
                currentNetworkIsTestnet = IS_TESTNET;
                
                client.on('close', () => {
                    if (client === cl) {
                        client = null;
                        connectionPromise = null;
                    }
                });
                return client;
            } catch (err: any) {
                console.warn(`❌ Failed ${peer.host}:`, err.message || 'Error');
                if (client) client.forceClose();
                client = null;
            }
        }
        throw new Error('All peers failed');
    } catch (error) {
        connectionPromise = null;
        throw error;
    } finally {
        connectionPromise = null;
    }
  })();

  return connectionPromise;
};

export const electrumGetBalance = async (scriptHash: string) => (await getElectrumClient()).request('blockchain.scripthash.get_balance', [scriptHash]);
export const electrumGetHistory = async (scriptHash: string) => (await getElectrumClient()).request('blockchain.scripthash.get_history', [scriptHash]);
export const electrumListUnspent = async (scriptHash: string) => (await getElectrumClient()).request('blockchain.scripthash.listunspent', [scriptHash]);
export const electrumGetTransaction = async (txId: string) => (await getElectrumClient()).request('blockchain.transaction.get', [txId, true]);
export const electrumBroadcast = async (txHex: string) => (await getElectrumClient()).request('blockchain.transaction.broadcast', [txHex]);
export const electrumEstimateFee = async (blocks: number) => (await getElectrumClient()).request('blockchain.estimatefee', [blocks]);
export const electrumGetHeader = async () => (await getElectrumClient()).request('blockchain.headers.subscribe');

export const electrumBatchGetBalance = async (scriptHashes: string[]) => {
    const cl = await getElectrumClient();
    return cl.batch(scriptHashes.map(h => ({ method: 'blockchain.scripthash.get_balance', params: [h] })));
};

export const electrumBatchGetHistory = async (scriptHashes: string[]) => {
    const cl = await getElectrumClient();
    return cl.batch(scriptHashes.map(h => ({ method: 'blockchain.scripthash.get_history', params: [h] })));
};

export const electrumBatchGetTransactions = async (txIds: string[]) => {
    const cl = await getElectrumClient();
    return cl.batch(txIds.map(txid => ({ method: 'blockchain.transaction.get', params: [txid, true] })));
};