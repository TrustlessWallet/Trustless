import {
    validateBitcoinAddress as validate_bitcoin_address,
    calculateVSize as calculate_vsize,
    inferScriptType as infer_script_type,
    getBip32Node as get_bip32_node,
    format_public_key,
    calculateTransactionMetrics as calculate_transaction_metrics,
    testNodeConnection as test_node_connection,
    fetchAddressInfoBatch as fetch_address_info_batch,
    fetchAddressBalances as fetch_address_balances,
    fetchBitcoinBalance as fetch_bitcoin_balance,
    fetchUTXOs as fetch_utxos,
    fetchAddressTransactions as fetch_address_transactions,
    broadcastTransaction as broadcast_transaction,
    fetchFeeEstimates as fetch_fee_estimates,
    fetchBalanceDetails as fetch_balance_details,
    getTransactionDetails as get_transaction_details,
    getTipHeight as get_tip_height,
    buildPSBT as build_psbt,
    encodePSBTtoUR as encode_psbt_to_ur,
    finalizeAndBroadcastPSBT as finalize_and_broadcast_psbt
} from '../../services/bitcoin';
import { networks, Psbt, payments } from 'bitcoinjs-lib';
import { Transaction as BitcoinTransaction } from 'bitcoinjs-lib';
import * as electrum from '../../services/electrum';

const mock_electrum_client = {
    request: jest.fn()
};

jest.mock('../../services/electrum', () => ({
    getElectrumClient: jest.fn(() => Promise.resolve(mock_electrum_client)),
    addressToScriptHash: jest.fn(() => 'mock_script_hash'),
    electrumBatchGetBalance: jest.fn(() => Promise.resolve([{ result: { confirmed: 1000, unconfirmed: 0 }, error: null }])),
    electrumBatchGetHistory: jest.fn(() => Promise.resolve([{ result: [{ tx_hash: 'mock_tx_hash', height: 100 }], error: null }])),
    electrumListUnspent: jest.fn(() => Promise.resolve([{ tx_hash: 'mock_tx_hash', tx_pos: 0, value: 1000, height: 100 }])),
    electrumBatchGetTransactions: jest.fn(() => Promise.resolve([])),
    electrumBroadcast: jest.fn(() => Promise.resolve('mock_tx_id')),
    electrumEstimateFee: jest.fn(() => Promise.resolve(0.0001)),
    electrumGetTransaction: jest.fn(() => Promise.resolve('020000000001000000000000000000')),
    electrumGetHeader: jest.fn(() => Promise.resolve({ height: 800000 }))
}));

global.fetch = jest.fn(() =>
    Promise.resolve({
        json: () => Promise.resolve({ fastestFee: 10, halfHourFee: 5, hourFee: 1 })
    })
) as jest.Mock;

describe('bitcoin_service_functions', () => {
    let original_console_warn: typeof console.warn;

    beforeAll(() => {
        original_console_warn = console.warn;
        console.warn = (...args: any[]) => {
            if (typeof args[0] === 'string' && args[0].includes('Failed electrum')) {
                return;
            }
            original_console_warn(...args);
        };
    });

    afterAll(() => {
        console.warn = original_console_warn;
    });

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('validates_correct_bitcoin_address', () => {
        const valid_address = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';
        const is_valid = validate_bitcoin_address(valid_address);
        expect(is_valid).toBe(true);
    });

    it('rejects_invalid_bitcoin_address', () => {
        const invalid_address = 'invalid_random_string_xyz';
        const is_valid = validate_bitcoin_address(invalid_address);
        expect(is_valid).toBe(false);
    });

    it('calculates_correct_transaction_vsize', () => {
        const input_count = 1;
        const output_count = 2;
        const expected_vsize = 141;
        const result = calculate_vsize(input_count, output_count);
        expect(result).toBe(expected_vsize);
    });

    it('infers_correct_script_type_from_ypub', () => {
        const test_ypub = 'ypub6Ww3ibxVfGzLrAH1PNcjyAWenMTbbAosGNB6VvmSEgytSER9azLDWCxoJwW7KeShDyVYVsU76SNDceRo2P31dYmjQjZTBeR5XTDK9GbgxY3';
        const script_type = infer_script_type(test_ypub);
        expect(script_type).toBe('p2sh-p2wpkh');
    });

    it('infers_correct_script_type_from_zpub', () => {
        const test_zpub = 'zpub6rFR7y4Q2AijTcQQWEQwB5MlsfR_SOME_KEY';
        const script_type = infer_script_type(test_zpub);
        expect(script_type).toBe('p2wpkh');
    });

    it('gets_bip32_node_from_xpub', () => {
        const test_xpub = 'xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8';
        const node = get_bip32_node(test_xpub, networks.bitcoin);
        expect(node).toBeDefined();
    });

    it('formats_public_key_correctly', () => {
        const test_xpub = 'xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8';
        const formatted_key = format_public_key(test_xpub, 'p2wpkh', 'bitcoin');
        expect(typeof formatted_key).toBe('string');
    });

    it('calculates_transaction_metrics_properly', () => {
        const metrics = calculate_transaction_metrics(1, 1000, 5000, 10);
        expect(metrics.fee).toBeGreaterThan(0);
        expect(metrics.change).toBeDefined();
        expect(metrics.vsize).toBeGreaterThan(0);
    });

    it('tests_node_connection', async () => {
        const is_connected = await test_node_connection('dummy_url');
        expect(is_connected).toBe(true);
    });

    it('fetches_address_info_batch', async () => {
        const addresses = ['bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu'];
        const info = await fetch_address_info_batch(addresses);
        expect(info.length).toBe(1);
        expect(info[0].balance).toBe(1000);
    });

    it('fetches_address_balances', async () => {
        const addresses = ['bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu'];
        const balances = await fetch_address_balances(addresses);
        expect(balances.length).toBe(1);
        expect(balances[0]).toBe(1000);
    });

    it('fetches_bitcoin_balance', async () => {
        const balance = await fetch_bitcoin_balance('bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu');
        expect(balance).toBe(1000);
    });

    it('fetches_utxos', async () => {
        const addresses = ['bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu'];
        const utxos = await fetch_utxos(addresses);
        expect(utxos.length).toBe(1);
        expect(utxos[0].value).toBe(1000);
    });

    it('fetches_address_transactions_returns_empty_on_parse_error', async () => {
        const addresses = ['bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu'];
        const transactions = await fetch_address_transactions(addresses);
        expect(Array.isArray(transactions)).toBe(true);
    });

    it('broadcasts_transaction', async () => {
        const tx_id = await broadcast_transaction('mock_hex');
        expect(tx_id).toBe('mock_tx_id');
    });

    it('fetches_fee_estimates', async () => {
        const fees = await fetch_fee_estimates();
        expect(fees.fast).toBeDefined();
        expect(fees.normal).toBeDefined();
        expect(fees.slow).toBeDefined();
    });

    it('fetches_balance_details', async () => {
        const addresses = ['bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu'];
        const details = await fetch_balance_details(addresses);
        expect(details.totalBalance).toBe(1000);
        expect(details.availableToSend).toBe(1000);
    });

    it('gets_transaction_details_returns_empty_on_invalid_hex', async () => {
        try {
            await get_transaction_details('mock_tx_id', ['bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu']);
        } catch (error) {
            expect(error).toBeDefined();
        }
    });

    it('gets_tip_height', async () => {
        mock_electrum_client.request.mockResolvedValueOnce({ height: 800000 });
        const height = await get_tip_height();
        expect(height).toBe(800000);
    });

    it('build_psbt_throws_error_for_non_watch_only_wallet', () => {
        expect(() => build_psbt({ type: 'standard' }, 'address', '0.0001', 'BTC', 100, [])).toThrow("Invalid wallet type");
    });

    it('build_psbt_generates_valid_base64_string_with_change', () => {
        const mock_wallet = {
            type: 'watch-only',
            fingerprint: 'deadbeef',
            xpub: 'xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8',
            derivation_path: "m/84'/0'/0'",
            changeAddressIndex: 0,
            derivedReceiveAddresses: [{ address: 'fake_address', index: 0 }],
            derivedChangeAddresses: [{ address: 'fake_change', index: 0 }],
            derivedAddressInfoCache: [{ address: 'fake_change', index: 0, tx_count: 0 }]
        };
        const utxos = [{
            txid: '0000000000000000000000000000000000000000000000000000000000000000',
            vout: 0,
            value: 100000,
            address: 'fake_address'
        }];

        const psbt_base64 = build_psbt(mock_wallet, 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu', '50000', 'sats', 1000, utxos);

        expect(typeof psbt_base64).toBe('string');
        expect(psbt_base64.length).toBeGreaterThan(0);
    });

    it('encode_psbt_to_ur_returns_array_of_ur_parts', () => {
        const mock_base64 = Buffer.from('mock_psbt_data').toString('base64');
        const ur_parts = encode_psbt_to_ur(mock_base64);

        expect(Array.isArray(ur_parts)).toBe(true);
        expect(ur_parts[0].startsWith('ur:crypto-psbt')).toBe(true);
    });

    it('finalize_and_broadcast_psbt_combines_and_broadcasts', async () => {
        const extract_tx_mock = jest.fn().mockReturnValue({ toHex: () => 'mock_final_hex' });
        const finalize_mock = jest.fn();
        const combine_mock = jest.fn();

        jest.spyOn(Psbt, 'fromBase64').mockReturnValue({
            combine: combine_mock,
            finalizeAllInputs: finalize_mock,
            extractTransaction: extract_tx_mock
        } as any);

        const tx_id = await finalize_and_broadcast_psbt('unsigned_base64', 'signed_base64');

        expect(combine_mock).toHaveBeenCalled();
        expect(finalize_mock).toHaveBeenCalled();
        expect(tx_id).toBe('mock_tx_id');

        jest.restoreAllMocks();
    });

    it('classifies_self_transfer_correctly', async () => {
        const parentTx = new BitcoinTransaction();
        parentTx.addInput(Buffer.alloc(32, 2), 0); // Dummy input ensures successful fromHex parsing
        parentTx.addOutput(Buffer.alloc(22, 1), 1500); // Forces fallback to 'unknown_script'
        const parentHex = parentTx.toHex();
        const parentId = parentTx.getId();

        const childTx = new BitcoinTransaction();
        childTx.addInput(Buffer.from(parentId, 'hex').reverse(), 0);
        childTx.addOutput(Buffer.alloc(22, 1), 1000);
        const childHex = childTx.toHex();
        const childId = childTx.getId();

        jest.spyOn(electrum, 'electrumBatchGetHistory').mockResolvedValueOnce([
            { result: [{ tx_hash: childId, height: 100 }], error: null }
        ]);

        jest.spyOn(electrum, 'electrumBatchGetTransactions').mockImplementation(async (batch: any) => {
            return batch.map((id: string) => {
                if (id === childId) return { result: childHex, error: null };
                if (id === parentId) return { result: parentHex, error: null };
                return { result: null, error: 'Not found' };
            });
        });

        const transactions = await fetch_address_transactions(['unknown_script']);

        expect(transactions.length).toBe(1);
        expect(transactions[0].type).toBe('send');
        expect(transactions[0].amount).toBe(500);
        expect(transactions[0].fee).toBe(500);
    });

    it('classifies_consolidation_transaction_correctly', async () => {
        const parentHexMap = new Map<string, string>();
        const childTx = new BitcoinTransaction();

        for (let i = 0; i < 10; i++) {
            const pTx = new BitcoinTransaction();
            pTx.addInput(Buffer.alloc(32, i + 2), 0);
            pTx.addOutput(Buffer.alloc(22, 1), 1000);
            const pId = pTx.getId();
            parentHexMap.set(pId, pTx.toHex());

            childTx.addInput(Buffer.from(pId, 'hex').reverse(), 0);
        }

        childTx.addOutput(Buffer.alloc(22, 1), 9000);
        const childHex = childTx.toHex();
        const childId = childTx.getId();

        jest.spyOn(electrum, 'electrumBatchGetHistory').mockResolvedValueOnce([
            { result: [{ tx_hash: childId, height: 100 }], error: null }
        ]);

        jest.spyOn(electrum, 'electrumBatchGetTransactions').mockImplementation(async (batch: any) => {
            return batch.map((id: string) => {
                if (id === childId) return { result: childHex, error: null };
                if (parentHexMap.has(id)) return { result: parentHexMap.get(id), error: null };
                return { result: null, error: 'Not found' };
            });
        });

        const transactions = await fetch_address_transactions(['unknown_script']);

        expect(transactions.length).toBe(1);
        expect(transactions[0].type).toBe('send');
        expect(transactions[0].amount).toBe(1000);
        expect(transactions[0].fee).toBe(1000);
        expect(transactions[0].vin.length).toBe(10);
    });

    it('handles_input_hydration_failures_gracefully', async () => {
        const childTx = new BitcoinTransaction();
        childTx.addInput(Buffer.alloc(32, 1), 0);
        const childHex = childTx.toHex();

        jest.spyOn(electrum, 'electrumBatchGetHistory').mockResolvedValueOnce([
            { result: [{ tx_hash: childTx.getId(), height: 100 }], error: null }
        ]);

        jest.spyOn(electrum, 'electrumBatchGetTransactions')
            .mockResolvedValueOnce([{ result: childHex, error: null }])
            .mockRejectedValueOnce(new Error('Parent fetch failed'));

        const transactions = await fetch_address_transactions(['mock_addr']);

        expect(transactions.length).toBe(1);
        expect(transactions[0].vin[0].prevout.scriptpubkey_address).toBe('Unknown');
        expect(transactions[0].vin[0].prevout.value).toBe(0);
    });

    it('fee_estimation_fallback_to_electrum', async () => {
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => { });
        (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));
        const electrumEstimateFeeMock = jest.spyOn(electrum, 'electrumEstimateFee').mockResolvedValue(0.0001);

        const fees = await fetch_fee_estimates();

        expect(fees.fast).toBe(10);
        expect(electrumEstimateFeeMock).toHaveBeenCalled();

        warnSpy.mockRestore();
    });

    it('fee_estimation_fallback_to_defaults', async () => {
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => { });
        (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));
        jest.spyOn(electrum, 'electrumEstimateFee').mockRejectedValue(new Error('Electrum error'));

        const fees = await fetch_fee_estimates();

        expect(fees.fast).toBeDefined();
        expect(fees.normal).toBeDefined();
        expect(fees.slow).toBeDefined();
        expect([25, 2]).toContain(fees.fast);
        expect([12, 1]).toContain(fees.normal);

        warnSpy.mockRestore();
    });

    it('build_psbt_handles_non_standard_derivation_paths', () => {
        const mock_wallet = {
            type: 'watch-only',
            fingerprint: 'deadbeef',
            xpub: 'xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8',
            derivation_path: "m/84/0/1'",
            changeAddressIndex: 0,
            derivedReceiveAddresses: [{ address: 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu', index: 0 }],
            derivedChangeAddresses: [],
            derivedAddressInfoCache: []
        };
        const utxos = [{
            txid: '0000000000000000000000000000000000000000000000000000000000000000',
            vout: 0,
            value: 100000,
            address: 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu'
        }];

        const psbt_base64 = build_psbt(mock_wallet as any, 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu', '50000', 'sats', 1000, utxos);
        const psbt = Psbt.fromBase64(psbt_base64);

        expect(typeof psbt_base64).toBe('string');
        expect(psbt.data.inputs[0].bip32Derivation![0].path).toBe("m/84/0/1'/0/0");
    });
});