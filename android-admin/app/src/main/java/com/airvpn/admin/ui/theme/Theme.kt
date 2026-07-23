package com.airvpn.admin.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

/** Deep console navy — chrome, login, emphasis */
val Night = Color(0xFF0B1C2E)
val NightElevated = Color(0xFF12263D)
val Navy = Color(0xFF1A539B)
val NavyBright = Color(0xFF2A6BC4)
val Cyan = Color(0xFF36B7E7)
val CyanSoft = Color(0xFF5EC8EE)
val SurfaceBg = Color(0xFFEFF3F8)
val Panel = Color(0xFFFFFFFF)
val Ink = Color(0xFF142033)
val InkMuted = Color(0xFF5B6B7C)
val Hairline = Color(0xFFD7E0EA)
val Danger = Color(0xFFC0392B)
val Success = Color(0xFF1F8A5B)
val Warning = Color(0xFFC47F17)
val OnNight = Color(0xFFF4F7FB)
val OnNightMuted = Color(0xFF9BB0C5)
val OnPrimary = Color(0xFFFFFFFF)

val NightGradient = Brush.verticalGradient(
    colors = listOf(Color(0xFF0B1C2E), Color(0xFF143356), Color(0xFF0F2744)),
)

val AccentWash = Brush.linearGradient(
    colors = listOf(Color(0xFF1A539B), Color(0xFF2A8FC4), Color(0xFF36B7E7)),
)

private val AdminColorScheme = lightColorScheme(
    primary = Navy,
    onPrimary = OnPrimary,
    secondary = Cyan,
    onSecondary = Night,
    background = SurfaceBg,
    onBackground = Ink,
    surface = Panel,
    onSurface = Ink,
    surfaceVariant = Color(0xFFF5F8FC),
    onSurfaceVariant = InkMuted,
    outline = Hairline,
    error = Danger,
    onError = OnPrimary,
    tertiary = Night,
    onTertiary = OnNight,
)

private val AdminTypography = androidx.compose.material3.Typography(
    displaySmall = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.SemiBold,
        fontSize = 28.sp,
        letterSpacing = (-0.4).sp,
    ),
    titleLarge = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.SemiBold,
        fontSize = 22.sp,
        letterSpacing = (-0.2).sp,
    ),
    titleMedium = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.SemiBold,
        fontSize = 16.sp,
    ),
    bodyLarge = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Normal,
        fontSize = 15.sp,
    ),
    bodyMedium = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Normal,
        fontSize = 13.sp,
        lineHeight = 18.sp,
    ),
    labelLarge = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.SemiBold,
        fontSize = 13.sp,
        letterSpacing = 0.2.sp,
    ),
    labelSmall = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Medium,
        fontSize = 11.sp,
        letterSpacing = 1.1.sp,
    ),
)

@Composable
fun AirVpnAdminTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = AdminColorScheme,
        typography = AdminTypography,
        content = content,
    )
}
