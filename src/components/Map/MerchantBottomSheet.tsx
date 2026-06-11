import React, { useEffect, useMemo } from 'react';
import { StyleSheet, View, TouchableOpacity, Linking, Platform, ActionSheetIOS } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import BottomSheet, { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { Text } from '../StyledText';
import { useTheme } from '../../contexts/ThemeContext';
import { BtcMapElement } from '../../services/btcmap';
import { getCategoryIcon } from './CustomMarker';
import { GlassView } from '../GlassView';

interface Props {
  merchant: BtcMapElement;
  onClose: () => void;
  bottomSheetRef: React.RefObject<any>;
}

const parseOpeningHours = (hoursString?: string): { status: 'open' | 'closed', time: string } | null => {
  if (!hoursString) return null;
  if (hoursString.toLowerCase() === '24/7') return { status: 'open', time: '24/7' };

  try {
    const now = new Date();
    const days = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
    const currentDay = days[now.getDay()];
    const currentTimeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

    const rules = hoursString.split(';');

    for (const rule of rules) {
      const r = rule.trim();
      const hasDay = r.includes(currentDay) ||
        r.includes('Mo-Su') ||
        (r.includes('Mo-Fr') && ['Mo', 'Tu', 'We', 'Th', 'Fr'].includes(currentDay)) ||
        (r.includes('Mo-Sa') && currentDay !== 'Su');

      if (hasDay) {
        const timeMatch = r.match(/(\d{2}:\d{2})-(\d{2}:\d{2})/);
        if (timeMatch) {
          const open = timeMatch[1];
          const close = timeMatch[2];
          if (currentTimeStr >= open && currentTimeStr < close) {
            return { status: 'open', time: close };
          }
          if (currentTimeStr < open) {
            return { status: 'closed', time: open };
          }
        }
      }
    }
    return null;
  } catch {
    return null;
  }
};

export default function MerchantBottomSheet({ merchant, onClose, bottomSheetRef }: Props) {
  const { theme } = useTheme();
  const tags = merchant.tags || {};

  const snapPoints = useMemo(() => ['28%', '50%', '90%'], []);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (bottomSheetRef.current) {
        bottomSheetRef.current.snapToIndex(1);
      }
    }, 50);
    return () => clearTimeout(timer);
  }, [merchant, bottomSheetRef]);

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
    Linking.openURL(url).catch(() => { });
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

  const badgeBgColor = theme.colors.bitcoin;
  const badgeTextColor = theme.colors.background;

  const categoryIcon = getCategoryIcon(tags);
  const storeStatus = parseOpeningHours(tags.opening_hours);

  const hasPaymentMethods = tags['payment:lightning'] === 'yes' || tags['payment:onchain'] === 'yes' || tags['payment:lightning_contactless'] === 'yes';
  const hasDetails = Boolean(addressString || tags.opening_hours || tags.phone || tags.website);

  return (
    <BottomSheet
      ref={bottomSheetRef}
      index={1}
      snapPoints={snapPoints}
      enableDynamicSizing={false}
      enablePanDownToClose={false}
      handleIndicatorStyle={{ backgroundColor: theme.colors.border, width: 40 }}
      backgroundStyle={{ backgroundColor: theme.colors.background, borderRadius: 36 }}
    >
      <View style={styles.sheetWrapper}>

        <View style={[styles.headerContainer, { borderBottomColor: theme.colors.border }]}>
          <View style={styles.headerTopRow}>
            <Text style={styles.title} numberOfLines={1}>
              {tags.name || 'Bitcoin Merchant'}
            </Text>
            <TouchableOpacity onPress={onClose} activeOpacity={0.8}>
              <GlassView
                width={32}
                height={32}
                borderRadius={16}
                shape="circle"
                interactive={true}
              >
                <MaterialIcons name="close" size={16} color={theme.colors.primary} />
              </GlassView>
            </TouchableOpacity>
          </View>

          <View style={styles.infoRow}>
            <MaterialIcons name={categoryIcon} size={14} color={theme.colors.primary} style={styles.inlineIcon} />
            <Text style={[styles.subtitle, { color: theme.colors.primary }]} numberOfLines={1}>
              {getSubtitle()}
            </Text>
          </View>

          {storeStatus && (
            <View style={styles.infoRow}>
              <MaterialIcons
                name={storeStatus.status === 'open' ? 'schedule' : 'lock'}
                size={14}
                color={theme.colors.primary}
                style={styles.inlineIcon}
              />
              <Text style={[styles.statusText, { color: theme.colors.primary }]}>
                {storeStatus.status === 'open'
                  ? `Open • Closing at ${storeStatus.time}`
                  : `Closed • Opens at ${storeStatus.time}`}
              </Text>
            </View>
          )}

          <TouchableOpacity
            style={[
              styles.directionsBtn,
              { backgroundColor: theme.colors.primary }
            ]}
            onPress={handleDirections}
            activeOpacity={0.8}
          >
            <Text style={[styles.directionsText, { color: theme.colors.background }]}>Directions</Text>
          </TouchableOpacity>
        </View>

        <BottomSheetScrollView style={styles.scrollContainer} contentContainerStyle={styles.scrollInnerContent}>

          {hasPaymentMethods && (
            <>
              <Text style={[styles.sectionHeader, { color: theme.colors.primary }]}>Accepting</Text>
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
            </>
          )}

          {hasDetails && (
            <>
              <Text style={[styles.sectionHeader, { color: theme.colors.primary }]}>Details</Text>
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
            </>
          )}

        </BottomSheetScrollView>

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
    paddingBottom: 16,
    borderBottomWidth: 1,
  },
  headerTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  title: {
    flex: 1,
    marginRight: 16,
    fontSize: 22,
    fontFamily: 'SpaceMono-Bold',
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  inlineIcon: {
    marginRight: 6,
    opacity: 0.7,
  },
  subtitle: {
    fontSize: 14,
    opacity: 0.7,
    textTransform: 'capitalize',
    fontFamily: 'SpaceMono-Regular',
  },
  statusText: {
    fontSize: 14,
    opacity: 0.7,
    fontFamily: 'SpaceMono-Regular',
  },
  closeBtn: {
    padding: 6,
    borderRadius: 16,
  },
  directionsBtn: {
    flexDirection: 'row',
    paddingVertical: 8,
    paddingHorizontal: 16,
    marginTop: 8,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  directionsText: {
    fontSize: 14,
    fontFamily: 'SpaceMono-Bold',
  },
  scrollContainer: {
    flex: 1,
  },
  scrollInnerContent: {
    paddingHorizontal: 24,
    paddingVertical: 20,
  },
  sectionHeader: {
    fontSize: 16,
    fontFamily: 'SpaceMono-Bold',
    marginBottom: 12,
  },
  badges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 24,
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
});