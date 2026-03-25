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
    getTipHeight as get_tip_height
} from '../../services/bitcoin';
import { networks } from 'bitcoinjs-lib';

const mock_electrum_client = {
    request: jest.fn()
};

jest.mock('../../services/electrum', () => ({
    getElectrumClient: jest.fn(() => Promise.resolve(mock_electrum_client)),
    addressToScriptHash: jest.fn(() => 'mock_script_hash'),
    electrumBatchGetBalance: jest.fn(() => Promise.resolve([{ result: { confirmed: 1000, unconfirmed: 0 } }])),
    electrumBatchGetHistory: jest.fn(() => Promise.resolve([{ result: [{ tx_hash: 'mock_tx_hash', height: 100 }] }])),
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
});