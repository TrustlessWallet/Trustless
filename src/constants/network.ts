import * as bitcoin from 'bitcoinjs-lib';

export let IS_TESTNET = false;
export let NETWORK = bitcoin.networks.bitcoin;
export let NETWORK_NAME = 'Bitcoin';
export let COIN_TYPE = "0'";
export let DERIVATION_PARENT_PATH = `m/84'/${COIN_TYPE}/0'`;
export let EXPLORER_UI_URL = 'https://mempool.space';
export let EXPLORER_API_URL = 'https://mempool.space/api';
export let FALLBACK_API_URL = 'https://blockstream.info/api';
export let GENESIS_HASH = '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f';
export const CUSTOM_NODE_URL_KEY = '@customNodeUrl'; // <--- Moved here

const MEMPOOL_SPACE_URL = 'https://mempool.space';
const MEMPOOL_SPACE_TESTNET_URL = 'https://mempool.space/testnet';

const BLOCKSTREAM_URL = 'https://blockstream.info';
const BLOCKSTREAM_TESTNET_URL = 'https://blockstream.info/testnet';

let onNetworkChangeCallback: (() => void) | null = null;

export const onNetworkChange = (callback: () => void) => {
  onNetworkChangeCallback = callback;
};

export const setNetwork = (networkId: 'mainnet' | 'testnet') => {
  IS_TESTNET = networkId === 'testnet';
  
  if (IS_TESTNET) {
    NETWORK = bitcoin.networks.testnet;
    NETWORK_NAME = 'Testnet';
    COIN_TYPE = "1'";
    DERIVATION_PARENT_PATH = `m/84'/${COIN_TYPE}/0'`;
    EXPLORER_UI_URL = MEMPOOL_SPACE_TESTNET_URL;
    EXPLORER_API_URL = `${MEMPOOL_SPACE_TESTNET_URL}/api`;
    FALLBACK_API_URL = `${BLOCKSTREAM_TESTNET_URL}/api`;
    GENESIS_HASH = '000000000933ea0136b099101e168e702b56b823b90b8793e96646f52e18e811';
  } else {
    NETWORK = bitcoin.networks.bitcoin;
    NETWORK_NAME = 'Mainnet';
    COIN_TYPE = "0'";
    DERIVATION_PARENT_PATH = `m/84'/${COIN_TYPE}/0'`;
    EXPLORER_UI_URL = MEMPOOL_SPACE_URL;
    EXPLORER_API_URL = `${MEMPOOL_SPACE_URL}/api`;
    FALLBACK_API_URL = `${BLOCKSTREAM_URL}/api`;
    GENESIS_HASH = '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f';
  }

  if (onNetworkChangeCallback) {
    onNetworkChangeCallback();
  }
};