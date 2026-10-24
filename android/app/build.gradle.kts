plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.agenticai.jarvis"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.agenticai.jarvis"
        minSdk = 26 // Android 8 and newer
        targetSdk = 36
        versionCode = 1
        versionName = "1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }
    kotlinOptions {
        jvmTarget = "11"
    }
}

// No libraries: the app only uses what Android itself provides (speech, voices, notifications, WebView).
