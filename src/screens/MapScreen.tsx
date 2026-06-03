import React, { useEffect, useState, useRef, useMemo } from 'react';
import { StyleSheet, View, TouchableOpacity, ActivityIndicator } from 'react-native';
import MapView, { Region } from 'react-native-maps';
import * as Location from 'expo-location';
import useSWR from 'swr';
import Supercluster from 'supercluster';
import { useTheme } from '../contexts/ThemeContext';
import { Text } from '../components/StyledText';

import CustomMarker from '../components/Map/CustomMarker';
import ClusterMarker from '../components/Map/ClusterMarker';
import MerchantBottomSheet from '../components/Map/MerchantBottomSheet';
import { BTC_MAP_API_URL, btcMapFetcher, BtcMapElement } from '../services/btcmap';

const getBounds = (region: Region): [number, number, number, number] => [
  region.longitude - region.longitudeDelta / 2,
  region.latitude - region.latitudeDelta / 2,
  region.longitude + region.longitudeDelta / 2,
  region.latitude + region.latitudeDelta / 2,
];

const getZoomLevel = (region: Region): number => Math.max(0, Math.round(Math.log(360 / region.longitudeDelta) / Math.LN2));

export default function MapScreen() {
  const { theme, isDark } = useTheme();
  const mapRef = useRef<MapView>(null);
  const clusterRef = useRef<Supercluster | null>(null);

  const [location, setLocation] = useState<Location.LocationObject | null>(null);
  const [selectedMerchant, setSelectedMerchant] = useState<BtcMapElement | null>(null);
  const [clusters, setClusters] = useState<any[]>([]);
  const [region, setRegion] = useState<Region>({
    latitude: 0,
    longitude: 0,
    latitudeDelta: 100,
    longitudeDelta: 100,
  });

  const { data: elements, error, isLoading } = useSWR<BtcMapElement[]>(
    BTC_MAP_API_URL,
    btcMapFetcher,
    { revalidateOnFocus: false }
  );

  // Initialize Supercluster when data arrives
  useEffect(() => {
    if (!elements) return;

    const points = elements.map((el) => ({
      type: 'Feature' as const,
      properties: { cluster: false, element: el },
      geometry: { type: 'Point' as const, coordinates: [el.lon, el.lat] },
    }));

    const supercluster = new Supercluster({
      radius: 40,
      maxZoom: 16,
    });

    supercluster.load(points);
    clusterRef.current = supercluster;
    
    updateClusters(region);
  }, [elements]);

  // Handle location permissions on mount
  useEffect(() => {
    (async () => {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;

      let currentLocation = await Location.getCurrentPositionAsync({});
      setLocation(currentLocation);

      const userRegion = {
        latitude: currentLocation.coords.latitude,
        longitude: currentLocation.coords.longitude,
        latitudeDelta: 0.05,
        longitudeDelta: 0.05,
      };

      if (mapRef.current) {
        mapRef.current.animateToRegion(userRegion, 1000);
      }
    })();
  }, []);

  const updateClusters = (newRegion: Region) => {
    if (!clusterRef.current) return;
    const bbox = getBounds(newRegion);
    const zoom = getZoomLevel(newRegion);
    const newClusters = clusterRef.current.getClusters(bbox, zoom);
    setClusters(newClusters);
  };

  const handleRegionChangeComplete = (newRegion: Region) => {
    setRegion(newRegion);
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

  const handleMarkerPress = (merchant: BtcMapElement) => {
    setSelectedMerchant(merchant);
    mapRef.current?.animateToRegion({
      latitude: merchant.lat,
      longitude: merchant.lon,
      latitudeDelta: 0.005,
      longitudeDelta: 0.005,
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
    const baseColor = isDark ? '#121212' : '#f5f5f5';
    const roadColor = isDark ? '#2c2c2c' : '#ffffff';
    const labelColor = isDark ? '#8a8a8a' : '#9e9e9e';

    return [
      { elementType: 'geometry', stylers: [{ color: baseColor }] },
      { elementType: 'labels.text.fill', stylers: [{ color: labelColor }] },
      { elementType: 'labels.text.stroke', stylers: [{ color: baseColor }] },
      { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: theme.colors.primary }] },
      { featureType: 'poi', stylers: [{ visibility: 'off' }] },
      { featureType: 'road', elementType: 'geometry', stylers: [{ color: roadColor }] },
      { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: baseColor }] },
      { featureType: 'transit', stylers: [{ visibility: 'off' }] },
      { featureType: 'water', elementType: 'geometry', stylers: [{ color: isDark ? '#000000' : '#e0e0e0' }] },
    ];
  }, [isDark, theme]);

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <MapView
        ref={mapRef}
        style={styles.map}
        customMapStyle={mapStyle}
        showsUserLocation={true}
        showsMyLocationButton={false}
        showsCompass={false}
        showsScale={false}
        onRegionChangeComplete={handleRegionChangeComplete}
        initialRegion={region}
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
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      )}

      {error && (
        <View style={[styles.errorContainer, { backgroundColor: theme.colors.surface }]}>
          <Text style={{ color: theme.colors.error }}>Failed to load map data.</Text>
        </View>
      )}

      <TouchableOpacity 
        style={[styles.fab, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]} 
        onPress={centerOnUser}
        activeOpacity={0.8}
      >
        <Text style={{ color: theme.colors.primary, fontSize: 18, fontFamily: 'SpaceMono-Bold' }}>O</Text>
      </TouchableOpacity>

      {selectedMerchant && (
        <MerchantBottomSheet 
          merchant={selectedMerchant} 
          onClose={() => setSelectedMerchant(null)} 
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  map: {
    ...StyleSheet.absoluteFillObject,
  },
  loadingContainer: {
    position: 'absolute',
    top: 50,
    alignSelf: 'center',
    padding: 10,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  errorContainer: {
    position: 'absolute',
    top: 50,
    alignSelf: 'center',
    padding: 16,
    borderRadius: 8,
    borderWidth: 1,
  },
  fab: {
    position: 'absolute',
    bottom: 30,
    right: 20,
    width: 50,
    height: 50,
    borderRadius: 25,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
});