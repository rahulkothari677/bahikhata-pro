# BahiKhata Pro — Android App (Capacitor)

This folder contains the Android wrapper for the BahiKhata Pro web app, built with Capacitor.

## How to Build the APK

### Prerequisites
1. Install [Android Studio](https://developer.android.com/studio) (or just the Android SDK command line tools)
2. Install [Node.js](https://nodejs.org/) (you already have this)
3. Make sure Java 17+ is installed (comes with Android Studio)

### Steps

```bash
# 1. Build the web app (already done by Vercel, but needed for local builds)
npm run build

# 2. Add Android platform (only needed once)
npx cap add android

# 3. Sync web assets to native project
npx cap sync android

# 4. Build the APK
cd android
./gradlew assembleDebug

# 5. Find the APK
# Debug APK: android/app/build/outputs/apk/debug/app-debug.apk
# Release APK: android/app/build/outputs/apk/release/app-release.apk
```

### Testing on Your Phone

```bash
# Option A: Install via USB
# Enable USB debugging on your phone → connect → run:
cd android
./gradlew installDebug

# Option B: Copy APK to phone
# Copy app-debug.apk to your phone → open file → install
```

### Opening in Android Studio

```bash
npx cap open android
# Android Studio opens → you can run/debug from there
```

## Configuration

- **App ID:** `pro.bahikhata.app`
- **App Name:** BahiKhata Pro
- **Web URL:** https://bahikhata-pro.vercel.app
- **Status Bar:** Saffron orange (#d97706)
- **Splash Screen:** Saffron background with app logo
- **Orientation:** Portrait only
- **Permissions:** Internet, Camera, Vibrate, Storage

## Native Plugins Included

| Plugin | Purpose |
|---|---|
| @capacitor/status-bar | Status bar color + style |
| @capacitor/splash-screen | Splash screen on launch |
| @capacitor/haptics | Native vibration feedback |
| @capacitor/app | Back button + lifecycle handling |
| @capacitor/preferences | Native key-value storage |

## Publishing to Play Store

1. Build release APK:
   ```bash
   cd android
   ./gradlew assembleRelease
   ```

2. Sign the APK (you need a keystore):
   ```bash
   keytool -genkey -v -keystore bahikhata-release.keystore -alias bahikhata -keyalg RSA -keysize 2048 -validity 10000
   ```

3. Upload to [Google Play Console](https://play.google.com/console):
   - Create new app → "BahiKhata Pro"
   - Upload signed APK
   - Fill store listing (description, screenshots, etc.)
   - Submit for review (takes 1-3 days)

## iOS (Future)

For iOS, you need a Mac:
```bash
npx cap add ios
npx cap sync ios
npx cap open ios
# Xcode opens → build + submit to App Store
```
