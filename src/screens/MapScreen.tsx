import React, { useEffect, useState, useRef, useMemo } from 'react';
import { StyleSheet, View, TouchableOpacity, ActivityIndicator, Platform } from 'react-native';
import MapView, { Region } from 'react-native-maps';
import * as Location from 'expo-location';
import useSWR from 'swr';
import Supercluster from 'supercluster';
import { MaterialIcons } from '@expo/vector-icons';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import BottomSheet from '@gorhom/bottom-sheet';

import { useTheme } from '../contexts/ThemeContext';
import { Text } from '../components/StyledText';
import CustomMarker from '../components/Map/CustomMarker';
import ClusterMarker from '../components/Map/ClusterMarker';
import MerchantBottomSheet from '../components/Map/MerchantBottomSheet';
import { BTC_MAP_API_URL, btcMapFetcher, BtcMapElement } from '../services/btcmap';
import { GlassView } from '../components/GlassView';

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

  const { data: elements, error, isLoading } = useSWR<BtcMapElement[]>(
    BTC_MAP_API_URL,
    btcMapFetcher,
    { revalidateOnFocus: false }
  );

  useEffect(() => {
    if (!elements || elements.length === 0) return;

    const timer = setTimeout(() => {
      const points = elements.map((el) => {
        const lat = el.osm_json?.lat ?? el.osm_json?.center?.lat ?? el.lat;
        const lon = el.osm_json?.lon ?? el.osm_json?.center?.lon ?? el.lon;
        const mergedTags = { ...(el.osm_json?.tags || {}), ...(el.tags || {}) };
        const cleanElement = { ...el, lat: Number(lat), lon: Number(lon), tags: mergedTags };

        return {
          type: 'Feature' as const,
          properties: { cluster: false, element: cleanElement },
          geometry: { type: 'Point' as const, coordinates: [Number(lon), Number(lat)] },
        };
      }).filter(p => !isNaN(p.geometry.coordinates[0]) && !isNaN(p.geometry.coordinates[1]));

      const supercluster = new Supercluster({ radius: 70, maxZoom: 16 });
      supercluster.load(points);
      clusterRef.current = supercluster;

      updateClusters(regionRef.current);
    }, 0);

    return () => clearTimeout(timer);
  }, [elements]);

  useEffect(() => {
    (async () => {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      let currentLocation = await Location.getCurrentPositionAsync({});
      setLocation(currentLocation);
    })();
  }, []);

  useEffect(() => {
    if (!isLoading && location && mapRef.current) {
      const targetRegion = {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        latitudeDelta: 0.05,
        longitudeDelta: 0.05,
      };

      mapRef.current.animateToRegion(targetRegion, 1000);

      // Force update state immediately so markers appear instantly
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
    if (selectedMerchant && bottomSheetRef.current) {
      bottomSheetRef.current.snapToIndex(0);
    }
  };

  const handleMarkerPress = (merchant: BtcMapElement) => {
    setSelectedMerchant(merchant);

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

        {isLoading && (
          <View style={styles.loadingOverlay}>
            <View style={StyleSheet.absoluteFill} />
            <View style={styles.loadingBoxContainer}>
              <GlassView
                width={240}
                height={120}
                borderRadius={16}
                shape="rectangle"
                tintColor={theme.colors.surface + '99'}
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
              <MaterialIcons name="layers" size={24} color={theme.colors.primary} />
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
              <MaterialIcons name="my-location" size={24} color={theme.colors.primary} />
            </GlassView>
          </TouchableOpacity>
        </View>

        {selectedMerchant && (
          <MerchantBottomSheet
            merchant={selectedMerchant}
            onClose={() => setSelectedMerchant(null)}
            bottomSheetRef={bottomSheetRef}
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
    top: 60,
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