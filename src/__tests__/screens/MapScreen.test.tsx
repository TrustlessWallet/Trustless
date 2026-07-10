import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';
import useSWR from 'swr';
import * as Location from 'expo-location';
import { useIsFocused } from '@react-navigation/native';
import MapScreen from '../../screens/MapScreen';

// --- Mocks ---

jest.mock('swr');
jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
}));

jest.mock('@react-navigation/native', () => ({
  useIsFocused: jest.fn(),
}));

jest.mock('react-native-maps', () => {
  const React = require('react');
  const { View } = require('react-native');
  const MapView = React.forwardRef((props: any, ref: any) => {
    React.useImperativeHandle(ref, () => ({
      animateToRegion: jest.fn(),
    }));
    return (
      <View testID="map-view" mapType={props.mapType}>
        {props.children}
      </View>
    );
  });
  return {
    __esModule: true,
    default: MapView,
  };
});

jest.mock('@gorhom/bottom-sheet', () => {
  const React = require('react');
  const { View } = require('react-native');
  class BottomSheet extends React.Component {
    snapToIndex = jest.fn();
    render() {
      return <View testID="bottom-sheet">{this.props.children}</View>;
    }
  }
  return BottomSheet;
});

jest.mock('../../contexts/ThemeContext', () => ({
  useTheme: () => ({
    theme: {
      colors: {
        background: '#000000',
        surface: '#1A1A1A',
        primary: '#FFFFFF',
        error: '#FF0000',
        muted: '#888888',
        border: '#333333',
      },
    },
  }),
}));

jest.mock('@expo/vector-icons', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    MaterialIcons: ({ name }: any) => <Text>{name}</Text>,
  };
});

jest.mock('expo-symbols', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    SymbolView: ({ name }: any) => <Text>{name}</Text>,
  };
});

// Mock CustomMarker and ClusterMarker to simplify testing
jest.mock('../../components/Map/CustomMarker', () => {
  const React = require('react');
  const { TouchableOpacity } = require('react-native');
  return ({ onPress, merchant }: any) => (
    <TouchableOpacity testID={`custom-marker-${merchant.id}`} onPress={onPress} />
  );
});

jest.mock('../../components/Map/ClusterMarker', () => {
  const React = require('react');
  const { TouchableOpacity } = require('react-native');
  return ({ onPress, pointCount }: any) => (
    <TouchableOpacity testID={`cluster-marker-${pointCount}`} onPress={onPress} />
  );
});

jest.mock('../../components/Map/MerchantBottomSheet', () => {
  const React = require('react');
  const { View } = require('react-native');
  return () => <View testID="merchant-bottom-sheet" />;
});

// --- Tests ---

describe('MapScreen Component', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useIsFocused as jest.Mock).mockReturnValue(true);
    (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
    (Location.getCurrentPositionAsync as jest.Mock).mockResolvedValue({
      coords: { latitude: 40.0, longitude: -74.0 },
    });
  });

  it('displays loading state correctly', async () => {
    (useSWR as jest.Mock).mockReturnValue({
      data: undefined,
      error: undefined,
      isLoading: true,
    });

    const { getByText } = render(<MapScreen />);
    
    await waitFor(() => {
      expect(getByText('Loading merchants...')).toBeTruthy();
    });
  });

  it('displays error state correctly', async () => {
    (useSWR as jest.Mock).mockReturnValue({
      data: undefined,
      error: new Error('Network error'),
      isLoading: false,
    });

    const { getByText } = render(<MapScreen />);
    
    await waitFor(() => {
      expect(getByText('Failed to load map data.')).toBeTruthy();
    });
  });

  it('requests location permissions and fetches coordinates when focused', async () => {
    (useSWR as jest.Mock).mockReturnValue({ data: [], error: undefined, isLoading: false });

    render(<MapScreen />);

    await waitFor(() => {
      expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
      expect(Location.getCurrentPositionAsync).toHaveBeenCalledTimes(1);
    });
  });

  it('toggles map type when the map type FAB is pressed', async () => {
    (useSWR as jest.Mock).mockReturnValue({ data: [], error: undefined, isLoading: false });

    const { getByTestId, getByText } = render(<MapScreen />);
    
    const mapView = getByTestId('map-view');
    expect(mapView.props.mapType).toBe('standard');

    let fabIcon;
    await waitFor(() => {
      try {
        fabIcon = getByText('layers'); // Android fallback
      } catch {
        fabIcon = getByText('square.stack.3d.up.fill'); // iOS fallback
      }
      expect(fabIcon).toBeTruthy();
    });
    
    fireEvent.press(fabIcon!);

    await waitFor(() => {
      expect(mapView.props.mapType).toBe('satellite');
    });
  });

  it('renders custom markers when valid merchant data is returned', async () => {
    const mockElements = [
      // Coordinates placed close to the mocked current location (40.0, -74.0) so they render within the bounding box
      { id: '1', lat: 40.01, lon: -74.01, tags: { name: 'Merchant A' } },
      { id: '2', lat: 39.99, lon: -73.99, tags: { name: 'Merchant B' } },
    ];

    (useSWR as jest.Mock).mockReturnValue({
      data: mockElements,
      error: undefined,
      isLoading: false,
    });

    const { getByTestId } = render(<MapScreen />);

    await waitFor(() => {
      expect(getByTestId('custom-marker-1')).toBeTruthy();
      expect(getByTestId('custom-marker-2')).toBeTruthy();
    });
  });

  it('opens the merchant bottom sheet when a marker is pressed', async () => {
    const mockElements = [
      { id: '1', lat: 40.01, lon: -74.01, tags: { name: 'Merchant A' } },
    ];

    (useSWR as jest.Mock).mockReturnValue({
      data: mockElements,
      error: undefined,
      isLoading: false,
    });

    const { getByTestId, queryByTestId } = render(<MapScreen />);

    expect(queryByTestId('merchant-bottom-sheet')).toBeNull();

    await waitFor(() => {
      expect(getByTestId('custom-marker-1')).toBeTruthy();
    });

    fireEvent.press(getByTestId('custom-marker-1'));

    await waitFor(() => {
      expect(getByTestId('merchant-bottom-sheet')).toBeTruthy();
    });
  });
});