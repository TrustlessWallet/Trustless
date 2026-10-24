import React, { createContext, useContext } from 'react';
import type { Wallet } from '../types';

// The active wallet includes the runtime receive address selected by WalletProvider.
export interface ActiveWallet extends Wallet {
    address: string;
    receiveAddressIndex: number;
}

const ActiveWalletContext = createContext<ActiveWallet | null | undefined>(undefined);

export const ActiveWalletProvider = ActiveWalletContext.Provider;

export const useActiveWallet = (): ActiveWallet | null => {
    const wallet = useContext(ActiveWalletContext);
    if (wallet === undefined) {
        throw new Error('useActiveWallet must be used within a WalletProvider');
    }
    return wallet;
};
