# AirVPN — keep VPN / crypto / reflection entry points

-keepattributes Signature, InnerClasses, EnclosingMethod
-keepattributes RuntimeVisibleAnnotations, RuntimeVisibleParameterAnnotations
-keepattributes AnnotationDefault
-keepattributes *Annotation*

-keep class libv2ray.** { *; }
-keep class go.** { *; }

# sshj
-keep class net.schmizz.sshj.** { *; }
-keep class com.hierynomus.** { *; }
-keep class net.i2p.crypto.eddsa.** { *; }
-dontnote net.schmizz.sshj.**

# BouncyCastle
-keep class org.bouncycastle.jce.provider.BouncyCastleProvider { *; }
-keep class org.bouncycastle.** { *; }
-dontwarn org.bouncycastle.**
-dontnote org.bouncycastle.**

-dontwarn javax.security.auth.login.**
-dontwarn org.ietf.jgss.**
-dontwarn sun.security.x509.**
-dontwarn com.google.errorprone.annotations.**

# --- Moshi + Kotlin reflection (required for release API parsing) ---
-keep class kotlin.Metadata { *; }
-keep class kotlin.reflect.** { *; }
-keep class kotlin.jvm.internal.** { *; }
-dontwarn kotlin.reflect.**
-dontwarn kotlin.jvm.internal.**

-keep class com.squareup.moshi.** { *; }
-keep class com.squareup.moshi.kotlin.** { *; }
-keepclassmembers class * {
    @com.squareup.moshi.Json <fields>;
}
-dontwarn com.squareup.moshi.**

# Our DTOs / Retrofit API — do not shrink (Moshi uses constructors + defaults)
-keep class com.airvpn.app.data.api.** { *; }
-keepclassmembers class com.airvpn.app.data.api.** {
    <init>(...);
    <fields>;
}
-keep interface com.airvpn.app.data.api.AirVpnApi { *; }

# Retrofit
-keep,allowobfuscation,allowshrinking interface retrofit2.Call
-keep,allowobfuscation,allowshrinking class retrofit2.Response
-keepclassmembers,allowshrinking,allowobfuscation interface * {
    @retrofit2.http.* <methods>;
}
-dontwarn retrofit2.**
-dontwarn okhttp3.**
-dontwarn okio.**

# Coroutines
-keepnames class kotlinx.coroutines.internal.MainDispatcherFactory {}
-keepnames class kotlinx.coroutines.CoroutineExceptionHandler {}
-keep class kotlinx.coroutines.** { *; }

# Tink (security-crypto / EncryptedSharedPreferences)
-keep class androidx.security.crypto.** { *; }
-keep class com.google.crypto.tink.** { *; }
-dontwarn com.google.crypto.tink.**

# Compose
-dontwarn androidx.compose.**
-dontwarn kotlin.**
