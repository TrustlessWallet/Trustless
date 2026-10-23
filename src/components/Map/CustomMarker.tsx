import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Marker } from 'react-native-maps';
import { MaterialIcons } from '@expo/vector-icons';
import { BtcMapElement } from '../../services/btcmap';
import { getCategoryIcon } from '../../services/mapCategory';

export { getCategoryIcon } from '../../services/mapCategory';

interface Props {
  merchant: BtcMapElement;
  onPress: () => void;
  theme: any;
}

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