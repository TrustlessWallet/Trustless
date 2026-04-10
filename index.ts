import './shim';
import 'react-native-get-random-values';
import '@azure/core-asynciterator-polyfill';
import { Buffer } from 'buffer';
global.Buffer = Buffer;
import { registerRootComponent } from 'expo';
import App from './App';
registerRootComponent(App);