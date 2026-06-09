#!/bin/bash
set -e

echo "Building isolated Docker environment..."
docker build -t trustless-builder .

echo "Executing reproducible build inside container..."

docker run --rm -v "$(pwd):/app" trustless-builder

echo "Build complete. Output located at: android/app/build/outputs/apk/release/app-release-unsigned.apk"