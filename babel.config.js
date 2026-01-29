module.exports = function(api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      [
        'module-resolver',
        {
          alias: {
            // Force 'net' and 'tls' to point to the React Native library
            'net': 'react-native-tcp-socket',
            'tls': 'react-native-tcp-socket',
            // Ensure other node core modules resolve correctly
            'crypto': 'react-native-crypto',
            'stream': 'stream-browserify',
            'buffer': 'buffer',
            'events': 'events',
            'process': 'process/browser',
          },
        },
      ],
      'react-native-reanimated/plugin',
    ],
  };
};