import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import TerminalProSheet from '../../components/TerminalProSheet';

const loadPlans = jest.fn().mockResolvedValue(undefined);
const purchase = jest.fn().mockResolvedValue(false);
const restore = jest.fn().mockResolvedValue(false);
const manage = jest.fn().mockResolvedValue(undefined);
let mockState: any;

jest.mock('../../contexts/TerminalProContext', () => ({ useTerminalPro: () => mockState }));
jest.mock('../../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: require('../../constants/theme').LIGHT_THEME }) }));
jest.mock('../../screens/TerminalSheetHeader', () => () => null);
jest.mock('../../screens/PrivacyPolicyScreen', () => () => null);
jest.mock('../../screens/TermsConditionsScreen', () => () => null);
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
  expect(view.getByText(/Checkout, payment history, refunds, raw CSV export, and backup stay free/)).toBeTruthy();
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
  await waitFor(() => expect(verified).toHaveBeenCalledTimes(1));
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
