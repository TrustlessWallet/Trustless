import * as bitcoin from 'bitcoinjs-lib';
import { NETWORK, IS_TESTNET } from '../constants/network';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { EventEmitter } from 'events';

/**
 * We use 'react-native-tcp-socket' because React Native does not provide a standard
 * Node.js 'net' or 'tls' module. This library allows us to create raw TCP and TLS
 * connections directly from the device to the Electrum server.
 */
const TcpSocket = require('react-native-tcp-socket').default || require('react-native-tcp-socket');

const CUSTOM_NODE_KEY = '@customNodeUrl'; 

/**
 * CustomElectrumClient
 * This class manages the connection to an Electrum server.
 * Key Responsibilities:
 * 1. Establishing and maintaining the socket connection.
 * 2. Handling TCP packet fragmentation (buffering).
 * 3. Matching asynchronous JSON-RPC responses to their original requests.
 * 4. Keeping the connection alive with pings.
 */
class CustomElectrumClient extends EventEmitter {
  private socket: any = null;
  private host: string = '';
  private port: number = 0;
  private protocol: 'tcp' | 'tls' = 'tcp';
  
  // JSON-RPC request ID counter. Every request gets a unique ID so we can identify the response.
  private id: number = 0;
  
  // Map to store pending requests. 
  // Key: Request ID (number)
  // Value: Object containing { resolve, reject } functions from the Promise.
  private requests: Map<number, { resolve: Function; reject: Function }> = new Map();
  
  // Buffer to store incoming data chunks. TCP packets can arrive split up or combined.
  private buffer: string = '';
  
  public isConnected: boolean = false;
  private keepAliveInterval: any = null;

  constructor(host: string, port: number, protocol: 'tcp' | 'tls' = 'tcp') {
    super();
    this.host = host;
    this.port = port;
    this.protocol = protocol;
  }

  /**
   * Initiates the connection to the server.
   * Returns a Promise that resolves when the socket is open and the initial handshake is complete.
   */
  async connect() {
    return new Promise<void>((resolve, reject) => {
      // Safety timeout: If we don't connect within 10 seconds, give up.
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
          // We disable unauthorized rejection to allow self-signed certs (common in private nodes),
          // though for public infrastructure this is a security trade-off.
          rejectUnauthorized: false, 
        };

        const onConnect = () => {
            console.log(`⚡ Socket Opened: ${this.host} (${this.protocol})`);
            
            // Electrum protocol version negotiation (Handshake).
            // We must identify ourselves and request version 1.4.
            const handshake = JSON.stringify({ 
                jsonrpc: '2.0', 
                id: 'handshake', 
                method: 'server.version', 
                params: ["TrustlessWallet", "1.4"] 
            }) + '\n'; // Newline is the delimiter for JSON-RPC over TCP
            
            if (this.socket) this.socket.write(handshake);
        };

        // Create the actual socket based on protocol preference
        if (this.protocol === 'tls') {
          // @ts-ignore
          this.socket = TcpSocket.connectTLS(options, onConnect);
        } else {
          // @ts-ignore
          this.socket = TcpSocket.createConnection(options, onConnect);
        }

        this.socket.setEncoding('utf8');

        // Listener for incoming data
        this.socket.on('data', (data: Buffer | string) => {
          const chunk = typeof data === 'string' ? data : data.toString('utf8');
          this.buffer += chunk;
          
          // If this is the first data we receive, we consider the connection "Established".
          if (!this.isConnected) {
             this.isConnected = true;
             clearTimeout(timeout);
             this.startKeepAlive(); // Start sending pings to prevent timeout
             console.log(`✅ Data received from ${this.host}`);
             resolve(); 
          }
          
          // Process the buffer to check for complete JSON messages
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

  /**
   * Handles TCP fragmentation.
   * TCP streams are continuous; we might receive half a JSON string, or two JSON strings at once.
   * We look for the newline character ('\n') which marks the end of a message in Electrum protocol.
   */
  private processBuffer() {
    let newlineIndex = this.buffer.indexOf('\n');
    
    // While there is a complete message in the buffer...
    while (newlineIndex !== -1) {
      const message = this.buffer.slice(0, newlineIndex); // Extract the message
      this.buffer = this.buffer.slice(newlineIndex + 1);  // Keep the rest in the buffer
      
      if (message.trim()) {
        try {
          const json = JSON.parse(message);
          this.handleMessage(json);
        } catch (e) {
          // If JSON parse fails, the server sent garbage or we have a sync issue. 
          // We ignore it to keep the connection alive.
        }
      }
      // Check if there is another message in the remaining buffer
      newlineIndex = this.buffer.indexOf('\n');
    }
  }

  /**
   * Routes the parsed JSON message to the correct handler.
   * It handles:
   * 1. Notifications (subscriptions like new blocks or wallet activity).
   * 2. Responses to our specific requests (matching by ID).
   */
  private handleMessage(response: any) {
    // 1. Handle Subscriptions (e.g., blockchain.headers.subscribe)
    if (response.method && response.method.endsWith('.subscribe')) {
      this.emit(response.method, response.params);
      return;
    }

    // 2. Handle Handshake response (we ignore the content, just ensures connection works)
    if (response.id === 'handshake') return;

    // 3. Handle Standard Responses
    if (response.id !== undefined) {
      const req = this.requests.get(response.id);
      if (req) {
        // Remove from pending map
        this.requests.delete(response.id);
        
        if (response.error) {
          req.reject(new Error(response.error.message || 'Electrum Error'));
        } else {
          req.resolve(response.result);
        }
      }
    }
  }

  /**
   * Sends a JSON-RPC request to the server.
   * Returns a Promise that resolves when the server responds with the matching ID.
   */
  async request(method: string, params: any[] = []) {
    if (!this.isConnected || !this.socket) throw new Error('Not connected');

    this.id += 1;
    const reqId = this.id;
    const payload = JSON.stringify({ jsonrpc: '2.0', id: reqId, method, params }) + '\n';

    return new Promise((resolve, reject) => {
      // Store the promise handlers so handleMessage can call them later
      this.requests.set(reqId, { resolve, reject });

      // Request timeout: If server doesn't answer in 10s, fail.
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

  /**
   * Helper to send multiple requests in parallel (not strictly a JSON-RPC batch, 
   * but concurrent requests over the same socket).
   */
  async batch(requests: { method: string; params: any[] }[]) {
     return Promise.all(
       requests.map(req => 
         this.request(req.method, req.params)
           .then(result => ({ result, error: null }))
           .catch(error => ({ result: null, error }))
       )
     );
  }

  /**
   * Periodically pings the server to prevent it from closing the socket due to inactivity.
   */
  private startKeepAlive() {
      if (this.keepAliveInterval) clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = setInterval(() => {
          if (this.isConnected) {
              this.request('server.ping').catch(() => {});
          }
      }, 60000); // 60 seconds
  }

  /**
   * Cleans up resources, destroys socket, and clears intervals.
   */
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

// Hardcoded fallback peers if the user hasn't defined a custom node.
// We mix TCP and TLS ports.
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

// Singleton instance. We only want one active socket at a time.
let client: CustomElectrumClient | null = null;
let currentNetworkIsTestnet: boolean | null = null;
let connectionPromise: Promise<CustomElectrumClient> | null = null;

/**
 * Utility: Converts a bitcoin address to a Script Hash.
 * Electrum servers index data by script hash (SHA256 of the output script), not by address.
 */
export const addressToScriptHash = (address: string): string => {
  try {
    const script = bitcoin.address.toOutputScript(address, NETWORK);
    const hash = bitcoin.crypto.sha256(script);
    return Buffer.from(hash).reverse().toString('hex');
  } catch (e) {
    return '';
  }
};

/**
 * THE GATEKEEPER (Singleton Accessor)
 * * This function ensures we always return a valid, connected client.
 * * Logic Flow:
 * 1. If we already have a connected client for the correct network, return it.
 * 2. If a connection is currently being attempted (Promise exists), return that Promise.
 * 3. Otherwise, start a new connection process:
 * a. Check for a Custom Node URL in AsyncStorage.
 * b. If custom node fails or doesn't exist, iterate through the fallback PEERS list.
 * c. If all fail, throw an error.
 */
export const getElectrumClient = async () => {
  // Reuse existing connection if valid
  if (client && client.isConnected && currentNetworkIsTestnet === IS_TESTNET) {
    return client;
  }
  // Prevent race conditions: if connection logic is already running, wait for it
  if (connectionPromise) return connectionPromise;

  connectionPromise = (async () => {
    try {
        // Clean up old client if it exists
        if (client) {
            client.forceClose();
            client = null;
        }

        const peerList = IS_TESTNET ? PEERS.testnet : PEERS.mainnet;
        
        // 1. Try Custom Node first
        try {
            let custom = await AsyncStorage.getItem(CUSTOM_NODE_KEY);
            if (custom) {
                // Remove http/https prefix if user pasted it by accident
                custom = custom.replace(/^https?:\/\//, '');
                
                const parts = custom.split(':');
                const host = parts[0];
                
                let port = 50001;
                let protocol: 'tcp' | 'tls' = 'tcp';

                if (parts.length > 1) {
                    port = parseInt(parts[1]) || 50001;
                }
                
                // Allow user to specify protocol in URL, e.g., host:port:tls
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

        // 2. Fallback: Sequential Try through hardcoded peers
        for (const peer of peerList) {
            try {
                console.log(`🔌 Connecting to ${peer.host}:${peer.port} (${peer.protocol})...`);
                const cl = new CustomElectrumClient(peer.host, peer.port, peer.protocol);
                await cl.connect();
                
                client = cl;
                currentNetworkIsTestnet = IS_TESTNET;
                
                // Clean up singleton if this specific client closes later
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

// --- Exported Helper Wrappers ---
// These functions abstract the JSON-RPC method names for the rest of the app.

export const electrumGetBalance = async (scriptHash: string) => (await getElectrumClient()).request('blockchain.scripthash.get_balance', [scriptHash]);
export const electrumGetHistory = async (scriptHash: string) => (await getElectrumClient()).request('blockchain.scripthash.get_history', [scriptHash]);
export const electrumListUnspent = async (scriptHash: string) => (await getElectrumClient()).request('blockchain.scripthash.listunspent', [scriptHash]);
export const electrumGetTransaction = async (txId: string) => (await getElectrumClient()).request('blockchain.transaction.get', [txId, true]);
export const electrumBroadcast = async (txHex: string) => (await getElectrumClient()).request('blockchain.transaction.broadcast', [txHex]);
export const electrumEstimateFee = async (blocks: number) => (await getElectrumClient()).request('blockchain.estimatefee', [blocks]);
export const electrumGetHeader = async () => (await getElectrumClient()).request('blockchain.headers.subscribe');

// Batch Requests
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