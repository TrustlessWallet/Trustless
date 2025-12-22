import React, { useState, useEffect, useMemo, useRef } from 'react';
import { View, StyleSheet, TouchableOpacity, Share, Alert, Clipboard, ActivityIndicator, ScrollView, Linking } from 'react-native';
import { Text } from '../components/StyledText';
import QRCode from 'react-native-qrcode-svg';
import { useWallet } from '../contexts/WalletContext';
import { Feather } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { useTheme } from '../contexts/ThemeContext';
import { Theme } from '../constants/theme';
import { EXPLORER_UI_URL, DERIVATION_PARENT_PATH } from '../constants/network';

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'Receive'>;

const QR_SIZE = 220;

const formatBtc = (sats: number) => (sats / 100000000).toFixed(8);

const formatAddressInChunks = (address: string | undefined) => {
  if (!address) return '';
  return address.match(/.{1,4}/g)?.join(' ') || '';
};

const formatAddressShort = (address: string) => {
  if (!address || address.length <= 8) return address;
  return `${address.substring(0, 4)}...${address.substring(address.length - 4)}`;
};

const ReceiveScreen = () => {
  const navigation = useNavigation<NavigationProp>();
  const { activeWallet, loading: walletLoading } = useWallet();
  const { theme, isDark } = useTheme(); 
  const styles = useMemo(() => getStyles(theme, isDark), [theme, isDark]); 
  const [copied, setCopied] = useState(false);
  const [addressOffset, setAddressOffset] = useState(0);
  const scrollRef = useRef<ScrollView>(null);

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

    setAddressOffset(0);
  }, [activeWallet?.id]);

  const unusedAddresses = useMemo(() => {
    if (!activeWallet) return [];
    
    const infoMap = new Map(activeWallet.derivedAddressInfoCache.map(i => [i.address, i.tx_count]));
    
    const unused = activeWallet.derivedReceiveAddresses.filter(addr => {
        const txCount = infoMap.get(addr.address) ?? 0;
        return txCount === 0;
    });


    return unused.sort((a, b) => a.index - b.index).slice(0, 20);
  }, [activeWallet]);

  const currentDisplayData = useMemo(() => {
    if (!activeWallet || unusedAddresses.length === 0) {

        return { 
            address: activeWallet?.address || '', 
            index: activeWallet?.receiveAddressIndex || 0, 
            path: `${DERIVATION_PARENT_PATH}/0/${activeWallet?.receiveAddressIndex || 0}` 
        };
    }
    
    const item = unusedAddresses[addressOffset % unusedAddresses.length];
    
    return {
        address: item.address,
        index: item.index,
        path: `${DERIVATION_PARENT_PATH}/0/${item.index}`
    };
  }, [activeWallet, unusedAddresses, addressOffset]);

  const copyToClipboard = () => {
    if (currentDisplayData.address) {
      Clipboard.setString(currentDisplayData.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  const onShare = async () => {
    if (currentDisplayData.address) {
      try {
        await Share.share({ message: currentDisplayData.address });
      } catch (error) {
        Alert.alert("Error", "Could not share the address.");
      }
    }
  };

  const handleViewDetails = (address: string) => {
    if (address) {
      navigation.navigate('AddressDetails', { address });
    }
  };

  const handleOpenExplorer = (address: string) => {
    const url = `${EXPLORER_UI_URL}/address/${address}`;
    Linking.openURL(url).catch(() => Alert.alert('Error', 'Could not open block explorer.'));
  };

  const handleNextAddress = () => {
    if (unusedAddresses.length > 0) {
        setAddressOffset(prev => (prev + 1) % unusedAddresses.length);
    }
  };

  const usedAddresses = useMemo(() => {
    if (!activeWallet) return [];
    const changeAddressSet = new Set(activeWallet.derivedChangeAddresses.map(a => a.address));
    return activeWallet.derivedAddressInfoCache
        .filter(item => {
            if (item.tx_count === 0) return false;
            if (changeAddressSet.has(item.address)) return false;
            return true;
        })
        .sort((a, b) => a.index - b.index); 
  }, [activeWallet]);

  const loadingInfo = walletLoading || !activeWallet;

  if (loadingInfo) {
    return (
        <View style={styles.centeredContainer}>
            <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
    );
  }

  return (
    <ScrollView 
      ref={scrollRef}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={true}
    >
      <View style={styles.qrContainer}>
        <Text style={styles.derivationPathDisplay}>{currentDisplayData.path}</Text>
        {copied && (
          <View style={styles.copiedOverlay}>
            <Feather name="copy" size={32} color={theme.colors.primary} />
            <Text style={styles.copiedText}>Copied!</Text>
          </View>
        )}
        <TouchableOpacity style={styles.qrCodeWrapper} onPress={copyToClipboard} activeOpacity={0.8}>
          <QRCode 
            value={currentDisplayData.address} 
            size={QR_SIZE} 
            backgroundColor={theme.colors.background} 
            color={theme.colors.primary} 
          />
        </TouchableOpacity>
        <Text style={styles.addressText} selectable>{formatAddressInChunks(currentDisplayData.address)}</Text>
      </View>

      <View style={styles.actionsContainer}>
        <TouchableOpacity style={styles.actionButton} onPress={copyToClipboard}>
          <Feather name="copy" size={24} color={theme.colors.primary} />
          <Text style={styles.actionButtonText}>Copy</Text>
        </TouchableOpacity>
        <TouchableOpacity 
          style={[styles.actionButton, loadingInfo && styles.actionButtonDisabled]} 
          onPress={handleNextAddress}
          disabled={loadingInfo}
        >
          <Feather name="refresh-cw" size={24} color={theme.colors.primary} />
          <Text style={styles.actionButtonText}>New Address</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionButton} onPress={onShare}>
          <Feather name="share-2" size={24} color={theme.colors.primary} />
          <Text style={styles.actionButtonText}>Share</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.listHeaderContainer}>
        <Text style={styles.listHeader}>Used Addresses</Text>
        {walletLoading && <ActivityIndicator color={theme.colors.primary} />}
      </View>

      {usedAddresses.length === 0 ? (
          <Text style={styles.emptyText}>No used receive addresses yet.</Text>
      ) : (
          usedAddresses.map((item) => {
            const balance = item.balance;
            return (
              <TouchableOpacity 
                key={item.index.toString()}
                style={styles.row}
                onPress={() => handleViewDetails(item.address)}
              >
                <View style={styles.addressContainer}>
                  <Text style={styles.addressShortText}>{formatAddressShort(item.address)}</Text>
                  <Text style={styles.derivationPath}>{DERIVATION_PARENT_PATH}/0/{item.index}</Text>
                </View>
                <View style={styles.balanceContainer}>
                  <Text style={styles.balanceText}>{formatBtc(balance)} <Text style={styles.orangeSymbol}>₿</Text></Text>
                  <TouchableOpacity onPress={() => handleOpenExplorer(item.address)}>
                    <Feather name="external-link" size={20} color={theme.colors.primary} />
                  </TouchableOpacity>
                </View>
              </TouchableOpacity>
            );
          })
      )}
    </ScrollView>
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
    paddingTop: 8, 
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
    fontFamily: 'monospace', 
    fontSize: 14,
    textAlign: 'center', 
    color: theme.colors.primary, 
    lineHeight: 24,
    paddingHorizontal: 72,
  },
  derivationPathDisplay: {
    fontFamily: 'monospace',
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
    backgroundColor: isDark ? 'rgba(0, 0, 0, 0.95)' : 'rgba(255, 255, 255, 0.95)', 
    justifyContent: 'center', 
    alignItems: 'center', 
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
    borderBottomWidth: 1,
    borderColor: theme.colors.border, 
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
    fontWeight: '600', 
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
  rowSelected: {
    backgroundColor: theme.colors.surface, 
  },
  addressContainer: { 
    flex: 3, 
    gap: 2 
  },
  addressShortText: {
    fontSize: 14,
    color: theme.colors.muted,
    fontFamily: 'monospace',
    fontWeight: '600'
  },
  derivationPath: {
    fontSize: 14,
    color: theme.colors.muted,
    fontFamily: 'monospace'
  },
  balanceContainer: {
    flex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 12,
  },
  balanceText: {
    fontFamily: 'monospace',
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
    padding: 20,
  }
});

export default ReceiveScreen;