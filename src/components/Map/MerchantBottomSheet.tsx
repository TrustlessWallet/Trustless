import React, { useMemo } from 'react';
import { StyleSheet, View, TouchableOpacity, Linking, Platform, ActionSheetIOS } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import BottomSheet, { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { Text } from '../StyledText';
import { useTheme } from '../../contexts/ThemeContext';
import { BtcMapElement } from '../../services/btcmap';

interface Props {
  merchant: BtcMapElement;
  onClose: () => void;
  bottomSheetRef: React.RefObject<BottomSheet>;
}

export default function MerchantBottomSheet({ merchant, onClose, bottomSheetRef }: Props) {
  const { theme } = useTheme();
  const tags = merchant.tags || {};

  const snapPoints = useMemo(() => ['15%', '50%', '100%'], []);

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
    const primaryTag = tags.shop || tags.amenity || tags.leisure || tags.tourism;
    if (primaryTag && primaryTag.toLowerCase() !== 'yes') {
      return primaryTag.replace(/_/g, ' '); 
    }
    if (tags.category && tags.category.toLowerCase() !== 'other') {
      return tags.category;
    }
    return 'Business';
  };

  const badgeBgColor = theme.colors.bitcoin || theme.colors.primary;
  const badgeTextColor = theme.colors.background;

  return (
    <BottomSheet
      ref={bottomSheetRef}
      index={1} 
      snapPoints={snapPoints}
      enablePanDownToClose={false} 
      handleIndicatorStyle={{ backgroundColor: theme.colors.border, width: 40 }}
      backgroundStyle={{ backgroundColor: theme.colors.background }}
    >
      <View style={styles.sheetWrapper}>
        
        <View style={[styles.headerContainer, { borderBottomColor: theme.colors.border }]}>
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
        </View>

        <BottomSheetScrollView 
          style={styles.scrollContainer} 
          contentContainerStyle={styles.scrollInnerContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.detailSection}>
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
        </BottomSheetScrollView>

        <View style={[styles.footerContainer, { borderTopColor: theme.colors.border }]}>
          <TouchableOpacity 
            style={[styles.directionsBtn, { backgroundColor: theme.colors.primary }]} 
            onPress={handleDirections}
            activeOpacity={0.8}
          >
            <MaterialIcons name="directions" size={20} color={theme.colors.background} style={{ marginRight: 8 }} />
            <Text style={[styles.directionsText, { color: theme.colors.background }]}>Directions</Text>
          </TouchableOpacity>
        </View>

      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sheetWrapper: {
    flex: 1,
  },
  headerContainer: {
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
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
  badges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
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
  scrollContainer: {
    flex: 1,
  },
  scrollInnerContent: {
    paddingHorizontal: 24,
    paddingVertical: 20,
  },
  detailSection: {
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
  footerContainer: {
    paddingHorizontal: 24,
    paddingVertical: 16,
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
    borderTopWidth: StyleSheet.hairlineWidth,
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