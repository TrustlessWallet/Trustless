import React from 'react';
import { renderHook, waitFor, act } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WalletProvider, useWallet as use_wallet } from '../../contexts/WalletContext';
import * as bitcoin_service from '../../services/bitcoin';

import {
    dbGetWallets as db_get_wallets,
    dbCreateWallet as db_create_wallet,
    dbDeleteWallet as db_delete_wallet,
    dbAddSavedAddress as db_add_saved_address,
    dbUpdateUtxoLabel as db_update_utxo_label,
    dbUpdateWalletName as db_update_wallet_name,
    dbRemoveSavedAddress as db_remove_saved_address,
    dbUpdateSavedAddress as db_update_saved_address,
    dbGetDerivedAddresses as db_get_derived_addresses,
    dbGetSavedAddresses as db_get_saved_addresses,
    dbUpdateChangeIndex as db_update_change_index,
    dbSyncUtxos as db_sync_utxos,
    dbSaveAddress as db_save_address,
    dbGetAddressCache as db_get_address_cache,
} from '../../services/database';

import * as keychain from 'react-native-keychain';

jest.mock('react-native-keychain', () => ({
    getGenericPassword: jest.fn(),
    setGenericPassword: jest.fn(),
    resetGenericPassword: jest.fn(),
}));

jest.mock('../../services/database', () => ({
    dbGetWallets: jest.fn(() => Promise.resolve([])),
    dbCreateWallet: jest.fn(),
    dbDeleteWallet: jest.fn(),
    dbUpdateWalletName: jest.fn(),
    dbGetDerivedAddresses: jest.fn(() => Promise.resolve([])),
    dbGetAddressCache: jest.fn(() => Promise.resolve([])),
    dbSaveAddress: jest.fn(),
    dbUpdateAddressInfoBatch: jest.fn(),
    dbGetUtxoLabels: jest.fn(() => Promise.resolve({})),
    dbSyncUtxos: jest.fn(),
    dbUpdateUtxoLabel: jest.fn(),
    dbGetSavedAddresses: jest.fn(() => Promise.resolve([])),
    dbAddSavedAddress: jest.fn(),
    dbRemoveSavedAddress: jest.fn(),
    dbUpdateSavedAddress: jest.fn(),
    dbUpdateChangeIndex: jest.fn(),
    dbFindWalletByAddress: jest.fn(),
    dbFindWalletByXpub: jest.fn(),
}));

jest.mock('../../hooks/useBalance', () => ({
    useWalletBalanceSync: jest.fn(() => ({ data: undefined })),
    useAddressListSync: jest.fn(() => ({ data: undefined })),
}));

jest.mock('uuid', () => ({
    v4: jest.fn(() => 'mocked_uuid_string'),
}));

jest.mock('@breeztech/breez-sdk-spark-react-native', () => ({
    NetworkRecommended: 'Mainnet',
    defaultConfig: jest.fn().mockReturnValue({}),
    Network: { Mainnet: 'mainnet' },
    MaxFee: { NetworkRecommended: jest.fn() },
    Seed: { Mnemonic: { new: jest.fn() } },
    connect: jest.fn().mockResolvedValue({
        getInfo: jest.fn().mockResolvedValue({ balanceSats: 0 }),
        listPayments: jest.fn().mockResolvedValue([]),
        addEventListener: jest.fn()
    }),
    PaymentStatus: {},
    PaymentType: {}
}));

jest.mock('../../services/electrum', () => ({
    getElectrumClient: jest.fn(() => Promise.resolve({
        request: jest.fn(),
        batch: jest.fn(),
        forceClose: jest.fn(),
        isConnected: true
    })),
    addressToScriptHash: jest.fn(() => 'mock_script_hash'),
    resetActiveConnection: jest.fn(),
    getActiveHostName: jest.fn(),
    test_custom_node_connection: jest.fn(),
    electrumGetBalance: jest.fn(() => Promise.resolve({ confirmed: 0, unconfirmed: 0 })),
    electrumGetHistory: jest.fn(() => Promise.resolve([])),
    electrumListUnspent: jest.fn(() => Promise.resolve([])),
    electrumBatchGetBalance: jest.fn(() => Promise.resolve([])),
    electrumBatchGetHistory: jest.fn(() => Promise.resolve([])),
    electrumBatchGetTransactions: jest.fn(() => Promise.resolve([])),
}));


const create_test_query_client = () => new QueryClient({
    defaultOptions: {
        queries: {
            retry: false,
            gcTime: 0,
        },
    },
});

const wrapper = ({ children }: { children: React.ReactNode }) => {
    const test_query_client = create_test_query_client();
    return (
        <QueryClientProvider client={test_query_client}>
            <WalletProvider>
                {children}
            </WalletProvider>
        </QueryClientProvider>
    );
};

describe('wallet_context_comprehensive_tests', () => {
    let original_console_error: typeof console.error;

    beforeAll(() => {
        original_console_error = console.error;
        console.error = (...args: any[]) => {
            if (
                typeof args[0] === 'string' &&
                (args[0].includes('Failed to bootstrap wallet') ||
                    args[0].includes('was not wrapped in act') ||
                    args[0].includes('Breez initialization failed'))
            ) {
                return;
            }
            original_console_error(...args);
        };
    });

    afterAll(() => {
        console.error = original_console_error;
    });

    beforeEach(() => {
        jest.clearAllMocks();
        (keychain.getGenericPassword as jest.Mock).mockResolvedValue({ password: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about' });
        (db_get_wallets as jest.Mock).mockResolvedValue([]);
        (db_get_saved_addresses as jest.Mock).mockResolvedValue([]);
    });

    it('initializes_with_empty_state_when_no_wallets_exist', async () => {
        // CHANGED: added unmount to close handles
        const { result, unmount } = renderHook(() => use_wallet(), { wrapper });

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.wallets.length).toBe(0);
        expect(result.current.activeWallet).toBeNull();
        unmount();
    });

    it('adds_standard_wallet_and_updates_active_state', async () => {
        const mock_new_wallet = { id: 'mocked_uuid_string', name: 'Wallet 1', type: 'standard', derivedReceiveAddresses: [], derivedChangeAddresses: [], derivedAddressInfoCache: [] };
        (db_get_wallets as jest.Mock).mockResolvedValueOnce([]).mockResolvedValueOnce([mock_new_wallet]);

        const { result, unmount } = renderHook(() => use_wallet(), { wrapper });

        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await result.current.addWallet({ mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about', type: 'standard' });
        });

        expect(db_create_wallet).toHaveBeenCalled();
        expect(keychain.setGenericPassword).toHaveBeenCalled();
        unmount();
    });

    it('removes_wallet_and_clears_keychain', async () => {
        const { result, unmount } = renderHook(() => use_wallet(), { wrapper });

        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await result.current.removeWallet('mocked_uuid_string');
        });

        expect(db_delete_wallet).toHaveBeenCalledWith('mocked_uuid_string');
        expect(keychain.resetGenericPassword).toHaveBeenCalled();
        unmount();
    });

    it('switches_active_wallet', async () => {
        const mock_wallet_one = { id: 'wallet_1', name: 'Wallet 1', type: 'standard', derivedReceiveAddresses: [], derivedChangeAddresses: [], derivedAddressInfoCache: [] };
        const mock_wallet_two = { id: 'wallet_2', name: 'Wallet 2', type: 'standard', derivedReceiveAddresses: [], derivedChangeAddresses: [], derivedAddressInfoCache: [] };
        (db_get_wallets as jest.Mock).mockResolvedValue([mock_wallet_one, mock_wallet_two]);

        const { result, unmount } = renderHook(() => use_wallet(), { wrapper });

        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await result.current.switchWallet('wallet_2');
        });

        expect(result.current.activeWallet?.id).toBe('wallet_2');
        unmount();
    });

    it('updates_wallet_name', async () => {
        const mock_wallet = { id: 'wallet_1', name: 'Old Name', type: 'standard', derivedReceiveAddresses: [], derivedChangeAddresses: [], derivedAddressInfoCache: [] };
        (db_get_wallets as jest.Mock).mockResolvedValue([mock_wallet]);

        const { result, unmount } = renderHook(() => use_wallet(), { wrapper });

        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await result.current.updateWalletName('wallet_1', 'New Name');
        });

        expect(db_update_wallet_name).toHaveBeenCalledWith('wallet_1', 'New Name');
        unmount();
    });

    it('gets_mnemonic_for_wallet_successfully', async () => {
        const mock_wallet = { id: 'wallet_1', name: 'Wallet 1', type: 'standard' };
        (db_get_wallets as jest.Mock).mockResolvedValue([mock_wallet]);
        (keychain.getGenericPassword as jest.Mock).mockResolvedValue({ password: 'test_mnemonic_string' });

        const { result, unmount } = renderHook(() => use_wallet(), { wrapper });

        await waitFor(() => expect(result.current.loading).toBe(false));

        let retrieved_mnemonic;
        await act(async () => {
            retrieved_mnemonic = await result.current.getMnemonicForWallet('wallet_1');
        });

        expect(keychain.getGenericPassword).toHaveBeenCalledWith({ service: 'com.btc.trustless.mnemonic.wallet_1' });
        expect(retrieved_mnemonic).toBe('test_mnemonic_string');
        unmount();
    });

    it('returns_null_when_getting_mnemonic_fails', async () => {
        const mock_wallet = { id: 'wallet_2', name: 'Watch Only', type: 'watch-only' };
        (db_get_wallets as jest.Mock).mockResolvedValue([mock_wallet]);
        (keychain.getGenericPassword as jest.Mock).mockRejectedValue(new Error('not found'));

        const { result, unmount } = renderHook(() => use_wallet(), { wrapper });

        await waitFor(() => expect(result.current.loading).toBe(false));

        let mnemonic;
        await act(async () => {
            mnemonic = await result.current.getMnemonicForWallet('wallet_2');
        });

        expect(mnemonic).toBeNull();
        unmount();
    });

    it('returns_null_for_next_address_if_no_active_wallet', async () => {
        const { result, unmount } = renderHook(() => use_wallet(), { wrapper });

        await waitFor(() => expect(result.current.loading).toBe(false));

        let next_address;
        await act(async () => {
            next_address = await result.current.getOrCreateNextUnusedReceiveAddress('dummy_address', 0);
        });

        expect(next_address).toBeNull();
        unmount();
    });

    it('throws_error_when_signing_without_active_wallet', async () => {
        const { result, unmount } = renderHook(() => use_wallet(), { wrapper });

        await waitFor(() => expect(result.current.loading).toBe(false));

        await expect(
            result.current.createAndSignTransaction('recipient', 1000, [], 1)
        ).rejects.toThrow("No active wallet.");
        unmount();
    });

    it('adds_saved_address_correctly', async () => {
        const { result, unmount } = renderHook(() => use_wallet(), { wrapper });

        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await result.current.addSavedAddress({ address: 'bc1qtest', balance: 0, lastUpdated: new Date() });
        });

        expect(db_add_saved_address).toHaveBeenCalled();
        unmount();
    });

    it('removes_saved_address', async () => {
        const { result, unmount } = renderHook(() => use_wallet(), { wrapper });

        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await result.current.removeSavedAddress('bc1qtest_remove');
        });

        expect(db_remove_saved_address).toHaveBeenCalledWith('saved_addresses', 'bc1qtest_remove');
        unmount();
    });

    it('updates_saved_address_name', async () => {
        const mock_saved = { id: 'bc1qtest_update', address: 'bc1qtest', name: '', balance: 0, lastUpdated: new Date() };
        (db_get_saved_addresses as jest.Mock).mockImplementation((network, table) => {
            if (table === 'saved_addresses') return Promise.resolve([mock_saved]);
            return Promise.resolve([]);
        });

        const { result, unmount } = renderHook(() => use_wallet(), { wrapper });

        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await result.current.updateSavedAddressName('bc1qtest_update', 'Exchange');
        });

        expect(db_update_saved_address).toHaveBeenCalledWith('saved_addresses', { ...mock_saved, name: 'Exchange' });
        unmount();
    });

    it('updates_and_gets_utxo_label', async () => {
        const mock_wallet = {
            id: 'wallet_1',
            name: 'Wallet 1',
            type: 'standard',
            utxoLabels: {},
            derivedReceiveAddresses: [],
            derivedChangeAddresses: [],
            derivedAddressInfoCache: []
        };
        (db_get_wallets as jest.Mock).mockResolvedValue([mock_wallet]);

        const { result, unmount } = renderHook(() => use_wallet(), { wrapper });

        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await result.current.updateUtxoLabel('mock_tx_id', 0, 'My Custom UTXO');
        });

        expect(db_update_utxo_label).toHaveBeenCalledWith('mock_tx_id', 0, 'My Custom UTXO');

        let label;
        act(() => {
            label = result.current.getUtxoLabel('mock_tx_id', 0);
        });

        expect(label).toBe('My Custom UTXO');
        unmount();
    });

    it('scans_and_names_utxos', async () => {
        const mock_wallet = {
            id: 'wallet_1',
            name: 'Wallet 1',
            type: 'standard',
            derivedAddressInfoCache: [{ address: 'bc1qtest', index: 0, balance: 1000, tx_count: 1 }],
            derivedChangeAddresses: [],
            derivedReceiveAddresses: [{ address: 'bc1qtest', index: 0 }],
            utxoLabels: {}
        };
        (db_get_wallets as jest.Mock).mockResolvedValue([mock_wallet]);
        (db_get_derived_addresses as jest.Mock).mockResolvedValue([
            { address: 'bc1qtest', index: 0 }
        ]);
        (keychain.getGenericPassword as jest.Mock).mockResolvedValue({
            password: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
        });
        const fetch_spy = jest.spyOn(bitcoin_service, 'fetchUTXOs').mockResolvedValue([
            { tx_hash: 'mock_tx_id', tx_pos: 0, value: 1000, height: 100 } as any
        ]);

        const { result, unmount } = renderHook(() => use_wallet(), { wrapper });

        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            if (result.current.activeWallet?.id !== 'wallet_1') {
                await result.current.switchWallet('wallet_1');
            }
            await result.current.scanAndNameUtxos();
        });

        expect(db_sync_utxos).toHaveBeenCalled();
        fetch_spy.mockRestore();
        unmount();
    });

    it('refreshes_saved_address_balances', async () => {
        const { result, unmount } = renderHook(() => use_wallet(), { wrapper });

        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await result.current.refreshSavedAddressBalances();
        });

        expect(result.current.loadingSavedAddresses).toBeDefined();
        unmount();
    });

    it('generates_mnemonic', async () => {
        const { result, unmount } = renderHook(() => use_wallet(), { wrapper });
        let wallet_mnemonic = '';

        await act(async () => {
            wallet_mnemonic = await result.current.generateMnemonic() || '';
        });

        const word_count = wallet_mnemonic.split(' ').length;
        const valid_lengths = [12, 15, 18, 21, 24];

        expect(wallet_mnemonic).not.toBe('');
        expect(valid_lengths).toContain(word_count);
        unmount();
    });

    it('increments_change_index', async () => {
        const mock_wallet = {
            id: 'wallet_1',
            changeAddressIndex: 0,
            derivedReceiveAddresses: [],
            derivedChangeAddresses: [],
            derivedAddressInfoCache: []
        };
        (db_get_wallets as jest.Mock).mockResolvedValue([mock_wallet]);

        const { result, unmount } = renderHook(() => use_wallet(), { wrapper });

        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await result.current.incrementChangeIndex('wallet_1', 0);
        });

        expect(db_update_change_index).toHaveBeenCalledWith('wallet_1', 1);
        unmount();
    });

    it('triggers_global_refresh', async () => {
        const { result, unmount } = renderHook(() => use_wallet(), { wrapper });
        const initial_time = result.current.lastRefreshTime;

        act(() => {
            result.current.triggerRefresh();
        });

        expect(result.current.lastRefreshTime).toBeGreaterThanOrEqual(initial_time);
        unmount();
    });

    it('resets_entire_wallet_state', async () => {
        const mock_wallet = { id: 'wallet_1', name: 'Wallet 1', type: 'standard', derivedReceiveAddresses: [], derivedChangeAddresses: [], derivedAddressInfoCache: [] };
        (db_get_wallets as jest.Mock).mockResolvedValue([mock_wallet]);

        const { result, unmount } = renderHook(() => use_wallet(), { wrapper });

        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await result.current.resetWallet();
        });

        expect(keychain.resetGenericPassword).toHaveBeenCalled();
        expect(db_delete_wallet).toHaveBeenCalledWith('wallet_1');
        expect(result.current.wallets.length).toBe(0);
        expect(result.current.activeWallet).toBeNull();
        unmount();
    });

    it('recovers_gap_limit_by_deriving_addresses_beyond_last_used_index', async () => {
        // Simulate a wallet where address index 19 has a transaction, but 0-18 are unused.
        const mock_wallet = {
            id: 'wallet_gap_test',
            name: 'Gap Limit Wallet',
            type: 'standard',
            derivedReceiveAddresses: Array.from({ length: 20 }).map((_, i) => ({ address: `bc1q_rx_${i}`, index: i })),
            derivedChangeAddresses: [],
            derivedAddressInfoCache: Array.from({ length: 20 }).map((_, i) => ({
                address: `bc1q_rx_${i}`,
                index: i,
                balance: i === 19 ? 1000 : 0,
                tx_count: i === 19 ? 1 : 0
            })),
            utxoLabels: {}
        };

        (db_get_wallets as jest.Mock).mockResolvedValue([mock_wallet]);
        (db_get_address_cache as jest.Mock).mockResolvedValue(mock_wallet.derivedAddressInfoCache);
        (db_get_derived_addresses as jest.Mock).mockImplementation((_id, chain) => {
            if (chain === 0) return Promise.resolve(mock_wallet.derivedReceiveAddresses);
            return Promise.resolve([]);
        });

        const { result, unmount } = renderHook(() => use_wallet(), { wrapper });

        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await result.current.switchWallet('wallet_gap_test');
        });

        // The gap limit is 20. Because index 19 is used, the consecutive unused count resets to 0.
        // The derivation loop must fire for indices 20 through 39 to restore the 20-address gap.
        expect(db_save_address).toHaveBeenCalledWith(
            'wallet_gap_test',
            expect.objectContaining({ index: 39 }),
            0,
            expect.any(String)
        );

        unmount();
    });
});

describe('transaction_building_edge_cases', () => {
    beforeEach(() => {
        const mock_wallet = {
            id: 'wallet_tx_edge',
            name: 'TX Edge Wallet',
            type: 'standard',
            changeAddressIndex: 0,
            derivedReceiveAddresses: [{ address: 'bc1q_rx_test', index: 0 }],
            derivedChangeAddresses: [{ address: 'bc1q_ch_test', index: 0 }],
            derivedAddressInfoCache: [
                { address: 'bc1q_rx_test', index: 0, balance: 50000, tx_count: 1 },
                { address: 'bc1q_ch_test', index: 0, balance: 0, tx_count: 0 }
            ],
            utxoLabels: {}
        };
        (db_get_wallets as jest.Mock).mockResolvedValue([mock_wallet]);
        (db_get_derived_addresses as jest.Mock).mockImplementation((_id, chain) => {
            return Promise.resolve(chain === 0 ? mock_wallet.derivedReceiveAddresses : mock_wallet.derivedChangeAddresses);
        });
        (db_get_address_cache as jest.Mock).mockResolvedValue(mock_wallet.derivedAddressInfoCache);
    });

    const mock_utxos = [{
        txid: '0000000000000000000000000000000000000000000000000000000000000000',
        vout: 0,
        value: 50000,
        address: 'bc1q_rx_test'
    }];

    const valid_recipient = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';

    it('handles_exact_amount_with_zero_change', async () => {
        const { result, unmount } = renderHook(() => use_wallet(), { wrapper });
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await result.current.switchWallet('wallet_tx_edge');
        });

        let txResult: { txHex: string | null; usedChangeIndex: number | null } | undefined;
        await act(async () => {
            txResult = await result.current.createAndSignTransaction(valid_recipient, 48590, mock_utxos, 10);
        });

        expect(txResult?.txHex).toBeDefined();
        expect(txResult?.usedChangeIndex).toBeNull();
        unmount();
    });

    it('swallows_dust_change_into_fee', async () => {
        const { result, unmount } = renderHook(() => use_wallet(), { wrapper });
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await result.current.switchWallet('wallet_tx_edge');
        });

        let txResult: { txHex: string | null; usedChangeIndex: number | null } | undefined;
        await act(async () => {
            txResult = await result.current.createAndSignTransaction(valid_recipient, 48300, mock_utxos, 10);
        });

        expect(txResult?.txHex).toBeDefined();
        expect(txResult?.usedChangeIndex).toBeNull();
        unmount();
    });

    it('aborts_cleanly_on_keychain_failure_during_signing', async () => {
        const { result, unmount } = renderHook(() => use_wallet(), { wrapper });
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await result.current.switchWallet('wallet_tx_edge');
        });

        // Simulate keychain rejection
        const keychain = require('react-native-keychain');
        keychain.getGenericPassword.mockResolvedValueOnce(false);

        await expect(
            result.current.createAndSignTransaction(valid_recipient, 10000, mock_utxos, 10)
        ).rejects.toThrow('Could not retrieve credentials.');

        unmount();
    });

    it('throws_error_if_signing_with_watch_only_wallet', async () => {
        const watch_only_wallet = {
            id: 'wallet_tx_watch',
            name: 'Watch Only Edge',
            type: 'watch-only',
            xpub: 'xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8',
            changeAddressIndex: 0,
            derivedReceiveAddresses: [],
            derivedChangeAddresses: [],
            derivedAddressInfoCache: [],
            utxoLabels: {}
        };

        (db_get_wallets as jest.Mock).mockResolvedValue([watch_only_wallet]);
        (db_get_address_cache as jest.Mock).mockResolvedValue([]);
        (db_get_derived_addresses as jest.Mock).mockResolvedValue([]);

        const { result, unmount } = renderHook(() => use_wallet(), { wrapper });
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await result.current.switchWallet('wallet_tx_watch');
        });

        await expect(
            result.current.createAndSignTransaction(valid_recipient, 10000, mock_utxos, 10)
        ).rejects.toThrow('Watch-only wallets cannot sign transactions.');

        unmount();
    });
});