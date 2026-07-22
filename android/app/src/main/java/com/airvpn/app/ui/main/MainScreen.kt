package com.airvpn.app.ui.main

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.airvpn.app.data.model.AdCreative
import com.airvpn.app.data.model.VpnServerItem
import com.airvpn.app.ui.components.AdBanner
import com.airvpn.app.ui.components.AirLogoMark
import com.airvpn.app.ui.components.AirPrimaryButton
import com.airvpn.app.ui.components.FlagIcon
import com.airvpn.app.ui.theme.Cyan
import com.airvpn.app.ui.theme.Danger
import com.airvpn.app.ui.theme.Hairline
import com.airvpn.app.ui.theme.Ink
import com.airvpn.app.ui.theme.InkMuted
import com.airvpn.app.ui.theme.Navy
import com.airvpn.app.ui.theme.SurfaceBg
import com.airvpn.app.ui.theme.contentColorFor
import com.airvpn.app.vpn.VpnState
import kotlinx.coroutines.delay
import kotlin.random.Random

@Composable
fun MainScreen(
    vpnState: VpnState,
    selectedServer: VpnServerItem?,
    statusLine: String,
    pingMs: Int? = null,
    bannerAds: List<AdCreative> = emptyList(),
    onAdClick: (AdCreative) -> Unit = {},
    onToggle: () -> Unit,
    onOpenServers: () -> Unit = {},
    modifier: Modifier = Modifier,
) {
    val connected = vpnState == VpnState.Connected
    val busy = vpnState == VpnState.Connecting || vpnState == VpnState.Disconnecting
    val serverDown = selectedServer != null && !selectedServer.online
    val pingLabel = formatPing(pingMs)
    val statusText = when {
        vpnState == VpnState.Connected ->
            if (pingLabel != null) "Connected · $pingLabel" else "Connected"
        vpnState == VpnState.Connecting -> "Connecting…"
        vpnState == VpnState.Disconnecting -> "Disconnecting…"
        vpnState == VpnState.Error -> statusLine.ifBlank { "Failed" }
        serverDown -> "Server is down"
        else -> statusLine.ifBlank { "Not connected" }
    }
    val statusDot = when {
        vpnState == VpnState.Connected -> Cyan
        vpnState == VpnState.Connecting || vpnState == VpnState.Disconnecting -> Navy
        vpnState == VpnState.Error || serverDown -> Danger
        else -> InkMuted.copy(alpha = 0.45f)
    }

    val screenBg = SurfaceBg
    val titleColor = contentColorFor(screenBg)
    val buttonBg = if (connected) Ink else Navy
    val canConnect = !busy && !serverDown && selectedServer != null

    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(horizontal = 28.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(Modifier.weight(0.14f))

        AirLogoMark(state = vpnState, logoSize = 156.dp)

        Spacer(Modifier.height(22.dp))

        Text(
            text = "AirVPN",
            style = MaterialTheme.typography.displayLarge.copy(
                fontWeight = FontWeight.Bold,
                letterSpacing = (-0.8).sp,
            ),
            color = titleColor,
        )

        Spacer(Modifier.height(14.dp))

        ServerLocationChip(
            server = selectedServer,
            pingMs = if (connected) pingMs else null,
            onClick = onOpenServers,
        )

        Spacer(Modifier.height(18.dp))

        StatusLine(text = statusText, dotColor = statusDot)

        Spacer(Modifier.weight(0.20f))

        AirPrimaryButton(
            text = when {
                connected -> "Disconnect"
                vpnState == VpnState.Connecting -> "Connecting"
                vpnState == VpnState.Disconnecting -> "Please wait"
                serverDown -> "Unavailable"
                else -> "Connect"
            },
            onClick = onToggle,
            enabled = if (connected) !busy else canConnect,
            loading = vpnState == VpnState.Connecting,
            containerColor = buttonBg,
            contentColor = contentColorFor(buttonBg),
        )

        if (bannerAds.isNotEmpty()) {
            Spacer(Modifier.height(16.dp))
            RotatingAdBanner(
                ads = bannerAds,
                onAdClick = onAdClick,
            )
        }

        Spacer(Modifier.height(24.dp))
    }
}

/**
 * Shows nothing when [ads] is empty.
 * One banner: static. Two or more: start on a random index, rotate every 5s.
 */
@Composable
private fun RotatingAdBanner(
    ads: List<AdCreative>,
    onAdClick: (AdCreative) -> Unit,
) {
    if (ads.isEmpty()) return
    var index by remember(ads.map { it.id }) {
        mutableIntStateOf(if (ads.size > 1) Random.nextInt(ads.size) else 0)
    }
    LaunchedEffect(ads.map { it.id }) {
        if (ads.size <= 1) return@LaunchedEffect
        while (true) {
            delay(5_000)
            index = (index + 1) % ads.size
        }
    }
    val ad = ads.getOrNull(index.coerceIn(0, ads.lastIndex)) ?: return
    AnimatedContent(
        targetState = ad.id,
        transitionSpec = { fadeIn(tween(280)) togetherWith fadeOut(tween(220)) },
        label = "bannerAd",
    ) { adId ->
        val current = ads.firstOrNull { it.id == adId } ?: ad
        AdBanner(ad = current, onClick = { onAdClick(current) })
    }
}

/**
 * Compact location row: flag + name (+ ping when connected) — no region code tag.
 */
@Composable
private fun ServerLocationChip(
    server: VpnServerItem?,
    pingMs: Int?,
    onClick: () -> Unit,
) {
    val shape = RoundedCornerShape(12.dp)
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        modifier = Modifier
            .widthIn(max = 280.dp)
            .clip(shape)
            .background(Color.White)
            .border(1.dp, Hairline, shape)
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 10.dp),
    ) {
        if (server != null) {
            FlagIcon(
                region = server.region,
                name = server.name,
                serverId = server.id,
                size = 32.dp,
                elevated = false,
            )
            Column(modifier = Modifier.weight(1f, fill = false)) {
                Text(
                    text = server.name,
                    style = MaterialTheme.typography.titleMedium.copy(
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 15.sp,
                    ),
                    color = Ink,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                val meta = when {
                    !server.online -> "Down"
                    else -> formatPing(pingMs)
                }
                if (!meta.isNullOrBlank()) {
                    Text(
                        text = meta,
                        style = MaterialTheme.typography.labelSmall,
                        color = if (!server.online) Danger else InkMuted,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        } else {
            Text(
                text = "Choose a server",
                style = MaterialTheme.typography.bodyLarge,
                color = InkMuted,
                modifier = Modifier.padding(vertical = 2.dp),
            )
        }
    }
}

@Composable
private fun StatusLine(text: String, dotColor: Color) {
    val dot by animateColorAsState(
        targetValue = dotColor,
        animationSpec = tween(200),
        label = "statusDot",
    )

    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.padding(horizontal = 4.dp, vertical = 2.dp),
    ) {
        Spacer(
            modifier = Modifier
                .size(6.dp)
                .drawBehind {
                    drawCircle(color = dot)
                },
        )
        Spacer(Modifier.width(8.dp))
        AnimatedContent(
            targetState = text,
            transitionSpec = { fadeIn(tween(140)) togetherWith fadeOut(tween(100)) },
            label = "statusText",
        ) { label ->
            Text(
                text = label,
                style = MaterialTheme.typography.bodyLarge.copy(
                    fontWeight = FontWeight.Medium,
                    letterSpacing = 0.1.sp,
                    fontSize = 15.sp,
                ),
                color = Ink,
            )
        }
    }
}

private fun formatPing(ms: Int?): String? = when {
    ms == null -> null
    ms < 0 -> "timeout"
    else -> "$ms ms"
}
