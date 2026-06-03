import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Marker } from 'react-native-maps';
import { Text } from '../StyledText';

export default function ClusterMarker({ geometry, properties, onPress, theme }: any) {
  const points = properties.point_count;
  
  return (
    <Marker
      coordinate={{
        longitude: geometry.coordinates[0],
        latitude: geometry.coordinates[1],
      }}
      onPress={onPress}
      tracksViewChanges={false}
    >
      <View 
        style={[
          styles.cluster, 
          { backgroundColor: theme.colors.text, borderColor: theme.colors.background }
        ]}
      >
        <Text style={[styles.text, { color: theme.colors.background }]}>
          {points > 99 ? '99+' : points}
        </Text>
      </View>
    </Marker>
  );
}

const styles = StyleSheet.create({
  cluster: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 3,
    justifyContent: 'center',
    alignItems: 'center',
  },
  text: {
    fontSize: 12,
    fontFamily: 'SpaceMono-Bold',
  },
});