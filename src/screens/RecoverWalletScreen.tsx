import React from 'react';
import * as bip39 from 'bip39';
import { canonicalMnemonic } from '../services/walletSecrets';
import WalletImportForm from './WalletImportForm';

const englishWords = bip39.wordlists.english;
const wordSet = new Set(englishWords);
const supportedWordCounts = [12, 15, 18, 21, 24];

function prepareImport(value: string) {
    const words = value.normalize('NFKD').trim().toLowerCase().split(/\s+/u);
    if (!supportedWordCounts.includes(words.length)) {
        throw new Error(`Found ${words.length} words. Enter a recovery phrase with 12, 15, 18, 21, or 24 words.`);
    }
    const invalidIndex = words.findIndex(word => !wordSet.has(word));
    if (invalidIndex !== -1) {
        throw new Error(`Check word ${invalidIndex + 1}. It isn’t in the recovery word list.`);
    }
    return { mnemonic: canonicalMnemonic(value) };
}

function suggestionsFor(value: string) {
    const lastWord = value.match(/\S+$/u)?.[0].toLowerCase();
    if (!lastWord || wordSet.has(lastWord)) return [];
    return englishWords.filter(word => word.startsWith(lastWord)).slice(0, 5);
}

export default function RecoverWalletScreen() {
    return <WalletImportForm
        label="Recovery phrase"
        placeholder="Enter words in order"
        hint="Wallets with an additional BIP39 passphrase aren’t supported."
        prepareImport={prepareImport}
        suggestionsFor={suggestionsFor}
    />;
}
