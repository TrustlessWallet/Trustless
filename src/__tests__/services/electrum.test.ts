import {
    addressToScriptHash,
    getElectrumClient,
    resetActiveConnection,
    getActiveHostName,
    test_custom_node_connection,
    electrumGetBalance,
    electrumGetHistory,
    electrumListUnspent,
    electrumGetTransaction,
    electrumBroadcast,
    electrumEstimateFee,
    electrumGetHeader,
    electrumBatchGetBalance,
    electrumBatchGetHistory,
    electrumBatchGetTransactions
} from '../../services/electrum';
import * as bitcoin from 'bitcoinjs-lib';
import AsyncStorage from '@react-native-async-storage/async-storage';

const flushPromises = async () => {
    for (let i = 0; i < 10; i++) {
        await Promise.resolve();
    }
};

// 1. Properly mock react-native-tcp-socket and export helpers for testing
jest.mock('react-native-tcp-socket', () => {
    const socket = {
        setEncoding: jest.fn(),
        on: jest.fn(),
        write: jest.fn(),
        destroy: jest.fn(),
        close: jest.fn(),
        callbacks: {} as Record<string, Function>,
        emitData: function (data: string) {
            if (this.callbacks['data']) this.callbacks['data'](data);
        },
        emitClose: function () {
            if (this.callbacks['close']) this.callbacks['close']();
        },
        emitError: function (err: any) {
            if (this.callbacks['error']) this.callbacks['error'](err);
        }
    };

    // Capture event listeners attached by electrum.ts
    socket.on.mockImplementation((event: string, cb: Function) => {
        socket.callbacks[event] = cb;
    });

    const tcp = {
        connectTLS: jest.fn((options, callback) => {
            if (callback) setTimeout(callback, 10);
            return socket;
        }),
        createConnection: jest.fn((options, callback) => {
            if (callback) setTimeout(callback, 10);
            return socket;
        }),
    };

    return {
        default: tcp,
        __esModule: true,
        mockSocket: socket,
        mockTcp: tcp
    };
});

// Import the mock helpers defined above
const { mockSocket, mockTcp } = require('react-native-tcp-socket');

jest.mock('@react-native-async-storage/async-storage', () => ({
    getItem: jest.fn(),
}));

jest.mock('../../constants/network', () => {
    const btc = require('bitcoinjs-lib');
    return {
        NETWORK: btc.networks.bitcoin,
        IS_TESTNET: false,
    };
});

describe('Electrum Service', () => {
    beforeAll(() => {
        jest.spyOn(console, 'log').mockImplementation(() => { });
        jest.spyOn(console, 'warn').mockImplementation(() => { });
    });

    afterAll(() => {
        jest.restoreAllMocks();
    });
    beforeEach(() => {
        jest.useFakeTimers();
        jest.clearAllMocks();
        resetActiveConnection();

        // Clear out callbacks before each test
        mockSocket.callbacks = {};
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    describe('addressToScriptHash', () => {
        it('converts address to correct electrum script hash', () => {
            const hash = addressToScriptHash('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa');
            expect(hash).toBe('8b01df4e368ea28f8dc0423bcf7a4923e3a12d307c875e47a0cfbf90b5c39161');
        });

        it('returns empty string on invalid address', () => {
            const hash = addressToScriptHash('invalid_address');
            expect(hash).toBe('');
        });
    });

    describe('getElectrumClient', () => {
        it('connects to custom node if available in storage', async () => {
            (AsyncStorage.getItem as jest.Mock).mockImplementation((key: string) => {
                if (key === '@customNodeUrl') return Promise.resolve('custom.node.com:50002:tls');
                if (key === '@allowSelfSigned') return Promise.resolve('true');
                return Promise.resolve(null);
            });

            const clientPromise = getElectrumClient();
            await flushPromises();
            jest.advanceTimersByTime(20);

            mockSocket.emitData('{"jsonrpc":"2.0","id":"handshake","result":"1.4"}\n');

            const client = await clientPromise;

            expect(mockTcp.connectTLS).toHaveBeenCalledWith(
                expect.objectContaining({ host: 'custom.node.com', port: 50002, rejectUnauthorized: false }),
                expect.any(Function)
            );
            expect(client.host).toBe('custom.node.com');
            expect(client.isConnected).toBe(true);
        });

        it('falls back to hardcoded peers if custom node fails', async () => {
            (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);

            const originalConnectTLS = mockTcp.connectTLS.getMockImplementation();

            mockTcp.connectTLS
                .mockImplementationOnce(() => {
                    throw new Error('Connection failed');
                })
                .mockImplementationOnce(originalConnectTLS);

            const clientPromise = getElectrumClient();
            await flushPromises();
            jest.advanceTimersByTime(20);

            mockSocket.emitData('{"jsonrpc":"2.0","id":"handshake","result":"1.4"}\n');

            const client = await clientPromise;

            expect(mockTcp.connectTLS).toHaveBeenCalledTimes(2);
            expect(client.host).toBe('electrum.emzy.de');
        });

        it('reuses existing connection', async () => {
            (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);

            const client1Promise = getElectrumClient();
            await flushPromises();
            jest.advanceTimersByTime(20);
            mockSocket.emitData('{"jsonrpc":"2.0","id":"handshake","result":"1.4"}\n');
            const client1 = await client1Promise;

            const client2 = await getElectrumClient();
            expect(client1).toBe(client2);
            expect(mockTcp.connectTLS).toHaveBeenCalledTimes(1);
        });
    });

    describe('CustomElectrumClient Data Handling', () => {
        beforeEach(async () => {
            (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
            const clientPromise = getElectrumClient();
            await flushPromises();
            jest.advanceTimersByTime(20);
            mockSocket.emitData('{"jsonrpc":"2.0","id":"handshake","result":"1.4"}\n');
            await clientPromise;
            mockSocket.write.mockClear();
        });

        it('processes fragmented TCP JSON buffers', async () => {
            const requestPromise = electrumGetBalance('test_hash');
            await flushPromises();

            const writeCall = mockSocket.write.mock.calls[0][0];
            const reqId = JSON.parse(writeCall).id;

            mockSocket.emitData(`{"jsonrpc":"2.0","id":${reqId}`);
            mockSocket.emitData(`,"result":{"confirmed": 1000}}\n`);

            const result = await requestPromise;
            expect(result).toEqual({ confirmed: 1000 });
        });

        it('handles JSON-RPC errors correctly', async () => {
            const requestPromise = electrumGetBalance('test_hash');
            await flushPromises();

            const writeCall = mockSocket.write.mock.calls[0][0];
            const reqId = JSON.parse(writeCall).id;

            mockSocket.emitData(`{"jsonrpc":"2.0","id":${reqId},"error":{"message":"Internal error"}}\n`);

            await expect(requestPromise).rejects.toThrow('Internal error');
        });

        it('times out requests after 10 seconds', async () => {
            const requestPromise = electrumGetBalance('test_hash');
            await flushPromises();

            jest.advanceTimersByTime(10000);
            await expect(requestPromise).rejects.toThrow(/Timeout/);
        });
    });

    describe('Connection Lifecycle', () => {
        beforeEach(async () => {
            (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
            const clientPromise = getElectrumClient();
            await flushPromises();
            jest.advanceTimersByTime(20);
            mockSocket.emitData('{"jsonrpc":"2.0","id":"handshake","result":"1.4"}\n');
            await clientPromise;
        });

        it('sends keepalive pings', () => {
            const initialWriteCount = mockSocket.write.mock.calls.length;

            jest.advanceTimersByTime(60000);

            expect(mockSocket.write.mock.calls.length).toBeGreaterThan(initialWriteCount);
            expect(mockSocket.write.mock.calls[initialWriteCount][0]).toContain('server.ping');
        });

        it('handles disconnect and cleanup', async () => {
            expect(getActiveHostName()).not.toBeNull();

            mockSocket.emitClose();

            expect(getActiveHostName()).toBeNull();
            expect(mockSocket.destroy).toHaveBeenCalled();

            const clientPromise = getElectrumClient();
            await flushPromises();
            jest.advanceTimersByTime(20);
            mockSocket.emitData('{"jsonrpc":"2.0","id":"handshake","result":"1.4"}\n');
            const newClient = await clientPromise;

            expect(newClient.isConnected).toBe(true);
            expect(getActiveHostName()).not.toBeNull();
        });
    });

    describe('API Wrappers', () => {
        beforeEach(async () => {
            (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
            const clientPromise = getElectrumClient();
            await flushPromises();
            jest.advanceTimersByTime(20);
            mockSocket.emitData('{"jsonrpc":"2.0","id":"handshake","result":"1.4"}\n');
            await clientPromise;
            mockSocket.write.mockClear();
        });

        it('electrumGetHistory sends correct format', async () => {
            electrumGetHistory('hash123').catch(() => { });
            await flushPromises();
            expect(mockSocket.write).toHaveBeenCalledWith(expect.stringContaining('blockchain.scripthash.get_history'));
            expect(mockSocket.write).toHaveBeenCalledWith(expect.stringContaining('hash123'));
        });

        it('electrumListUnspent sends correct format', async () => {
            electrumListUnspent('hash123').catch(() => { });
            await flushPromises();
            expect(mockSocket.write).toHaveBeenCalledWith(expect.stringContaining('blockchain.scripthash.listunspent'));
        });

        it('electrumGetTransaction sends correct format', async () => {
            electrumGetTransaction('tx123').catch(() => { });
            await flushPromises();
            expect(mockSocket.write).toHaveBeenCalledWith(expect.stringContaining('blockchain.transaction.get'));
            expect(mockSocket.write).toHaveBeenCalledWith(expect.stringContaining('tx123'));
            expect(mockSocket.write).toHaveBeenCalledWith(expect.stringContaining('true'));
        });

        it('electrumBroadcast sends correct format', async () => {
            electrumBroadcast('rawtx').catch(() => { });
            await flushPromises();
            expect(mockSocket.write).toHaveBeenCalledWith(expect.stringContaining('blockchain.transaction.broadcast'));
            expect(mockSocket.write).toHaveBeenCalledWith(expect.stringContaining('rawtx'));
        });

        it('electrumEstimateFee sends correct format', async () => {
            electrumEstimateFee(6).catch(() => { });
            await flushPromises();
            expect(mockSocket.write).toHaveBeenCalledWith(expect.stringContaining('blockchain.estimatefee'));
            expect(mockSocket.write).toHaveBeenCalledWith(expect.stringContaining('6'));
        });

        it('electrumGetHeader sends correct format', async () => {
            electrumGetHeader().catch(() => { });
            await flushPromises();
            expect(mockSocket.write).toHaveBeenCalledWith(expect.stringContaining('blockchain.headers.subscribe'));
        });
    });

    describe('Batch API Wrappers', () => {
        beforeEach(async () => {
            (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
            const clientPromise = getElectrumClient();
            await flushPromises();
            jest.advanceTimersByTime(20);
            mockSocket.emitData('{"jsonrpc":"2.0","id":"handshake","result":"1.4"}\n');
            await clientPromise;
            mockSocket.write.mockClear();
        });

        it('executes electrumBatchGetBalance', async () => {
            const promise = electrumBatchGetBalance(['hash1', 'hash2']);
            await flushPromises();

            const calls = mockSocket.write.mock.calls;
            expect(calls.length).toBe(2);
            expect(calls[0][0]).toContain('blockchain.scripthash.get_balance');
            expect(calls[1][0]).toContain('blockchain.scripthash.get_balance');

            const id1 = JSON.parse(calls[0][0]).id;
            const id2 = JSON.parse(calls[1][0]).id;

            mockSocket.emitData(`{"jsonrpc":"2.0","id":${id1},"result":{"confirmed": 100}}\n`);
            mockSocket.emitData(`{"jsonrpc":"2.0","id":${id2},"result":{"confirmed": 200}}\n`);

            const result = await promise;
            expect(result).toEqual([{ error: null, result: { confirmed: 100 } }, { error: null, result: { confirmed: 200 } }]);
        });

        it('executes electrumBatchGetHistory', async () => {
            electrumBatchGetHistory(['hash1', 'hash2']).catch(() => { });
            await flushPromises();
            expect(mockSocket.write).toHaveBeenCalledTimes(2);
            expect(mockSocket.write.mock.calls[0][0]).toContain('blockchain.scripthash.get_history');
        });

        it('executes electrumBatchGetTransactions', async () => {
            electrumBatchGetTransactions(['tx1', 'tx2']).catch(() => { });
            await flushPromises();
            expect(mockSocket.write).toHaveBeenCalledTimes(2);
            expect(mockSocket.write.mock.calls[0][0]).toContain('blockchain.transaction.get');
            expect(mockSocket.write.mock.calls[0][0]).toContain('false');
        });
    });

    describe('test_custom_node_connection', () => {
        it('returns true on successful connection', async () => {
            const promise = test_custom_node_connection('test.com:50001:tcp', false);
            await flushPromises();
            jest.advanceTimersByTime(20);
            mockSocket.emitData('{"jsonrpc":"2.0","id":"handshake","result":"1.4"}\n');

            const result = await promise;

            expect(mockTcp.createConnection).toHaveBeenCalledWith(
                expect.objectContaining({ host: 'test.com', port: 50001 }),
                expect.any(Function)
            );
            expect(result).toBe(true);
            expect(mockSocket.destroy).toHaveBeenCalled();
        });

        it('returns false on failed connection', async () => {
            mockTcp.connectTLS.mockImplementationOnce(() => {
                throw new Error('Test connection failed');
            });

            const resultPromise = test_custom_node_connection('test.com:50002:tls', false);
            await flushPromises();
            const result = await resultPromise;
            expect(result).toBe(false);
        });
    });

    describe('Advanced Edge Cases', () => {
        beforeEach(() => {
            resetActiveConnection();
            mockTcp.connectTLS.mockClear();
            mockSocket.write.mockClear();
        });

        it('attempts all hardcoded peers sequentially and throws if all fail (Peer Exhaustion Routing)', async () => {
            (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);

            // Use mockImplementationOnce twice to fail mainnet peers cleanly without breaking other tests
            mockTcp.connectTLS
                .mockImplementationOnce(() => {
                    setTimeout(() => mockSocket.emitError(new Error('Connection refused 1')), 5);
                    return mockSocket;
                })
                .mockImplementationOnce(() => {
                    setTimeout(() => mockSocket.emitError(new Error('Connection refused 2')), 5);
                    return mockSocket;
                });

            const clientPromise = getElectrumClient();

            await flushPromises();
            jest.advanceTimersByTime(10);
            await flushPromises();
            jest.advanceTimersByTime(10);
            await flushPromises();

            expect(mockTcp.connectTLS).toHaveBeenCalledTimes(2);
            await expect(clientPromise).rejects.toThrow('All peers failed');
        });

        it('rejects orphaned requests and removes them if connection closes (Orphaned Request Cleanup)', async () => {
            (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);

            // 1. Establish connection
            const clientPromise = getElectrumClient();
            await flushPromises();
            jest.advanceTimersByTime(20);
            mockSocket.emitData('{"jsonrpc":"2.0","id":"handshake","result":"1.4"}\n');
            const client = await clientPromise;

            // 2. Fire off a request
            const reqPromise = electrumGetBalance('dummy_hash');
            await flushPromises();

            expect((client as any).requests.size).toBe(1);

            // 3. Simulate unexpected socket closure
            mockSocket.emitClose();

            await expect(reqPromise).rejects.toThrow('Connection closed prematurely');
            expect((client as any).requests.size).toBe(0);
        });

        it('closes connection and sets isConnected to false if keep-alive ping fails (Keep-Alive Ping Interruption)', async () => {
            (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);

            // 1. Establish connection
            const clientPromise = getElectrumClient();
            await flushPromises();
            jest.advanceTimersByTime(20);
            mockSocket.emitData('{"jsonrpc":"2.0","id":"handshake","result":"1.4"}\n');
            const client = await clientPromise;

            expect(client.isConnected).toBe(true);

            // 2. Mock socket.write to throw an error on the ping
            mockSocket.write.mockImplementationOnce(() => {
                throw new Error('System error: socket is half-open');
            });

            // 3. Fast-forward 60s
            jest.advanceTimersByTime(60000);
            await flushPromises();

            expect(client.isConnected).toBe(false);
            expect(mockSocket.destroy).toHaveBeenCalled();
        });
    });
});