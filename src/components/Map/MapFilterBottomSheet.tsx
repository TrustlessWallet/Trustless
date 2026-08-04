import React, { useMemo } from 'react';
import { StyleSheet, View, TouchableOpacity } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import BottomSheet, { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { Text } from '../StyledText';
import { useTheme } from '../../contexts/ThemeContext';
import { GlassView } from '../GlassView';

export const FILTER_GROUPS: Record<string, { label: string, icon: keyof typeof MaterialIcons.glyphMap, icons: string[] }> = {
  food: { 
    label: 'Food & Drink', icon: 'restaurant', 
    icons: ['restaurant', 'local-cafe', 'local-bar', 'fastfood', 'bakery-dining', 'icecream'] 
  },
  shopping: { 
    label: 'Shopping', icon: 'local-grocery-store', 
    icons: ['local-grocery-store', 'checkroom', 'devices', 'menu-book', 'card-giftcard', 'chair', 'visibility', 'hardware', 'toys', 'pets', 'watch', 'videogame-asset', 'music-note', 'storefront'] 
  },
  services: { 
    label: 'Services', icon: 'account-balance', 
    icons: ['account-balance', 'local-pharmacy', 'local-hospital', 'content-cut', 'spa', 'real-estate-agent', 'gavel', 'design-services', 'business', 'school', 'plumbing', 'bolt', 'construction'] 
  },
  lodging: { 
    label: 'Lodging', icon: 'hotel', 
    icons: ['hotel', 'apartment'] 
  },
  transport: { 
    label: 'Transport', icon: 'directions-car', 
    icons: ['pedal-bike', 'two-wheeler', 'directions-car', 'directions-boat', 'local-gas-station', 'local-parking'] 
  },
  entertainment: { 
    label: 'Entertainment', icon: 'attractions', 
    icons: ['flight', 'movie', 'casino', 'museum', 'fitness-center', 'pool', 'park', 'attractions'] 
  }
};

interface Props {
  activeFilters: string[];
  setActiveFilters: React.Dispatch<React.SetStateAction<string[]>>;
  bottomSheetRef: React.RefObject<any>;
  onClose: () => void;
}

export default function MapFilterBottomSheet({ activeFilters, setActiveFilters, bottomSheetRef, onClose }: Props) {
  const { theme } = useTheme();
  const snapPoints = useMemo(() => ['45%'], []);

  const toggleFilter = (filterKey: string) => {
    setActiveFilters(prev => 
      prev.includes(filterKey) 
        ? prev.filter(k => k !== filterKey) 
        : [...prev, filterKey]
    );
  };

  const clearFilters = () => setActiveFilters([]);

  return (
    <BottomSheet
      ref={bottomSheetRef}
      index={-1} 
      snapPoints={snapPoints}
      enablePanDownToClose={true}
      handleIndicatorStyle={{ backgroundColor: theme.colors.border, width: 40 }}
      backgroundStyle={{ backgroundColor: theme.colors.background, borderRadius: 36 }}
      onClose={onClose}
    >
      <View style={styles.sheetWrapper}>
        <View style={[styles.headerContainer, { borderBottomColor: theme.colors.border }]}>
          <View style={styles.headerTopRow}>
            <Text style={styles.title}>Filter Map</Text>
            {activeFilters.length > 0 && (
              <TouchableOpacity onPress={clearFilters} style={styles.clearBtn}>
                <Text style={[styles.clearText, { color: theme.colors.primary }]}>Clear</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        <BottomSheetScrollView style={styles.scrollContainer} contentContainerStyle={styles.scrollInnerContent}>
          <View style={styles.grid}>
            {Object.entries(FILTER_GROUPS).map(([key, group]) => {
              const isActive = activeFilters.includes(key);
              return (
                <TouchableOpacity 
                  key={key}
                  style={styles.gridItem}
                  onPress={() => toggleFilter(key)}
                  activeOpacity={0.8}
                >
                  <GlassView
                    width={100}
                    height={85}
                    borderRadius={16}
                    shape="rectangle"
                    tintColor={isActive ? theme.colors.bitcoin + '30' : theme.colors.surface + '10'}
                    fallbackColor={theme.colors.surface}
                    interactive={true}
                  >
                    <View style={[styles.filterContent, isActive && { borderColor: theme.colors.bitcoin, borderWidth: 1, borderRadius: 16 }]}>
                      <MaterialIcons 
                        name={group.icon} 
                        size={24} 
                        color={isActive ? theme.colors.bitcoin : theme.colors.primary} 
                      />
                      <Text style={[styles.filterLabel, { color: isActive ? theme.colors.bitcoin : theme.colors.primary }]}>
                        {group.label}
                      </Text>
                    </View>
                  </GlassView>
                </TouchableOpacity>
              );
            })}
          </View>
        </BottomSheetScrollView>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sheetWrapper: { flex: 1 },
  headerContainer: {
    paddingHorizontal: 24,
    paddingBottom: 16,
    borderBottomWidth: 1,
  },
  headerTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    fontSize: 22,
    fontFamily: 'SpaceMono-Bold',
  },
  clearBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  clearText: {
    fontSize: 14,
    fontFamily: 'SpaceMono-Bold',
  },
  scrollContainer: { flex: 1 },
  scrollInnerContent: {
    paddingHorizontal: 20,
    paddingVertical: 20,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 12,
  },
  gridItem: {
    width: '48%',
  },
  filterContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 12,
    gap: 8,
  },
  filterLabel: {
    fontSize: 12,
    fontFamily: 'SpaceMono-Bold',
    textAlign: 'center',
  },
});