package com.airvpn.app.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

val Navy = Color(0xFF1A539B)
val Cyan = Color(0xFF36B7E7)
val SurfaceBg = Color(0xFFF7F9FC)
val Ink = Color(0xFF1B2A3A)
val InkMuted = Color(0xFF5A6B7D)
val Hairline = Color(0xFFE2E8F0)
val Danger = Color(0xFFB42318)
val OnDark = Color.White
val OnDarkMuted = Color.White.copy(alpha = 0.72f)

/**
 * Primary text color that stays readable on [background].
 * Light surfaces → Ink; dark / saturated fills → white.
 */
fun contentColorFor(background: Color): Color {
    return if (background.luminance() > 0.55f) Ink else OnDark
}

/** Secondary / supporting text on [background]. */
fun mutedContentColorFor(background: Color): Color {
    return if (background.luminance() > 0.55f) InkMuted else OnDarkMuted
}

/**
 * Soft tinted surface from an accent (status, selection, tags).
 * Keeps the field light so body text can use the accent color itself.
 */
fun softSurface(accent: Color, alpha: Float = 0.12f): Color =
    accent.copy(alpha = alpha)

/** Text/icon color for content sitting on [softSurface] of the same accent. */
fun accentContentColor(accent: Color): Color = accent

private val AirColorScheme = lightColorScheme(
    primary = Navy,
    onPrimary = Color.White,
    secondary = Cyan,
    onSecondary = Color.White,
    background = SurfaceBg,
    onBackground = Ink,
    surface = SurfaceBg,
    onSurface = Ink,
    surfaceVariant = Color.White,
    onSurfaceVariant = InkMuted,
    outline = Hairline,
    error = Danger,
)

private val AirTypography = androidx.compose.material3.Typography(
    displayLarge = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.SemiBold,
        fontSize = 34.sp,
        letterSpacing = (-0.5).sp,
        color = Ink,
    ),
    titleLarge = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.SemiBold,
        fontSize = 22.sp,
        color = Ink,
    ),
    titleMedium = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Medium,
        fontSize = 16.sp,
        color = Ink,
    ),
    bodyLarge = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Normal,
        fontSize = 16.sp,
        color = Ink,
    ),
    bodyMedium = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Normal,
        fontSize = 14.sp,
        color = InkMuted,
    ),
    labelLarge = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Medium,
        fontSize = 14.sp,
        color = Ink,
    ),
    labelSmall = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Medium,
        fontSize = 11.sp,
        letterSpacing = 0.4.sp,
        color = InkMuted,
    ),
)

@Composable
fun AirVpnTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = AirColorScheme,
        typography = AirTypography,
        content = content,
    )
}
