import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Marker } from 'react-native-maps';

export default function CustomMarker({ merchant, onPress, theme }: any) {
  return (
    <Marker
      coordinate={{ latitude: merchant.lat, longitude: merchant.lon }}
      onPress={onPress}
    >
      <View 
        style={[
          styles.dot, 
          { backgroundColor: theme.colors.primary, borderColor: theme.colors.background }
        ]} 
      />
    </Marker>
  );
}

const styles = StyleSheet.create({
  dot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
  },
});