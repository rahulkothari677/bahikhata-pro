#!/bin/bash
#
# Build a signed release APK for the Play Store.
#
# Prerequisites:
#   1. Run scripts/generate-keystore.sh first (creates the keystore)
#   2. Create android/keystore.properties with your keystore credentials
#   3. Android Studio installed (or at least Android SDK + Gradle)
#   4. JAVA_HOME set to Android Studio's JBR
#
# Usage:
#   chmod +x scripts/build-release-apk.sh
#   ./scripts/build-release-apk.sh
#
# Output:
#   android/app/build/outputs/apk/release/app-release.apk
#

set -e  # exit on any error

echo "============================================"
echo "  BahiKhata Pro — Release APK Builder"
echo "============================================"
echo ""

# Check prerequisites
KEYSTORE="android/bahikhata-release.keystore"
KEYSTORE_PROPS="android/keystore.properties"

if [ ! -f "$KEYSTORE" ]; then
  echo "❌ Keystore not found at $KEYSTORE"
  echo "   Run ./scripts/generate-keystore.sh first"
  exit 1
fi

if [ ! -f "$KEYSTORE_PROPS" ]; then
  echo "❌ keystore.properties not found at $KEYSTORE_PROPS"
  echo "   Create it with:"
  echo "     storeFile=bahikhata-release.keystore"
  echo "     storePassword=YOUR_KEYSTORE_PASSWORD"
  echo "     keyAlias=bahikhata"
  echo "     keyPassword=YOUR_KEY_PASSWORD"
  exit 1
fi

# Step 1: Build the Next.js app and sync to Capacitor
echo "📦 Step 1: Building Next.js app..."
npm run build
echo "✅ Next.js build complete"
echo ""

# Step 2: Sync web assets to Capacitor
echo "🔄 Step 2: Syncing to Capacitor..."
npx cap sync android
echo "✅ Capacitor sync complete"
echo ""

# Step 3: Set JAVA_HOME if not set (common on Windows)
if [ -z "$JAVA_HOME" ]; then
  if [ -d "/c/Program Files/Android/Android Studio/jbr" ]; then
    export JAVA_HOME="/c/Program Files/Android/Android Studio/jbr"
    echo "Set JAVA_HOME to: $JAVA_HOME"
  fi
fi

# Step 4: Build the release APK
echo "🔨 Step 3: Building signed release APK..."
cd android
./gradlew assembleRelease

# Step 5: Check if APK was created
APK_PATH="app/build/outputs/apk/release/app-release.apk"
if [ -f "$APK_PATH" ]; then
  echo ""
  echo "✅ Release APK built successfully!"
  echo ""
  echo "   Location: android/$APK_PATH"
  echo ""
  echo "   File size: $(du -h $APK_PATH | cut -f1)"
  echo ""
  echo "Next steps:"
  echo "  1. Go to https://play.google.com/console"
  echo "  2. Create a new app (one-time $25 fee)"
  echo "  3. Upload app-release.apk under 'Production' → 'Create release'"
  echo "  4. Fill in the store listing (see scripts/play-store-listing.md)"
  echo ""
  echo "⚠️  DO NOT lose the keystore — you'll need it for ALL future updates!"
else
  echo ""
  echo "❌ APK build failed. Check the gradle output above."
  exit 1
fi
