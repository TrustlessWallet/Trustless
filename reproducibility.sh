set -e

echo "0. Hiding environment variables..."
if [ -f .env ]; then
    mv .env .env.backup
fi

trap 'if [ -f .env.backup ]; then mv .env.backup .env; fi' EXIT

echo "1. Generating version metadata..."
node src/scripts/write-version.js

echo "2. Installing dependencies..."
npm ci --legacy-peer-deps

echo "3. Generating android and ios directories..."
export CI=1
npx expo prebuild --clean

echo "4. Injecting reproducibility settings..."
echo "" >> android/gradle.properties
echo "org.gradle.jvmargs=-Xmx4096m -XX:MaxMetaspaceSize=1024m" >> android/gradle.properties
# The React Native Gradle plugin bakes the build machine's first non-loopback IPv4 address
# into resources.arsc (string "react_native_dev_server_ip"), even for release builds. Inside
# Docker that is the container IP (e.g. 172.17.0.2 vs 172.18.0.2), which differs between
# machines and breaks bit-for-bit reproducibility. So we pin it to a constant.
echo "reactNativeDevServerIp=localhost" >> android/gradle.properties

cat <<EOF >> android/app/build.gradle

android {
    buildTypes {
        release {
            signingConfig null
        }
    }
}

tasks.withType(AbstractArchiveTask).configureEach {
    preserveFileTimestamps = false
    reproducibleFileOrder = true
}
EOF

echo "5. Compiling APK..."
export MAX_WORKERS=1
export NODE_ENV=production
cd android
./gradlew assembleRelease --no-daemon
cd ..

echo "6. Build successful"