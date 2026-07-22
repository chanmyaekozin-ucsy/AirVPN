package com.airvpn.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Public
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import coil.compose.SubcomposeAsyncImage
import com.airvpn.app.ui.theme.Hairline
import com.airvpn.app.ui.theme.InkMuted
import java.util.Locale

/**
 * Premium circular-ish flag chip using real flag artwork (not emoji).
 * Resolves [region] / [name] / [serverId] → ISO country code → flagcdn image.
 */
@Composable
fun FlagIcon(
    region: String,
    name: String = "",
    serverId: String = "",
    modifier: Modifier = Modifier,
    size: Dp = 40.dp,
    elevated: Boolean = true,
) {
    val code = remember(region, name, serverId) {
        countryCodeFor(region = region, name = name, serverId = serverId)
    }
    val density = LocalDensity.current
    val px = remember(size, density) {
        with(density) { (size * 2.5f).toPx().toInt().coerceIn(64, 160) }
    }
    val shape = RoundedCornerShape(percent = 28)
    val url = code?.let { flagImageUrl(it, px) }

    Box(
        modifier = modifier
            .size(size)
            .then(if (elevated) Modifier.shadow(3.dp, shape, clip = false) else Modifier)
            .clip(shape)
            .background(Color.White)
            .border(1.dp, Hairline, shape),
        contentAlignment = Alignment.Center,
    ) {
        if (url != null) {
            SubcomposeAsyncImage(
                model = url,
                contentDescription = code,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
                loading = { FlagPlaceholder() },
                error = { FlagPlaceholder() },
            )
        } else {
            FlagPlaceholder()
        }
    }
}

@Composable
private fun FlagPlaceholder() {
    Icon(
        imageVector = Icons.Outlined.Public,
        contentDescription = null,
        tint = InkMuted.copy(alpha = 0.55f),
        modifier = Modifier.size(18.dp),
    )
}

/** flagcdn.com — crisp PNG flags by ISO 3166-1 alpha-2. */
fun flagImageUrl(countryCode: String, widthPx: Int = 80): String {
    val cc = countryCode.trim().lowercase(Locale.US)
    val w = widthPx.coerceIn(20, 640)
    return "https://flagcdn.com/w$w/$cc.png"
}

/**
 * Resolve ISO country code from region / name / id heuristics.
 * Returns null when unknown (shows globe placeholder).
 */
fun countryCodeFor(
    region: String = "",
    name: String = "",
    serverId: String = "",
): String? {
    val code = region.trim().uppercase(Locale.US)
    if (code.length == 2 && code.all { it in 'A'..'Z' }) {
        return normalizeCountryCode(code)
    }

    val blob = listOf(region, name, serverId)
        .joinToString(" ")
        .lowercase(Locale.US)
        .trim()
    if (blob.isBlank()) return null

    val matchers: List<Pair<Regex, String>> = listOf(
        Regex("""\b(sg|singapore|စင်္ကာပူ)\b""") to "SG",
        Regex("""\b(us|usa|united\s*states|america|california|new\s*york|los\s*angeles)\b""") to "US",
        Regex("""\b(jp|japan|tokyo|osaka)\b""") to "JP",
        Regex("""\b(kr|korea|seoul)\b""") to "KR",
        Regex("""\b(hk|hong\s*kong)\b""") to "HK",
        Regex("""\b(tw|taiwan|taipei)\b""") to "TW",
        Regex("""\b(mm|myanmar|burma|yangon|mandalay)\b""") to "MM",
        Regex("""\b(my|malaysia|kuala)\b""") to "MY",
        Regex("""\b(th|thailand|bangkok)\b""") to "TH",
        Regex("""\b(vn|vietnam|hanoi|saigon|ho\s*chi)\b""") to "VN",
        Regex("""\b(indonesia|jakarta|\bid\b)\b""") to "ID",
        Regex("""\b(ph|philippines|manila)\b""") to "PH",
        Regex("""\b(india|mumbai|delhi|\bin\b)\b""") to "IN",
        Regex("""\b(cn|china|beijing|shanghai)\b""") to "CN",
        Regex("""\b(de|germany|frankfurt|berlin)\b""") to "DE",
        Regex("""\b(nl|netherlands|amsterdam)\b""") to "NL",
        Regex("""\b(gb|uk|united\s*kingdom|london|england)\b""") to "GB",
        Regex("""\b(fr|france|paris)\b""") to "FR",
        Regex("""\b(au|australia|sydney|melbourne)\b""") to "AU",
        Regex("""\b(ca|canada|toronto|vancouver)\b""") to "CA",
        Regex("""\b(ae|uae|dubai|emirates)\b""") to "AE",
        Regex("""\b(tr|turkey|türkiye|istanbul)\b""") to "TR",
        Regex("""\b(ru|russia|moscow)\b""") to "RU",
        Regex("""\b(br|brazil|sao\s*paulo)\b""") to "BR",
        Regex("""\b(fi|finland|helsinki)\b""") to "FI",
        Regex("""\b(se|sweden|stockholm)\b""") to "SE",
        Regex("""\b(no|norway|oslo)\b""") to "NO",
        Regex("""\b(pl|poland|warsaw)\b""") to "PL",
        Regex("""\b(it|italy|milan|rome)\b""") to "IT",
        Regex("""\b(es|spain|madrid)\b""") to "ES",
        Regex("""\b(ch|switzerland|zurich)\b""") to "CH",
        Regex("""\b(ie|ireland|dublin)\b""") to "IE",
        Regex("""\b(nz|new\s*zealand)\b""") to "NZ",
    )
    for ((re, cc) in matchers) {
        if (re.containsMatchIn(blob)) return normalizeCountryCode(cc)
    }
    return null
}

/** Map uncommon aliases to flagcdn codes if needed. */
private fun normalizeCountryCode(code: String): String {
    return when (code.uppercase(Locale.US)) {
        "UK" -> "GB"
        else -> code.uppercase(Locale.US)
    }
}
