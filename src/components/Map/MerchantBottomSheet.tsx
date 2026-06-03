import React from 'react';
import { StyleSheet, View, TouchableOpacity, Linking, Platform, ActionSheetIOS, ScrollView } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Text } from '../StyledText';
import { useTheme } from '../../contexts/ThemeContext';
import { BtcMapElement } from '../../services/btcmap';

interface Props {
  merchant: BtcMapElement;
  onClose: () => void;
}

export default function MerchantBottomSheet({ merchant, onClose }: Props) {
  const { theme } = useTheme();
  const tags = merchant.tags || {};

  const handleDirections = () => {
    const lat = merchant.lat;
    const lon = merchant.lon;
    const name = tags.name || 'Bitcoin Merchant';
    const appleUrl = `http://maps.apple.com/?daddr=${lat},${lon}`;
    const googleUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`;

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options: ['Cancel', 'Apple Maps', 'Google Maps'], cancelButtonIndex: 0 },
        (buttonIndex) => {
          if (buttonIndex === 1) Linking.openURL(appleUrl);
          if (buttonIndex === 2) Linking.openURL(googleUrl);
        }
      );
    } else {
      Linking.openURL(`geo:${lat},${lon}?q=${lat},${lon}(${encodeURIComponent(name)})`)
        .catch(() => Linking.openURL(googleUrl));
    }
  };

  const openLink = (url: string) => {
    if (!url.startsWith('http')) url = `https://${url}`;
    Linking.openURL(url).catch(() => {});
  };

  const addressString = [tags['addr:street'], tags['addr:housenumber'], tags['addr:city']]
    .filter(Boolean).join(' ');

  const getSubtitle = () => {
    // 1. Prioritize specific OpenStreetMap classification tags over BTCMap root tags
    const primaryTag = tags.shop || tags.amenity || tags.leisure || tags.tourism;
    
    if (primaryTag && primaryTag.toLowerCase() !== 'yes') {
      return primaryTag.replace(/_/g, ' '); // Format string cleanly (e.g. "fast_food" -> "fast food")
    }
    
    // 2. Fallback to BTCMap's generic category, UNLESS it just says "other"
    if (tags.category && tags.category.toLowerCase() !== 'other') {
      return tags.category;
    }
    
    return 'Business';
  };

  // Define dynamic badge colors using theme
  const badgeBgColor = theme.colors.bitcoin || theme.colors.primary;
  const badgeTextColor = theme.colors.background;

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background, borderColor: theme.colors.border }]}>
      <View style={styles.headerRow}>
        <View style={styles.titleContainer}>
          <Text style={styles.title} numberOfLines={1}>
            {tags.name || 'Bitcoin Merchant'}
          </Text>
          <Text style={[styles.subtitle, { color: theme.colors.primary }]} numberOfLines={1}>
            {getSubtitle()}
          </Text>
        </View>
        <TouchableOpacity onPress={onClose} style={[styles.closeBtn, { backgroundColor: theme.colors.surface }]}>
          <MaterialIcons name="close" size={20} color={theme.colors.primary} />
        </TouchableOpacity>
      </View>

      <ScrollView 
        style={[
          styles.scrollContent, 
          { borderTopColor: theme.colors.border, borderBottomColor: theme.colors.border }
        ]} 
        contentContainerStyle={styles.scrollInnerContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.badges}>
          {tags['payment:lightning'] === 'yes' && (
            <View style={[styles.badge, { backgroundColor: badgeBgColor }]}>
              <MaterialIcons name="bolt" size={14} color={badgeTextColor} />
              <Text style={[styles.badgeText, { color: badgeTextColor }]}>Lightning</Text>
            </View>
          )}
          {tags['payment:onchain'] === 'yes' && (
            <View style={[styles.badge, { backgroundColor: badgeBgColor }]}>
              <MaterialIcons name="link" size={14} color={badgeTextColor} />
              <Text style={[styles.badgeText, { color: badgeTextColor }]}>On-chain</Text>
            </View>
          )}
          {tags['payment:lightning_contactless'] === 'yes' && (
            <View style={[styles.badge, { backgroundColor: badgeBgColor }]}>
              <MaterialIcons name="contactless" size={14} color={badgeTextColor} />
              <Text style={[styles.badgeText, { color: badgeTextColor }]}>NFC</Text>
            </View>
          )}
        </View>

        <View style={[styles.detailSection, { borderTopColor: theme.colors.border }]}>
          {addressString && (
            <View style={styles.detailRow}>
              <MaterialIcons name="location-pin" size={20} color={theme.colors.primary} style={styles.icon} />
              <Text style={[styles.detailText, { color: theme.colors.primary }]}>{addressString}</Text>
            </View>
          )}
          
          {tags.opening_hours && (
            <View style={styles.detailRow}>
              <MaterialIcons name="schedule" size={20} color={theme.colors.primary} style={styles.icon} />
              <Text style={[styles.detailText, { color: theme.colors.primary }]}>{tags.opening_hours}</Text>
            </View>
          )}

          {tags.phone && (
            <TouchableOpacity style={styles.detailRow} onPress={() => Linking.openURL(`tel:${tags.phone}`)}>
              <MaterialIcons name="phone" size={20} color={theme.colors.primary} style={styles.icon} />
              <Text style={[styles.detailText, { color: theme.colors.primary, textDecorationLine: 'underline' }]}>{tags.phone}</Text>
            </TouchableOpacity>
          )}

          {tags.website && (
            <TouchableOpacity style={styles.detailRow} onPress={() => openLink(tags.website!)}>
              <MaterialIcons name="language" size={20} color={theme.colors.primary} style={styles.icon} />
              <Text style={[styles.detailText, { color: theme.colors.primary, textDecorationLine: 'underline' }]} numberOfLines={1}>{tags.website}</Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>

      <TouchableOpacity 
        style={[styles.directionsBtn, { backgroundColor: theme.colors.primary }]} 
        onPress={handleDirections}
        activeOpacity={0.8}
      >
        <MaterialIcons name="directions" size={20} color={theme.colors.background} style={{ marginRight: 8 }} />
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
    height: '45%',
    padding: 24,
    borderTopWidth: 1,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
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
    fontSize: 22,
    fontFamily: 'SpaceMono-Bold',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    opacity: 0.7,
    textTransform: 'capitalize',
    fontFamily: 'SpaceMono-Regular',
  },
  closeBtn: {
    padding: 8,
    borderRadius: 20,
  },
  scrollContent: {
    flex: 1,
    marginBottom: 16,
    borderTopWidth: 1,
    borderBottomWidth: 1,
  },
  scrollInnerContent: {
    paddingVertical: 16,
  },
  badges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 20,
    gap: 8,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    gap: 4,
  },
  badgeText: {
    fontSize: 12,
    fontFamily: 'SpaceMono-Bold',
  },
  detailSection: {
    borderTopWidth: 1,
    paddingTop: 16,
    gap: 16,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  icon: {
    marginRight: 12,
    opacity: 0.7,
  },
  detailText: {
    fontSize: 14,
    fontFamily: 'SpaceMono-Regular',
    flex: 1,
  },
  directionsBtn: {
    flexDirection: 'row',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  directionsText: {
    fontSize: 16,
    fontFamily: 'SpaceMono-Bold',
  },
});