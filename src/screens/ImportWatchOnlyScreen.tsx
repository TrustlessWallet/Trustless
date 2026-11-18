import React from 'react';
import { NETWORK } from '../constants/network';
import { validateWatchOnlyImport } from '../services/bitcoin';
import WalletImportForm from './WalletImportForm';

function prepareImport(value: string) {
    const match = /^\[([^/\]]+)\/([^\]]+)\](.+)$/.exec(value.trim());
    if (!match) {
        throw new Error('Scan or paste the full account export, including its master fingerprint and derivation path.');
    }
    const { xpub, fingerprint, derivation_path } = validateWatchOnlyImport(match[3], match[1], `m/${match[2]}`, NETWORK);
    return { type: 'watch-only' as const, xpub, fingerprint, derivation_path };
}

export default function ImportWatchOnlyScreen() {
    return <WalletImportForm
        label="Extended public key"
        placeholder="Paste or scan your account export"
        hint="Include the account fingerprint and derivation path. Watch-only wallets can’t sign payments."
        prepareImport={prepareImport}
    />;
}
