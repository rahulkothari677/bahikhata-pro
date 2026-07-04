# Play Store APK Build Guide — BahiKhata Pro

## Overview

This guide walks you through building an Android APK from the BahiKhata Pro web app using Capacitor 8.x, and uploading it to the Google Play Store.

## Architecture

```
Next.js Web App (Vercel)  →  Capacitor Wrapper (Android APK)
         ↑                           ↑
    Real app logic              Just a WebView wrapper
    (database, AI, etc.)       (loads https://bahikhata-pro.vercel.app)
```

The APK is a **wrapper** — it loads the web app from Vercel inside a native Android WebView. This means:
- ✅ No need to rebuild APK for every code change
- ✅ Updates happen automatically (when you deploy to Vercel)
- ✅ All features work (AI scanner, voice, offline mode, etc.)
- ✅ Native features (camera, haptics, share) work via Capacitor plugins

## Prerequisites

### On your computer:
1. **Android Studio** — download from https://developer.android.com/studio
   - This includes Android SDK + Gradle + Emulator
2. **Java JDK 17+** — comes with Android Studio, or install separately
3. **Node.js** — already installed (you're using it for the project)

### On your phone (for testing):
1. **Android phone** with USB debugging enabled
   - Settings → About Phone → tap "Build Number" 7 times
   - Settings → Developer Options → enable "USB Debugging"

## Step-by-Step Build Process

### Step 1: Open project in Android Studio

```bash
# From the project root:
cd /home/z/my-project

# Open Android project in Android Studio
studio android/
```

Or manually:
1. Open Android Studio
2. Click "Open" → select the `android/` folder
3. Wait for Gradle sync to complete (first time takes 2-5 minutes)

### Step 2: Build the APK

**Option A: Using the build script (recommended)**
```bash
cd /home/z/my-project
./scripts/build-apk.sh
```

**Option B: Manual build**
```bash
# 1. Build Next.js
npm run build

# 2. Sync Capacitor
npx cap sync android

# 3. Build APK
cd android
./gradlew assembleRelease
```

**Option C: Using Android Studio GUI**
1. Open `android/` in Android Studio
2. Click "Build" → "Build Bundle(s) / APK(s)" → "Build APK(s)"
3. Wait for build to complete
4. Click "locate" in the notification to find the APK

### Step 3: Find the APK

The APK file will be at:
```
android/app/build/outputs/apk/release/app-release.apk
```

### Step 4: Test on a real device

```bash
# Connect phone via USB (with USB debugging enabled)
adb install android/app/build/outputs/apk/release/app-release.apk
```

Or:
1. Copy the APK to your phone (email, Google Drive, etc.)
2. Open the APK file on your phone
3. Allow "Install from unknown sources" if prompted
4. Open "BahiKhata Pro" from app drawer

## Step 5: Create a Release Keystore (for Play Store)

The APK built above is signed with a **debug key** — fine for testing but NOT accepted by Play Store.

Create a release keystore:

```bash
keytool -genkey -v \
  -keystore release.keystore \
  -alias bahikhata \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000
```

You'll be prompted for:
- Password (choose a strong one — SAVE THIS)
- Your name, organization, etc.
- This creates `release.keystore` file

**IMPORTANT: Save this file and password securely. If you lose it, you can NEVER update the app on Play Store.**

### Step 6: Configure release signing

Edit `android/app/build.gradle` — add before `buildTypes`:

```gradle
signingConfigs {
    release {
        storeFile file('../../release.keystore')
        storePassword 'YOUR_PASSWORD'
        keyAlias 'bahikhata'
        keyPassword 'YOUR_PASSWORD'
    }
}
```

Then change the release build type:
```gradle
buildTypes {
    release {
        signingConfig signingConfigs.release
        minifyEnabled true
        proguardFiles getDefaultProguardFile('proguard-android.txt'), 'proguard-rules.pro'
    }
}
```

### Step 7: Rebuild with release key

```bash
cd android
./gradlew assembleRelease
```

The signed APK will be at:
```
android/app/build/outputs/apk/release/app-release.apk
```

### Step 8: Upload to Play Store

1. Go to https://play.google.com/console
2. Pay the one-time ₹2,100 registration fee
3. Click "Create App"
4. Fill in app details:
   - **App name:** BahiKhata Pro
   - **Package name:** pro.bahikhata.app
   - **Category:** Business
   - **Target audience:** 18+ (business owners)
5. Upload the signed APK
6. Fill in store listing:
   - App description
   - Screenshots (take from running app)
   - Feature graphic
   - Privacy policy URL
7. Submit for review (Google takes 1-3 days to approve)

## App Configuration

### App Identity
| Property | Value |
|----------|-------|
| App ID | `pro.bahikhata.app` |
| App Name | `BahiKhata Pro` |
| Version | 1.0.0 |
| Version Code | 1 |
| Min SDK | 24 (Android 7.0) |
| Target SDK | 36 (Android 16) |

### Permissions
| Permission | Why |
|-----------|-----|
| INTERNET | Load web app from Vercel |
| ACCESS_NETWORK_STATE | Check online/offline status |
| CAMERA | Bill scanner (AI) |
| READ_EXTERNAL_STORAGE | Read bill images |
| WRITE_EXTERNAL_STORAGE | Save exported files (PDF, CSV) |
| VIBRATE | Haptic feedback |

### Native Plugins (Capacitor)
| Plugin | Version | Purpose |
|--------|---------|---------|
| @capacitor/app | 8.1.0 | App lifecycle (back button, URLs) |
| @capacitor/camera | 8.0.2 | Bill scanner camera |
| @capacitor/filesystem | 8.0.2 | Save files locally |
| @capacitor/haptics | 8.0.2 | Vibration feedback |
| @capacitor/preferences | 8.0.01 | Local storage |
| @capacitor/share | 8.0.1 | Share invoices/reports |
| @capacitor/splash-screen | 8.0.1 | Launch splash screen |
| @capacitor/status-bar | 8.0.2 | Status bar color |

## Updating the App

Since the APK is a **web wrapper**, most updates don't require a new APK:
- Code changes → deploy to Vercel → app auto-updates on next launch
- UI changes → deploy to Vercel → app auto-updates
- New features → deploy to Vercel → app auto-updates

**When you DO need a new APK:**
- Changing app name or icon
- Adding new native permissions
- Updating Capacitor plugins
- Increasing version code for Play Store

## Troubleshooting

### "Missing out directory" warning
This is normal — we use `server.url` (load from Vercel), not bundled web assets. The `out` directory doesn't need to exist.

### App shows blank white screen
- Check if Vercel is accessible: open `https://bahikhata-pro.vercel.app` in phone browser
- Check `capacitor.config.json` → `server.url` is correct
- Check network security config allows the Vercel domain

### Camera not working
- Ensure `CAMERA` permission is in AndroidManifest.xml (it is)
- Check that Capacitor camera plugin is installed (it is: @capacitor/camera 8.0.2)

### Build fails with "SDK not found"
- Open Android Studio → SDK Manager → install Android SDK 36
- Set `ANDROID_HOME` environment variable

### Gradle build fails
- Try: `cd android && ./gradlew clean`
- Then: `./gradlew assembleRelease`
