import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Marker } from 'react-native-maps';
import { MaterialIcons } from '@expo/vector-icons';
import { BtcMapElement } from '../../services/btcmap';

interface Props {
  merchant: BtcMapElement;
  onPress: () => void;
  theme: any;
}

export const getCategoryIcon = (tags: any = {}): keyof typeof MaterialIcons.glyphMap => {
  const categoryStr = [
    tags.category, tags.amenity, tags.shop, tags.leisure, tags.tourism, tags.office, tags.craft
  ].filter(Boolean).join(' ').toLowerCase();

  if (categoryStr.match(/restaurant|food|dining|deli|steak|seafood|pizza|burger|sushi|caterer/)) return 'restaurant';
  if (categoryStr.match(/cafe|coffee|tea|juice/)) return 'local-cafe';
  if (categoryStr.match(/bar|pub|nightclub|biergarten|alcohol|wine|liquor|brewery|distillery/)) return 'local-bar';
  if (categoryStr.match(/fast_food/)) return 'fastfood';
  if (categoryStr.match(/bakery/)) return 'bakery-dining';
  if (categoryStr.match(/ice_cream|dessert|chocolate|confectionery/)) return 'icecream';
  if (categoryStr.match(/atm|bank|exchange|bureau_de_change|money_transfer|bitcoin|crypto/)) return 'account-balance';
  if (categoryStr.match(/hotel|hostel|guest_house|motel|resort|bed and breakfast|camp|caravan|chalet/)) return 'hotel';
  if (categoryStr.match(/apartment|accommodation/)) return 'apartment';
  if (categoryStr.match(/supermarket|grocery|convenience|deli|market|bio/)) return 'local-grocery-store';
  if (categoryStr.match(/clothes|boutique|shoe|tailor|fashion|bag|leather|garment|textile|sewing/)) return 'checkroom';
  if (categoryStr.match(/electronics|mobile|computer|device|copyshop|printing|printer/)) return 'devices';
  if (categoryStr.match(/book|library|stationery|newspaper/)) return 'menu-book';
  if (categoryStr.match(/gift|souvenir|florist|flower|candle|magic/)) return 'card-giftcard';
  if (categoryStr.match(/furniture|interior|homeware|bed|carpet|kitchen|window|door|tiles/)) return 'chair';
  if (categoryStr.match(/optician|glasses/)) return 'visibility';
  if (categoryStr.match(/hardware|doityourself|tools|paint/)) return 'hardware';
  if (categoryStr.match(/toys|baby|kids/)) return 'toys';
  if (categoryStr.match(/pet|animal|veterinary/)) return 'pets';
  if (categoryStr.match(/jewelry|watch|gold|crystal|diamond/)) return 'watch';
  if (categoryStr.match(/video_game|game|esport|anime/)) return 'videogame-asset';
  if (categoryStr.match(/music|instrument|hifi|audio|record|dvd/)) return 'music-note';
  if (categoryStr.match(/pharmacy|chemist|apothecary/)) return 'local-pharmacy';
  if (categoryStr.match(/hospital|clinic|doctor|dentist|therapist|medical|chiropractor|psychiatrist/)) return 'local-hospital';
  if (categoryStr.match(/hairdresser|barber|beauty|salon|tattoo|piercing/)) return 'content-cut';
  if (categoryStr.match(/massage|spa|sauna|wellness|care/)) return 'spa';
  if (categoryStr.match(/estate_agent|real_estate|property/)) return 'real-estate-agent';
  if (categoryStr.match(/lawyer|notary|legal|bail/)) return 'gavel';
  if (categoryStr.match(/architect|design|marketing|advertising|consult|software|web|it/)) return 'design-services';
  if (categoryStr.match(/travel|tours|guide/)) return 'flight';
  if (categoryStr.match(/coworking|office|business|agency|company/)) return 'business';
  if (categoryStr.match(/school|university|college|kindergarten|education|tutor|training/)) return 'school';
  if (categoryStr.match(/bicycle|bike/)) return 'pedal-bike';
  if (categoryStr.match(/motorcycle|scooter/)) return 'two-wheeler';
  if (categoryStr.match(/car|auto|vehicle|tyre|mechanic/)) return 'directions-car';
  if (categoryStr.match(/boat|marine|canoe|kayak/)) return 'directions-boat';
  if (categoryStr.match(/fuel|gas|charging/)) return 'local-gas-station';
  if (categoryStr.match(/parking/)) return 'local-parking';
  if (categoryStr.match(/cinema|movie|theatre/)) return 'movie';
  if (categoryStr.match(/casino|gambling|lottery|bet/)) return 'casino';
  if (categoryStr.match(/museum|gallery|art/)) return 'museum';
  if (categoryStr.match(/gym|fitness|sports|yoga|dance/)) return 'fitness-center';
  if (categoryStr.match(/pool|swimming/)) return 'pool';
  if (categoryStr.match(/park|garden|nature|forest/)) return 'park';
  if (categoryStr.match(/leisure|entertainment|attraction|tourism/)) return 'attractions';
  if (categoryStr.match(/plumber|plumbing|water/)) return 'plumbing';
  if (categoryStr.match(/electrician|electrical|energy/)) return 'bolt';
  if (categoryStr.match(/builder|carpenter|construction|roof|handyman|craft|repair/)) return 'construction';
  if (categoryStr.match(/shop|store|retail|wholesale/)) return 'storefront';

  return 'place';
};

export default function CustomMarker({ merchant, onPress, theme }: Props) {
  const iconName = getCategoryIcon(merchant.tags);

  return (
    <Marker
      coordinate={{ latitude: Number(merchant.lat), longitude: Number(merchant.lon) }}
      onPress={onPress}
    >
      <View style={[
        styles.container, 
        { 
          backgroundColor: theme.colors.bitcoin, 
          borderColor: theme.colors.background,
        }
      ]}>
        <MaterialIcons name={iconName} size={14} color={theme.colors.background} />
      </View>
    </Marker>
  );
}

const styles = StyleSheet.create({
  container: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
});