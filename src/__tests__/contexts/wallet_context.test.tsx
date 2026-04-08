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
    dbSyncUtxos as db_sync_utxos
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
                (args[0].includes('Failed to bootstrap wallet') || args[0].includes('was not wrapped in act'))
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
        // Provide a valid mnemonic by default so wallet loading does not fail and throw warnings
        (keychain.getGenericPassword as jest.Mock).mockResolvedValue({ password: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about' });
        (db_get_wallets as jest.Mock).mockResolvedValue([]);
        (db_get_saved_addresses as jest.Mock).mockResolvedValue([]);
    });

    it('initializes_with_empty_state_when_no_wallets_exist', async () => {
        const { result } = renderHook(() => use_wallet(), { wrapper });

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.wallets.length).toBe(0);
        expect(result.current.activeWallet).toBeNull();
    });

    it('adds_standard_wallet_and_updates_active_state', async () => {
        const mock_new_wallet = { id: 'mocked_uuid_string', name: 'Wallet 1', type: 'standard', derivedReceiveAddresses: [], derivedChangeAddresses: [], derivedAddressInfoCache: [] };
        (db_get_wallets as jest.Mock).mockResolvedValueOnce([]).mockResolvedValueOnce([mock_new_wallet]);

        const { result } = renderHook(() => use_wallet(), { wrapper });

        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await result.current.addWallet({ mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about', type: 'standard' });
        });

        expect(db_create_wallet).toHaveBeenCalled();
        expect(keychain.setGenericPassword).toHaveBeenCalled();
    });

    it('removes_wallet_and_clears_keychain', async () => {
        const { result } = renderHook(() => use_wallet(), { wrapper });

        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await result.current.removeWallet('mocked_uuid_string');
        });

        expect(db_delete_wallet).toHaveBeenCalledWith('mocked_uuid_string');
        expect(keychain.resetGenericPassword).toHaveBeenCalled();
    });

    it('switches_active_wallet', async () => {
        const mock_wallet_one = { id: 'wallet_1', name: 'Wallet 1', type: 'standard', derivedReceiveAddresses: [], derivedChangeAddresses: [], derivedAddressInfoCache: [] };
        const mock_wallet_two = { id: 'wallet_2', name: 'Wallet 2', type: 'standard', derivedReceiveAddresses: [], derivedChangeAddresses: [], derivedAddressInfoCache: [] };

        (db_get_wallets as jest.Mock).mockResolvedValue([mock_wallet_one, mock_wallet_two]);

        const { result } = renderHook(() => use_wallet(), { wrapper });

        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await result.current.switchWallet('wallet_2');
        });

        expect(result.current.activeWallet?.id).toBe('wallet_2');
    });

    it('updates_wallet_name', async () => {
        const mock_wallet = { id: 'wallet_1', name: 'Old Name', type: 'standard', derivedReceiveAddresses: [], derivedChangeAddresses: [], derivedAddressInfoCache: [] };
        (db_get_wallets as jest.Mock).mockResolvedValue([mock_wallet]);

        const { result } = renderHook(() => use_wallet(), { wrapper });

        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await result.current.updateWalletName('wallet_1', 'New Name');
        });

        expect(db_update_wallet_name).toHaveBeenCalledWith('wallet_1', 'New Name');
    });

    it('gets_mnemonic_for_wallet_successfully', async () => {
        const mock_wallet = { id: 'wallet_1', name: 'Wallet 1', type: 'standard' };
        (db_get_wallets as jest.Mock).mockResolvedValue([mock_wallet]);
        (keychain.getGenericPassword as jest.Mock).mockResolvedValue({ password: 'test_mnemonic_string' });

        const { result } = renderHook(() => use_wallet(), { wrapper });

        await waitFor(() => expect(result.current.loading).toBe(false));

        let retrieved_mnemonic;
        await act(async () => {
            retrieved_mnemonic = await result.current.getMnemonicForWallet('wallet_1');
        });

        expect(keychain.getGenericPassword).toHaveBeenCalledWith({ service: 'com.btc.trustless.mnemonic.wallet_1' });
        expect(retrieved_mnemonic).toBe('test_mnemonic_string');
    });

    it('returns_null_when_getting_mnemonic_fails', async () => {
        const mock_wallet = { id: 'wallet_2', name: 'Watch Only', type: 'watch-only' };
        (db_get_wallets as jest.Mock).mockResolvedValue([mock_wallet]);
        (keychain.getGenericPassword as jest.Mock).mockRejectedValue(new Error('not found'));

        const { result } = renderHook(() => use_wallet(), { wrapper });

        await waitFor(() => expect(result.current.loading).toBe(false));

        let mnemonic;
        await act(async () => {
            mnemonic = await result.current.getMnemonicForWallet('wallet_2');
        });

        expect(mnemonic).toBeNull();
    });

    it('returns_null_for_next_address_if_no_active_wallet', async () => {
        const { result } = renderHook(() => use_wallet(), { wrapper });

        await waitFor(() => expect(result.current.loading).toBe(false));

        let next_address;
        await act(async () => {
            next_address = await result.current.getOrCreateNextUnusedReceiveAddress('dummy_address', 0);
        });

        expect(next_address).toBeNull();
    });

    it('throws_error_when_signing_without_active_wallet', async () => {
        const { result } = renderHook(() => use_wallet(), { wrapper });

        await waitFor(() => expect(result.current.loading).toBe(false));

        await expect(
            result.current.createAndSignTransaction('recipient', 1000, [], 1)
        ).rejects.toThrow("No active wallet.");
    });

    it('adds_saved_address_correctly', async () => {
        const { result } = renderHook(() => use_wallet(), { wrapper });

        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await result.current.addSavedAddress({ address: 'bc1qtest', balance: 0, lastUpdated: new Date() });
        });

        expect(db_add_saved_address).toHaveBeenCalled();
    });

    it('removes_saved_address', async () => {
        const { result } = renderHook(() => use_wallet(), { wrapper });

        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await result.current.removeSavedAddress('bc1qtest_remove');
        });

        expect(db_remove_saved_address).toHaveBeenCalledWith('saved_addresses', 'bc1qtest_remove');
    });

    it('updates_saved_address_name', async () => {
        const mock_saved = { id: 'bc1qtest_update', address: 'bc1qtest', name: '', balance: 0, lastUpdated: new Date() };
        (db_get_saved_addresses as jest.Mock).mockImplementation((network, table) => {
            if (table === 'saved_addresses') return Promise.resolve([mock_saved]);
            return Promise.resolve([]);
        });

        const { result } = renderHook(() => use_wallet(), { wrapper });

        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await result.current.updateSavedAddressName('bc1qtest_update', 'Exchange');
        });

        expect(db_update_saved_address).toHaveBeenCalledWith('saved_addresses', { ...mock_saved, name: 'Exchange' });
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

        const { result } = renderHook(() => use_wallet(), { wrapper });

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

        const { result } = renderHook(() => use_wallet(), { wrapper });

        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            if (result.current.activeWallet?.id !== 'wallet_1') {
                await result.current.switchWallet('wallet_1');
            }
            await result.current.scanAndNameUtxos();
        });

        expect(db_sync_utxos).toHaveBeenCalled();

        fetch_spy.mockRestore();
    });

    it('refreshes_saved_address_balances', async () => {
        const { result } = renderHook(() => use_wallet(), { wrapper });

        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await result.current.refreshSavedAddressBalances();
        });

        expect(result.current.loadingSavedAddresses).toBeDefined();
    });

    it('generates_mnemonic', async () => {
        const { result } = renderHook(() => use_wallet(), { wrapper });

        let wallet_mnemonic = '';

        await act(async () => {
            wallet_mnemonic = await result.current.generateMnemonic() || '';
        });

        const word_count = wallet_mnemonic.split(' ').length;
        const valid_lengths = [12, 15, 18, 21, 24];

        expect(wallet_mnemonic).not.toBe('');
        expect(valid_lengths).toContain(word_count);
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

        const { result } = renderHook(() => use_wallet(), { wrapper });

        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await result.current.incrementChangeIndex('wallet_1', 0);
        });

        expect(db_update_change_index).toHaveBeenCalledWith('wallet_1', 1);
    });

    it('triggers_global_refresh', async () => {
        const { result } = renderHook(() => use_wallet(), { wrapper });

        const initial_time = result.current.lastRefreshTime;

        act(() => {
            result.current.triggerRefresh();
        });

        expect(result.current.lastRefreshTime).toBeGreaterThanOrEqual(initial_time);
    });

    it('resets_entire_wallet_state', async () => {
        const mock_wallet = { id: 'wallet_1', name: 'Wallet 1', type: 'standard', derivedReceiveAddresses: [], derivedChangeAddresses: [], derivedAddressInfoCache: [] };
        (db_get_wallets as jest.Mock).mockResolvedValue([mock_wallet]);

        const { result } = renderHook(() => use_wallet(), { wrapper });

        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await result.current.resetWallet();
        });

        expect(keychain.resetGenericPassword).toHaveBeenCalled();
        expect(db_delete_wallet).toHaveBeenCalledWith('wallet_1');
        expect(result.current.wallets.length).toBe(0);
        expect(result.current.activeWallet).toBeNull();
    });
});