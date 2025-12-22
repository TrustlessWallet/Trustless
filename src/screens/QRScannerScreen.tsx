import React, { useEffect, useMemo } from 'react';
import { View, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Text } from '../components/StyledText';
import { Feather } from '@expo/vector-icons';
import { CameraView, useCameraPermissions, BarcodeScanningResult } from 'expo-camera';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { useTheme } from '../contexts/ThemeContext'; 
import { Theme } from '../constants/theme'; 
type QRScannerScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'QRScanner'>;
type QRScannerScreenRouteProp = RouteProp<RootStackParamList, 'QRScanner'>;
const QRScannerScreen = () => {
  const [permission, requestPermission] = useCameraPermissions();
  const navigation = useNavigation<QRScannerScreenNavigationProp>();
  const route = useRoute<QRScannerScreenRouteProp>();
  const { onScanSuccess } = route.params;
  const { theme } = useTheme(); 
  const styles = useMemo(() => getStyles(theme), [theme]); 
  const handleBarCodeScanned = (scanningResult: BarcodeScanningResult) => {
    const address = scanningResult.data.replace(/^(bitcoin:)/, '');
    onScanSuccess(address);
    navigation.goBack();
  };
  useEffect(() => {
    if (!permission || !permission.granted) {
      requestPermission();
    }
  }, [permission, requestPermission]);
  if (!permission) {
    return (
      <View style={styles.container}>
        <ActivityIndicator color={theme.colors.primary} />
      </View>
    );
  }
  if (!permission.granted) {
    return (
      <View style={styles.container}>
        <Text style={styles.permissionText}>We need your permission to show the camera</Text>
        <TouchableOpacity style={styles.permissionButton} onPress={requestPermission}>
          <View style={styles.buttonContentRowCentered}>
            <Feather name="camera" size={18} color={theme.colors.inversePrimary} />
            <Text style={styles.permissionButtonText}>Grant Permission</Text>
          </View>
        </TouchableOpacity>
      </View>
    );
  }
  return (
    <View style={styles.container}>
      <CameraView
        onBarcodeScanned={handleBarCodeScanned}
        barcodeScannerSettings={{
          barcodeTypes: ["qr"],
        }}
        facing="back"
        style={{ flex: 1, width: '100%' }}
      />
      <View style={styles.overlay}>
        <View style={styles.scanBox} />
        <Text style={styles.scanText}>Scan a Bitcoin Address QR Code</Text>
      </View>
    </View>
  );
};
const getStyles = (theme: Theme) => StyleSheet.create({
  container: { 
    flex: 1, 
    backgroundColor: theme.colors.background, 
    justifyContent: 'center', 
    alignItems: 'center', 
  },
  permissionText: { 
    color: theme.colors.primary, 
    textAlign: 'center', 
    fontSize: 18, 
    marginBottom: 20, 
  },
  permissionButton: { 
    backgroundColor: theme.colors.primary, 
    paddingVertical: 12, 
    paddingHorizontal: 16, 
    borderRadius: 8 
  },
  permissionButtonText: { 
    color: theme.colors.inversePrimary, 
    fontSize: 16, 
    fontWeight: '600' 
  },
  buttonContentRowCentered: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'center', 
    gap: 8 
  },
  overlay: { 
    ...StyleSheet.absoluteFillObject, 
    justifyContent: 'center', 
    alignItems: 'center', 
  },
  scanBox: { 
    width: 280, 
    height: 280, 
    borderWidth: 2, 
    borderColor: '#fff', 
    opacity: 0.7, 
    borderRadius: 12, 
  },
  scanText: { 
    color: '#fff', 
    marginTop: 20, 
    fontSize: 16, 
  },
});
export default QRScannerScreen;