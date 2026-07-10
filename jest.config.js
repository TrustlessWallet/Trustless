module.exports = {
    preset: "jest-expo",
    setupFiles: ["<rootDir>/jest_setup.ts"],
    testMatch: [
        "**/__tests__/**/*.test.ts", 
        "**/__tests__/**/*.test.tsx"
    ],
    transformIgnorePatterns: [
        "node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|supercluster|kdbush)"
    ]
};