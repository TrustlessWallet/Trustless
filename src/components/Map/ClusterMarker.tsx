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
      <View 
        style={[
          styles.cluster, 
          { backgroundColor: theme.colors.primary, borderColor: theme.colors.background }
        ]}
      >
        <Text style={[styles.text, { color: theme.colors.background }]}>
          {pointCount > 99 ? '99+' : pointCount}
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