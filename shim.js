import 'react-native-get-random-values';
import 'react-native-url-polyfill/auto'; // Preserved
import { Platform } from 'react-native';

// 1. Process Polyfill (Your original robust logic)
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

// 2. Environment Setup (Preserved)
global.process.env.NODE_ENV = __DEV__ ? 'development' : 'production';
global.process.version = 'v18.18.0';

// 3. Buffer Polyfill
global.Buffer = require('buffer').Buffer;

// 4. Text Encoding
if (typeof global.TextEncoder === 'undefined') {
  global.TextEncoder = require('text-encoding').TextEncoder;
}
if (typeof global.TextDecoder === 'undefined') {
  global.TextDecoder = require('text-encoding').TextDecoder;
}

// 5. Crypto & BigInt (Preserved)
require('crypto');

if (typeof global.BigInt === 'undefined') {
    global.BigInt = require('big-integer');
}

// --- NEW ADDITION FOR ELECTRUM ---
// This allows 'rn-electrum-client' to use TCP sockets on mobile
const TcpSocket = require('react-native-tcp-socket');
global.net = TcpSocket;
global.tls = TcpSocket;

process.browser = true;