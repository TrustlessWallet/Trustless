const { getDefaultConfig } = require('expo/metro-config');
const defaultConfig = getDefaultConfig(__dirname);

defaultConfig.projectRoot = __dirname;

defaultConfig.resolver.sourceExts = [
  'expo.ts', 'expo.tsx', 'expo.js', 'expo.jsx',
  'ts', 'tsx', 'js', 'jsx', 'json', 'mjs', 'cjs',
];

defaultConfig.resolver.assetExts = [
  ...defaultConfig.resolver.assetExts,
  'wasm',
  'mp4',
  'mov',
  'avi',
  'mkv',
  'webm',
  'm4v',
  'mpg',
  'mpeg'
];

defaultConfig.resolver.extraNodeModules = {
  ...require('node-libs-browser'),
  crypto: require.resolve('crypto-browserify'),
  stream: require.resolve('stream-browserify'),
  buffer: require.resolve('buffer/'),
  process: require.resolve('process/browser'),
  events: require.resolve('events/'),
  util: require.resolve('util/'),
  vm: require.resolve('vm-browserify'),
  path: require.resolve('path-browserify'),
  os: require.resolve('os-browserify/browser'),
  net: require.resolve('react-native-tcp-socket'),
  tls: require.resolve('react-native-tcp-socket'),
};

defaultConfig.transformer = {
  ...defaultConfig.transformer,
  minifierConfig: {
    ...defaultConfig.transformer?.minifierConfig,
    keep_fnames: true,
    mangle: {
      keep_fnames: true,
    },
  },
};

module.exports = defaultConfig;