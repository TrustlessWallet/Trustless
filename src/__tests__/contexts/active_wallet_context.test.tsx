import React, { createContext, memo, useContext } from 'react';
import { act, render, renderHook } from '@testing-library/react-native';
import { ActiveWalletProvider, useActiveWallet } from '../../contexts/ActiveWalletContext';
import type { ActiveWallet } from '../../contexts/ActiveWalletContext';

const BroadContext = createContext({ lightningBalance: 0 });
const wallet = (id: string, name = id) => ({ id, name, type: 'standard' } as ActiveWallet);

it('distinguishes no wallet from a missing provider', () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useActiveWallet())).toThrow('useActiveWallet must be used within a WalletProvider');
    error.mockRestore();
    const { result } = renderHook(() => useActiveWallet(), {
        wrapper: ({ children }) => <ActiveWalletProvider value={null}>{children}</ActiveWalletProvider>,
    });
    expect(result.current).toBeNull();
});

it('only publishes wallet reference changes to memoized wallet readers', () => {
    const broadRenders: number[] = [];
    const walletRenders: (ActiveWallet | null)[] = [];
    const BroadReader = memo(() => {
        broadRenders.push(useContext(BroadContext).lightningBalance);
        return null;
    });
    const WalletReader = memo(() => {
        walletRenders.push(useActiveWallet());
        return null;
    });
    const readers = <>
        <BroadReader />
        <WalletReader />
    </>;
    const Tree = ({ balance, active }: { balance: number; active: ActiveWallet | null }) =>
        <BroadContext.Provider value={{ lightningBalance: balance }}>
            <ActiveWalletProvider value={active}>{readers}</ActiveWalletProvider>
        </BroadContext.Provider>;
    const first = wallet('a');
    const view = render(<Tree balance={0} active={first} />);
    expect(walletRenders).toEqual([first]);
    act(() => view.rerender(<Tree balance={1} active={first} />));
    act(() => view.rerender(<Tree balance={2} active={first} />));
    expect(broadRenders).toEqual([0, 1, 2]);
    expect(walletRenders).toEqual([first]);

    const renamed = wallet('a', 'New name');
    act(() => view.rerender(<Tree balance={2} active={renamed} />));
    const second = wallet('b');
    act(() => view.rerender(<Tree balance={2} active={second} />));
    act(() => view.rerender(<Tree balance={2} active={null} />));
    expect(walletRenders).toEqual([first, renamed, second, null]);
});
