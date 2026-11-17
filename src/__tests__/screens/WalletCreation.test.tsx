import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import BackupIntroScreen from '../../screens/BackupIntroScreen';
import VerifyMnemonicScreen from '../../screens/VerifyMnemonicScreen';

const mockNavigate = jest.fn();
const mockGenerate = jest.fn();
const mockAdd = jest.fn();
const mockParams = { mnemonic: 'abandon '.repeat(11) + 'about', name: 'Savings' };
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, isFocused: () => true }),
  useRoute: () => ({ params: mockParams }),
}));
jest.mock('../../contexts/WalletContext', () => ({
  useWallet: () => ({ wallets: [{ id: 'existing' }], generateMnemonic: mockGenerate, addWallet: mockAdd }),
}));
jest.mock('../../contexts/ThemeContext', () => ({
  useTheme: () => ({ theme: { colors: {}, LAYOUT: {} }, isDark: false }),
}));
jest.mock('../../services/firstLaunchWallet', () => ({ confirmWalletBackup: jest.fn() }));
jest.mock('@expo/vector-icons', () => ({ Feather: () => null }));

beforeEach(() => jest.clearAllMocks());

it('passes the selected phrase length and trimmed name and ignores repeated generation taps', async () => {
  let finish!: (value: string) => void;
  mockGenerate.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const view = render(<BackupIntroScreen />);
  fireEvent.changeText(view.getByLabelText('Wallet name'), '  Savings  ');
  fireEvent.press(view.getByText('24 words'));
  fireEvent.press(view.getByText('Show recovery phrase'));
  expect(mockGenerate).toHaveBeenCalledTimes(1);
  expect(mockGenerate).toHaveBeenCalledWith(256);
  await act(async () => finish(mockParams.mnemonic));
  expect(mockNavigate).toHaveBeenCalledWith('ShowMnemonic', { ...mockParams, mode: 'create' });
});

it('preserves entries after a mismatch and creates only one named wallet after correction', async () => {
  let finish!: (value: { id: string }) => void;
  mockAdd.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const view = render(<VerifyMnemonicScreen />);
  const fields = view.getAllByLabelText(/^Word \d+$/);
  fields.forEach(field => fireEvent.changeText(field, 'wrong'));
  fireEvent.press(view.getByText('Create wallet'));
  expect(mockAdd).not.toHaveBeenCalled();
  expect(view.getAllByDisplayValue('wrong')).toHaveLength(fields.length);
  expect(view.getAllByText('Check this word')).toHaveLength(fields.length);
  fields.forEach(field => {
    const index = Number(field.props.accessibilityLabel.split(' ')[1]) - 1;
    fireEvent.changeText(field, mockParams.mnemonic.split(' ')[index]);
  });
  await act(async () => {
    fireEvent.press(view.getByText('Create wallet'));
    fireEvent(fields[fields.length - 1], 'submitEditing');
  });
  expect(mockAdd).toHaveBeenCalledTimes(1);
  expect(mockAdd).toHaveBeenCalledWith(mockParams);
  await act(async () => finish({ id: 'new' }));
  expect(mockNavigate).toHaveBeenCalledWith('WalletSetupSuccess', { kind: 'created' });
});
