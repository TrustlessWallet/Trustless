import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import CustomNodeScreen from '../../screens/CustomNodeScreen';
import { getConnectedPeer, resetActiveConnection, test_custom_node_connection } from '../../services/electrum';

jest.mock('@react-navigation/native', () => ({ usePreventRemove: jest.fn() }));
jest.mock('../../contexts/ThemeContext', () => ({
    useTheme: () => ({ theme: { colors: {}, LAYOUT: { radius: 8, inputHeight: 56 } } }),
}));
jest.mock('../../contexts/WalletContext', () => ({
    useWallet: () => ({ triggerRefresh: jest.fn().mockResolvedValue(undefined) }),
}));
jest.mock('@expo/vector-icons', () => ({ Feather: 'Feather' }));
jest.mock('../../services/electrum', () => ({
    ...jest.requireActual('../../services/electrum'),
    getConnectedPeer: jest.fn(),
    resetActiveConnection: jest.fn(),
    test_custom_node_connection: jest.fn(),
    getElectrumClient: jest.fn().mockResolvedValue({}),
}));

beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    await AsyncStorage.setItem('@customNodeUrl', 'saved.node:50002:tls');
    (getConnectedPeer as jest.Mock).mockReturnValue({ host: 'public.node', port: 50002, protocol: 'tls' });
});

it('leaves the existing settings intact when a replacement node fails its test', async () => {
    (test_custom_node_connection as jest.Mock).mockResolvedValue(false);
    const screen = render(<CustomNodeScreen />);
    const field = await screen.findByLabelText('Electrum node');
    expect(screen.getByText('Using a public node')).toBeTruthy();

    fireEvent.changeText(field, 'new.node:50002:tls');
    fireEvent.press(screen.getByRole('button', { name: 'Test & save' }));

    await screen.findByText(/Could not reach this node/);
    expect(await AsyncStorage.getItem('@customNodeUrl')).toBe('saved.node:50002:tls');
    expect(resetActiveConnection).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue('new.node:50002:tls')).toBeTruthy();
});

it('clears both custom node preferences and the certificate override when reverting', async () => {
    await AsyncStorage.setItem('@customElectrumNode', '{"host":"old.node","port":50002,"protocol":"tls"}');
    await AsyncStorage.setItem('@allowSelfSigned', 'true');
    const screen = render(<CustomNodeScreen />);
    fireEvent.press(await screen.findByRole('button', { name: 'Use default nodes' }));

    await waitFor(() => expect(resetActiveConnection).toHaveBeenCalledTimes(1));
    expect(await AsyncStorage.getItem('@customNodeUrl')).toBeNull();
    expect(await AsyncStorage.getItem('@customElectrumNode')).toBeNull();
    expect(await AsyncStorage.getItem('@allowSelfSigned')).toBeNull();
});
