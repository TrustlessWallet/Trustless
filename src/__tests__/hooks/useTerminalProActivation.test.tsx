import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { Text, TouchableOpacity, View } from 'react-native';
import { TerminalProProvider } from '../../contexts/TerminalProContext';
import { TerminalOwnerFocusContext } from '../../contexts/TerminalOwnerFocusContext';
import { useTerminalProGate } from '../../hooks/useTerminalProGate';
import { createTerminalProService } from '../../services/terminalPro';

jest.mock('../../services/terminalPro', () => ({ createTerminalProService: jest.fn() }));
jest.mock('../../components/TerminalProSheet', () => {
  const React = require('react');
  const { Text, TouchableOpacity, View } = require('react-native');
  const { useTerminalPro } = require('../../contexts/TerminalProContext');
  return function MockSheet({ visible, activation, onClose, onDismiss, onVerified, onActivationStart }: any) {
    const pro = useTerminalPro();
    return <View testID="pro-sheet" visible={visible} onDismiss={onDismiss}>
      {visible && <TouchableOpacity accessibilityLabel="Buy" onPress={() => { const id = onActivationStart('purchase'); void pro.purchase('annual', id); }}><Text>Buy</Text></TouchableOpacity>}
      {visible && activation && <TouchableOpacity accessibilityLabel="Continue" onPress={onVerified}><Text>{activation.kind} confirmed</Text></TouchableOpacity>}
      {visible && <TouchableOpacity accessibilityLabel="Close" onPress={onClose}><Text>Close</Text></TouchableOpacity>}
    </View>;
  };
});

function Owner({ allowed, scope = 'shop-a', action }: { allowed: boolean; scope?: string; action: () => void }) {
  const gate = useTerminalProGate({ allowed, scope });
  return <View><TouchableOpacity accessibilityLabel="Action" onPress={() => gate.requirePro(action)}><Text>Action</Text></TouchableOpacity>{gate.proSheet}</View>;
}

it('delivers a verified purchase after StoreKit focus loss without replaying the old action', async () => {
  let settle!: (value: boolean) => void;
  let publish!: (value: any) => void;
  const unsubscribe = jest.fn();
  const service = {
    subscribe: jest.fn((listener: any) => { publish = listener; return unsubscribe; }),
    purchase: jest.fn(() => new Promise<boolean>(resolve => { settle = resolve; })),
    refresh: jest.fn().mockResolvedValue(undefined),
    loadPlans: jest.fn().mockResolvedValue(undefined),
    dispose: jest.fn(),
  };
  (createTerminalProService as jest.Mock).mockReturnValue(service);
  const action = jest.fn();
  const view = render(<TerminalProProvider><TerminalOwnerFocusContext.Provider value={true}><Owner allowed action={action} /></TerminalOwnerFocusContext.Provider></TerminalProProvider>);
  act(() => publish({ status: 'free', pending: false, plans: [], loadingPlans: false, busy: false, error: null }));
  fireEvent.press(view.getByLabelText('Action'));
  fireEvent.press(view.getByLabelText('Buy'));
  view.rerender(<TerminalProProvider><TerminalOwnerFocusContext.Provider value={false}><Owner allowed action={action} /></TerminalOwnerFocusContext.Provider></TerminalProProvider>);
  await act(async () => {
    publish({ status: 'pro', pending: false, plans: [], loadingPlans: false, busy: false, error: null });
    settle(true);
  });
  expect(view.getByTestId('pro-sheet').props.visible).toBe(false);
  expect(action).not.toHaveBeenCalled();
  view.rerender(<TerminalProProvider><TerminalOwnerFocusContext.Provider value={true}><Owner allowed action={action} /></TerminalOwnerFocusContext.Provider></TerminalProProvider>);
  expect(view.getByText('purchase confirmed')).toBeTruthy();
  fireEvent.press(view.getByLabelText('Continue'));
  fireEvent(view.getByTestId('pro-sheet'), 'dismiss');
  expect(action).not.toHaveBeenCalled();
  view.rerender(<TerminalProProvider><TerminalOwnerFocusContext.Provider value={true}><Owner allowed action={action} /></TerminalOwnerFocusContext.Provider></TerminalProProvider>);
  expect(view.queryByText('purchase confirmed')).toBeNull();
  view.unmount();
});

it('keeps claims scoped to the current event and clears confirmation if entitlement is lost', async () => {
  let publish!: (value: any) => void;
  let pro: any;
  const service = {
    subscribe: jest.fn((listener: any) => { publish = listener; return jest.fn(); }),
    purchase: jest.fn().mockResolvedValue(true),
    refresh: jest.fn().mockResolvedValue(undefined),
    dispose: jest.fn(),
  };
  (createTerminalProService as jest.Mock).mockReturnValue(service);
  function Probe() { pro = require('../../contexts/TerminalProContext').useTerminalPro(); return null; }
  const view = render(<TerminalProProvider><Probe /></TerminalProProvider>);
  act(() => publish({ status: 'pro', pending: false, plans: [], loadingPlans: false, busy: false, error: null }));
  let first!: number;
  await act(async () => { first = pro.beginActivation('shop-a', 'purchase'); await pro.purchase('annual', first); });
  act(() => expect(pro.claimActivation(first, 'old-owner', 'shop-a')).toBe(true));
  let second!: number;
  await act(async () => { second = pro.beginActivation('shop-a', 'purchase'); await pro.purchase('annual', second); });
  act(() => {
    expect(pro.claimActivation(second, 'new-owner', 'shop-a')).toBe(true);
    pro.acknowledgeActivation(first, 'old-owner');
    pro.releaseActivation(first, 'old-owner');
    pro.acknowledgeActivation(second, 'old-owner');
  });
  expect(pro.activation?.id).toBe(second);
  expect(pro.activation?.claimedBy).toBe('new-owner');
  act(() => publish({ status: 'free', pending: false, plans: [], loadingPlans: false, busy: false, error: null }));
  expect(pro.activation).toBeNull();
  view.unmount();
});

it('records a pending purchase only when a later verified entitlement arrives', () => {
  let publish!: (value: any) => void;
  let pro: any;
  (createTerminalProService as jest.Mock).mockReturnValue({
    subscribe: (listener: any) => { publish = listener; return jest.fn(); },
    dispose: jest.fn(),
  });
  function Probe() { pro = require('../../contexts/TerminalProContext').useTerminalPro(); return null; }
  const view = render(<TerminalProProvider><Probe /></TerminalProProvider>);
  let id!: number;
  act(() => { id = pro.beginActivation('shop-a', 'purchase'); });
  act(() => publish({ status: 'unavailable', pending: true, plans: [], loadingPlans: false, busy: false, error: null }));
  expect(pro.activation).toBeNull();
  act(() => publish({ status: 'pro', pending: false, plans: [], loadingPlans: false, busy: false, error: null }));
  expect(pro.activation).toMatchObject({ id, kind: 'purchase', scope: 'shop-a' });
  view.unmount();
});

it('consumes a newer claimed activation after an earlier attempt fails and focus returns', async () => {
  let publish!: (value: any) => void;
  let pro: any;
  const service = {
    subscribe: jest.fn((listener: any) => { publish = listener; return jest.fn(); }),
    purchase: jest.fn().mockResolvedValue(false),
    restore: jest.fn().mockResolvedValue(true),
    refresh: jest.fn().mockResolvedValue(undefined),
    loadPlans: jest.fn().mockResolvedValue(undefined),
    dispose: jest.fn(),
  };
  (createTerminalProService as jest.Mock).mockReturnValue(service);
  function Probe() { pro = require('../../contexts/TerminalProContext').useTerminalPro(); return null; }
  const action = jest.fn();
  const view = render(<TerminalProProvider><Probe /><Owner allowed action={action} /></TerminalProProvider>);
  act(() => publish({ status: 'free', pending: false, plans: [], loadingPlans: false, busy: false, error: null }));
  fireEvent.press(view.getByLabelText('Action'));
  await act(async () => { fireEvent.press(view.getByLabelText('Buy')); });
  view.rerender(<TerminalProProvider><Probe /><Owner allowed={false} action={action} /></TerminalProProvider>);
  let newer!: number;
  await act(async () => {
    newer = pro.beginActivation('shop-a', 'restore');
    publish({ status: 'pro', pending: false, plans: [], loadingPlans: false, busy: false, error: null });
    await pro.restore(newer);
  });
  view.rerender(<TerminalProProvider><Probe /><Owner allowed action={action} /></TerminalProProvider>);
  expect(view.getByText('restore confirmed')).toBeTruthy();
  fireEvent.press(view.getByLabelText('Continue'));
  fireEvent(view.getByTestId('pro-sheet'), 'dismiss');
  expect(action).not.toHaveBeenCalled();
  expect(pro.activation).toBeNull();
  view.unmount();
});
