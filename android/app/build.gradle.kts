plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "com.airvpn.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.airvpn.app"
        minSdk = 26
        targetSdk = 35
        versionCode = 4
        versionName = "1.2.0"
        ndk {
            // Match libv2ray.aar ABIs
            abiFilters += listOf("arm64-v8a", "armeabi-v7a", "x86_64")
        }
        buildConfigField("String", "API_BASE_URL", "\"https://airnetwork.flash-myanmar.com/\"")
        // Must match server MOBILE_CONFIG_KEY (sha256 of secret is used for AES)
        buildConfigField(
            "String",
            "CONFIG_KEY_MATERIAL",
            "\"ILoveWathanIn2023andStill2026AndAStillCounting9999\"",
        )
        buildConfigField("String", "TELEGRAM_URL", "\"https://t.me/airvpn_myanmar_bot\"")
        buildConfigField("String", "PRIVACY_URL", "\"https://airvpn.app/privacy\"")
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
        jniLibs {
            // libv2ray ships prebuilt .so per ABI
            useLegacyPackaging = true
        }
    }

    // Keep APK lean for debug if needed — full ABIs for release
    splits {
        abi {
            isEnable = false
        }
    }
}

dependencies {
    // AndroidLibXrayLite — real Xray core + gVisor TUN
    implementation(files("libs/libv2ray.aar"))

    val composeBom = platform("androidx.compose:compose-bom:2024.12.01")
    implementation(composeBom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
    implementation("androidx.navigation:navigation-compose:2.8.5")
    implementation("androidx.security:security-crypto:1.1.0-alpha06")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("com.squareup.retrofit2:retrofit:2.11.0")
    implementation("com.squareup.retrofit2:converter-moshi:2.11.0")
    implementation("com.squareup.moshi:moshi-kotlin:1.15.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    implementation("io.coil-kt:coil-compose:2.7.0")
    // Real SSH client (password auth over TLS-wrapped socket)
    implementation("com.hierynomus:sshj:0.38.0")
    implementation("org.bouncycastle:bcprov-jdk18on:1.78.1")
    debugImplementation("androidx.compose.ui:ui-tooling")
}
