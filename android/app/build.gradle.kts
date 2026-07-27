plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

import java.util.Properties

val keystorePropertiesFile = rootProject.file("keystore.properties")
val keystoreProperties = Properties()
if (keystorePropertiesFile.exists()) {
    keystorePropertiesFile.inputStream().use { keystoreProperties.load(it) }
}

android {
    namespace = "com.airvpn.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.airvpn.app"
        minSdk = 26
        targetSdk = 35
        versionCode = 6
        versionName = "1.2.2"
        ndk {
            // Single APK, phones only — drops ~70MB of unused ABI copies (no Play splits)
            abiFilters += listOf("arm64-v8a")
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

    signingConfigs {
        create("release") {
            if (keystorePropertiesFile.exists()) {
                storeFile = file(keystoreProperties["storeFile"] as String)
                storePassword = keystoreProperties["storePassword"] as String
                keyAlias = keystoreProperties["keyAlias"] as String
                keyPassword = keystoreProperties["keyPassword"] as String
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
            ndk {
                debugSymbolLevel = "NONE"
            }
            if (keystorePropertiesFile.exists()) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
        debug {
            isMinifyEnabled = false
        }
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
            excludes += "META-INF/versions/**"
            excludes += "META-INF/*.SF"
            excludes += "META-INF/*.RSA"
            excludes += "META-INF/*.DSA"
            excludes += "META-INF/LICENSE*"
            excludes += "META-INF/NOTICE*"
            excludes += "META-INF/DEPENDENCIES"
            excludes += "META-INF/INDEX.LIST"
            excludes += "**/mozilla/public-suffix-list.txt"
            // libv2ray.aar ships ~28MB of geo DBs we do not use (hardcoded private CIDRs)
            excludes += "assets/geoip.dat"
            excludes += "assets/geosite.dat"
            excludes += "assets/geoip-only-cn-private.dat"
        }
        jniLibs {
            // Compress .so in the APK (smaller download). Extracted on install;
            // VPN runtime performance is unchanged vs uncompressed packaging.
            useLegacyPackaging = true
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
    // Core icons only — extended added MBs for a handful of glyphs
    implementation("androidx.compose.material:material-icons-core")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
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

// libv2ray.aar merges ~28MB geo DBs into assets — strip after merge (unused by our routes)
listOf("mergeDebugAssets", "mergeReleaseAssets").forEach { taskName ->
    tasks.matching { it.name == taskName }.configureEach {
        doLast {
            val outDir = outputs.files.files.firstOrNull { it.isDirectory } ?: return@doLast
            listOf("geoip.dat", "geosite.dat", "geoip-only-cn-private.dat").forEach { asset ->
                val f = outDir.resolve(asset)
                if (f.exists() && f.delete()) {
                    logger.lifecycle("Stripped unused asset $asset")
                }
            }
        }
    }
}
