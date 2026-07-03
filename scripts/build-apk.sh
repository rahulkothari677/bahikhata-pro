#!/bin/bash
# =====================================================================
# BahiKhata Pro — Android APK Build Script
# =====================================================================
# This script builds a signed APK ready for Play Store upload.
#
# PREREQUISITES:
#   1. Android Studio installed (or Android Command Line Tools)
#   2. Java JDK 17+ installed
#   3. Run this script from the project root (bahikhata-pro/)
#
# USAGE:
#   chmod +x scripts/build-apk.sh
#   ./scripts/build-apk.sh
#
# OUTPUT:
#   android/app/build/outputs/apk/release/app-release.apk
# =====================================================================

set -e

echo "=========================================="
echo "  BahiKhata Pro — APK Build Script"
echo "=========================================="
echo ""

# Step 1: Check prerequisites
echo "Step 1: Checking prerequisites..."

if ! command -v java &> /dev/null; then
    echo "❌ Java not found. Install JDK 17+ first."
    exit 1
fi

if [ ! -d "android" ]; then
    echo "❌ Android directory not found. Run 'npx cap add android' first."
    exit 1
fi

if [ ! -f "capacitor.config.json" ]; then
    echo "❌ capacitor.config.json not found."
    exit 1
fi

echo "✅ Prerequisites OK"
echo ""

# Step 2: Build Next.js (for web assets)
echo "Step 2: Building Next.js..."
npm run build
echo "✅ Next.js build complete"
echo ""

# Step 3: Copy web assets to Android
echo "Step 3: Syncing Capacitor..."
npx cap sync android
echo "✅ Capacitor sync complete"
echo ""

# Step 4: Build APK
echo "Step 4: Building APK..."
cd android

# Make gradlew executable
chmod +x gradlew

# Build release APK (signed with debug key for testing)
./gradlew assembleRelease --no-daemon

echo "✅ APK build complete"
echo ""

# Step 5: Show output location
APK_PATH="app/build/outputs/apk/release/app-release.apk"
if [ -f "$APK_PATH" ]; then
    echo "=========================================="
    echo "  ✅ APK Built Successfully!"
    echo "=========================================="
    echo ""
    echo "📦 APK Location:"
    echo "  android/$APK_PATH"
    echo ""
    echo "📋 Next Steps:"
    echo "  1. Test the APK on a real device:"
    echo "     adb install android/$APK_PATH"
    echo ""
    echo "  2. For Play Store upload, you need a RELEASE keystore:"
    echo "     keytool -genkey -v -keystore release.keystore -alias bahikhata \\"
    echo "       -keyalg RSA -keysize 2048 -validity 10000"
    echo ""
    echo "  3. Then rebuild with the release keystore (see PLAY-STORE-GUIDE.md)"
    echo ""
else
    echo "❌ APK not found at expected location."
    echo "Check android/app/build/outputs/ for the APK."
fi
