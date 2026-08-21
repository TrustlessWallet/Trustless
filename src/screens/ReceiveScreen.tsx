import React, { useState, useEffect, useMemo, useRef } from 'react';
import { View, StyleSheet, TouchableOpacity, Share, Alert, Clipboard, ActivityIndicator, Linking, KeyboardAvoidingView, Platform, Pressable, Modal, ScrollView, TextInput } from 'react-native';
import { Text } from '../components/StyledText';
import { StyledInput } from '../components/StyledInput';
import QRCode from 'react-native-qrcode-svg';
import { useWallet } from '../contexts/WalletContext';
import { Feather } from '@expo/vector-icons';
import { useNavigation, useIsFocused, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { useTheme } from '../contexts/ThemeContext';
import { Theme } from '../constants/theme';
import { EXPLORER_UI_URL, COIN_TYPE, IS_TESTNET } from '../constants/network';
import { formatBitcoinAddressShort } from '../constants/format';
import { AddressText } from '../components/AddressText';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { GlassView } from '../components/GlassView';

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'Receive'>;
type ReceiveScreenRouteProp = RouteProp<RootStackParamList, 'Receive'>;

const QR_SIZE = 240;
const UNUSED_BUFFER_SIZE = 20;
const HIDE_WALLET_BALANCE_KEY = '@hideWalletBalance';

const format_btc = (sats: number) => (sats / 100000000).toFixed(8);

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
    registerLightningAddress
  } = useWallet();

  const { theme, isDark } = useTheme();
  const styles = useMemo(() => getStyles(theme, isDark), [theme, isDark]);

  const mode = route.params?.mode || 'onchain';

  const [copied, set_copied] = useState(false);
  const [address_offset, set_address_offset] = useState(0);
  const [hideBalance, setHideBalance] = useState(false);
  const scroll_ref = useRef<ScrollView>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const [lightningInvoice, setLightningInvoice] = useState<string>('');
  const [isGeneratingLightning, setIsGeneratingLightning] = useState(false);

  const [isAmountModalVisible, setIsAmountModalVisible] = useState(false);
  const [modalAmountStr, setModalAmountStr] = useState('');
  const [appliedAmountSats, setAppliedAmountSats] = useState<number>(0);

  const [isEditingLabel, setIsEditingLabel] = useState(false);
  const [labelInput, setLabelInput] = useState('');

  const [isAddressModalVisible, setIsAddressModalVisible] = useState(false);
  const [addressUsername, setAddressUsername] = useState('');
  const [isRegisteringAddress, setIsRegisteringAddress] = useState(false);

  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable onPress={() => navigation.goBack()}>
          <GlassView
            width={32}
            height={32}
            borderRadius={16}
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
    setAppliedAmountSats(0);
    setModalAmountStr('');
    if (mode === 'lightning' && defaultLightningInvoice) {
      setLightningInvoice(defaultLightningInvoice);
      setIsGeneratingLightning(false);
    } else {
      setLightningInvoice('');
    }
  }, [mode, defaultLightningInvoice]);

  useEffect(() => {
    if (mode === 'lightning' && isLightningInitialized) {
      if (appliedAmountSats === 0 && defaultLightningInvoice) {
        setLightningInvoice(defaultLightningInvoice);
        setIsGeneratingLightning(false);
      } else if (!lightningInvoice && !isGeneratingLightning) {
        setIsGeneratingLightning(true);
        getLightningInvoice(appliedAmountSats)
          .then(setLightningInvoice)
          .catch(err => {
            console.error("Failed to fetch initial BOLT11 invoice", err);
            setLightningInvoice('lnbc1...');
          })
          .finally(() => setIsGeneratingLightning(false));
      }
    }
  }, [mode, isLightningInitialized, lightningInvoice, getLightningInvoice, appliedAmountSats, defaultLightningInvoice]);

  const path_prefix = useMemo(() => {
    if (activeWallet?.scriptType === 'p2sh-p2wpkh') {
      return `m/49'/${COIN_TYPE}/0'`;
    }
    return `m/84'/${COIN_TYPE}/0'`;
  }, [activeWallet?.scriptType]);

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
    if (wallet_loading || !activeWallet) return;
    if (all_unused_addresses.length < UNUSED_BUFFER_SIZE) {
      const last_derived = activeWallet.derivedReceiveAddresses[activeWallet.derivedReceiveAddresses.length - 1];
      if (last_derived) {
        getOrCreateNextUnusedReceiveAddress(last_derived.address, last_derived.index)
          .catch(err => console.error("Failed to generate buffer address:", err));
      }
    }
  }, [all_unused_addresses.length, activeWallet, wallet_loading, getOrCreateNextUnusedReceiveAddress]);

  const displayable_addresses = useMemo(() => {
    return all_unused_addresses.slice(0, UNUSED_BUFFER_SIZE);
  }, [all_unused_addresses]);

  const current_display_data = useMemo(() => {
    if (!activeWallet || displayable_addresses.length === 0) {
      return {
        address: activeWallet?.address || '',
        index: activeWallet?.receiveAddressIndex || 0,
        path: `${path_prefix}/0/${activeWallet?.receiveAddressIndex || 0}`,
        label: undefined
      };
    }
    const item = displayable_addresses[address_offset % displayable_addresses.length];
    return {
      address: item.address,
      index: item.index,
      path: `${path_prefix}/0/${item.index}`,
      label: item.label
    };
  }, [activeWallet, displayable_addresses, address_offset, path_prefix]);

  const copy_to_clipboard = (text: string) => {
    if (text) {
      Clipboard.setString(text);
      set_copied(true);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => set_copied(false), 1500);
    }
  };

  const on_share = async (text: string) => {
    if (text) {
      try {
        await Share.share({ message: text });
      } catch (error) {
        Alert.alert("Error", "Could not share the address.");
      }
    }
  };

  const handleOpenAmountModal = () => {
    setModalAmountStr(appliedAmountSats > 0 ? appliedAmountSats.toString() : '');
    setIsAmountModalVisible(true);
  };

  const handleSaveAmount = async () => {
    const cleanAmount = modalAmountStr.replace(',', '.');
    const amountNum = parseFloat(cleanAmount);

    if (!modalAmountStr || isNaN(amountNum) || amountNum <= 0) {
      setAppliedAmountSats(0);
      setIsAmountModalVisible(false);
      if (mode === 'lightning' && isLightningInitialized) {
        setLightningInvoice(defaultLightningInvoice);
        setIsGeneratingLightning(false);
      }
      return;
    }

    const sats = parseInt(cleanAmount, 10);
    setAppliedAmountSats(sats);
    setIsAmountModalVisible(false);

    if (mode === 'lightning' && isLightningInitialized) {
      setIsGeneratingLightning(true);
      try {
        const invoice = await getLightningInvoice(sats);
        setLightningInvoice(invoice);
      } catch (e) {
        Alert.alert("Error", "Failed to generate lightning invoice with this amount.");
      } finally {
        setIsGeneratingLightning(false);
      }
    }
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
    setLabelInput(current_display_data.label || defaultAddressName);
    setIsEditingLabel(true);
  };

  const saveLabel = async () => {
    if (updateAddressLabel && current_display_data.address) {
      const cleanLabel = labelInput.trim();
      const finalLabel = cleanLabel === defaultAddressName || cleanLabel === '' ? '' : cleanLabel;
      await updateAddressLabel(current_display_data.address, finalLabel);
    }
    setIsEditingLabel(false);
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

  const loading_info = wallet_loading || !activeWallet;

  const currentLnString = (appliedAmountSats === 0 && lightningAddress) ? lightningAddress : lightningInvoice;
  const qrEncodeString = (appliedAmountSats === 0 && lightningAddress) ? `lightning:${lightningAddress}` : lightningInvoice;

  const rawAmountNum = parseFloat(modalAmountStr.replace(',', '.'));
  const isAmountValid = !isNaN(rawAmountNum) && rawAmountNum > 0;
  const isAddressValid = addressUsername.trim().length > 0 && (!lightningAddress || addressUsername.trim().toLowerCase() !== lightningAddress.split('@')[0]);

  const memoizedOnchainQR = useMemo(() => {
    if (!current_display_data?.address) return null;
    return (
      <QRCode
        value={current_display_data.address}
        size={QR_SIZE}
        backgroundColor={theme.colors.background}
        color={theme.colors.primary}
      />
    );
  }, [current_display_data?.address, theme.colors.background, theme.colors.primary]);

  const memoizedLightningQR = useMemo(() => {
    if (!qrEncodeString) return null;
    return (
      <QRCode
        value={qrEncodeString}
        size={QR_SIZE}
        backgroundColor={theme.colors.background}
        color={theme.colors.primary}
      />
    );
  }, [qrEncodeString, theme.colors.background, theme.colors.primary]);

  if (loading_info) {
    return (
      <View style={styles.centeredContainer}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={{ flex: 1, backgroundColor: theme.colors.background }}
    >
      <Modal visible={isAmountModalVisible} transparent animationType="fade">
        <Pressable style={styles.modalOverlay} onPress={() => setIsAmountModalVisible(false)}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.keyboardAvoidingView}
          >
            <Pressable style={styles.modalContent} onPress={(e) => e.stopPropagation()}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Set request amount</Text>
                <Pressable onPress={() => setIsAmountModalVisible(false)}>
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
                placeholder="0"
                value={modalAmountStr}
                onChangeText={setModalAmountStr}
                keyboardType="numeric"
                autoFocus
                rightElement={
                  <Text style={styles.currencyLabel}>sats</Text>
                }
              />

              <TouchableOpacity
                style={[styles.modalButtonPrimary, !isAmountValid && styles.modalButtonDisabled]}
                onPress={handleSaveAmount}
                disabled={!isAmountValid}
              >
                <Text style={styles.modalButtonTextPrimary}>Save amount</Text>
              </TouchableOpacity>
            </Pressable>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>

      <Modal visible={isAddressModalVisible} transparent animationType="fade">
        <Pressable style={styles.modalOverlay} onPress={() => !isRegisteringAddress && setIsAddressModalVisible(false)}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.keyboardAvoidingView}
          >
            <Pressable style={styles.modalContent} onPress={(e) => e.stopPropagation()}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>
                  {lightningAddress ? 'Change lightning address' : 'Claim lightning address'}
                </Text>
                <Pressable
                  onPress={() => !isRegisteringAddress && setIsAddressModalVisible(false)}
                  disabled={isRegisteringAddress}
                >
                  <GlassView
                    width={32}
                    height={32}
                    borderRadius={16}
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
                  <ActivityIndicator color={theme.colors.inversePrimary} />
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

      <ScrollView
        ref={scroll_ref}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={true}
        bounces={false}
      >
        {mode === 'onchain' ? (
          <>
            <View style={styles.qrContainer}>
              <Text style={styles.derivationPathDisplay}>{current_display_data.path}</Text>

              <Pressable
                style={({ pressed }) => [styles.qrCodeWrapper, { opacity: pressed ? 0.8 : 1 }]}
                onPress={() => copy_to_clipboard(current_display_data.address)}
              >
                {copied && (
                  <View style={styles.copiedOverlay} pointerEvents="none">
                    <Feather name="copy" size={32} color={theme.colors.primary} />
                    <Text style={styles.copiedText}>Copied!</Text>
                  </View>
                )}
                {current_display_data.address ? memoizedOnchainQR : null}
              </Pressable>

              {IS_TESTNET && (
                <View style={styles.warningBanner}>
                  <Feather name="alert-triangle" size={14} color={theme.colors.muted} />
                  <Text style={styles.warningText}>Send only testnet coins.</Text>
                </View>
              )}

              <AddressText
                style={styles.addressText}
                selectable
                address={current_display_data.address}
                groupSize={6}
                padLastLine
              />

              {isEditingLabel ? (
                <View style={styles.addressLabelPill}>
                  <TextInput
                    style={styles.addressLabelInput}
                    value={labelInput}
                    onChangeText={setLabelInput}
                    onBlur={saveLabel}
                    onSubmitEditing={saveLabel}
                    autoFocus
                    returnKeyType="done"
                    selectTextOnFocus
                    keyboardAppearance={isDark ? 'dark' : 'light'}
                    placeholderTextColor={theme.colors.muted}
                  />
                </View>
              ) : (
                <TouchableOpacity style={styles.addressLabelPill} onPress={startEditingLabel}>
                  <Text style={styles.addressLabelText}>{current_display_data.label || defaultAddressName}</Text>
                  <Feather name="edit" size={14} color={theme.colors.primary} />
                </TouchableOpacity>
              )}
            </View>

            <View style={styles.actionsContainer}>
              <TouchableOpacity style={styles.actionButton} onPress={() => copy_to_clipboard(current_display_data.address)}>
                <Feather name="copy" size={24} color={theme.colors.primary} />
                <Text style={styles.actionButtonText}>Copy</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionButton, loading_info && styles.actionButtonDisabled]}
                onPress={handle_next_address}
                disabled={loading_info}
              >
                <Feather name="refresh-cw" size={24} color={theme.colors.primary} />
                <Text style={styles.actionButtonText}>New address</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.actionButton} onPress={() => on_share(current_display_data.address)}>
                <Feather name="share-2" size={24} color={theme.colors.primary} />
                <Text style={styles.actionButtonText}>Share</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.listHeaderContainer}>
              <Text style={styles.listHeader}>Used addresses</Text>
              {wallet_loading && <ActivityIndicator color={theme.colors.primary} />}
            </View>

            {used_addresses.length === 0 ? (
              <Text style={styles.emptyText}>No used receive addresses yet</Text>
            ) : (
              used_addresses.map((item) => {
                const balance = item.balance;
                return (
                  <TouchableOpacity
                    key={item.index.toString()}
                    style={styles.row}
                    onPress={() => handle_view_details(item.address)}
                  >
                    <View style={styles.addressContainer}>
                      <Text style={styles.addressLabelListText}>{item.label || `Address ${item.index}`}</Text>
                      <Text style={styles.addressShortText}>{formatBitcoinAddressShort(item.address)}</Text>
                      <Text style={styles.derivationPath}>{path_prefix}/0/{item.index}</Text>
                    </View>
                    <View style={styles.balanceContainer}>
                      <Text style={styles.balanceText}>
                        {hideBalance ? '*******' : (
                          <>{format_btc(balance)} <Text style={styles.orangeSymbol}> </Text></>
                        )}
                      </Text>
                      <TouchableOpacity onPress={() => handle_open_explorer(item.address)}>
                        <Feather name="external-link" size={18} color={theme.colors.primary} />
                      </TouchableOpacity>
                    </View>
                  </TouchableOpacity>
                );
              })
            )}
          </>
        ) : (
          <View style={styles.lnContainer}>
            <View style={styles.lnContainer}>
              {!isLightningInitialized ? (
                <View style={styles.lnError}>
                  <Feather name="alert-circle" size={48} color={theme.colors.error} style={{ marginBottom: 16 }} />
                  <Text style={styles.lnErrorText}>Lightning node is not initialized.</Text>
                </View>
              ) : (
                <>
                  <View style={styles.qrContainer}>
                    <Text style={styles.derivationPathDisplay}>
                      {appliedAmountSats === 0 ? (lightningAddress ? 'Lightning address' : 'BOLT11 invoice') : 'BOLT11 invoice'}
                    </Text>

                    <Pressable
                      style={({ pressed }) => [styles.qrCodeWrapper, { opacity: pressed ? 0.8 : 1 }]}
                      onPress={() => !isGeneratingLightning && copy_to_clipboard(currentLnString)}
                      disabled={isGeneratingLightning}
                    >
                      {copied && (
                        <View style={styles.copiedOverlay} pointerEvents="none">
                          <Feather name="copy" size={32} color={theme.colors.primary} />
                          <Text style={styles.copiedText}>Copied!</Text>
                        </View>
                      )}
                      {isGeneratingLightning ? (
                        <View style={{ height: QR_SIZE, width: QR_SIZE, justifyContent: 'center', alignItems: 'center' }}>
                          <ActivityIndicator size="large" color={theme.colors.primary} />
                          <Text style={{ color: theme.colors.muted, marginTop: 12 }}>Generating...</Text>
                        </View>
                      ) : currentLnString ? memoizedLightningQR : null}
                    </Pressable>

                    {appliedAmountSats === 0 && !isGeneratingLightning ? (
                      <Pressable
                        style={{
                          marginTop: 16,
                          shadowColor: theme.colors.primary,
                          shadowOffset: { width: 0, height: 2 },
                          shadowOpacity: isDark ? 0.15 : 0.1,
                          shadowRadius: 4,
                          elevation: 3,
                          overflow: 'visible',
                        }}
                        onPress={() => {
                          if (lightningAddress) {
                            setAddressUsername(lightningAddress.split('@')[0]);
                          } else {
                            setAddressUsername('');
                          }
                          setIsAddressModalVisible(true);
                        }}
                      >
                        <GlassView
                          width={272}
                          height={40}
                          shape="capsule"
                          interactive={true}
                          style={{ overflow: 'visible' }}
                        >
                          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 16, height: '100%' }}>
                            <Text style={{ fontSize: 14, fontWeight: 'bold', color: theme.colors.primary }} numberOfLines={1} ellipsizeMode="middle">
                              {lightningAddress ? lightningAddress : 'Claim lightning address'}
                            </Text>
                            <Feather name="edit" size={14} color={theme.colors.primary} />
                          </View>
                        </GlassView>
                      </Pressable>
                    ) : null}

                    {appliedAmountSats > 0 && !isGeneratingLightning && (
                      <Text style={styles.amountValue}>
                        {appliedAmountSats.toLocaleString()}
                        <Text style={styles.amountUnit}> sats</Text>
                      </Text>
                    )}
                  </View>

                  <View style={styles.actionsContainer}>
                    <TouchableOpacity
                      style={[styles.actionButton, isGeneratingLightning && styles.actionButtonDisabled]}
                      onPress={() => copy_to_clipboard(currentLnString)}
                      disabled={isGeneratingLightning}
                    >
                      <Feather name="copy" size={24} color={theme.colors.primary} />
                      <Text style={styles.actionButtonText}>Copy</Text>
                    </TouchableOpacity>

                    <TouchableOpacity style={styles.actionButton} onPress={handleOpenAmountModal}>
                      <Feather name="edit" size={24} color={theme.colors.primary} />
                      <Text style={styles.actionButtonText}>Set amount</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.actionButton, isGeneratingLightning && styles.actionButtonDisabled]}
                      onPress={() => on_share(currentLnString)}
                      disabled={isGeneratingLightning}
                    >
                      <Feather name="share-2" size={24} color={theme.colors.primary} />
                      <Text style={styles.actionButtonText}>Share</Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </View>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const getStyles = (theme: Theme, isDark: boolean) => StyleSheet.create({
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
    padding: 16,
    backgroundColor: theme.colors.background,
    borderRadius: 8,
    shadowColor: theme.colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: isDark ? 0.3 : 0.1,
    shadowRadius: 3,
    elevation: 3,
    borderWidth: 1,
    borderColor: theme.colors.border,
    marginBottom: 0,
  },
  addressLabelPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surface,
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 16,
    marginTop: 10,
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: 8,
  },
  addressLabelText: {
    color: theme.colors.primary,
    fontSize: 14,
    fontWeight: '600',
    fontFamily: 'SpaceMono-Regular',
  },
  addressLabelInput: {
    color: theme.colors.primary,
    fontSize: 14,
    fontWeight: '600',
    fontFamily: 'SpaceMono-Regular',
    minWidth: 100,
    textAlign: 'center',
    padding: 0,
    margin: 0,
  },
  addressLabelListText: {
    fontSize: 14,
    color: theme.colors.primary,
  },
  amountValue: {
    marginTop: 8,
    fontSize: 20,
    color: theme.colors.primary,
    textAlign: 'center',
  },
  amountUnit: {
    fontSize: 20,
    fontWeight: 'normal',
    color: theme.colors.primary,
  },
  amountBitcoin: {
    fontSize: 20,
    fontWeight: 'normal',
    color: theme.colors.bitcoin,
  },
  addressText: {
    fontSize: 14,
    textAlign: 'center',
    color: theme.colors.primary,
    lineHeight: 24,
    marginTop: 8,
    paddingHorizontal: 72,
  },
  derivationPathDisplay: {
    fontSize: 14,
    color: theme.colors.muted,
    marginBottom: 8
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
    paddingTop: 12,
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
  derivationPath: {
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
  emptyText: {
    textAlign: 'center',
    color: theme.colors.muted,
    alignSelf: 'center',
    marginTop: 32,
    padding: 20,
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
  lnContainer: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
  },
  lnError: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 60,
  },
  lnErrorText: {
    color: theme.colors.error,
    fontSize: 16,
    textAlign: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  keyboardAvoidingView: {
    width: '100%',
    alignItems: 'center',
  },
  modalContent: {
    width: '100%',
    backgroundColor: theme.colors.surface,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
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
    marginTop: 12,
    alignItems: 'center',
    justifyContent: 'center',
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