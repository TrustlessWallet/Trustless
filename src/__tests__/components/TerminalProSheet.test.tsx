import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Modal } from 'react-native';
import TerminalProSheet from '../../components/TerminalProSheet';

const loadPlans = jest.fn().mockResolvedValue(undefined);
const purchase = jest.fn().mockResolvedValue(false);
const restore = jest.fn().mockResolvedValue(false);
const manage = jest.fn().mockResolvedValue(undefined);
let mockState: any;

jest.mock('../../contexts/TerminalProContext', () => ({ useTerminalPro: () => mockState }));
jest.mock('../../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: require('../../constants/theme').LIGHT_THEME }) }));
jest.mock('../../screens/TerminalSheetHeader', () => ({ title, onClose, closeLabel, disabled }: any) => {
  const { Text, TouchableOpacity } = require('react-native');
  return <TouchableOpacity accessibilityRole="button" accessibilityLabel={closeLabel} disabled={disabled} onPress={onClose}><Text>{title}</Text></TouchableOpacity>;
});
jest.mock('../../screens/PrivacyPolicyScreen', () => () => {
  const { Text } = require('react-native');
  return <Text>Privacy body</Text>;
});
jest.mock('../../screens/TermsConditionsScreen', () => () => {
  const { Text } = require('react-native');
  return <Text>Terms body</Text>;
});
jest.mock('@expo/vector-icons', () => ({ Feather: () => null }));

beforeEach(() => {
  jest.clearAllMocks();
  mockState = {
    status: 'free', loadingPlans: false, busy: false, error: null,
    plans: [
      { id: 'monthly', price: '€4,99', periodLabel: 'month', renewalLabel: '€4,99 per month' },
      { id: 'annual', price: '€49,99', periodLabel: 'year', renewalLabel: '€49,99 per year' },
    ],
    loadPlans, purchase, restore, manage, refresh: jest.fn().mockResolvedValue(undefined),
  };
});

it('shows localized annual total by default and only metadata supplied trial wording', async () => {
  const verified = jest.fn();
  const view = render(<TerminalProSheet visible onClose={jest.fn()} onDismiss={jest.fn()} onVerified={verified} />);
  expect(view.getByText('€49,99')).toBeTruthy();
  expect(view.getByLabelText('Annual plan, €49,99 year').props.accessibilityState.selected).toBe(true);
  expect(view.queryByText(/free trial/i)).toBeNull();
  expect(view.queryByText(/Checkout, payment history/)).toBeNull();
  fireEvent.press(view.getByLabelText('Continue with annual Terminal Pro'));
  await waitFor(() => expect(purchase).toHaveBeenCalledWith('annual'));
  expect(verified).not.toHaveBeenCalled();
});

it('uses selected store plan and unlocks only on confirmed restore', async () => {
  const verified = jest.fn();
  restore.mockResolvedValueOnce(true);
  const view = render(<TerminalProSheet visible onClose={jest.fn()} onDismiss={jest.fn()} onVerified={verified} />);
  fireEvent.press(view.getByLabelText('Monthly plan, €4,99 month'));
  fireEvent.press(view.getByLabelText('Continue with monthly Terminal Pro'));
  await waitFor(() => expect(purchase).toHaveBeenCalledWith('monthly'));
  fireEvent.press(view.getByLabelText('Restore purchases'));
  await waitFor(() => expect(restore).toHaveBeenCalledTimes(1));
  expect(verified).not.toHaveBeenCalled();
  mockState = { ...mockState, status: 'pro' };
  view.rerender(<TerminalProSheet visible onClose={jest.fn()} onDismiss={jest.fn()} onVerified={verified} />);
  expect(view.getByText('Terminal Pro is ready')).toBeTruthy();
  fireEvent.press(view.getByLabelText('Continue to Terminal'));
  expect(verified).toHaveBeenCalledTimes(1);
});

it('shows a spinner and disables subscription management while it is opening', () => {
  mockState = { ...mockState, status: 'pro', busy: true };
  const props = { visible: true, onClose: jest.fn(), onDismiss: jest.fn(), onVerified: jest.fn() };
  const view = render(<TerminalProSheet {...props} />);
  const button = view.getByLabelText('Manage subscription');
  expect(button.props.accessibilityState).toMatchObject({ disabled: true, busy: true });
  expect(view.queryByText('Manage subscription')).toBeNull();
  fireEvent.press(button);
  expect(manage).not.toHaveBeenCalled();
  mockState = { ...mockState, busy: false };
  view.rerender(<TerminalProSheet {...props} />);
  expect(view.getByText('Manage subscription')).toBeTruthy();
  fireEvent.press(view.getByLabelText('Manage subscription'));
  expect(manage).toHaveBeenCalledTimes(1);
});

it('shows included features and management without plan choices when active', () => {
  mockState = { ...mockState, status: 'pro' };
  const view = render(<TerminalProSheet visible onClose={jest.fn()} onDismiss={jest.fn()} onVerified={jest.fn()} />);
  expect(view.getByText('Active')).toBeTruthy();
  expect(view.getByText('INCLUDED WITH PRO')).toBeTruthy();
  expect(view.getByText('Reports')).toBeTruthy();
  expect(view.getByText('Item reports and CSV export')).toBeTruthy();
  expect(view.getByLabelText('Manage subscription')).toBeTruthy();
  expect(view.queryByText('CHOOSE A PLAN')).toBeNull();
  expect(view.queryByLabelText('Restore purchases')).toBeNull();
});

it('uses sliding native sheets and routes Pro dismissal separately from legal dismissal', () => {
  const onClose = jest.fn();
  const onDismiss = jest.fn();
  const view = render(<TerminalProSheet visible onClose={onClose} onDismiss={onDismiss} onVerified={jest.fn()} />);
  let [pro, legal] = view.UNSAFE_getAllByType(Modal);
  expect(pro.props.animationType).toBe('slide');
  expect(pro.props.allowSwipeDismissal).toBe(true);
  expect(pro.props.children.props.children[1].type).toBe(Modal);
  expect(legal.props.animationType).toBe('slide');
  expect(legal.props.visible).toBe(false);
  pro.props.onRequestClose();
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(onDismiss).not.toHaveBeenCalled();
  pro.props.onDismiss();
  expect(onDismiss).toHaveBeenCalledTimes(1);

  fireEvent.press(view.getByLabelText('Monthly plan, €4,99 month'));
  fireEvent.press(view.getByLabelText('Privacy Policy'));
  [pro, legal] = view.UNSAFE_getAllByType(Modal);
  expect(legal.props.visible).toBe(true);
  expect(legal.props.allowSwipeDismissal).toBe(true);
  expect(view.getByText('Privacy body')).toBeTruthy();
  expect(pro.props.children.props.children[0].props.pointerEvents).toBe('none');
  expect(pro.props.children.props.children[0].props.children[0].props.disabled).toBe(true);
  act(() => legal.props.onRequestClose());
  expect(view.UNSAFE_getAllByType(Modal)[1].props.visible).toBe(false);
  act(() => legal.props.onDismiss());
  expect(view.getByLabelText('Monthly plan, €4,99 month').props.accessibilityState.selected).toBe(true);
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(onDismiss).toHaveBeenCalledTimes(1);
  fireEvent.press(view.getByLabelText('Terms and Conditions'));
  expect(view.getByText('Terms body')).toBeTruthy();
  fireEvent.press(view.getByLabelText('Close Terms and Conditions'));
  expect(view.UNSAFE_getAllByType(Modal)[1].props.visible).toBe(false);
});

it('blocks swipe and purchase controls while the store is busy or pending', () => {
  mockState = { ...mockState, busy: true };
  const props = { visible: true, onClose: jest.fn(), onDismiss: jest.fn(), onVerified: jest.fn() };
  const view = render(<TerminalProSheet {...props} />);
  expect(view.UNSAFE_getAllByType(Modal)[0].props.allowSwipeDismissal).toBe(false);
  expect(view.getByLabelText('Continue with annual Terminal Pro').props.accessibilityState.disabled).toBe(true);
  fireEvent.press(view.getByLabelText('Privacy Policy'));
  expect(view.UNSAFE_getAllByType(Modal)[1].props.visible).toBe(false);
  mockState = { ...mockState, busy: false, pending: true };
  view.rerender(<TerminalProSheet {...props} />);
  expect(view.getByLabelText('Continue with annual Terminal Pro').props.accessibilityState.disabled).toBe(true);
  fireEvent.press(view.getByLabelText('Continue with annual Terminal Pro'));
  expect(purchase).not.toHaveBeenCalled();
});

it('clears a legal sheet when Pro closes so reopening starts on Pro', () => {
  const callbacks = { onClose: jest.fn(), onDismiss: jest.fn(), onVerified: jest.fn() };
  const view = render(<TerminalProSheet visible {...callbacks} />);
  fireEvent.press(view.getByLabelText('Privacy Policy'));
  expect(view.UNSAFE_getAllByType(Modal)[1].props.visible).toBe(true);
  view.rerender(<TerminalProSheet visible={false} {...callbacks} />);
  view.rerender(<TerminalProSheet visible {...callbacks} />);
  expect(view.UNSAFE_getAllByType(Modal)[1].props.visible).toBe(false);
  expect(view.getByLabelText('Close Terminal Pro')).toBeTruthy();
});

it('waits for verified purchase success and acknowledgement even if status arrives first', async () => {
  let finish!: (result: boolean) => void;
  purchase.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const verified = jest.fn();
  const started = jest.fn();
  const props = { visible: true, onClose: jest.fn(), onDismiss: jest.fn(), onVerified: verified, onActivationStart: started };
  const view = render(<TerminalProSheet {...props} />);
  fireEvent.press(view.getByLabelText('Continue with annual Terminal Pro'));
  expect(started).toHaveBeenCalledTimes(1);
  mockState = { ...mockState, status: 'pro' };
  view.rerender(<TerminalProSheet {...props} />);
  expect(view.queryByText('Terminal Pro is ready')).toBeNull();
  expect(verified).not.toHaveBeenCalled();
  await act(async () => finish(true));
  expect(view.getByText('Terminal Pro is ready')).toBeTruthy();
  expect(view.getByText('Sales → Reports')).toBeTruthy();
  expect(view.queryByLabelText('Manage subscription')).toBeNull();
  fireEvent.press(view.getByLabelText('Continue to Terminal'));
  fireEvent.press(view.getByLabelText('Continue to Terminal'));
  expect(verified).toHaveBeenCalledTimes(1);
});

it('ignores a purchase result from a closed sheet and does not onboard an existing subscriber again', async () => {
  let finish!: (result: boolean) => void;
  purchase.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const verified = jest.fn();
  const props = { onClose: jest.fn(), onDismiss: jest.fn(), onVerified: verified };
  const view = render(<TerminalProSheet visible {...props} />);
  fireEvent.press(view.getByLabelText('Continue with annual Terminal Pro'));
  view.rerender(<TerminalProSheet visible={false} {...props} />);
  mockState = { ...mockState, status: 'pro' };
  view.rerender(<TerminalProSheet visible {...props} />);
  await act(async () => finish(true));
  expect(view.queryByText('Terminal Pro is ready')).toBeNull();
  expect(view.getByLabelText('Manage subscription')).toBeTruthy();
  expect(verified).not.toHaveBeenCalled();
});

it('confirms approval of a pending purchase without a second purchase', async () => {
  const props = { visible: true, onClose: jest.fn(), onDismiss: jest.fn(), onVerified: jest.fn() };
  const view = render(<TerminalProSheet {...props} />);
  fireEvent.press(view.getByLabelText('Continue with annual Terminal Pro'));
  await act(async () => {});
  mockState = { ...mockState, pending: true };
  view.rerender(<TerminalProSheet {...props} />);
  expect(view.queryByText('Terminal Pro is ready')).toBeNull();
  mockState = { ...mockState, pending: false, status: 'pro' };
  view.rerender(<TerminalProSheet {...props} />);
  expect(view.getByText('Terminal Pro is ready')).toBeTruthy();
  expect(purchase).toHaveBeenCalledTimes(1);
});

it('keeps loaded prices and the selected plan visible during a background plan refresh', () => {
  const props = { visible: true, onClose: jest.fn(), onDismiss: jest.fn(), onVerified: jest.fn() };
  const view = render(<TerminalProSheet {...props} />);
  fireEvent.press(view.getByLabelText('Monthly plan, €4,99 month'));
  mockState = { ...mockState, loadingPlans: true };
  view.rerender(<TerminalProSheet {...props} />);
  expect(view.getByText('€4,99')).toBeTruthy();
  expect(view.getByText('€49,99')).toBeTruthy();
  expect(view.getByLabelText('Monthly plan, €4,99 month').props.accessibilityState.selected).toBe(true);
  expect(view.getByLabelText('Continue with monthly Terminal Pro')).toBeTruthy();
  expect(view.UNSAFE_queryAllByType(require('react-native').ActivityIndicator)).toHaveLength(0);
});

it('shows restore progress on Restore rather than the purchase button and permits retry', async () => {
  let finish!: (result: boolean) => void;
  restore.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const view = render(<TerminalProSheet visible onClose={jest.fn()} onDismiss={jest.fn()} onVerified={jest.fn()} />);
  fireEvent.press(view.getByLabelText('Restore purchases'));
  expect(view.getByLabelText('Restore purchases').props.accessibilityState).toEqual({ disabled: true, busy: true });
  expect(view.getByLabelText('Restoring purchases')).toBeTruthy();
  expect(view.getByText('Continue with Annual')).toBeTruthy();
  expect(view.getByLabelText('Continue with annual Terminal Pro').props.accessibilityState).toEqual({ disabled: true, busy: false });
  expect(view.UNSAFE_getAllByType(require('react-native').ActivityIndicator)).toHaveLength(1);
  fireEvent.press(view.getByLabelText('Restore purchases'));
  expect(restore).toHaveBeenCalledTimes(1);
  await act(async () => finish(false));
  expect(view.getByLabelText('Restore purchases').props.accessibilityState).toEqual({ disabled: false, busy: false });
  expect(view.queryByLabelText('Restoring purchases')).toBeNull();
});

it('waits for the shared activation claim before offering Continue', async () => {
  purchase.mockResolvedValueOnce(true);
  const verified = jest.fn();
  const props = { visible: true, onClose: jest.fn(), onDismiss: jest.fn(), onVerified: verified, onActivationStart: jest.fn(() => 7) };
  const view = render(<TerminalProSheet {...props} />);
  fireEvent.press(view.getByLabelText('Continue with annual Terminal Pro'));
  await waitFor(() => expect(purchase).toHaveBeenCalledWith('annual', 7));
  mockState = { ...mockState, status: 'pro' };
  view.rerender(<TerminalProSheet {...props} />);
  expect(view.queryByLabelText('Continue to Terminal')).toBeNull();
  view.rerender(<TerminalProSheet {...props} activation={{ id: 7, kind: 'purchase', scope: 'shop-a', claimedBy: 'owner-a' }} />);
  fireEvent.press(view.getByLabelText('Continue to Terminal'));
  expect(verified).toHaveBeenCalledTimes(1);
});
