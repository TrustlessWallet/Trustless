import React from 'react';
import { Alert, StyleSheet } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useWallet } from '../../contexts/WalletContext';
import AddressBookScreen from '../../screens/AddressBookScreen';

jest.mock('@react-navigation/native', () => ({ useNavigation: jest.fn(), useRoute: jest.fn(), CommonActions: { setParams: jest.fn() } }));
jest.mock('../../contexts/WalletContext', () => ({ useWallet: jest.fn() }));
jest.mock('../../contexts/ThemeContext', () => ({ useTheme: () => ({ isDark: true, theme: { colors: { background: '#000', surface: '#222', primary: '#fff', inversePrimary: '#000', border: '#333', muted: '#888', bitcoin: '#f90' } } }) }));
jest.mock('@expo/vector-icons', () => ({ Feather: 'Feather' }));
jest.mock('../../components/StyledText', () => ({ Text: require('react-native').Text }));

it('keeps edit and delete actions separate from address selection with 44-point targets', () => {
  const navigate = jest.fn();
  const goBack = jest.fn();
  const dispatch = jest.fn();
  (useNavigation as jest.Mock).mockReturnValue({ navigate, goBack, dispatch, getState: () => ({ index: 1, routes: [{ name: 'Send', key: 'send' }, { name: 'AddressBook', key: 'book' }] }) });
  (useRoute as jest.Mock).mockReturnValue({ params: { returnScreen: 'Send' } });
  (useWallet as jest.Mock).mockReturnValue({ savedAddresses: [{ id: '1', name: 'Alice', address: 'bc1qexample', balance: 0, lastUpdated: new Date() }], loadingSavedAddresses: false, removeSavedAddress: jest.fn(), updateSavedAddressName: jest.fn() });
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

  const view = render(<AddressBookScreen />);
  const edit = view.getByLabelText('Edit Alice address name');
  const deleteButton = view.getByLabelText('Delete Alice address');
  const select = view.getByLabelText('Select Alice address');
  expect(StyleSheet.flatten(select.findByType(require('react-native').Text).props.style)).toMatchObject({ marginTop: 4 });
  expect(StyleSheet.flatten(edit.props.style)).toMatchObject({ width: 44, height: 44 });
  expect(StyleSheet.flatten(deleteButton.props.style)).toMatchObject({ width: 44, height: 44 });

  fireEvent.press(edit);
  fireEvent.press(deleteButton);
  expect(alert).toHaveBeenCalledWith('Delete Address', expect.any(String), expect.any(Array));
  expect(navigate).not.toHaveBeenCalled();
  expect(goBack).not.toHaveBeenCalled();
  expect(dispatch).not.toHaveBeenCalled();
  alert.mockRestore();
});
