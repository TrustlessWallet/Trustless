import React from 'react';
import { StyleSheet, View, TouchableOpacity, Linking, Platform, ActionSheetIOS } from 'react-native';
import { Text } from '../StyledText';
import { useTheme } from '../../contexts/ThemeContext';

export default function MerchantBottomSheet({ merchant, onClose }: any) {
  const { theme } = useTheme();

  const handleDirections = () => {
    const lat = merchant.lat;
    const lon = merchant.lon;
    const name = merchant.tags?.name || 'Bitcoin Merchant';

    const appleUrl = `http://maps.apple.com/?daddr=${lat},${lon}`;
    const googleUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`;

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ['Cancel', 'Apple Maps', 'Google Maps'],
          cancelButtonIndex: 0,
        },
        (buttonIndex) => {
          if (buttonIndex === 1) Linking.openURL(appleUrl);
          if (buttonIndex === 2) Linking.openURL(googleUrl);
        }
      );
    } else {
      const geoUrl = `geo:${lat},${lon}?q=${lat},${lon}(${encodeURIComponent(name)})`;
      Linking.openURL(geoUrl).catch(() => Linking.openURL(googleUrl));
    }
  };

  const addressString = [
    merchant.tags?.['addr:street'], 
    merchant.tags?.['addr:housenumber'], 
    merchant.tags?.['addr:city']
  ].filter(Boolean).join(' ');

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background, borderColor: theme.colors.border }]}>
      <View style={styles.headerRow}>
        <View style={styles.titleContainer}>
          <Text style={styles.title} numberOfLines={1}>
            {merchant.tags?.name || 'Bitcoin Merchant'}
          </Text>
          <Text style={[styles.subtitle, { color: theme.colors.primary }]} numberOfLines={1}>
            {merchant.tags?.amenity || merchant.tags?.category || 'Business'}
          </Text>
        </View>
        <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
          <Text style={{ color: theme.colors.primary, fontSize: 18, fontFamily: 'SpaceMono-Bold' }}>X</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.badges}>
        {merchant.tags?.['payment:lightning'] === 'yes' && (
          <View style={[styles.badge, { backgroundColor: theme.colors.primary }]}>
            <Text style={[styles.badgeText, { color: theme.colors.background }]}>Lightning</Text>
          </View>
        )}
        {merchant.tags?.['payment:onchain'] === 'yes' && (
          <View style={[styles.badge, { backgroundColor: theme.colors.primary }]}>
            <Text style={[styles.badgeText, { color: theme.colors.background }]}>On-chain</Text>
          </View>
        )}
        {merchant.tags?.['payment:lightning_contactless'] === 'yes' && (
          <View style={[styles.badge, { backgroundColor: theme.colors.primary }]}>
            <Text style={[styles.badgeText, { color: theme.colors.background }]}>NFC</Text>
          </View>
        )}
      </View>

      <Text style={[styles.address, { color: theme.colors.primary }]}>
        {addressString || 'Address not provided'}
      </Text>

      <TouchableOpacity 
        style={[styles.directionsBtn, { backgroundColor: theme.colors.primary }]} 
        onPress={handleDirections}
        activeOpacity={0.8}
      >
        <Text style={[styles.directionsText, { color: theme.colors.background }]}>Directions</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 20,
    borderTopWidth: 1,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingBottom: Platform.OS === 'ios' ? 40 : 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 20,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  titleContainer: {
    flex: 1,
    paddingRight: 16,
  },
  title: {
    fontSize: 20,
    fontFamily: 'SpaceMono-Bold',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    opacity: 0.7,
    textTransform: 'capitalize',
  },
  closeBtn: {
    padding: 4,
  },
  badges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 16,
    gap: 8,
  },
  badge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  badgeText: {
    fontSize: 12,
    fontFamily: 'SpaceMono-Bold',
  },
  address: {
    fontSize: 14,
    fontFamily: 'SpaceMono-Regular',
    marginBottom: 24,
    opacity: 0.8,
  },
  directionsBtn: {
    paddingVertical: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  directionsText: {
    fontSize: 16,
    fontFamily: 'SpaceMono-Bold',
  },
});