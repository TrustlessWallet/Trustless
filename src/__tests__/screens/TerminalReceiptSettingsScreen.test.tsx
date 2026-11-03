const mockPro = { status: 'pro', pending: false, plans: [], busy: false, loadingPlans: false, error: null, loadPlans: jest.fn(), refresh: jest.fn().mockResolvedValue(undefined), purchase: jest.fn(), restore: jest.fn(), manage: jest.fn() };
let mockFocused = true;
jest.mock('../../contexts/TerminalProContext', () => ({ useTerminalPro: () => mockPro }));
import React from 'react';
import { ActionSheetIOS, Alert, Modal, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import TerminalReceiptSettingsScreen from '../../screens/TerminalReceiptSettingsScreen';
import TerminalSheetHeader from '../../screens/TerminalSheetHeader';
import { useActiveWallet } from '../../contexts/WalletContext';
import { useWalletMode } from '../../contexts/WalletModeContext';
import { loadTerminalReceiptBranding, saveTerminalReceiptBranding } from '../../services/terminalReceiptBranding';
import * as DocumentPicker from 'expo-document-picker';
import * as Templates from '../../services/terminalReceiptTemplates';
import { importTerminalReceiptLogo } from '../../services/terminalReceiptLogoImport';

const mockOptions = jest.fn();
jest.mock('@react-navigation/native', () => ({ useIsFocused: () => mockFocused, useNavigation: () => ({ setOptions: mockOptions }) }));
jest.mock('../../contexts/WalletContext', () => ({ useActiveWallet: jest.fn() }));
jest.mock('../../contexts/WalletModeContext', () => ({ useWalletMode: jest.fn() }));
jest.mock('../../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: { colors: { background: '#fff', primary: '#000', inversePrimary: '#fff', surface: '#eee', muted: '#888', border: '#ccc', bitcoin: '#f90' }, LAYOUT: { radius: 8, inputHeight: 48 } } }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('@expo/vector-icons', () => ({ Feather: () => null }));
jest.mock('../../components/StyledInput', () => ({ StyledInput: require('react-native').TextInput }));
jest.mock('../../services/terminalReceiptBranding', () => ({ DEFAULT_TERMINAL_RECEIPT_BRANDING: { name: '', contact: '', footer: '' }, normalizeTerminalReceiptBranding: jest.requireActual('../../services/terminalReceiptBranding').normalizeTerminalReceiptBranding, loadTerminalReceiptBranding: jest.fn(), saveTerminalReceiptBranding: jest.fn() }));
jest.mock('../../services/terminalReceiptTemplates', () => ({ loadTerminalReceiptTemplates: jest.fn(), createTerminalReceiptTemplate: jest.fn(), replaceTerminalReceiptTemplate: jest.fn(), removeTerminalReceiptTemplate: jest.fn() }));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn(), UIImagePickerPreferredAssetRepresentationMode: { Compatible: 'compatible' } }), { virtual: true });
jest.mock('../../services/terminalReceiptLogoImport', () => ({ importTerminalReceiptLogo: jest.fn() }));
const branding = { name: 'Corner café', contact: 'shop@example.com', footer: 'Thank you' };
const props = { walletId: 'wallet-a', network: 'mainnet' as const, onClose: jest.fn() };
const namingModal = (view: ReturnType<typeof render>) => view.UNSAFE_getAllByType(Modal).find(modal => modal.props.presentationStyle === 'pageSheet')!;
beforeEach(() => {
  mockPro.status = 'pro';
  mockFocused = true;
  jest.clearAllMocks();
  jest.spyOn(ActionSheetIOS, 'showActionSheetWithOptions').mockImplementation((_options, callback) => callback(1));
  (useActiveWallet as jest.Mock).mockReturnValue({ id: 'wallet-a', type: 'standard' });
  (useWalletMode as jest.Mock).mockReturnValue({ cashierState: 'off' });
  (loadTerminalReceiptBranding as jest.Mock).mockResolvedValue(branding);
  (Templates.loadTerminalReceiptTemplates as jest.Mock).mockResolvedValue([]);
  (saveTerminalReceiptBranding as jest.Mock).mockResolvedValue(branding);
  (importTerminalReceiptLogo as jest.Mock).mockResolvedValue({ mimeType: 'image/png', base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==' });
});
it('keeps selection canceled, previews a chosen logo, and saves removal as a dirty edit', async () => {
  const view = render(<TerminalReceiptSettingsScreen {...props} />);
  await waitFor(() => expect(view.getByDisplayValue('Corner café')).toBeTruthy());
  (DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValueOnce({ canceled: true });
  await act(async () => fireEvent.press(view.getByLabelText('Choose receipt logo')));
  expect(view.getByLabelText('Save receipt settings').props.accessibilityState.disabled).toBe(true);
  (DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValueOnce({ canceled: false, assets: [{ uri: 'file:///logo.png' }] });
  await act(async () => fireEvent.press(view.getByLabelText('Choose receipt logo')));
  expect(view.getByLabelText('Receipt logo in preview')).toBeTruthy();
  expect(view.getByLabelText('Save receipt settings').props.accessibilityState.disabled).toBe(false);
  fireEvent.press(view.getByLabelText('Remove receipt logo'));
  expect(view.queryByLabelText('Receipt logo in preview')).toBeNull();
  expect(view.getByLabelText('Save receipt settings').props.accessibilityState.disabled).toBe(true);
});
it('ignores a selected logo after owner access changes', async () => {
  let finish!: (value: any) => void;
  (DocumentPicker.getDocumentAsync as jest.Mock).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const view = render(<TerminalReceiptSettingsScreen {...props} />);
  await waitFor(() => expect(view.getByDisplayValue('Corner café')).toBeTruthy());
  fireEvent.press(view.getByLabelText('Choose receipt logo'));
  await waitFor(() => expect(DocumentPicker.getDocumentAsync).toHaveBeenCalled());
  (useActiveWallet as jest.Mock).mockReturnValue({ id: 'wallet-b', type: 'standard' });
  view.rerender(<TerminalReceiptSettingsScreen {...props} />);
  await act(async () => finish({ canceled: false, assets: [{ uri: 'file:///logo.png' }] }));
  expect(importTerminalReceiptLogo).not.toHaveBeenCalled();
  expect(view.queryByLabelText('Receipt logo in preview')).toBeNull();
});
it('saves removal of an existing logo', async () => {
  (loadTerminalReceiptBranding as jest.Mock).mockResolvedValueOnce({ ...branding, logo: { mimeType: 'image/png', base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==' } });
  const view = render(<TerminalReceiptSettingsScreen {...props} />);
  await waitFor(() => expect(view.getByLabelText('Receipt logo in preview')).toBeTruthy());
  fireEvent.press(view.getByLabelText('Remove receipt logo'));
  fireEvent.press(view.getByLabelText('Save receipt settings'));
  await waitFor(() => expect(saveTerminalReceiptBranding).toHaveBeenCalledTimes(1));
  expect((saveTerminalReceiptBranding as jest.Mock).mock.calls[0][2]).toEqual(branding);
});
it('loads scoped values, previews edits and saves once before closing', async () => {
  let finish!: () => void;
  (saveTerminalReceiptBranding as jest.Mock).mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  const view = render(<TerminalReceiptSettingsScreen {...props} />);
  await waitFor(() => expect(view.getByDisplayValue('Corner café')).toBeTruthy());
  expect(view.getByLabelText('Save receipt settings').props.accessibilityState.disabled).toBe(true);
  fireEvent.changeText(view.getByLabelText('Receipt business name'), 'New café');
  expect(view.getByText('New café')).toBeTruthy();
  fireEvent.press(view.getByLabelText('Save receipt settings'));
  fireEvent.press(view.getByLabelText('Save receipt settings'));
  expect(saveTerminalReceiptBranding).toHaveBeenCalledTimes(1);
  expect(props.onClose).not.toHaveBeenCalled();
  expect(mockOptions).toHaveBeenLastCalledWith({ gestureEnabled: false });
  await act(async () => finish());
  expect(props.onClose).toHaveBeenCalledTimes(1);
});
it('does not show an empty editable profile on read failure and retains edits on failed save', async () => {
  (loadTerminalReceiptBranding as jest.Mock).mockRejectedValueOnce(new Error('corrupt'));
  const view = render(<TerminalReceiptSettingsScreen {...props} />);
  await waitFor(() => expect(view.getByText('Receipt settings unavailable.')).toBeTruthy());
  expect(view.queryByLabelText('Save receipt settings')).toBeNull();
  fireEvent.press(view.getByLabelText('Retry receipt settings'));
  await waitFor(() => expect(view.getByDisplayValue('Corner café')).toBeTruthy());
  fireEvent.changeText(view.getByLabelText('Receipt footer'), 'Welcome back');
  (saveTerminalReceiptBranding as jest.Mock).mockRejectedValueOnce(new Error('disk'));
  fireEvent.press(view.getByLabelText('Save receipt settings'));
  await waitFor(() => expect(view.getByText('Couldn’t save receipt details. Try again.')).toBeTruthy());
  expect(view.getByDisplayValue('Welcome back')).toBeTruthy();
  expect(props.onClose).not.toHaveBeenCalled();
});
it('blocks cashier and watch-only editing and ignores a save after owner scope changes', async () => {
  (useWalletMode as jest.Mock).mockReturnValue({ cashierState: 'locked' });
  const view = render(<TerminalReceiptSettingsScreen {...props} />);
  expect(view.getByText('Owner access is required to edit receipts.')).toBeTruthy();
  expect(loadTerminalReceiptBranding).not.toHaveBeenCalled();
  (useWalletMode as jest.Mock).mockReturnValue({ cashierState: 'off' });
  view.rerender(<TerminalReceiptSettingsScreen {...props} />);
  await waitFor(() => expect(view.getByDisplayValue('Corner café')).toBeTruthy());
  let finish!: () => void;
  (saveTerminalReceiptBranding as jest.Mock).mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  fireEvent.changeText(view.getByLabelText('Receipt footer'), 'Changed');
  fireEvent.press(view.getByLabelText('Save receipt settings'));
  const guard = (saveTerminalReceiptBranding as jest.Mock).mock.calls[0][3];
  expect(guard()).toBe(true);
  (useActiveWallet as jest.Mock).mockReturnValue({ id: 'wallet-a', type: 'watch-only' });
  view.rerender(<TerminalReceiptSettingsScreen {...props} />);
  expect(guard()).toBe(false);
  await act(async () => finish());
  expect(props.onClose).not.toHaveBeenCalled();
});

it('offers native Photos, Files and Cancel choices without opening either picker on cancel', async () => {
  const chooser = jest.spyOn(ActionSheetIOS, 'showActionSheetWithOptions').mockImplementation((_options, callback) => callback(2));
  const view = render(<TerminalReceiptSettingsScreen {...props} />);
  await waitFor(() => expect(view.getByLabelText('Choose receipt logo')).toBeTruthy());
  await act(async () => fireEvent.press(view.getByLabelText('Choose receipt logo')));
  expect(chooser).toHaveBeenCalledWith(expect.objectContaining({ options: ['Choose from Photos', 'Choose from Files', 'Cancel'], cancelButtonIndex: 2 }), expect.any(Function));
  expect(ImagePicker.launchImageLibraryAsync).not.toHaveBeenCalled();
  expect(DocumentPicker.getDocumentAsync).not.toHaveBeenCalled();
  expect(view.getByLabelText('Save receipt settings').props.accessibilityState.disabled).toBe(true);
});

it('uses the same validated logo draft for Photos, and keeps it unchanged on photo cancellation', async () => {
  jest.spyOn(ActionSheetIOS, 'showActionSheetWithOptions').mockImplementation((_options, callback) => callback(0));
  (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValueOnce({ canceled: true });
  const view = render(<TerminalReceiptSettingsScreen {...props} />);
  await waitFor(() => expect(view.getByDisplayValue('Corner café')).toBeTruthy());
  await act(async () => fireEvent.press(view.getByLabelText('Choose receipt logo')));
  expect(view.getByLabelText('Save receipt settings').props.accessibilityState.disabled).toBe(true);
  (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValueOnce({ canceled: false, assets: [{ uri: 'file:///photo.png' }] });
  await act(async () => fireEvent.press(view.getByLabelText('Choose receipt logo')));
  expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalledWith(expect.objectContaining({ mediaTypes: ['images'], allowsEditing: false, exif: false }));
  expect(DocumentPicker.getDocumentAsync).not.toHaveBeenCalled();
  expect(importTerminalReceiptLogo).toHaveBeenCalledWith('file:///photo.png', expect.any(Function));
  expect(view.getByLabelText('Receipt logo in preview')).toBeTruthy();
});

it('does not stack source menus or open a picker after owner access changes', async () => {
  let choose!: (index: number) => void;
  const menu = jest.spyOn(ActionSheetIOS, 'showActionSheetWithOptions').mockImplementation((_options, callback) => { choose = callback; });
  const view = render(<TerminalReceiptSettingsScreen {...props} />);
  await waitFor(() => expect(view.getByDisplayValue('Corner café')).toBeTruthy());
  fireEvent.press(view.getByLabelText('Choose receipt logo'));
  fireEvent.press(view.getByLabelText('Choose receipt logo'));
  expect(menu).toHaveBeenCalledTimes(1);
  (useActiveWallet as jest.Mock).mockReturnValue({ id: 'wallet-b', type: 'standard' });
  view.rerender(<TerminalReceiptSettingsScreen {...props} />);
  await act(async () => choose(0));
  expect(ImagePicker.launchImageLibraryAsync).not.toHaveBeenCalled();
  expect(DocumentPicker.getDocumentAsync).not.toHaveBeenCalled();
});

const savedTemplate = { id: 'template-one', name: 'Weekend', branding: { name: 'Market stall', contact: 'market@example.com', footer: 'See you next week' } };
it('saves a named copy without applying receipt settings, then applies only through Save', async () => {
  (Templates.createTerminalReceiptTemplate as jest.Mock).mockResolvedValue([savedTemplate]);
  const view = render(<TerminalReceiptSettingsScreen {...props} />);
  await waitFor(() => expect(view.getByLabelText('Save as receipt template').props.accessibilityState.disabled).toBe(false));
  fireEvent.changeText(view.getByLabelText('Receipt footer'), 'Weekend footer');
  fireEvent.press(view.getByLabelText('Save as receipt template'));
  expect(namingModal(view).props.visible).toBe(true);
  expect(view.queryByLabelText('Save receipt settings')).toBeNull();
  fireEvent.changeText(view.getByLabelText('Receipt template name'), 'Weekend');
  await act(async () => {
    fireEvent.press(view.getByLabelText('Save receipt template'));
    fireEvent.press(view.getByLabelText('Save receipt template'));
  });
  await waitFor(() => expect(namingModal(view).props.visible).toBe(false));
  expect(Templates.createTerminalReceiptTemplate).toHaveBeenCalledTimes(1);
  expect(saveTerminalReceiptBranding).not.toHaveBeenCalled();
  fireEvent.press(view.getByLabelText('Save receipt settings'));
  await waitFor(() => expect(saveTerminalReceiptBranding).toHaveBeenCalledWith('wallet-a', 'mainnet', expect.objectContaining({ footer: 'Weekend footer' }), expect.any(Function)));
});
it('loads a template into the draft, explicitly replaces it, and deleting preserves that draft', async () => {
  (Templates.loadTerminalReceiptTemplates as jest.Mock).mockResolvedValue([savedTemplate]);
  (Templates.replaceTerminalReceiptTemplate as jest.Mock).mockImplementation(async (_wallet, _network, _id, draft) => [{ ...savedTemplate, branding: draft }]);
  (Templates.removeTerminalReceiptTemplate as jest.Mock).mockResolvedValue([]);
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const view = render(<TerminalReceiptSettingsScreen {...props} />);
  await waitFor(() => expect(view.getByDisplayValue('Corner café')).toBeTruthy());
  fireEvent.press(view.getByLabelText('Load receipt template'));
  await waitFor(() => expect(view.getByLabelText('Load template Weekend')).toBeTruthy());
  fireEvent.press(view.getByLabelText('Load template Weekend'));
  expect(view.getByDisplayValue('Market stall')).toBeTruthy(); expect(saveTerminalReceiptBranding).not.toHaveBeenCalled();
  fireEvent.changeText(view.getByLabelText('Receipt footer'), 'Updated weekend footer');
  fireEvent.press(view.getByLabelText('Replace receipt template Weekend'));
  await waitFor(() => expect(Templates.replaceTerminalReceiptTemplate).toHaveBeenCalledWith('wallet-a', 'mainnet', savedTemplate.id, expect.objectContaining({ footer: 'Updated weekend footer' }), expect.any(Function)));
  await waitFor(() => expect(view.queryByLabelText('Replace receipt template Weekend')).toBeNull());
  fireEvent.press(view.getByLabelText('Load receipt template')); fireEvent.press(view.getByLabelText('Delete template Weekend'));
  await act(async () => { (alert.mock.calls[0][2] as any[]).find(button => button.text === 'Delete').onPress(); });
  expect(view.getByDisplayValue('Updated weekend footer')).toBeTruthy(); expect(saveTerminalReceiptBranding).not.toHaveBeenCalled();
  expect(view.queryByLabelText('Load template Weekend')).toBeNull();
  fireEvent.press(view.getByLabelText('Load standard receipt'));
  expect(view.getByLabelText('Receipt business name').props.value).toBe('');
  expect(view.queryByLabelText('Receipt logo in preview')).toBeNull(); alert.mockRestore();
});
it('keeps normal receipt editing available after a template-library read failure and retry preserves the draft', async () => {
  (Templates.loadTerminalReceiptTemplates as jest.Mock).mockRejectedValueOnce(new Error('unreadable')).mockResolvedValue([]);
  const view = render(<TerminalReceiptSettingsScreen {...props} />);
  await waitFor(() => expect(view.getByDisplayValue('Corner café')).toBeTruthy());
  fireEvent.changeText(view.getByLabelText('Receipt footer'), 'Keep my draft'); fireEvent.press(view.getByLabelText('Load receipt template'));
  await waitFor(() => expect(view.getByLabelText('Retry receipt templates')).toBeTruthy());
  expect(view.getByLabelText('Save receipt settings').props.accessibilityState.disabled).toBe(false);
  fireEvent.press(view.getByLabelText('Retry receipt templates'));
  await waitFor(() => expect(view.getByLabelText('Load standard receipt')).toBeTruthy());
  expect(view.getByDisplayValue('Keep my draft')).toBeTruthy();
});
it('ignores late template writes and stale delete confirmations after wallet changes', async () => {
  let finish!: (value: unknown) => void;
  (Templates.loadTerminalReceiptTemplates as jest.Mock).mockResolvedValue([savedTemplate]);
  (Templates.createTerminalReceiptTemplate as jest.Mock).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const view = render(<TerminalReceiptSettingsScreen {...props} />);
  await waitFor(() => expect(view.getByLabelText('Save as receipt template').props.accessibilityState.disabled).toBe(false));
  fireEvent.press(view.getByLabelText('Save as receipt template')); fireEvent.changeText(view.getByLabelText('Receipt template name'), 'Late'); fireEvent.press(view.getByLabelText('Save receipt template'));
  (useActiveWallet as jest.Mock).mockReturnValue({ id: 'other', type: 'standard' }); view.rerender(<TerminalReceiptSettingsScreen {...props} />);
  expect((Templates.createTerminalReceiptTemplate as jest.Mock).mock.calls[0][4]()).toBe(false);
  await act(async () => finish([savedTemplate]));
  expect(view.queryByLabelText('Load template Weekend')).toBeNull(); expect(saveTerminalReceiptBranding).not.toHaveBeenCalled();
});


it('presents naming in a swipeable page sheet and preserves the receipt draft on dismissal', async () => {
  const view = render(<TerminalReceiptSettingsScreen {...props} />);
  await waitFor(() => expect(view.getByLabelText('Save as receipt template').props.accessibilityState.disabled).toBe(false));
  fireEvent.changeText(view.getByLabelText('Receipt footer'), 'Unsaved footer');
  fireEvent.press(view.getByLabelText('Save as receipt template'));
  const modal = namingModal(view);
  expect(modal.props).toEqual(expect.objectContaining({ visible: true, animationType: 'slide', presentationStyle: 'pageSheet', allowSwipeDismissal: true }));
  expect(view.getAllByText('Save template')).toHaveLength(2);
  expect(view.getByLabelText('Receipt template name').props.autoFocus).toBe(true);
  expect(view.getByLabelText('Receipt template name').props.editable).toBe(true);
  expect(view.UNSAFE_getAllByType(TerminalSheetHeader).find(header => header.props.title === 'Receipts')?.props.disabled).toBe(true);
  expect(view.queryByLabelText('Cancel template name')).toBeNull();
  expect(view.queryByLabelText('Receipt branding preview')).toBeNull();
  expect(view.queryByLabelText('Receipt business name')).toBeNull();
  expect(view.getByLabelText('Receipt business name', { includeHiddenElements: true }).props.editable).toBe(false);
  expect(view.UNSAFE_getAllByType(View).some(node => node.props.pointerEvents === 'none' && node.props.accessibilityElementsHidden === true)).toBe(true);
  fireEvent.changeText(view.getByLabelText('Receipt template name'), 'Unfinished');
  act(() => modal.props.onRequestClose());
  expect(namingModal(view).props.visible).toBe(false);
  expect(view.getByLabelText('Receipt footer').props.value).toBe('Unsaved footer');
  expect(view.getByLabelText('Receipt branding preview')).toBeTruthy();
  expect(Templates.createTerminalReceiptTemplate).not.toHaveBeenCalled();
  expect(props.onClose).not.toHaveBeenCalled();
});

it('disables swipe dismissal while a template write is in progress', async () => {
  let finish!: (value: unknown) => void;
  (Templates.createTerminalReceiptTemplate as jest.Mock).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const view = render(<TerminalReceiptSettingsScreen {...props} />);
  await waitFor(() => expect(view.getByLabelText('Save as receipt template').props.accessibilityState.disabled).toBe(false));
  fireEvent.press(view.getByLabelText('Save as receipt template'));
  fireEvent.changeText(view.getByLabelText('Receipt template name'), 'Weekend');
  fireEvent.press(view.getByLabelText('Save receipt template'));
  expect(namingModal(view).props.allowSwipeDismissal).toBe(false);
  act(() => namingModal(view).props.onRequestClose());
  expect(namingModal(view).props.visible).toBe(true);
  await act(async () => finish([savedTemplate]));
  expect(namingModal(view).props.visible).toBe(false);
});


it('keeps a failed template name editable and retries without applying the receipt profile', async () => {
  (Templates.createTerminalReceiptTemplate as jest.Mock).mockRejectedValueOnce(new Error('Receipt template name already exists.')).mockResolvedValue([{ ...savedTemplate, name: 'New weekend' }]);
  const view = render(<TerminalReceiptSettingsScreen {...props} />);
  await waitFor(() => expect(view.getByLabelText('Save as receipt template').props.accessibilityState.disabled).toBe(false));
  fireEvent.changeText(view.getByLabelText('Receipt footer'), 'Keep this draft');
  fireEvent.press(view.getByLabelText('Save as receipt template'));
  fireEvent.changeText(view.getByLabelText('Receipt template name'), 'Weekend');
  fireEvent.press(view.getByLabelText('Save receipt template'));
  await waitFor(() => expect(view.getByText('A template with this name already exists.')).toBeTruthy());
  expect(view.getByLabelText('Receipt template name').props.value).toBe('Weekend');
  expect(view.getByLabelText('Receipt template name').props.editable).toBe(true);
  fireEvent.changeText(view.getByLabelText('Receipt template name'), 'New weekend');
  fireEvent(view.getByLabelText('Receipt template name'), 'submitEditing');
  expect(Templates.createTerminalReceiptTemplate).toHaveBeenCalledTimes(2);
  await waitFor(() => expect(namingModal(view).props.visible).toBe(false));
  expect(view.getByLabelText('Receipt footer').props.value).toBe('Keep this draft');
  expect(saveTerminalReceiptBranding).not.toHaveBeenCalled();
});

it('keeps a receipt draft on upgrade cancellation and leaves basic Save free', async () => {
  mockPro.status = 'free';
  const view = render(<TerminalReceiptSettingsScreen {...props} />);
  await waitFor(() => expect(view.getByDisplayValue('Corner café')).toBeTruthy());
  fireEvent.changeText(view.getByLabelText('Receipt business name'), 'Unsaved café');
  fireEvent.press(view.getByLabelText('Choose receipt logo'));
  expect(view.getByText('Terminal Pro')).toBeTruthy();
  expect(DocumentPicker.getDocumentAsync).not.toHaveBeenCalled();
  fireEvent.press(view.getByLabelText('Close Terminal Pro'));
  expect(view.getByDisplayValue('Unsaved café')).toBeTruthy();
  await act(async () => fireEvent.press(view.getByLabelText('Save receipt settings')));
  expect(saveTerminalReceiptBranding).toHaveBeenCalledWith('wallet-a', 'mainnet', expect.objectContaining({ name: 'Unsaved café' }), expect.any(Function));
});

it('keeps same-wallet receipt edits and template selection after temporary focus loss', async () => {
  (Templates.loadTerminalReceiptTemplates as jest.Mock).mockResolvedValue([savedTemplate]);
  const view = render(<TerminalReceiptSettingsScreen {...props} />);
  await waitFor(() => expect(view.getByDisplayValue('Corner café')).toBeTruthy());
  fireEvent.press(view.getByLabelText('Load receipt template'));
  fireEvent.press(view.getByLabelText('Load template Weekend'));
  fireEvent.changeText(view.getByLabelText('Receipt business name'), 'Unsaved name');
  fireEvent.changeText(view.getByLabelText('Receipt footer'), 'Unsaved footer');
  fireEvent.press(view.getByLabelText('Save as receipt template'));
  expect(namingModal(view).props.visible).toBe(true);
  mockFocused = false;
  view.rerender(<TerminalReceiptSettingsScreen {...props} />);
  expect(namingModal(view).props.visible).toBe(false);
  mockFocused = true;
  view.rerender(<TerminalReceiptSettingsScreen {...props} />);
  expect(view.getByLabelText('Receipt business name').props.value).toBe('Unsaved name');
  expect(view.getByLabelText('Receipt footer').props.value).toBe('Unsaved footer');
  expect(view.getByLabelText('Replace receipt template Weekend')).toBeTruthy();
  expect(loadTerminalReceiptBranding).toHaveBeenCalledTimes(1);
  expect(Templates.loadTerminalReceiptTemplates).toHaveBeenCalledTimes(1);
});

it('hides the template library for free users while keeping the save entry and basic receipt editing', async () => {
  mockPro.status = 'free';
  (Templates.loadTerminalReceiptTemplates as jest.Mock).mockResolvedValue([savedTemplate]);
  const view = render(<TerminalReceiptSettingsScreen {...props} />);
  await waitFor(() => expect(view.getByDisplayValue('Corner café')).toBeTruthy());
  expect(view.getAllByText('Pro')).toHaveLength(2);
  expect(view.queryByLabelText('Load receipt template')).toBeNull();
  expect(view.queryByLabelText('Load template Weekend')).toBeNull();
  expect(view.getByLabelText('Receipt business name').props.editable).toBe(true);
  expect(view.getByLabelText('Choose receipt logo')).toBeTruthy();
  expect(view.getByLabelText('Save as receipt template')).toBeTruthy();
});

it('shows no Pro badges for a subscriber and exposes saved templates', async () => {
  (Templates.loadTerminalReceiptTemplates as jest.Mock).mockResolvedValue([savedTemplate]);
  const view = render(<TerminalReceiptSettingsScreen {...props} />);
  await waitFor(() => expect(view.getByDisplayValue('Corner café')).toBeTruthy());
  expect(view.queryByText('Pro')).toBeNull();
  fireEvent.press(view.getByLabelText('Load receipt template'));
  expect(view.getByLabelText('Load template Weekend')).toBeTruthy();
});

it('keeps Save as template usable as the free upgrade entry when saved templates are full', async () => {
  mockPro.status = 'free';
  (Templates.loadTerminalReceiptTemplates as jest.Mock).mockResolvedValue(Array.from({ length: 5 }, (_, index) => ({ ...savedTemplate, id: String(index), name: `Saved ${index}` })));
  const view = render(<TerminalReceiptSettingsScreen {...props} />);
  await waitFor(() => expect(view.getByDisplayValue('Corner café')).toBeTruthy());
  expect(view.queryByLabelText('Load receipt template')).toBeNull();
  expect(view.getByLabelText('Save as receipt template').props.accessibilityState.disabled).toBe(false);
  fireEvent.press(view.getByLabelText('Save as receipt template'));
  expect(view.getByText('Terminal Pro')).toBeTruthy();
});
