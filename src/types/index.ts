import { NavigatorScreenParams } from '@react-navigation/native';

export type BitcoinAddress = {
  id: string;
  address: string;
  name?: string;
  balance: number;
  lastUpdated: Date;
};

export type DerivedAddress = {
  address: string;
  index: number;
  label?: string;
};

export type DerivedAddressInfo = {
  address: string;
  index: number;
  balance: number;
  tx_count: number;
  label?: string;
};

export type UTXO = {
  txid: string;
  vout: number;
  value: number;
  address: string;
  status: {
    confirmed: boolean;
    block_height: number | null;
    block_hash: string | null;
    block_time: number | null;
  };
};

export type Transaction = {
  txid: string;
  version: number;
  locktime: number;
  vin: {
    txid: string;
    vout: number;
    prevout: {
      scriptpubkey: string;
      scriptpubkey_asm: string;
      scriptpubkey_type: string;
      scriptpubkey_address: string;
      value: number;
    };
    scriptsig: string;
    scriptsig_asm: string;
    witness: string[];
    is_coinbase: boolean;
    sequence: number;
  }[];
  vout: {
    scriptpubkey: string;
    scriptpubkey_asm: string;
    scriptpubkey_type: string;
    scriptpubkey_address: string;
    value: number;
  }[];
  size: number;
  weight: number;
  fee: number;
  status: {
    confirmed: boolean;
    block_height: number | null;
    block_hash: string | null;
    block_time: number | null;
  };
  type: 'send' | 'receive' | 'internal';
  amount: number;
};

export type LightningTransaction = {
  paymentHash: string;
  paymentTime: number;
  amountMsat: number;
  feeMsat: number;
  status: 'pending' | 'complete' | 'failed';
  type: 'send' | 'receive';
  description?: string;
  paymentMethod?: number;
};

export interface Wallet {
  id: string;
  name: string;
  type: 'standard' | 'watch-only';
  xpub?: string;
  fingerprint?: string;
  derivation_path?: string;
  scriptType?: 'p2wpkh' | 'p2sh-p2wpkh';
  changeAddressIndex: number;
  derivedReceiveAddresses: DerivedAddress[];
  derivedChangeAddresses: DerivedAddress[];
  derivedAddressInfoCache: DerivedAddressInfo[];
  utxoLabels: Record<string, string>;
  nextUtxoCount: number;
}

export type TabParamList = {
  Map: undefined;
  Wallet: undefined;
  Settings: undefined;
};

export type RootStackParamList = {
  MainTabs: { screen?: string } | undefined;
  AuthCheck: undefined;
  AddAddress: undefined;
  BackupIntro: undefined;
  ShowMnemonic: { mnemonic: string; mode?: string };
  ShowMnemonicQR: undefined;
  VerifyMnemonic: { mnemonic: string };
  RecoverWallet: undefined;
  ImportWatchOnly: undefined;
  LightningTopUp: undefined;
  WithdrawToOnchain: undefined;
  Send: { selectedAddress?: string; mode?: 'onchain' | 'lightning' };
  Receive: { mode?: 'onchain' | 'lightning' };
  TransactionSuccess: { type: 'onchain' | 'lightning' };
  TransactionConfirm: {
    recipientAddress: string;
    amount: string;
    unit: 'BTC' | 'sats';
    onConfirm: (finalFeeRate?: number) => Promise<void>;
    loading: boolean;
    fee: number;
    feeVSize?: number;
    selectedRate?: number;
    feeOptions?: { fast: number; normal: number; slow: number };
    onSelectFeeOption?: (rate: number, fee: number) => void;
    utxos: UTXO[];
    isImported?: boolean;
  };
  ExportPSBT: {
    recipientAddress: string;
    amount: string;
    unit: 'BTC' | 'sats';
    feeRate: number;
    fee: number;
    utxos: UTXO[];
  };
  ImportPSBT: {
    recipientAddress: string;
    amount: string;
    unit: 'BTC' | 'sats';
    fee: number;
    utxos: UTXO[];
    unsignedPsbtBase64: string;
  };
  WalletSwitcher: undefined;
  WalletOptions: { wallet_id: string };
  AddWalletOptions: undefined;
  BackupDisclaimer: { walletId: string };
  AddressBook: { returnScreen?: keyof RootStackParamList };
  AddSavedAddress: undefined;
  CoinControl: { targetAmount: number; onSelect: (utxos: UTXO[]) => void };
  BalanceDetail: { utxos: UTXO[] };
  AddressDetails: { address: string }
  ShowPublicKey: { wallet_id: string };
  QRScanner: { onScanSuccess: (data: string) => void };
  TransactionDetails: { transaction: Transaction | LightningTransaction };
  OnboardingWelcome: undefined;
  OnboardingWallet: undefined;
  PrivacyPolicy: undefined;
  TermsConditions: undefined;
  Support: undefined;
  PrivacyOverlay: undefined;
};