import React from 'react';
import { ActionSheetIOS, Linking } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import MerchantBottomSheet from '../../components/Map/MerchantBottomSheet';
import type { BtcMapElement } from '../../services/btcmap';

jest.mock('../../components/Map/MerchantSheetFrame', () => ({ children }: any) => children);
jest.mock('@gorhom/bottom-sheet', () => ({}));
jest.mock('../../components/GlassView', () => ({ GlassView: ({ children }: any) => children }));
jest.mock('../../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: { colors: {} } }) }));
jest.mock('@expo/vector-icons', () => ({ Feather: () => null, MaterialIcons: () => null }));

afterEach(() => jest.restoreAllMocks());

it('keeps the merchant on cancel, collapses for directions, and closes only from the close button', () => {
  const onIndexChange = jest.fn(), onClose = jest.fn();
  const picker = jest.spyOn(ActionSheetIOS, 'showActionSheetWithOptions').mockImplementation(() => {});
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  const merchant: BtcMapElement = { id: 'cafe', lat: 40, lon: -74, tags: { name: 'Cafe' } };
  const view = render(<MerchantBottomSheet merchant={merchant} index={1} onIndexChange={onIndexChange} closing={false} onClose={onClose} onDismiss={jest.fn()} />);
  fireEvent.press(view.getByText('Directions'));
  picker.mock.calls[0][1](0);
  expect(onIndexChange).not.toHaveBeenCalled();
  fireEvent.press(view.getByText('Directions'));
  picker.mock.calls[1][1](1);
  expect(onIndexChange).toHaveBeenCalledWith(0);
  expect(open).toHaveBeenCalledWith('http://maps.apple.com/?daddr=40,-74');
  expect(onClose).not.toHaveBeenCalled();
  fireEvent.press(view.getByRole('button', { name: 'Close merchant details' }));
  expect(onClose).toHaveBeenCalledTimes(1);
});
