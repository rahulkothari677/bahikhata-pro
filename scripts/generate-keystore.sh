#!/bin/bash
#
# Generate a release keystore for signing the BahiKhata Pro APK.
#
# This keystore is PERMANENT — keep it safe. If you lose it, you can never
# update the app on the Play Store (Google requires the same key for all updates).
#
# Usage:
#   chmod +x scripts/generate-keystore.sh
#   ./scripts/generate-keystore.sh
#
# The keystore will be saved to: android/bahikhata-release.keystore
# A template keystore.properties file will also be created.
#

KEYSTORE_PATH="android/bahikhata-release.keystore"
ALIAS="bahikhata"
VALIDITY=10000  # ~27 years (Google requires at least 25 years)

echo "============================================"
echo "  BahiKhata Pro — Release Keystore Generator"
echo "============================================"
echo ""

# Check if keystore already exists
if [ -f "$KEYSTORE_PATH" ]; then
  echo "⚠️  WARNING: Keystore already exists at $KEYSTORE_PATH"
  echo "   Do you want to overwrite it? This is PERMANENT and cannot be undone."
  echo "   Type 'YES' to continue, anything else to abort:"
  read -r confirm
  if [ "$confirm" != "YES" ]; then
    echo "Aborted. Existing keystore preserved."
    exit 0
  fi
  rm "$KEYSTORE_PATH"
fi

# Create android directory if it doesn't exist
mkdir -p android

echo "Generating keystore..."
echo ""
echo "You'll be asked for:"
echo "  1. Keystore password (make it strong — write it down!)"
echo "  2. Keystore password confirmation"
echo "  3. Key password (can be same as keystore — just press Enter)"
echo "  4. Your name (use your real name)"
echo "  5. Your organization (e.g. 'BahiKhata Pro')"
echo "  6. City, State, Country code (2 letters, e.g. 'IN')"
echo ""

keytool -genkey -v \
  -keystore "$KEYSTORE_PATH" \
  -alias "$ALIAS" \
  -keyalg RSA \
  -keysize 2048 \
  -validity $VALIDITY

if [ $? -eq 0 ]; then
  echo ""
  echo "✅ Keystore created successfully at: $KEYSTORE_PATH"
  echo ""
  echo "Now create a file called 'android/keystore.properties' with:"
  echo ""
  echo "  storeFile=bahikhata-release.keystore"
  echo "  storePassword=YOUR_KEYSTORE_PASSWORD"
  echo "  keyAlias=bahikhata"
  echo "  keyPassword=YOUR_KEY_PASSWORD"
  echo ""
  echo "⚠️  IMPORTANT:"
  echo "  - NEVER commit keystore.properties or the .keystore file to git"
  echo "  - Back up the keystore to Google Drive + a USB stick"
  echo "  - If you lose this keystore, you CANNOT update the app on Play Store"
  echo ""
  echo "Next step: Add the signing config to android/app/build.gradle"
  echo "(see scripts/build-release-apk.sh for instructions)"
else
  echo ""
  echo "❌ Keystore generation failed."
  exit 1
fi
