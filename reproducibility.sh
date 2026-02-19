set -e

echo "1. Installing dependencies..."
npm install

echo "2. Generating android and ios directories..."
export CI=1
npx expo prebuild --clean

echo "3. Injecting reproducibility settings..."
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

echo "4. Generating version metadata..."
node src/scripts/write-version.js

echo "5. Compiling APK..."
export MAX_WORKERS=1
export NODE_ENV=production
cd android
./gradlew assembleRelease
cd ..

echo "6. Build successful"