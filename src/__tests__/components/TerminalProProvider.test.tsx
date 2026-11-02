import React from 'react';
import { AppState, Text, TouchableOpacity } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import { TerminalProProvider, useTerminalPro } from '../../contexts/TerminalProContext';
import { createTerminalProService } from '../../services/terminalPro';

jest.mock('../../services/terminalPro', () => ({ createTerminalProService: jest.fn() }));

function Owner() {
  const pro = useTerminalPro();
  return <TouchableOpacity accessibilityLabel="Check Pro" onPress={() => { void pro.refresh(); }}><Text>{pro.status}</Text></TouchableOpacity>;
}

it('does not start billing at wallet boot and refreshes on foreground only after owner use', async () => {
  let foreground!: (state: string) => void;
  const remove = jest.fn();
  const events = jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, callback) => { foreground = callback as any; return { remove }; });
  const unsubscribe = jest.fn();
  const service = { initialize: jest.fn(), subscribe: jest.fn(() => unsubscribe), refresh: jest.fn().mockResolvedValue(undefined), dispose: jest.fn() };
  (createTerminalProService as jest.Mock).mockReturnValue(service);
  const view = render(<TerminalProProvider><Owner /></TerminalProProvider>);
  expect(service.initialize).not.toHaveBeenCalled();
  act(() => foreground('active'));
  expect(service.refresh).not.toHaveBeenCalled();
  await act(async () => fireEvent.press(view.getByLabelText('Check Pro')));
  expect(service.refresh).toHaveBeenCalledTimes(1);
  act(() => foreground('active'));
  expect(service.refresh).toHaveBeenCalledTimes(2);
  view.unmount();
  expect(remove).toHaveBeenCalledTimes(1);
  expect(unsubscribe).toHaveBeenCalledTimes(1);
  expect(service.dispose).toHaveBeenCalledTimes(1);
  events.mockRestore();
});
