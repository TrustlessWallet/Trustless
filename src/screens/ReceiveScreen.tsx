import React, { useState, useEffect, useMemo, useRef } from 'react';
import { View, StyleSheet, TouchableOpacity, Share, Alert, Clipboard, ActivityIndicator, Linking, KeyboardAvoidingView, Platform, Pressable, Modal, ScrollView, TextInput, Keyboard, useWindowDimensions } from 'react-native';
import { Text } from '../components/StyledText';
import SheetHeader from '../components/SheetHeader';
import { StyledInput } from '../components/StyledInput';
import QRCode from 'react-native-qrcode-svg';
import { useWallet } from '../contexts/WalletContext';
import { Feather } from '@expo/vector-icons';
import { useNavigation, useIsFocused, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { useTheme } from '../contexts/ThemeContext';
import { Theme } from '../constants/theme';
import { EXPLORER_UI_URL, IS_TESTNET, NETWORK_NAME } from '../constants/network';
import { formatBitcoinAddressShort } from '../constants/format';
import { AddressText } from '../components/AddressText';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { GlassView } from '../components/GlassView';

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'Receive'>;
type ReceiveScreenRouteProp = RouteProp<RootStackParamList, 'Receive'>;

const MAX_QR_SIZE = 256;
const SATS_PER_BTC = 100_000_000;
const MAX_REQUEST_SATS = 21_000_000 * SATS_PER_BTC;
const satsFormatter = new Intl.NumberFormat('en-US');
const UNUSED_BUFFER_SIZE = 20;
const HIDE_WALLET_BALANCE_KEY = '@hideWalletBalance';

const format_btc = (sats: number) => (sats / SATS_PER_BTC).toFixed(8);

const ReceiveScreen = () => {
  const route = useRoute<ReceiveScreenRouteProp>();
  const navigation = useNavigation<NavigationProp>();
  const isFocused = useIsFocused();
  const {
    activeWallet,
    loading: wallet_loading,
    getOrCreateNextUnusedReceiveAddress,
    getLightningInvoice,
    isLightningInitialized,
    defaultLightningInvoice,
    updateAddressLabel,
    lightningAddress,
    registerLightningAddress,
    retryLightning,
    lightningInitError,
  } = useWallet();

  const { theme, isDark } = useTheme();
  const styles = useMemo(() => getStyles(theme), [theme]);
  const { width } = useWindowDimensions();
  const qrSize = Math.min(MAX_QR_SIZE, Math.max(120, width - 80));

  const mode = route.params?.mode || 'onchain';

  const [copiedRequest, setCopiedRequest] = useState('');
  const [address_offset, set_address_offset] = useState(0);
  const [hideBalance, setHideBalance] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const [invoiceResult, setInvoiceResult] = useState<{ key: string; value?: string; error?: string } | null>(null);
  const [invoiceRetry, setInvoiceRetry] = useState(0);
  const invoiceRequestRef = useRef(0);
  const [isAmountModalVisible, setIsAmountModalVisible] = useState(false);
  const [modalAmountStr, setModalAmountStr] = useState('');
  const scope = `${NETWORK_NAME}:${activeWallet?.id ?? ''}:${mode}`;
  const [requestAmount, setRequestAmount] = useState({ scope, sats: 0 });
  const appliedAmountSats = requestAmount.scope === scope ? requestAmount.sats : 0;
  const invoiceKey = `${scope}:${appliedAmountSats}:${invoiceRetry}`;
  const useLightningAddress = appliedAmountSats === 0 && !!lightningAddress;

  const [isEditingLabel, setIsEditingLabel] = useState(false);
  const [labelInput, setLabelInput] = useState('');
  const labelTarget = useRef<{ address: string; scope: string; defaultName: string } | null>(null);

  const [isAddressModalVisible, setIsAddressModalVisible] = useState(false);
  const [addressUsername, setAddressUsername] = useState('');
  const [isRegisteringAddress, setIsRegisteringAddress] = useState(false);

  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable accessibilityRole="button" accessibilityLabel="Close receive" hitSlop={8} onPress={() => navigation.goBack()}>
          <GlassView
            width={32}
            height={32}
            shape="circle"
            interactive={true}
            style={{ overflow: 'visible' }}
          >
            <Feather name="x" size={20} color={theme.colors.primary} />
          </GlassView>
        </Pressable>
      ),
    });
  }, [navigation, theme.colors.primary]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  useEffect(() => {
    set_address_offset(0);
  }, [activeWallet?.id]);

  useEffect(() => {
    const loadPreference = async () => {
      const savedPref = await AsyncStorage.getItem(HIDE_WALLET_BALANCE_KEY);
      setHideBalance(savedPref === 'true');
    };
    if (isFocused) {
      loadPreference();
    }
  }, [isFocused]);

  useEffect(() => {
    setIsAmountModalVisible(false);
    setIsAddressModalVisible(false);
    setModalAmountStr('');
    setRequestAmount({ scope, sats: 0 });
    setInvoiceResult(null);
    setIsEditingLabel(false);
    labelTarget.current = null;
  }, [scope]);

  const cachedInvoice = appliedAmountSats === 0 ? defaultLightningInvoice : '';
  useEffect(() => {
    const request = ++invoiceRequestRef.current;
    if (mode !== 'lightning' || !isLightningInitialized || useLightningAddress || cachedInvoice) {
      setInvoiceResult(null);
      return;
    }
    let cancelled = false;

    getLightningInvoice(appliedAmountSats).then(value => {
      if (!value) throw new Error('Unable to create invoice.');
      if (!cancelled && request === invoiceRequestRef.current) setInvoiceResult({ key: invoiceKey, value });
    }).catch(error => {
      if (!cancelled && request === invoiceRequestRef.current) {
        setInvoiceResult({ key: invoiceKey, error: error instanceof Error ? error.message : 'Unable to create invoice.' });
      }
    });
    return () => { cancelled = true; };
  }, [mode, isLightningInitialized, useLightningAddress, cachedInvoice, getLightningInvoice, appliedAmountSats, invoiceKey]);

  const all_unused_addresses = useMemo(() => {
    if (!activeWallet) return [];
    const info_map = new Map(activeWallet.derivedAddressInfoCache.map(i => [i.address, i.tx_count]));
    return activeWallet.derivedReceiveAddresses
      .filter(addr => {
        const tx_count = info_map.get(addr.address) ?? 0;
        return tx_count === 0;
      })
      .sort((a, b) => a.index - b.index);
  }, [activeWallet]);

  useEffect(() => {
    if (mode !== 'onchain' || wallet_loading || !activeWallet) return;
    if (all_unused_addresses.length < UNUSED_BUFFER_SIZE) {
      const last_derived = activeWallet.derivedReceiveAddresses[activeWallet.derivedReceiveAddresses.length - 1];
      if (last_derived) {
        getOrCreateNextUnusedReceiveAddress(last_derived.address, last_derived.index)
          .catch(err => console.error("Failed to generate buffer address:", err));
      }
    }
  }, [mode, all_unused_addresses.length, activeWallet, wallet_loading, getOrCreateNextUnusedReceiveAddress]);

  const displayable_addresses = useMemo(() => {
    return all_unused_addresses.slice(0, UNUSED_BUFFER_SIZE);
  }, [all_unused_addresses]);

  const current_display_data = useMemo(() => {
    if (!activeWallet || displayable_addresses.length === 0) {
      return {
        address: activeWallet?.address || '',
        index: activeWallet?.receiveAddressIndex || 0,
        label: undefined
      };
    }
    const item = displayable_addresses[address_offset % displayable_addresses.length];
    return {
      address: item.address,
      index: item.index,
      label: item.label
    };
  }, [activeWallet, displayable_addresses, address_offset]);

  const copy_to_clipboard = (text: string) => {
    if (text) {
      Clipboard.setString(text);
      setCopiedRequest(text);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => setCopiedRequest(''), 1500);
    }
  };

  const on_share = async (text: string) => {
    if (text) {
      try {
        await Share.share({ message: text });
      } catch (error) {
        Alert.alert("Error", "Could not share the payment request.");
      }
    }
  };

  const handleOpenAmountModal = () => {
    setModalAmountStr(appliedAmountSats > 0 ? appliedAmountSats.toString() : '');
    setIsAmountModalVisible(true);
  };

  const amountDraft = modalAmountStr.trim();
  const draftSats = Number(amountDraft);
  const isAmountValid = (!amountDraft || /^\d+$/u.test(amountDraft))
    && Number.isSafeInteger(draftSats) && draftSats <= MAX_REQUEST_SATS;

  const closeAmountModal = () => {
    Keyboard.dismiss();
    setIsAmountModalVisible(false);
  };

  const handleSaveAmount = () => {
    if (!isAmountValid) return;
    if (draftSats !== appliedAmountSats) setInvoiceResult(null);
    setRequestAmount({ scope, sats: draftSats });
    closeAmountModal();
  };

  const handleRegisterAddress = async () => {
    const cleanUsername = addressUsername.trim().toLowerCase();
    if (!cleanUsername) return;

    setIsRegisteringAddress(true);
    try {
      await registerLightningAddress(cleanUsername);
      setIsAddressModalVisible(false);
    } catch (error: any) {
      let errorMsg = error.message || "Failed to register address.";
      if (errorMsg.toLowerCase().includes('networkerror') || errorMsg.toLowerCase().includes('conflict')) {
        errorMsg = "This username is already taken by someone else. Please choose a different one.";
      }
      Alert.alert("Not available", errorMsg);
    } finally {
      setIsRegisteringAddress(false);
    }
  };

  const handle_view_details = (address: string) => {
    if (address) {
      navigation.navigate('AddressDetails', { address });
    }
  };

  const handle_open_explorer = (address: string) => {
    const url = `${EXPLORER_UI_URL}/address/${address}`;
    Linking.openURL(url).catch(() => Alert.alert('Error', 'Could not open block explorer.'));
  };

  const handle_next_address = () => {
    if (displayable_addresses.length > 0) {
      set_address_offset(prev => (prev + 1) % displayable_addresses.length);
    }
  };

  const defaultAddressName = useMemo(() => {
    return `Address ${current_display_data.index}`;
  }, [current_display_data.index]);

  const startEditingLabel = () => {
    labelTarget.current = { address: current_display_data.address, scope, defaultName: defaultAddressName };
    setLabelInput(current_display_data.label || defaultAddressName);
    setIsEditingLabel(true);
  };

  const saveLabel = async () => {
    const target = labelTarget.current;
    labelTarget.current = null;
    setIsEditingLabel(false);
    if (!target || target.scope !== scope || !target.address || !updateAddressLabel) return;

    const cleanLabel = labelInput.trim();
    try {
      await updateAddressLabel(target.address, cleanLabel === target.defaultName ? '' : cleanLabel);
    } catch {
      Alert.alert('Address label', 'Could not save the label. Please try again.');
    }
  };

  const used_addresses = useMemo(() => {
    if (!activeWallet) return [];
    const change_address_set = new Set(activeWallet.derivedChangeAddresses.map(a => a.address));
    const derivedMap = new Map();
    activeWallet.derivedReceiveAddresses.forEach(a => derivedMap.set(a.address, a));

    return activeWallet.derivedAddressInfoCache
      .filter(item => {
        if (item.tx_count === 0) return false;
        if (change_address_set.has(item.address)) return false;
        return true;
      })
      .map(item => {
        const fullAddr = derivedMap.get(item.address);
        return {
          ...item,
          label: fullAddr?.label
        };
      })
      .sort((a, b) => a.index - b.index);
  }, [activeWallet]);

  const isOnchain = mode === 'onchain';
  const onchainAddress = current_display_data.address;
  const onchainRequest = appliedAmountSats && onchainAddress
    ? `bitcoin:${onchainAddress}?amount=${format_btc(appliedAmountSats)}` : onchainAddress;
  const resolvedInvoice = invoiceResult?.key === invoiceKey ? invoiceResult : null;
  const lightningRequest = isLightningInitialized
    ? useLightningAddress ? lightningAddress : cachedInvoice || resolvedInvoice?.value || ''
    : '';
  const payload = isOnchain ? onchainRequest : lightningRequest;
  const qrPayload = !isOnchain && useLightningAddress && payload ? `lightning:${payload}` : payload;
  const invoiceError = !isOnchain && !useLightningAddress && !cachedInvoice ? resolvedInvoice?.error : undefined;
  const isAddressValid = addressUsername.trim().length > 0 && (!lightningAddress || addressUsername.trim().toLowerCase() !== lightningAddress.split('@')[0]);
  const canSetAmount = isOnchain ? !!onchainAddress : isLightningInitialized;

  const qr = useMemo(() => qrPayload ? (
    <QRCode value={qrPayload} size={qrSize} backgroundColor="#FFFFFF" color="#000000" />
  ) : null, [qrPayload, qrSize]);

  if (!activeWallet) {
    return (
      <View style={styles.centeredContainer}>
        <ActivityIndicator color={theme.colors.bitcoin} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={{ flex: 1, backgroundColor: theme.colors.background }}
    >
      <Modal visible={isAmountModalVisible} transparent animationType="fade" onRequestClose={closeAmountModal}>
        <KeyboardAvoidingView style={styles.amountOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <Pressable style={StyleSheet.absoluteFill} onPress={closeAmountModal} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
          <View style={styles.amountSheet} accessibilityViewIsModal>
            <SheetHeader title="Request amount" trailing={
              <Pressable accessibilityRole="button" accessibilityLabel="Close amount editor" hitSlop={8} onPress={closeAmountModal}>
                <GlassView width={32} height={32} shape="circle" interactive style={{ overflow: 'visible' }}>
                  <Feather name="x" size={20} color={theme.colors.primary} />
                </GlassView>
              </Pressable>
            } />
            <View style={styles.amountSheetContent}>
              <StyledInput
                accessibilityLabel="Request amount in sats"
                placeholder="0"
                value={modalAmountStr}
                onChangeText={setModalAmountStr}
                keyboardType="number-pad"
                autoFocus
                rightElement={<Text style={styles.currencyLabel}>sats</Text>}
              />
              {!isAmountValid && <Text accessibilityRole="alert" style={styles.lnErrorText}>
                Enter a whole amount in sats up to 21 million BTC.
              </Text>}
              <TouchableOpacity accessibilityRole="button"
                style={[styles.modalButtonPrimary, !isAmountValid && styles.modalButtonDisabled]}
                onPress={handleSaveAmount} disabled={!isAmountValid}>
                <Text style={styles.modalButtonTextPrimary}>{appliedAmountSats > 0 && draftSats === 0 ? 'Clear amount' : 'Save amount'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={isAddressModalVisible} transparent animationType="fade" onRequestClose={() => !isRegisteringAddress && setIsAddressModalVisible(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => !isRegisteringAddress && setIsAddressModalVisible(false)}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.keyboardAvoidingView}
          >
            <Pressable style={styles.modalContent} onPress={(e) => e.stopPropagation()}>
              <View style={styles.modalHeader}>
                <View>
                  <Text style={styles.modalTitle}>
                    {lightningAddress ? 'Change lightning address' : 'Claim lightning address'}
                  </Text>
                </View>
                <Pressable
                  onPress={() => !isRegisteringAddress && setIsAddressModalVisible(false)}
                  disabled={isRegisteringAddress}
                >
                  <GlassView
                    width={32}
                    height={32}
                    shape="circle"
                    interactive={true}
                    style={{ overflow: 'visible' }}
                  >
                    <Feather name="x" size={20} color={theme.colors.primary} />
                  </GlassView>
                </Pressable>
              </View>

              <StyledInput
                placeholder="username"
                value={addressUsername}
                onChangeText={setAddressUsername}
                autoCapitalize="none"
                autoCorrect={false}
                autoFocus
                rightElement={
                  <Text style={styles.currencyLabel}>@pay.hd-apps.com</Text>
                }
              />

              <TouchableOpacity
                style={[styles.modalButtonPrimary, (isRegisteringAddress || !isAddressValid) && styles.modalButtonDisabled]}
                onPress={handleRegisterAddress}
                disabled={isRegisteringAddress || !isAddressValid}
              >
                {isRegisteringAddress ? (
                  <ActivityIndicator color={theme.colors.bitcoin} />
                ) : (
                  <Text style={styles.modalButtonTextPrimary}>
                    {lightningAddress ? 'Update address' : 'Claim address'}
                  </Text>
                )}
              </TouchableOpacity>
            </Pressable>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>

      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled" bounces={false}>
        <View style={styles.qrContainer}>
          {payload ? (
            <Pressable
              style={[styles.qrCodeWrapper, { width: qrSize + 32, height: qrSize + 32 }]}
              accessibilityRole="button"
              accessibilityLabel={appliedAmountSats > 0 ? 'Copy payment request' : isOnchain ? 'Copy Bitcoin address' : 'Copy Lightning payment details'}
              onPress={() => copy_to_clipboard(payload)}
            >
              {qr}
              {copiedRequest === payload && (
                <View style={styles.copiedOverlay} pointerEvents="none">
                  <Feather name="check" size={28} color={theme.colors.primary} />
                  <Text style={styles.copiedText}>Copied</Text>
                </View>
              )}
            </Pressable>
          ) : (
            <View style={[styles.qrCodeWrapper, styles.qrPlaceholder, { width: qrSize + 32, height: qrSize + 32 }]}>
              {invoiceError || (!isOnchain && lightningInitError)
                ? <View style={styles.requestError}>
                    <Text style={styles.lnErrorText} accessibilityLiveRegion="polite">{invoiceError || lightningInitError}</Text>
                    <TouchableOpacity accessibilityRole="button" style={styles.iconAction}
                      onPress={() => {
                        if (invoiceError) setInvoiceRetry(value => value + 1);
                        else void retryLightning().catch(error => Alert.alert('Lightning', error.message));
                      }}>
                      <Text style={styles.actionButtonText}>Retry</Text>
                    </TouchableOpacity>
                  </View>
                : <ActivityIndicator accessibilityLabel="Preparing payment request" color={theme.colors.bitcoin} />}
            </View>
          )}

          {IS_TESTNET && isOnchain && (
            <View style={styles.warningBanner}>
              <Feather name="alert-triangle" size={14} color={theme.colors.muted} />
              <Text style={styles.warningText}>Send only testnet coins.</Text>
            </View>
          )}

          {appliedAmountSats > 0 && (
            <Text style={styles.requestAmount}>{satsFormatter.format(appliedAmountSats)} <Text style={styles.requestUnit}>sats</Text></Text>
          )}
          {isOnchain && <AddressText style={styles.addressText} selectable address={onchainAddress} groupSize={6} padLastLine />}
        </View>

        <View style={styles.actionsContainer}>
          <TouchableOpacity accessibilityRole="button" style={[styles.actionButton, !payload && styles.actionButtonDisabled]}
            disabled={!payload} onPress={() => copy_to_clipboard(payload)}>
            <Feather name="copy" size={22} color={theme.colors.primary} />
            <Text style={styles.actionButtonText}>Copy</Text>
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" style={[styles.actionButton, !canSetAmount && styles.actionButtonDisabled]}
            disabled={!canSetAmount} onPress={handleOpenAmountModal}>
            <Feather name="edit" size={22} color={theme.colors.primary} />
            <Text style={styles.actionButtonText}>{appliedAmountSats > 0 ? 'Edit amount' : 'Set amount'}</Text>
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" style={[styles.actionButton, !payload && styles.actionButtonDisabled]}
            disabled={!payload} onPress={() => on_share(payload)}>
            <Feather name="share-2" size={22} color={theme.colors.primary} />
            <Text style={styles.actionButtonText}>Share</Text>
          </TouchableOpacity>
        </View>

        {isOnchain && !!onchainAddress && (
          <View style={styles.addressActions}>
            <View style={styles.addressActionsRow}>
              {isEditingLabel ? (
                <TextInput accessibilityLabel="Address label" style={styles.addressLabelInput} value={labelInput}
                  onChangeText={setLabelInput} onBlur={saveLabel} onSubmitEditing={saveLabel}
                  autoFocus returnKeyType="done" selectTextOnFocus keyboardAppearance={isDark ? 'dark' : 'light'} />
              ) : (
                <TouchableOpacity accessibilityRole="button" accessibilityLabel="Edit address label"
                  style={styles.labelAction} onPress={startEditingLabel}>
                  <Text style={styles.addressLabelListText} numberOfLines={1}>{current_display_data.label || defaultAddressName}</Text>
                  <Feather name="edit" size={15} color={theme.colors.muted} />
                </TouchableOpacity>
              )}
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Address details"
                style={styles.iconAction} onPress={() => handle_view_details(onchainAddress)}>
                <Feather name="info" size={19} color={theme.colors.primary} />
              </TouchableOpacity>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="New address"
                style={[styles.iconAction, styles.newAddress, displayable_addresses.length < 2 && styles.actionButtonDisabled]}
                disabled={isEditingLabel || displayable_addresses.length < 2} onPress={handle_next_address}>
                <Feather name="refresh-cw" size={16} color={theme.colors.primary} />
                <Text style={styles.addressLabelListText}>New address</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {!isOnchain && isLightningInitialized && (
          <TouchableOpacity accessibilityRole="button" accessibilityLabel={lightningAddress ? 'Edit Lightning address' : 'Claim Lightning address'}
            style={styles.lightningAddressRow} onPress={() => {
              setAddressUsername(lightningAddress ? lightningAddress.split('@')[0] : '');
              setIsAddressModalVisible(true);
            }}>
            <Text style={styles.addressLabelListText} numberOfLines={1} ellipsizeMode="middle">
              {lightningAddress || 'Claim Lightning address'}
            </Text>
            <Feather name="edit" size={15} color={theme.colors.muted} />
          </TouchableOpacity>
        )}

        {isOnchain && used_addresses.length > 0 && <>
          <View style={styles.listHeaderContainer}>
            <Text style={styles.listHeader}>Used addresses</Text>
            {wallet_loading && <ActivityIndicator color={theme.colors.bitcoin} />}
          </View>
          {used_addresses.map(item => (
            <View key={item.address} style={styles.row}>
              <TouchableOpacity accessibilityRole="button" style={styles.addressContainer} onPress={() => handle_view_details(item.address)}>
                <Text style={styles.addressLabelListText}>{item.label || `Address ${item.index}`}</Text>
                <Text style={styles.addressShortText}>{formatBitcoinAddressShort(item.address)}</Text>
              </TouchableOpacity>
              <View style={styles.balanceContainer}>
                <Text style={styles.balanceText}>
                  {hideBalance ? '*******' : <>{format_btc(item.balance)} <Text style={styles.orangeSymbol}>₿</Text></>}
                </Text>
                <TouchableOpacity accessibilityRole="button" accessibilityLabel="Open address in block explorer"
                  style={styles.iconAction} onPress={() => handle_open_explorer(item.address)}>
                  <Feather name="external-link" size={18} color={theme.colors.primary} />
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </>}
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const getStyles = (theme: Theme) => StyleSheet.create({
  centeredContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: theme.colors.background,
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: 32,
    backgroundColor: theme.colors.background,
  },
  qrContainer: {
    alignItems: 'center',
    paddingTop: 16,
    width: '100%',
    borderBottomWidth: 0,
    borderColor: theme.colors.border,
  },
  qrCodeWrapper: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  qrPlaceholder: { backgroundColor: theme.colors.surface },
  requestError: { gap: 8, padding: 16, alignItems: 'center' },
  requestAmount: { fontSize: 27, fontWeight: 'bold', color: theme.colors.primary, marginTop: 12 },
  requestUnit: { fontSize: 15, fontWeight: 'normal', color: theme.colors.muted },
  addressActions: { paddingHorizontal: 20, marginTop: 8 },
  addressActionsRow: {
    flexDirection: 'row', alignItems: 'center', gap: 4, borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border, paddingVertical: 4,
  },
  labelAction: { flex: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6 },
  iconAction: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  newAddress: { flexDirection: 'row', gap: 6 },
  lightningAddressRow: {
    minHeight: 44, alignSelf: 'center', maxWidth: '85%', paddingHorizontal: 12,
    flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  addressLabelInput: {
    color: theme.colors.primary,
    fontSize: 14,
    fontWeight: '600',
    fontFamily: 'SpaceMono-Regular',
    flex: 1,
    minHeight: 44,
    padding: 0,
    margin: 0,
  },
  addressLabelListText: {
    fontSize: 14,
    color: theme.colors.primary,
    flexShrink: 1,
  },
  addressText: {
    fontSize: 14,
    textAlign: 'center',
    color: theme.colors.primary,
    lineHeight: 24,
    marginTop: 8,
    paddingHorizontal: 24,
  },
  copiedOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: theme.colors.background + 'CC',
    borderRadius: 8,
    gap: 8,
    zIndex: 10,
  },
  copiedText: {
    fontSize: 20,
    fontWeight: 'bold',
    color: theme.colors.primary
  },
  actionsContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
    width: '100%',
    paddingVertical: 1,
    marginTop: 12,
  },
  actionButton: {
    alignItems: 'center',
    padding: 12,
    minWidth: 70
  },
  actionButtonDisabled: {
    opacity: 0.3,
  },
  actionButtonText: {
    color: theme.colors.primary,
    fontSize: 14,
    marginTop: 8
  },
  listHeaderContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingTop: 24,
  },
  listHeader: {
    fontSize: 16,
    fontWeight: 'bold',
    color: theme.colors.primary,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderColor: theme.colors.border,
  },
  addressContainer: {
    flex: 3,
    gap: 2
  },
  addressShortText: {
    fontSize: 14,
    color: theme.colors.muted,
  },
  balanceContainer: {
    flex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 12,
  },
  balanceText: {
    fontSize: 16,
    color: theme.colors.primary
  },
  orangeSymbol: {
    fontSize: 14,
    color: theme.colors.bitcoin,
  },
  warningBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: theme.colors.surface,
    paddingVertical: 8,
    paddingHorizontal: 16,
    marginHorizontal: 20,
    marginTop: 16,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  warningText: {
    fontSize: 12,
    color: theme.colors.muted,
    fontWeight: '400',
  },
  lnErrorText: {
    color: theme.colors.error,
    fontSize: 16,
    textAlign: 'center',
  },
  amountOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  amountSheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, overflow: 'hidden', backgroundColor: theme.colors.background },
  amountSheetContent: { gap: 4, paddingHorizontal: 24, paddingTop: 16, paddingBottom: 24 },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    overflow: 'hidden',
  },
  keyboardAvoidingView: {
    width: '100%',
    maxWidth: 420,
  },
  modalContent: {
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
    backgroundColor: theme.colors.surface,
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: theme.colors.border,
    overflow: 'hidden',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: theme.colors.primary,
  },
  modalButtonPrimary: {
    backgroundColor: theme.colors.primary,
    height: 52,
    borderRadius: 8,
    marginTop: 16,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  modalButtonDisabled: {
    opacity: 0.4,
  },
  modalButtonTextPrimary: {
    color: theme.colors.inversePrimary,
    fontSize: 16,
    fontWeight: '600',
  },
  currencyLabel: {
    fontSize: 16,
    color: theme.colors.primary,
    fontFamily: 'SpaceMono-Bold',
    marginRight: 16,
  },
});

export default ReceiveScreen;
