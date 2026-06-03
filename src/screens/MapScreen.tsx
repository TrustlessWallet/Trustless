import React, { useEffect, useState, useRef, useMemo } from 'react';
import { StyleSheet, View, TouchableOpacity, ActivityIndicator } from 'react-native';
import MapView, { Region } from 'react-native-maps';
import MapViewCluster from 'react-native-map-clustering';
import * as Location from 'expo-location';
import useSWR from 'swr';
import { useTheme } from '../contexts/ThemeContext';
import { Text } from '../components/StyledText';

import CustomMarker from '../components/Map/CustomMarker';
import MerchantBottomSheet from '../components/Map/MerchantBottomSheet';

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export default function MapScreen() {
  const { theme, isDark } = useTheme();
  const mapRef = useRef<MapView>(null);
  const [location, setLocation] = useState<Location.LocationObject | null>(null);
  const [selectedMerchant, setSelectedMerchant] = useState<any | null>(null);

  const { data: elements, error, isLoading } = useSWR(
    'https://api.btcmap.org/v2/elements',
    fetcher,
    { revalidateOnFocus: false }
  );

  useEffect(() => {
    (async () => {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;

      let currentLocation = await Location.getCurrentPositionAsync({});
      setLocation(currentLocation);

      if (mapRef.current) {
        mapRef.current.animateToRegion({
          latitude: currentLocation.coords.latitude,
          longitude: currentLocation.coords.longitude,
          latitudeDelta: 0.05,
          longitudeDelta: 0.05,
        }, 1000);
      }
    })();
  }, []);

  const centerOnUser = async () => {
    if (!location) return;
    mapRef.current?.animateToRegion({
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
      latitudeDelta: 0.05,
      longitudeDelta: 0.05,
    }, 1000);
  };

  const handleMarkerPress = (merchant: any) => {
    setSelectedMerchant(merchant);
    mapRef.current?.animateToRegion({
      latitude: merchant.lat,
      longitude: merchant.lon,
      latitudeDelta: 0.005,
      longitudeDelta: 0.005,
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
      <MapViewCluster
        ref={mapRef}
        style={styles.map}
        customMapStyle={mapStyle}
        showsUserLocation={true}
        showsMyLocationButton={false}
        showsCompass={false}
        showsScale={false}
        clusterColor={theme.colors.primary}
        clusterTextColor={theme.colors.background}
        initialRegion={{
          latitude: 0,
          longitude: 0,
          latitudeDelta: 100,
          longitudeDelta: 100,
        }}
      >
        {elements && elements.map((element: any) => (
          <CustomMarker 
            key={element.id} 
            merchant={element} 
            onPress={() => handleMarkerPress(element)}
            theme={theme}
          />
        ))}
      </MapViewCluster>

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