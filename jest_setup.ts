import 'react-native-gesture-handler/jestSetup';

jest.mock('@react-native-async-storage/async-storage', () =>
    require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('react-native-tcp-socket', () => ({
    default: {
        createConnection: jest.fn(),
        Server: jest.fn()
    },
    createConnection: jest.fn(),
    Server: jest.fn()
}));

Object.defineProperty(global, 'document', {
    value: {
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
    },
    writable: true
});