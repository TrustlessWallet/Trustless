import 'react-native-get-random-values';
import 'react-native-url-polyfill/auto';
if (typeof global.process === 'undefined') {
  global.process = require('process');
} else {
  const bProcess = require('process');
  for (var p in bProcess) {
    if (!(p in global.process)) {
      global.process[p] = bProcess[p];
    }
  }
}
global.process.env.NODE_ENV = __DEV__ ? 'development' : 'production';
global.process.version = 'v18.18.0';
global.Buffer = require('buffer').Buffer;
if (typeof global.TextEncoder === 'undefined') {
  global.TextEncoder = require('text-encoding').TextEncoder;
}
if (typeof global.TextDecoder === 'undefined') {
  global.TextDecoder = require('text-encoding').TextDecoder;
}
require('crypto');
if (typeof global.BigInt === 'undefined') {
    global.BigInt = require('big-integer');
}