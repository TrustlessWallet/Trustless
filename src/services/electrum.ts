import TcpSocket from 'react-native-tcp-socket';
import { AppState, AppStateStatus } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as bitcoin from 'bitcoinjs-lib';

// -------------------------------------------------------------
// Constants and Peer Configurations
// -------------------------------------------------------------

export let IS_TESTNET = false; 
const SETTINGS_NETWORK_KEY = '@network_preference';
const CUSTOM_ELECTRUM_NODE_KEY = '@customElectrumNode';
const ALLOW_SELF_SIGNED_CERTIFICATES_KEY = '@allow_self_signed_certs';

export interface PeerConfig {
  host: string;
  port: number;
  protocol: 'tcp' | 'tls';
  requiresSelfSigned?: boolean;
}

export const PEERS: { mainnet: PeerConfig[], testnet: PeerConfig[] } = {
  mainnet: [
    { host: 'electrum.blockstream.info', port: 50002, protocol: 'tls', requiresSelfSigned: false },
    { host: 'bitcoin.lu.ke', port: 50002, protocol: 'tls', requiresSelfSigned: true },
    { host: 'electrum.bitaroo.net', port: 50002, protocol: 'tls', requiresSelfSigned: true },
    { host: 'electrum.emzy.de', port: 50002, protocol: 'tls', requiresSelfSigned: true },
    { host: 'fulcrum.sethforprivacy.com', port: 50002, protocol: 'tls', requiresSelfSigned: true },
    { host: 'electrum.jochen-hoenicke.de', port: 50002, protocol: 'tls', requiresSelfSigned: false },
    { host: 'bitcoin.grey.pw', port: 50002, protocol: 'tls', requiresSelfSigned: false },
    { host: 'electrum.loyce.club', port: 50002, protocol: 'tls', requiresSelfSigned: true },
    { host: 'electrum.sare.red', port: 50002, protocol: 'tls', requiresSelfSigned: false },
    { host: 'fulcrum-core.1209k.com', port: 50002, protocol: 'tls', requiresSelfSigned: true },
    { host: 'mempool.8333.mobi', port: 50002, protocol: 'tls', requiresSelfSigned: false },
    { host: 'vmd128083.contaboserver.net', port: 50002, protocol: 'tls', requiresSelfSigned: true }
  ],
  testnet: [
    { host: 'electrum.blockstream.info', port: 60002, protocol: 'tls', requiresSelfSigned: false },
    { host: 'testnet.qtornado.com', port: 51002, protocol: 'tls', requiresSelfSigned: true },
    { host: 'testnet.aranguren.org', port: 51001, protocol: 'tcp', requiresSelfSigned: false },
  ],
};

// -------------------------------------------------------------
// Core CustomElectrumClient Class
// -------------------------------------------------------------

export class CustomElectrumClient {
  host: string;
  port: number;
  protocol: 'tcp' | 'tls';
  tlsRequiresSelfSigned: boolean;
  socket: any;
  buffer: string = '';
  requests: Map<number, { resolve: any; reject: any }> = new Map();
  idCounter: number = 0;
  isConnected: boolean = false;
  keepAliveInterval: any = null;
  onCloseCallback?: () => void;

  constructor(host: string, port: number, protocol: 'tcp' | 'tls', tlsRequiresSelfSigned: boolean = false) {
    this.host = host;
    this.port = port;
    this.protocol = protocol;
    this.tlsRequiresSelfSigned = tlsRequiresSelfSigned;
  }

  async connect(timeoutMs: number = 10000): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (!this.isConnected) {
          this.forceClose();
          reject(new Error(`Connection timeout`));
        }
      }, timeoutMs);

      const onConnect = async () => {
        if (!this.socket) return; // Guard against zombies firing after a timeout
        this.isConnected = true;
        this.startKeepAlive();
        try {
          await this.request('server.version', ['TrustlessWallet', '1.4']);
          clearTimeout(timeout);
          resolve();
        } catch(e) {
          clearTimeout(timeout);
          this.forceClose();
          reject(e);
        }
      };

      const safeOnConnect = () => {
        onConnect().catch(err => {
           if (!this.isConnected) {
              this.forceClose();
              reject(err);
           }
        });
      };

      try {
        const options: any = { host: this.host, port: this.port };
        
        if (this.protocol === 'tls') {
          options.tls = true;
          options.rejectUnauthorized = !this.tlsRequiresSelfSigned;
          options.tlsCheckValidity = !this.tlsRequiresSelfSigned;

          if (typeof (TcpSocket as any).connectTLS === 'function') {
            this.socket = (TcpSocket as any).connectTLS(options, safeOnConnect);
          } else {
            this.socket = TcpSocket.createConnection(options, safeOnConnect);
          }
        } else {
          this.socket = TcpSocket.createConnection(options, safeOnConnect);
        }

        if (this.socket && typeof this.socket.on === 'function') {
          this.socket.on('data', (data: Buffer | string) => {
            const chunk = typeof data === 'string' ? data : data.toString('utf8');
            this.buffer += chunk;
            this.processBuffer();
          });

          this.socket.on('error', (error: any) => {
            const rawError = error ? JSON.stringify(error, Object.getOwnPropertyNames(error)) : 'Unknown Socket Error';
            if (!this.isConnected) {
              clearTimeout(timeout);
              reject(new Error(rawError));
            }
            this.forceClose();
          });

          this.socket.on('close', (hadError: boolean) => {
            this.forceClose();
          });
        }

      } catch (e) {
        clearTimeout(timeout);
        this.forceClose();
        reject(e);
      }
    });
  }

  startKeepAlive() {
    if (this.keepAliveInterval) clearInterval(this.keepAliveInterval);
    this.keepAliveInterval = setInterval(async () => {
      try {
        await this.request('server.ping', []);
      } catch (err) {
        console.warn(`  ⚠️ Ping timeout for ${this.host}, dropping connection`);
        this.forceClose();
      }
    }, 30000);
  }

  processBuffer() {
    if (typeof this.buffer !== 'string') return;
    let newlineIndex;
    while ((newlineIndex = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, newlineIndex);
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (line) {
        try {
          const response = JSON.parse(line);
          this.handleMessage(response);
        } catch (err) {
          // Ignore unparseable chunks
        }
      }
    }
  }

  handleMessage(response: any) {
    if (response.id !== undefined) {
      const req = this.requests.get(response.id);
      if (req) {
        this.requests.delete(response.id);
        if (response.error) {
          if (response.error.message !== 'missing transaction' && response.error.message !== 'non-hex hash') {
              console.warn(`  ⚠️ ERROR (id=${response.id}):`, JSON.stringify(response.error));
          }
          req.reject(new Error(response.error.message || 'Electrum Error'));
        } else {
          req.resolve(response.result);
        }
      }
    }
  }

  async request(method: string, params: any[] = []): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.socket || !this.isConnected) {
        return reject(new Error('Socket is not connected'));
      }
      const id = ++this.idCounter;
      this.requests.set(id, { resolve, reject });
      const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
      try {
        this.socket.write(payload);
      } catch (err) {
        this.requests.delete(id);
        reject(err);
      }
    });
  }

  forceClose() {
    this.isConnected = false;
    
    if (this.keepAliveInterval) {
      try { clearInterval(this.keepAliveInterval); } catch (e) {}
      this.keepAliveInterval = null;
    }
    
    if (this.socket) {
      try {
        if (typeof this.socket.destroy === 'function') {
          this.socket.destroy();
        } else if (typeof this.socket.end === 'function') {
          this.socket.end();
        }
      } catch (e) {}
      this.socket = null;
    }
    
    for (const [id, req] of this.requests.entries()) {
      try {
        if (typeof req.reject === 'function') {
          req.reject(new Error('Connection closed'));
        }
      } catch (e) {}
    }
    this.requests.clear();

    if (this.onCloseCallback) {
      this.onCloseCallback();
    }
  }
}

// -------------------------------------------------------------
// Connection Management & Peer Rotation
// -------------------------------------------------------------

let client: CustomElectrumClient | null = null;
let connectionPromise: Promise<CustomElectrumClient> | null = null;

const peerCooldowns = new Map<string, number>();
const COOLDOWN_MS = 5 * 60 * 1000; 

function shuffle(array: any[]) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
  if (nextAppState.match(/inactive|background/)) {
    if (client) {
      console.log('  💤 App going to background, closing active socket.');
      client.forceClose();
      client = null;
      connectionPromise = null;
    }
  } else if (nextAppState === 'active') {
    if (!client && !connectionPromise) {
      console.log('  🚀 App active, reconnecting...');
      getElectrumClient().catch(() => {}); 
    }
  }
});

async function raceConnections(candidates: PeerConfig[]): Promise<CustomElectrumClient> {
  if (candidates.length === 0) throw new Error("No candidates for race");

  return new Promise((resolve, reject) => {
    let resolved = false;
    let failedCount = 0;
    
    for (const peer of candidates) {
      console.log(`  🔌 Racing ${peer.host}:${peer.port} (${peer.protocol})...`);
      const cl = new CustomElectrumClient(peer.host, peer.port, peer.protocol, Boolean(peer.requiresSelfSigned));
      
      cl.connect(3000) 
        .then(() => {
          if (!resolved) {
            resolved = true;
            console.log(`  🏆 Race won by ${peer.host}:${peer.port}`);
            resolve(cl);
          } else {
            cl.forceClose();
          }
        })
        .catch((err: any) => {
          const osErrorCode = err.code ? `[${err.code}] ` : '';
          console.warn(`  ❌ Race failed for ${peer.host}:${peer.port}: ${osErrorCode}${err.message}`);
          
          peerCooldowns.set(`${peer.host}:${peer.port}`, Date.now());
          
          failedCount++;
          if (failedCount === candidates.length && !resolved) {
            reject(new Error("All candidates failed the race"));
          }
        });
    }
  });
}

export const getElectrumClient = async (): Promise<CustomElectrumClient> => {
  if (client && client.isConnected) {
    return client;
  }
  if (connectionPromise) {
    return connectionPromise;
  }

  connectionPromise = (async () => {
    try {
      const netStr = await AsyncStorage.getItem(SETTINGS_NETWORK_KEY);
      IS_TESTNET = netStr === 'testnet';
      
      const allowSelfSignedStr = await AsyncStorage.getItem(ALLOW_SELF_SIGNED_CERTIFICATES_KEY);
      const allowSelfSigned = allowSelfSignedStr === 'true';

      const customNodeStr = await AsyncStorage.getItem(CUSTOM_ELECTRUM_NODE_KEY);
      
      if (customNodeStr) {
        try {
          const parsed = JSON.parse(customNodeStr);
          if (parsed && parsed.host) {
            console.log(`  🔌 Attempting custom node ${parsed.host}...`);
            const cl = new CustomElectrumClient(parsed.host, parsed.port, parsed.protocol, true);
            await cl.connect(5000);
            client = cl;
            
            cl.onCloseCallback = () => {
              if (client === cl) { 
                client = null; 
                connectionPromise = null; 
                if (AppState.currentState === 'active') getElectrumClient().catch(() => {});
              }
            };
            return cl;
          }
        } catch (e) {
          console.warn('  ⚠️ Custom node failed. Falling back to public peers.', e);
        }
      }

      const networkPeers = IS_TESTNET ? PEERS.testnet : PEERS.mainnet;
      const validPeers = networkPeers.filter(p => allowSelfSigned || !p.requiresSelfSigned);
      
      const tier1 = validPeers.filter(p => !p.requiresSelfSigned);
      const tier2 = validPeers.filter(p => Boolean(p.requiresSelfSigned));
      
      shuffle(tier1);
      shuffle(tier2);
      
      const candidatePool = [...tier1, ...tier2];
      
      if (candidatePool.length === 0) {
        throw new Error("No valid peers available based on current settings.");
      }

      const now = Date.now();
      const freshCandidates = candidatePool.filter(p => {
        const cd = peerCooldowns.get(`${p.host}:${p.port}`);
        return !cd || (now - cd > COOLDOWN_MS);
      });
      
      if (freshCandidates.length === 0) {
        console.warn('  ⚠️ All peers on cooldown. Resetting registry.');
        peerCooldowns.clear();
        freshCandidates.push(...candidatePool);
      }

      while (freshCandidates.length > 0) {
        const batch = freshCandidates.splice(0, 3);
        try {
          const winner = await raceConnections(batch);
          client = winner;
          
          winner.onCloseCallback = () => {
            if (client === winner) { 
              client = null; 
              connectionPromise = null;
              if (AppState.currentState === 'active') {
                getElectrumClient().catch(() => {}); 
              }
            }
          };
          
          return winner;
        } catch (err) {
          console.warn(`  ⚠️ Batch failed. Trying next batch if available...`);
        }
      }
      
      throw new Error("All peers exhausted or blocked.");
    } catch (error) {
      connectionPromise = null;
      throw error;
    }
  })();

  return connectionPromise;
};

// -------------------------------------------------------------
// Exposed Electrum API Actions & Settings Helpers
// -------------------------------------------------------------

export const getConnectedPeer = () => {
  if (client && client.isConnected) {
    return { host: client.host, port: client.port, protocol: client.protocol };
  }
  return null;
};

export const getActiveHostName = (): string | null => {
  if (client && client.isConnected) {
    return client.host;
  }
  return null;
};

export const resetElectrumClient = () => {
  if (client) {
    client.forceClose();
  }
  client = null;
  connectionPromise = null;
};

export const resetActiveConnection = () => {
  resetElectrumClient();
};

export const test_custom_node_connection = async (url: string, allowSelfSigned: boolean): Promise<boolean> => {
  try {
    const parts = url.split(':');
    if (parts.length < 2) return false;
    
    const host = parts[0];
    const port = parseInt(parts[1], 10);
    const protocol = parts.length > 2 && parts[2].toLowerCase() === 'tcp' ? 'tcp' : 'tls';

    const cl = new CustomElectrumClient(host, port, protocol, allowSelfSigned);
    await cl.connect(5000); 
    cl.forceClose();
    return true;
  } catch (e) {
    return false;
  }
};

export const isElectrumConnected = () => {
  return client ? client.isConnected : false;
};

export const electrumBatchGetBalance = async (scripthashes: string[]) => {
  const cl = await getElectrumClient();
  return Promise.all(scripthashes.map(hash => 
    cl.request('blockchain.scripthash.get_balance', [hash])
      .then(result => ({ result }))
      .catch(error => ({ error }))
  ));
};

export const electrumBatchGetHistory = async (scripthashes: string[]) => {
  const cl = await getElectrumClient();
  return Promise.all(scripthashes.map(hash => 
    cl.request('blockchain.scripthash.get_history', [hash])
      .then(result => ({ result }))
      .catch(error => ({ error }))
  ));
};

export const electrumListUnspent = async (hash: string) => {
  const cl = await getElectrumClient();
  return cl.request('blockchain.scripthash.listunspent', [hash]);
};

export const electrumEstimateFee = async (blocks: number) => {
  const cl = await getElectrumClient();
  return cl.request('blockchain.estimatefee', [blocks]);
};

export const electrumBroadcastTransaction = async (txHex: string) => {
  const cl = await getElectrumClient();
  return cl.request('blockchain.transaction.broadcast', [txHex]);
};

export const addressToScriptHash = (address: string): string => {
  try {
    const network = IS_TESTNET ? bitcoin.networks.testnet : bitcoin.networks.bitcoin;
    const script = bitcoin.address.toOutputScript(address, network);
    const hash = bitcoin.crypto.sha256(script);
    return Buffer.from(hash).reverse().toString('hex');
  } catch (error) {
    return '';
  }
};

export const electrumBatchGetTransactions = async (txids: string[]) => {
  const cl = await getElectrumClient();
  return Promise.all(txids.map(txid => 
    cl.request('blockchain.transaction.get', [txid, true])
      .then(result => ({ result }))
      .catch(error => ({ error }))
  ));
};

export const electrumGetTransaction = async (txid: string) => {
  const cl = await getElectrumClient();
  return cl.request('blockchain.transaction.get', [txid, true]);
};

export const electrumGetHeader = async (height: number) => {
  const cl = await getElectrumClient();
  return cl.request('blockchain.block.header', [height]);
};

// Alias to fix the missing electrumBroadcast error in bitcoin.ts
export const electrumBroadcast = electrumBroadcastTransaction;