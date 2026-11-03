import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { Text, TouchableOpacity, View } from 'react-native';
import { useTerminalProGate } from '../../hooks/useTerminalProGate';

let mockStatus: 'free' | 'pro' | 'loading' | 'unavailable' = 'free';
jest.mock('../../contexts/TerminalProContext', () => ({ useTerminalPro: () => ({ status: mockStatus }) }));
jest.mock('../../components/TerminalProSheet', () => {
  const React = require('react');
  const { Text, TouchableOpacity, View } = require('react-native');
  return function MockSheet({ visible, onClose, onDismiss, onVerified, onActivationStart }: any) {
    return <View testID="pro-sheet" visible={visible} onDismiss={onDismiss}>
      <TouchableOpacity accessibilityLabel="Start purchase" onPress={onActivationStart}><Text>Start</Text></TouchableOpacity>
      <TouchableOpacity accessibilityLabel="Verify purchase" onPress={onVerified}><Text>Verify</Text></TouchableOpacity>
      <TouchableOpacity accessibilityLabel="Cancel purchase" onPress={onClose}><Text>Cancel</Text></TouchableOpacity>
    </View>;
  };
});

function Owner({ allowed = true, scope = 'shop-a', onAction }: { allowed?: boolean; scope?: string; onAction: () => void }) {
  const gate = useTerminalProGate({ allowed, scope });
  return <View>
    <TouchableOpacity accessibilityLabel="Gated action" onPress={() => gate.requirePro(onAction)}><Text>Action</Text></TouchableOpacity>
    <TouchableOpacity accessibilityLabel="Open Pro" onPress={gate.openPro}><Text>Pro</Text></TouchableOpacity>
    {gate.proSheet}
  </View>;
}

beforeEach(() => { mockStatus = 'free'; });

it('replays a gated action once, only after verified Pro and native dismissal', () => {
  const action = jest.fn();
  const view = render(<Owner onAction={action} />);
  fireEvent.press(view.getByLabelText('Gated action'));
  expect(view.getByTestId('pro-sheet').props.visible).toBe(true);
  expect(action).not.toHaveBeenCalled();
  fireEvent.press(view.getByLabelText('Verify purchase'));
  expect(action).not.toHaveBeenCalled();
  mockStatus = 'pro';
  view.rerender(<Owner onAction={action} />);
  expect(view.getByTestId('pro-sheet').props.visible).toBe(false);
  fireEvent(view.getByTestId('pro-sheet'), 'dismiss');
  fireEvent(view.getByTestId('pro-sheet'), 'dismiss');
  expect(action).toHaveBeenCalledTimes(1);
});

it('drops deferred work on cancel, scope change, owner loss, and unmount', () => {
  const action = jest.fn();
  const view = render(<Owner onAction={action} />);
  fireEvent.press(view.getByLabelText('Gated action'));
  fireEvent.press(view.getByLabelText('Cancel purchase'));
  mockStatus = 'pro';
  view.rerender(<Owner onAction={action} />);
  fireEvent(view.getByTestId('pro-sheet'), 'dismiss');
  expect(action).not.toHaveBeenCalled();

  mockStatus = 'free';
  view.rerender(<Owner onAction={action} />);
  fireEvent.press(view.getByLabelText('Gated action'));
  view.rerender(<Owner scope="shop-b" onAction={action} />);
  mockStatus = 'pro';
  view.rerender(<Owner scope="shop-b" onAction={action} />);
  fireEvent(view.getByTestId('pro-sheet'), 'dismiss');
  expect(action).not.toHaveBeenCalled();

  mockStatus = 'free';
  view.rerender(<Owner scope="shop-b" onAction={action} />);
  fireEvent.press(view.getByLabelText('Gated action'));
  view.rerender(<Owner scope="shop-b" allowed={false} onAction={action} />);
  mockStatus = 'pro';
  view.rerender(<Owner scope="shop-b" allowed={false} onAction={action} />);
  fireEvent(view.getByTestId('pro-sheet'), 'dismiss');
  expect(action).not.toHaveBeenCalled();

  view.unmount();
});

it('runs immediately for verified Pro and never opens for a restricted owner', () => {
  mockStatus = 'pro';
  const action = jest.fn();
  const view = render(<Owner onAction={action} />);
  fireEvent.press(view.getByLabelText('Gated action'));
  expect(action).toHaveBeenCalledTimes(1);
  expect(view.getByTestId('pro-sheet').props.visible).toBe(false);
  view.rerender(<Owner allowed={false} onAction={action} />);
  fireEvent.press(view.getByLabelText('Open Pro'));
  expect(view.getByTestId('pro-sheet').props.visible).toBe(false);
});

it('resumes once when a pending scoped action receives verified access asynchronously', () => {
  const action = jest.fn();
  const view = render(<Owner onAction={action} />);
  fireEvent.press(view.getByLabelText('Gated action'));
  mockStatus = 'pro';
  view.rerender(<Owner onAction={action} />);
  expect(action).not.toHaveBeenCalled();
  fireEvent(view.getByTestId('pro-sheet'), 'dismiss');
  expect(action).toHaveBeenCalledTimes(1);
});

it('keeps the sheet open through early purchase status and resumes only after confirmation', () => {
  const action = jest.fn();
  const view = render(<Owner onAction={action} />);
  fireEvent.press(view.getByLabelText('Gated action'));
  fireEvent.press(view.getByLabelText('Start purchase'));
  mockStatus = 'pro';
  view.rerender(<Owner onAction={action} />);
  expect(view.getByTestId('pro-sheet').props.visible).toBe(true);
  expect(action).not.toHaveBeenCalled();
  fireEvent.press(view.getByLabelText('Verify purchase'));
  expect(view.getByTestId('pro-sheet').props.visible).toBe(false);
  fireEvent(view.getByTestId('pro-sheet'), 'dismiss');
  fireEvent(view.getByTestId('pro-sheet'), 'dismiss');
  expect(action).toHaveBeenCalledTimes(1);
});

it('abandons a confirmed purchase action when its sheet is closed or owner scope changes', () => {
  const action = jest.fn();
  const view = render(<Owner onAction={action} />);
  fireEvent.press(view.getByLabelText('Gated action'));
  fireEvent.press(view.getByLabelText('Start purchase'));
  mockStatus = 'pro';
  view.rerender(<Owner onAction={action} />);
  fireEvent.press(view.getByLabelText('Cancel purchase'));
  fireEvent(view.getByTestId('pro-sheet'), 'dismiss');
  expect(action).not.toHaveBeenCalled();
  mockStatus = 'free';
  view.rerender(<Owner onAction={action} />);
  fireEvent.press(view.getByLabelText('Gated action'));
  fireEvent.press(view.getByLabelText('Start purchase'));
  mockStatus = 'pro';
  view.rerender(<Owner scope="other" onAction={action} />);
  fireEvent.press(view.getByLabelText('Verify purchase'));
  fireEvent(view.getByTestId('pro-sheet'), 'dismiss');
  expect(action).not.toHaveBeenCalled();
});
