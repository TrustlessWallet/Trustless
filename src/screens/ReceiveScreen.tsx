import React, { useState, useEffect, useMemo, useRef } from 'react';
import { View, StyleSheet, TouchableOpacity, Share, Alert, Clipboard, ActivityIndicator, ScrollView, Linking, KeyboardAvoidingView, Platform, Pressable } from 'react-native';
import { Text } from '../components/StyledText';
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

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'Receive'>;
type ReceiveScreenRouteProp = RouteProp<RootStackParamList, 'Receive'>;

const QR_SIZE = 220;
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
    isLightningInitialized
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

  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity onPress={() => navigation.goBack()} style={{ padding: 4 }}>
          <Feather name="x" size={24} color={theme.colors.primary} />
        </TouchableOpacity>
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
    if (mode === 'lightning' && isLightningInitialized && !lightningInvoice) {
      getLightningInvoice(0)
        .then(setLightningInvoice)
        .catch(err => {
            console.error("Failed to fetch initial BOLT11 invoice", err);
            setLightningInvoice('lnbc1...'); 
        });
    }
  }, [mode, isLightningInitialized, lightningInvoice, getLightningInvoice]);

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
        path: `${path_prefix}/0/${activeWallet?.receiveAddressIndex || 0}`
      };
    }
    const item = displayable_addresses[address_offset % displayable_addresses.length];
    return {
      address: item.address,
      index: item.index,
      path: `${path_prefix}/0/${item.index}`
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

  const used_addresses = useMemo(() => {
    if (!activeWallet) return [];
    const change_address_set = new Set(activeWallet.derivedChangeAddresses.map(a => a.address));
    return activeWallet.derivedAddressInfoCache
      .filter(item => {
        if (item.tx_count === 0) return false;
        if (change_address_set.has(item.address)) return false;
        return true;
      })
      .sort((a, b) => a.index - b.index);
  }, [activeWallet]);

  const loading_info = wallet_loading || !activeWallet;
  const currentLnString = lightningInvoice;

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
    if (!currentLnString) return null;
    return (
      <QRCode
        value={currentLnString}
        size={QR_SIZE}
        backgroundColor={theme.colors.background}
        color={theme.colors.primary}
      />
    );
  }, [currentLnString, theme.colors.background, theme.colors.primary]);

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
      <ScrollView
        ref={scroll_ref}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={true}
      >
        {mode === 'onchain' ? (
          <>
            <View style={styles.qrContainer}>
              <Text style={styles.derivationPathDisplay}>{current_display_data.path}</Text>
              <Pressable 
                style={({pressed}) => [styles.qrCodeWrapper, { opacity: pressed ? 0.8 : 1 }]} 
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
              <AddressText
                style={styles.addressText}
                selectable
                address={current_display_data.address}
                groupSize={6}
                padLastLine
              />

              {IS_TESTNET && (
                <View style={styles.warningBanner}>
                  <Feather name="alert-triangle" size={14} color={theme.colors.muted} />
                  <Text style={styles.warningText}>Send only testnet coins.</Text>
                </View>
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
              <Text style={styles.emptyText}>No used receive addresses yet.</Text>
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
                      <Text style={styles.addressShortText}>{formatBitcoinAddressShort(item.address)}</Text>
                      <Text style={styles.derivationPath}>{path_prefix}/0/{item.index}</Text>
                    </View>
                    <View style={styles.balanceContainer}>
                      <Text style={styles.balanceText}>
                        {hideBalance ? '*******' : (
                          <>{format_btc(balance)} <Text style={styles.orangeSymbol}>₿</Text></>
                        )}
                      </Text>
                      <TouchableOpacity onPress={() => handle_open_explorer(item.address)}>
                        <Feather name="external-link" size={20} color={theme.colors.primary} />
                      </TouchableOpacity>
                    </View>
                  </TouchableOpacity>
                );
              })
            )}
          </>
        ) : (
          <View style={styles.lnContainer}>
            {!isLightningInitialized ? (
              <View style={styles.lnError}>
                <Feather name="alert-circle" size={48} color={theme.colors.error} style={{ marginBottom: 16 }} />
                <Text style={styles.lnErrorText}>Lightning node is not initialized.</Text>
              </View>
            ) : (
              <>
                <View style={styles.qrContainer}>
                  <Text style={styles.derivationPathDisplay}>Lightning Invoice</Text>
                  <Pressable 
                    style={({pressed}) => [styles.qrCodeWrapper, { opacity: pressed ? 0.8 : 1 }]} 
                    onPress={() => copy_to_clipboard(currentLnString)} 
                  >
                    {copied && (
                      <View style={styles.copiedOverlay} pointerEvents="none">
                        <Feather name="copy" size={32} color={theme.colors.primary} />
                        <Text style={styles.copiedText}>Copied!</Text>
                      </View>
                    )}
                    {currentLnString ? memoizedLightningQR : (
                      <View style={{ height: QR_SIZE, width: QR_SIZE, justifyContent: 'center', alignItems: 'center' }}>
                          <ActivityIndicator size="large" color={theme.colors.primary} />
                      </View>
                    )}
                  </Pressable>
                </View>

                <View style={styles.actionsContainer}>
                  <TouchableOpacity style={styles.actionButton} onPress={() => copy_to_clipboard(currentLnString)}>
                    <Feather name="copy" size={24} color={theme.colors.primary} />
                    <Text style={styles.actionButtonText}>Copy</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.actionButton} onPress={() => on_share(currentLnString)}>
                    <Feather name="share-2" size={24} color={theme.colors.primary} />
                    <Text style={styles.actionButtonText}>Share</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
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
    paddingTop: 24,
    paddingBottom: 8,
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
    marginBottom: 16,
  },
  addressText: {
    fontSize: 14,
    textAlign: 'center',
    color: theme.colors.primary,
    lineHeight: 24,
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
    gap: 24,
    width: '100%',
    paddingVertical: 1,
  },
  actionButton: {
    alignItems: 'center',
    padding: 12,
    minWidth: 80
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
    paddingBottom: 12,
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
    color: theme.colors.primary,
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
    marginTop: 12,
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
  }
});

export default ReceiveScreen;