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
};
export type DerivedAddressInfo = {
  address: string;
  index: number;
  balance: number;
  tx_count: number;
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
export interface Wallet {
  id: string;
  name: string;
  changeAddressIndex: number;
  derivedReceiveAddresses: DerivedAddress[];
  derivedChangeAddresses: DerivedAddress[];
  derivedAddressInfoCache: DerivedAddressInfo[];
}
export type TabParamList = {
  Tracker: undefined;
  Wallet: undefined;
  Settings: undefined;
};
export type RootStackParamList = {
  MainTabs: NavigatorScreenParams<TabParamList> & { screen?: keyof TabParamList } | undefined;
  AddAddress: undefined;
  QRScanner: { onScanSuccess: (scannedData: string) => void };
  BackupIntro: undefined;
  ShowMnemonic: { mnemonic: string; mode: 'create' | 'backup' };
  VerifyMnemonic: { mnemonic: string };
  RecoverWallet: undefined;
  Receive: undefined;
  Send: { selectedAddress?: string } | undefined;
  TransactionConfirm: {
    recipientAddress: string,
    amount: string,
    unit: 'BTC' | 'sats',
    onConfirm: (finalFeeRate: number) => Promise<void>,
    loading: boolean,
    fee: number,
    feeVSize: number,
    selectedRate: number,
    feeOptions: { fast: number; normal: number; slow: number },
    onSelectFeeOption: (rate: number, fee: number) => void,
    utxos: UTXO[],
  };
  TransactionDetails: { transaction: Transaction };
  TransactionHistory: undefined;
  WalletSwitcher: undefined;
  AddWalletOptions: undefined;
  BackupDisclaimer: { walletId: string };
  AddressBook: { returnScreen?: keyof RootStackParamList } | undefined;
  AddSavedAddress: undefined;
  BalanceDetail: { utxos: UTXO[] };
  AddressDetails: { address: string };
  CoinControl: {
    onSelect: (selectedUtxos: UTXO[]) => void;
    targetAmount: number;
  };
  OnboardingWelcome: undefined;
  OnboardingTracker: undefined;
  OnboardingWallet: undefined;
  AuthCheck: undefined;
  PrivacyPolicy: undefined;
  TermsConditions: undefined;
  Support: undefined;
};