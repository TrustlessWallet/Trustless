import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Marker } from 'react-native-maps';
import { Text } from '../StyledText';

export default function ClusterMarker({ coordinate, pointCount, onPress, theme }: any) {
  return (
    <Marker
      coordinate={coordinate}
      onPress={onPress}
    >
      <View style={[styles.cluster, { borderColor: theme.colors.background }]}>
        <Text style={styles.text}>
          {pointCount > 99 ? '99+' : pointCount}
        </Text>
      </View>
    </Marker>
  );
}

const styles = StyleSheet.create({
  cluster: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 2.5,
    backgroundColor: '#F7931A', // Bitcoin Orange
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  text: {
    fontSize: 14,
    color: '#FFFFFF',
    fontFamily: 'SpaceMono-Bold',
  },
});