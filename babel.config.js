module.exports = function(api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      [
        'module-resolver',
        {
          alias: {
            'net': 'react-native-tcp-socket',
            'tls': 'react-native-tcp-socket',
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