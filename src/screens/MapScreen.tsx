import React, { useEffect, useState, useRef, useMemo } from 'react';
import { StyleSheet, View, TouchableOpacity, ActivityIndicator, Platform, ScrollView } from 'react-native';
import MapView, { Region } from 'react-native-maps';
import * as Location from 'expo-location';
import useSWR from 'swr';
import Supercluster from 'supercluster';
import { MaterialIcons } from '@expo/vector-icons';
import { SymbolView } from 'expo-symbols';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import BottomSheet from '@gorhom/bottom-sheet';

import { useTheme } from '../contexts/ThemeContext';
import { Text } from '../components/StyledText';
import CustomMarker, { getCategoryIcon } from '../components/Map/CustomMarker';
import ClusterMarker from '../components/Map/ClusterMarker';
import MerchantBottomSheet from '../components/Map/MerchantBottomSheet';
import { BTC_MAP_API_URL, btcMapFetcher, BtcMapElement } from '../services/btcmap';
import { GlassView } from '../components/GlassView';
import { useIsFocused } from '@react-navigation/native';

const FILTER_GROUPS = [
  { id: 'food', label: 'Food & Drink', icon: 'restaurant', icons: ['restaurant', 'local-cafe', 'local-bar', 'fastfood', 'bakery-dining', 'icecream'] },
  { id: 'shopping', label: 'Shopping', icon: 'local-grocery-store', icons: ['local-grocery-store', 'checkroom', 'devices', 'menu-book', 'card-giftcard', 'chair', 'visibility', 'hardware', 'toys', 'pets', 'watch', 'videogame-asset', 'music-note', 'storefront'] },
  { id: 'services', label: 'Services', icon: 'account-balance', icons: ['account-balance', 'local-pharmacy', 'local-hospital', 'content-cut', 'spa', 'real-estate-agent', 'gavel', 'design-services', 'business', 'school', 'plumbing', 'bolt', 'construction'] },
  { id: 'Hotels', label: 'Hotels', icon: 'hotel', icons: ['hotel', 'apartment'] },
  { id: 'transport', label: 'Transport', icon: 'directions-car', icons: ['pedal-bike', 'two-wheeler', 'directions-car', 'directions-boat', 'local-gas-station', 'local-parking'] },
  { id: 'entertainment', label: 'Entertainment', icon: 'attractions', icons: ['flight', 'movie', 'casino', 'museum', 'fitness-center', 'pool', 'park', 'attractions'] }
] as const;

const getBounds = (region: Region): [number, number, number, number] => [
  region.longitude - region.longitudeDelta / 2,
  region.latitude - region.latitudeDelta / 2,
  region.longitude + region.longitudeDelta / 2,
  region.latitude + region.latitudeDelta / 2,
];

const getZoomLevel = (region: Region): number => Math.max(0, Math.round(Math.log(360 / region.longitudeDelta) / Math.LN2));

export default function MapScreen() {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const mapRef = useRef<MapView>(null);
  const clusterRef = useRef<Supercluster | null>(null);
  const bottomSheetRef = useRef<BottomSheet>(null);
  const sheetState = useRef<'open' | 'closing' | 'closed'>('closed');

  const [location, setLocation] = useState<Location.LocationObject | null>(null);
  const [selectedMerchant, setSelectedMerchant] = useState<BtcMapElement | null>(null);
  const [clusters, setClusters] = useState<any[]>([]);
  const [mapType, setMapType] = useState<'standard' | 'satellite'>('standard');
  const [region, setRegion] = useState<Region>({
    latitude: 0,
    longitude: 0,
    latitudeDelta: 100,
    longitudeDelta: 100,
  });
  const regionRef = useRef<Region>(region);

  const [activeFilters, setActiveFilters] = useState<string[]>([]);
  const [processingFilter, setProcessingFilter] = useState<string | null>(null);

  const { data: elements, error, isLoading } = useSWR<BtcMapElement[]>(
    BTC_MAP_API_URL,
    btcMapFetcher,
    { revalidateOnFocus: false }
  );

  useEffect(() => {
    if (!elements || elements.length === 0) return;

    const timer = setTimeout(() => {
      const points = elements.reduce<any[]>((acc, el) => {
        const lat = el.osm_json?.lat ?? el.osm_json?.center?.lat ?? el.lat;
        const lon = el.osm_json?.lon ?? el.osm_json?.center?.lon ?? el.lon;

        if (isNaN(Number(lon)) || isNaN(Number(lat))) return acc;

        const mergedTags = { ...(el.osm_json?.tags || {}), ...(el.tags || {}) };

        if (activeFilters.length > 0) {
          const iconName = getCategoryIcon(mergedTags);
          const matchesFilter = activeFilters.some(filterId => {
            const group = FILTER_GROUPS.find(g => g.id === filterId);
            return (group?.icons as readonly string[])?.includes(iconName);
          });
          if (!matchesFilter) return acc;
        }

        const cleanElement = { ...el, lat: Number(lat), lon: Number(lon), tags: mergedTags };

        acc.push({
          type: 'Feature' as const,
          properties: { cluster: false, element: cleanElement },
          geometry: { type: 'Point' as const, coordinates: [Number(lon), Number(lat)] },
        });

        return acc;
      }, []);

      const supercluster = new Supercluster({ radius: 70, maxZoom: 16 });
      supercluster.load(points);
      clusterRef.current = supercluster;

      updateClusters(regionRef.current);

      setProcessingFilter(null);
    }, 50);

    return () => clearTimeout(timer);
  }, [elements, activeFilters]);

  const isFocused = useIsFocused();
  const hasRequestedLocation = useRef(false);

  useEffect(() => {
    if (isFocused && !hasRequestedLocation.current) {
      hasRequestedLocation.current = true;
      (async () => {
        let { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return;
        let currentLocation = await Location.getCurrentPositionAsync({});
        setLocation(currentLocation);
      })();
    }
  }, [isFocused]);

  useEffect(() => {
    if (!isLoading && location && mapRef.current) {
      const targetRegion = {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        latitudeDelta: 0.05,
        longitudeDelta: 0.05,
      };
      mapRef.current.animateToRegion(targetRegion, 1000);
      setRegion(targetRegion);
      regionRef.current = targetRegion;
      updateClusters(targetRegion);
    }
  }, [isLoading, location]);

  const updateClusters = (newRegion: Region) => {
    if (!clusterRef.current) return;
    const bbox = getBounds(newRegion);
    const zoom = getZoomLevel(newRegion);
    try {
      setClusters(clusterRef.current.getClusters(bbox, zoom));
    } catch (e) { }
  };

  const handleRegionChangeComplete = (newRegion: Region) => {
    setRegion(newRegion);
    regionRef.current = newRegion;
    updateClusters(newRegion);
  };

  const centerOnUser = async () => {
    if (!location) return;
    mapRef.current?.animateToRegion({
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
      latitudeDelta: 0.05,
      longitudeDelta: 0.05,
    }, 1000);
  };

  const toggleMapType = () => setMapType(prev => (prev === 'standard' ? 'satellite' : 'standard'));

  const handleMapInteraction = () => {
    if (selectedMerchant && bottomSheetRef.current && sheetState.current === 'open') {
      bottomSheetRef.current.snapToIndex(0);
    }
  };

  const handleMarkerPress = (merchant: BtcMapElement) => {
    if (selectedMerchant?.id === merchant.id) {
      sheetState.current = 'open';
      bottomSheetRef.current?.snapToIndex(1);
    } else {
      sheetState.current = 'open';
      setSelectedMerchant(merchant);
    }
    
    const latDelta = 0.003;
    const lonDelta = 0.003;
    const targetLatitude = Number(merchant.lat) - (latDelta * 0.25);

    mapRef.current?.animateToRegion({
      latitude: targetLatitude,
      longitude: Number(merchant.lon),
      latitudeDelta: latDelta,
      longitudeDelta: lonDelta,
    }, 500);
  };

  const handleClusterPress = (clusterId: number, lat: number, lon: number) => {
    if (!clusterRef.current) return;
    const expansionZoom = clusterRef.current.getClusterExpansionZoom(clusterId);
    mapRef.current?.animateToRegion({
      latitude: lat,
      longitude: lon,
      latitudeDelta: region.latitudeDelta / 4,
      longitudeDelta: region.longitudeDelta / 4,
    }, 500);
  };

  const toggleFilter = (filterId: string) => {
    setProcessingFilter(filterId);

    setTimeout(() => {
      setActiveFilters(prev => (prev[0] === filterId ? [] : [filterId]));
    }, 20);
  };

  const mapStyle = useMemo(() => {
    const baseColor = theme.colors.background;
    const roadColor = theme.colors.surface;
    const labelColor = theme.colors.muted;

    return [
      { elementType: 'geometry', stylers: [{ color: baseColor }] },
      { elementType: 'labels.text.fill', stylers: [{ color: labelColor }] },
      { elementType: 'labels.text.stroke', stylers: [{ color: baseColor }] },
      { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: theme.colors.primary }] },
      { featureType: 'poi', stylers: [{ visibility: 'off' }] },
      { featureType: 'road', elementType: 'geometry', stylers: [{ color: roadColor }] },
      { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: baseColor }] },
      { featureType: 'transit', stylers: [{ visibility: 'off' }] },
      { featureType: 'water', elementType: 'geometry', stylers: [{ color: theme.colors.border }] },
    ];
  }, [theme]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <View style={styles.container}>
        <MapView
          ref={mapRef}
          style={styles.map}
          mapType={mapType}
          customMapStyle={mapStyle}
          showsUserLocation={true}
          tintColor="#007AFF"
          showsMyLocationButton={false}
          showsCompass={false}
          showsScale={false}
          onRegionChangeComplete={handleRegionChangeComplete}
          initialRegion={region}
          onPress={handleMapInteraction}
          onPanDrag={handleMapInteraction}
        >
          {clusters.map((cluster) => {
            const [lon, lat] = cluster.geometry.coordinates;
            const { cluster: isCluster, element, cluster_id, point_count } = cluster.properties;

            if (isCluster) {
              return (
                <ClusterMarker
                  key={`cluster-${cluster_id}`}
                  coordinate={{ latitude: lat, longitude: lon }}
                  pointCount={point_count}
                  onPress={() => handleClusterPress(cluster_id, lat, lon)}
                  theme={theme}
                />
              );
            }

            return (
              <CustomMarker
                key={`merchant-${element.id}`}
                merchant={element}
                onPress={() => handleMarkerPress(element)}
                theme={theme}
              />
            );
          })}
        </MapView>

        <View style={styles.topFilterWrapper} pointerEvents="box-none">
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterScrollContent}
          >
            {FILTER_GROUPS.map(group => {
              const isActive = activeFilters[0] === group.id;
              const isProcessing = processingFilter === group.id;
              const contentColor = isActive ? theme.colors.bitcoin : theme.colors.primary;

              return (
                <TouchableOpacity
                  key={group.id}
                  onPress={() => toggleFilter(group.id)}
                  style={styles.pillTouchContainer}
                  disabled={isProcessing}
                >
                  <GlassView
                    width={140}
                    height={40}
                    borderRadius={20}
                    shape="capsule"
                    tintColor={theme.colors.surface + '99'}
                    fallbackColor={theme.colors.surface}
                    interactive={false}
                  >
                    <View style={styles.pillContent}>
                      <View style={styles.pillIconSlot}>
                        {isProcessing ? (
                          <ActivityIndicator size="small" color={contentColor} />
                        ) : (
                          <MaterialIcons name={group.icon as any} size={16} color={contentColor} />
                        )}
                      </View>
                      <Text style={[styles.pillText, { color: contentColor }]}>{group.label}</Text>
                    </View>
                  </GlassView>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        {isLoading && (
          <View style={styles.loadingOverlay}>
            <View style={StyleSheet.absoluteFill} />
            <View style={styles.loadingBoxContainer}>
              <GlassView
                width={240}
                height={120}
                borderRadius={16}
                shape="rectangle"
                tintColor={theme.colors.surface + '10'}
                fallbackColor={theme.colors.surface}
                interactive={false}
              >
                <View style={styles.loadingContent}>
                  <ActivityIndicator size="large" color={theme.colors.primary} />
                  <Text style={styles.loadingText}>Loading merchants...</Text>
                </View>
              </GlassView>
            </View>
          </View>
        )}

        {error && (
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>Failed to load map data.</Text>
          </View>
        )}

        <View style={styles.fabContainer} pointerEvents={selectedMerchant ? 'none' : 'box-none'}>
          <TouchableOpacity
            style={styles.fab}
            onPress={toggleMapType}
            activeOpacity={0.8}
            disabled={!!selectedMerchant}
          >
            <GlassView
              width={52}
              height={52}
              tintColor={theme.colors.surface + '99'}
              shape="circle"
              fallbackColor={theme.colors.surface}
              interactive={!selectedMerchant}
              style={{ overflow: 'visible' }}
            >
              {Platform.OS === 'ios' ? (
                <SymbolView
                  name='square.stack.3d.up.fill'
                  size={22}
                  tintColor={theme.colors.primary}
                  weight="semibold"
                />
              ) : (
                <MaterialIcons name="layers" size={24} color={theme.colors.primary} />
              )}
            </GlassView>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.fab}
            onPress={centerOnUser}
            activeOpacity={0.8}
            disabled={!!selectedMerchant}
          >
            <GlassView
              width={52}
              height={52}
              tintColor={theme.colors.surface + '99'}
              shape="circle"
              fallbackColor={theme.colors.surface}
              interactive={!selectedMerchant}
              style={{ overflow: 'visible' }}
            >
              {Platform.OS === 'ios' ? (
                <SymbolView
                  name="location.fill"
                  size={22}
                  tintColor={theme.colors.primary}
                  weight="semibold"
                />
              ) : (
                <MaterialIcons name="my-location" size={24} color={theme.colors.primary} />
              )}
            </GlassView>
          </TouchableOpacity>
        </View>

        {selectedMerchant && (
          <MerchantBottomSheet
            merchant={selectedMerchant}
            onClose={() => {
              sheetState.current = 'closed';
              setSelectedMerchant(null);
            }}
            bottomSheetRef={bottomSheetRef}
            onStateChange={(state) => {
              sheetState.current = state;
            }}
          />
        )}
      </View>
    </GestureHandlerRootView>
  );
}

const createStyles = (theme: any) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
    overflow: 'visible',
  },
  map: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  topFilterWrapper: {
    position: 'absolute',
    top: 80,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  filterScrollContent: {
    paddingHorizontal: 16,
    gap: 8,
    alignItems: 'center',
  },
  pillTouchContainer: {},
  pillContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillIconSlot: {
    width: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 6,
  },
  pillText: {
    fontSize: 13,
    fontFamily: 'SpaceMono-Bold',
  },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  loadingBoxContainer: {
    overflow: 'hidden',
  },
  loadingContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  loadingText: {
    marginTop: 16,
    fontFamily: 'SpaceMono-Bold',
    fontSize: 16,
    color: theme.colors.primary,
  },
  errorContainer: {
    position: 'absolute',
    top: 120,
    alignSelf: 'center',
    padding: 16,
    borderRadius: 8,
    borderWidth: 1,
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.error,
  },
  errorText: {
    color: theme.colors.error,
  },
  fabContainer: {
    position: 'absolute',
    bottom: 140,
    right: 20,
    gap: 16,
    overflow: 'visible',
  },
  fab: {
    overflow: 'visible',
  },
});