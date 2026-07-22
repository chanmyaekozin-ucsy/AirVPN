package com.airvpn.app.ui.servers

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.airvpn.app.data.model.ServerCatalog
import com.airvpn.app.data.model.SubscriptionInfo
import com.airvpn.app.data.model.VpnServerItem
import com.airvpn.app.ui.components.AirDialog
import com.airvpn.app.ui.components.AirTopBar
import com.airvpn.app.ui.components.FlagIcon
import com.airvpn.app.ui.components.airTextFieldColors
import com.airvpn.app.ui.theme.Cyan
import com.airvpn.app.ui.theme.Danger
import com.airvpn.app.ui.theme.Hairline
import com.airvpn.app.ui.theme.Ink
import com.airvpn.app.ui.theme.InkMuted
import com.airvpn.app.ui.theme.Navy
import com.airvpn.app.ui.theme.SurfaceBg
import com.airvpn.app.ui.theme.accentContentColor
import com.airvpn.app.ui.theme.contentColorFor
import com.airvpn.app.ui.theme.mutedContentColorFor
import com.airvpn.app.ui.theme.softSurface
import com.airvpn.app.util.VpnKeyImport
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ServersScreen(
    catalog: ServerCatalog,
    selectedId: String?,
    loading: Boolean,
    importing: Boolean,
    importError: String?,
    subscriptions: List<SubscriptionInfo>,
    pings: Map<String, Int?>,
    pinging: Boolean,
    onRefresh: () -> Unit,
    onSelect: (VpnServerItem) -> Unit,
    onImportPaste: (String) -> Unit,
    onRefreshSubscription: () -> Unit,
    onDeleteImported: (String) -> Unit,
    onRemoveSubscription: (String) -> Unit,
    onBuyPaid: (VpnServerItem) -> Unit,
    modifier: Modifier = Modifier,
) {
    var showImport by remember { mutableStateOf(false) }
    var keyText by remember { mutableStateOf("") }
    var plansServer by remember { mutableStateOf<VpnServerItem?>(null) }

    val freeServers = catalog.free
    val paidServers = catalog.paid
    val imported = freeServers.filter { it.isImported }
    val freeRemote = freeServers.filter { !it.isImported }
    val subNodes = imported.filter { it.fromSubscription }
    val manualImported = imported.filter { !it.fromSubscription }
    val hasSubs = subscriptions.isNotEmpty()

    Column(modifier = modifier.fillMaxSize()) {
        AirTopBar(
            title = "Servers",
            actions = {
                IconButton(onClick = {
                    keyText = ""
                    showImport = true
                }) {
                    Icon(Icons.Outlined.Add, contentDescription = "Import", tint = Navy)
                }
                IconButton(
                    onClick = {
                        if (hasSubs) onRefreshSubscription() else onRefresh()
                    },
                    enabled = !loading && !importing,
                ) {
                    Icon(Icons.Outlined.Refresh, contentDescription = "Refresh", tint = Navy)
                }
            },
        )

        if (importing || pinging) {
            LinearProgressIndicator(
                modifier = Modifier.fillMaxWidth(),
                color = Navy,
                trackColor = Hairline,
            )
        }

        PullToRefreshBox(
            isRefreshing = loading || importing,
            onRefresh = {
                if (hasSubs) onRefreshSubscription() else onRefresh()
            },
            modifier = Modifier.fillMaxSize(),
        ) {
            LazyColumn(modifier = Modifier.fillMaxSize()) {
                if (subscriptions.isNotEmpty()) {
                    items(subscriptions, key = { "sub-${it.url}" }) { info ->
                        SubscriptionCard(
                            info = info,
                            onRemove = { onRemoveSubscription(info.url) },
                        )
                    }
                }
                if (subNodes.isNotEmpty()) {
                    item { SectionHeader("Subscription") }
                    items(subNodes, key = { it.id }) { server ->
                        ServerRow(
                            server = server,
                            selected = server.id == selectedId,
                            showHost = true,
                            pingMs = pings[server.id],
                            pingKnown = pings.containsKey(server.id),
                            onClick = { onSelect(server) },
                            onDelete = { onDeleteImported(server.id) },
                        )
                        HorizontalDivider(
                            thickness = 1.dp,
                            color = Hairline,
                            modifier = Modifier.padding(start = 20.dp),
                        )
                    }
                }
                if (manualImported.isNotEmpty()) {
                    item { SectionHeader("Imported") }
                    items(manualImported, key = { it.id }) { server ->
                        ServerRow(
                            server = server,
                            selected = server.id == selectedId,
                            showHost = !server.host.isNullOrBlank(),
                            pingMs = pings[server.id],
                            pingKnown = pings.containsKey(server.id),
                            onClick = { onSelect(server) },
                            onDelete = { onDeleteImported(server.id) },
                        )
                        HorizontalDivider(
                            thickness = 1.dp,
                            color = Hairline,
                            modifier = Modifier.padding(start = 20.dp),
                        )
                    }
                }
                if (freeRemote.isNotEmpty()) {
                    item { SectionHeader("Free") }
                    items(freeRemote, key = { it.id }) { server ->
                        ServerRow(
                            server = server,
                            selected = server.id == selectedId,
                            showHost = false,
                            pingMs = pings[server.id],
                            pingKnown = pings.containsKey(server.id),
                            onClick = { onSelect(server) },
                            onDelete = null,
                        )
                        HorizontalDivider(
                            thickness = 1.dp,
                            color = Hairline,
                            modifier = Modifier.padding(start = 20.dp),
                        )
                    }
                }
                if (paidServers.isNotEmpty()) {
                    item { SectionHeader("Paid") }
                    items(paidServers, key = { it.id }) { server ->
                        PaidServerRow(
                            server = server,
                            pingMs = pings[server.id],
                            pingKnown = pings.containsKey(server.id),
                            onClick = { plansServer = server },
                            onBuy = { onBuyPaid(server) },
                        )
                        HorizontalDivider(
                            thickness = 1.dp,
                            color = Hairline,
                            modifier = Modifier.padding(start = 20.dp),
                        )
                    }
                }
                if (freeServers.isEmpty() && paidServers.isEmpty() && !loading && !importing) {
                    item { EmptyServers(loading = false) }
                }
                item { Spacer(Modifier.height(28.dp)) }
            }
        }
    }

    val plansTarget = plansServer
    if (plansTarget != null) {
        AirDialog(
            title = plansTarget.name,
            onDismiss = { plansServer = null },
            confirmLabel = "Buy in Telegram",
            onConfirm = {
                onBuyPaid(plansTarget)
                plansServer = null
            },
            dismissLabel = "Close",
        ) {
            Column {
                Text(
                    text = "Plans",
                    style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.SemiBold),
                    color = InkMuted,
                )
                Spacer(Modifier.height(8.dp))
                plansTarget.allPlans.forEach { plan ->
                    Text(
                        text = plan.summary.ifBlank { plan.title ?: "Plan" },
                        style = MaterialTheme.typography.bodyLarge,
                        color = Ink,
                        modifier = Modifier.padding(vertical = 4.dp),
                    )
                }
                if (plansTarget.allPlans.isEmpty()) {
                    Text("See Telegram bot for prices.", color = InkMuted)
                }
            }
        }
    }

    if (showImport) {
        val canImport = keyText.trim().let {
            it.contains("vless://", ignoreCase = true) ||
                it.contains("ss://", ignoreCase = true) ||
                it.startsWith("http://", ignoreCase = true) ||
                it.startsWith("https://", ignoreCase = true)
        }
        AirDialog(
            title = "Import",
            onDismiss = { if (!importing) showImport = false },
            confirmLabel = if (importing) "Importing…" else "Import",
            onConfirm = {
                onImportPaste(keyText)
                showImport = false
            },
            confirmEnabled = canImport && !importing,
        ) {
            Column {
                Text(
                    text = "Paste vless://, ss://, or a subscription https:// link. Multiple subs are merged.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = InkMuted,
                )
                Spacer(Modifier.height(10.dp))
                OutlinedTextField(
                    value = keyText,
                    onValueChange = { keyText = it },
                    singleLine = false,
                    minLines = 3,
                    maxLines = 6,
                    label = { Text("Key or subscription URL") },
                    placeholder = { Text("vless://… or https://…/sub") },
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                    keyboardActions = KeyboardActions(onDone = {
                        if (canImport && !importing) {
                            onImportPaste(keyText)
                            showImport = false
                        }
                    }),
                    colors = airTextFieldColors(),
                    modifier = Modifier.fillMaxWidth(),
                )
                if (!importError.isNullOrBlank()) {
                    Spacer(Modifier.height(8.dp))
                    Text(importError, color = MaterialTheme.colorScheme.error)
                }
            }
        }
    }
}

@Composable
private fun SubscriptionCard(
    info: SubscriptionInfo,
    onRemove: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp)
            .background(Color.White, RoundedCornerShape(12.dp))
            .border(1.dp, Hairline, RoundedCornerShape(12.dp))
            .padding(16.dp),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text(
                text = "Subscription",
                style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.SemiBold),
                color = InkMuted,
                modifier = Modifier.weight(1f),
            )
            IconButton(onClick = onRemove, modifier = Modifier.padding(0.dp)) {
                Icon(
                    Icons.Outlined.DeleteOutline,
                    contentDescription = "Remove subscription",
                    tint = InkMuted,
                )
            }
        }
        Spacer(Modifier.height(8.dp))
        val usage = if (info.totalBytes > 0) {
            "%.2f / %.2f GB".format(info.usedGb, info.totalGb)
        } else if (info.usedBytes > 0) {
            "%.2f GB used".format(info.usedGb)
        } else {
            "Usage unknown"
        }
        Text(
            text = usage,
            style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.SemiBold),
            color = if (info.isExpired) Danger else Ink,
        )
        if (info.totalBytes > 0) {
            Spacer(Modifier.height(8.dp))
            val frac = (info.usedBytes.toFloat() / info.totalBytes.toFloat()).coerceIn(0f, 1f)
            LinearProgressIndicator(
                progress = { frac },
                modifier = Modifier.fillMaxWidth().height(4.dp),
                color = if (frac > 0.9f) Danger else Navy,
                trackColor = Hairline,
            )
        }
        Spacer(Modifier.height(8.dp))
        val exp = if (info.expireAt > 0) {
            val fmt = SimpleDateFormat("yyyy-MM-dd", Locale.US)
            val label = fmt.format(Date(info.expireAt * 1000L))
            val days = info.daysLeft
            when {
                info.isExpired -> {
                    val ago = days?.let { " · ${-it}d ago" }.orEmpty()
                    "Expired $label$ago"
                }
                days != null -> "Expires $label ($days days left)"
                else -> "Expires $label"
            }
        } else {
            "Expiry unknown"
        }
        Text(
            text = "$exp · ${info.nodeCount} nodes",
            style = MaterialTheme.typography.bodyMedium,
            color = if (info.isExpired) Danger else InkMuted,
        )
    }
}

@Composable
private fun SectionHeader(title: String) {
    Text(
        text = title.uppercase(),
        style = MaterialTheme.typography.labelSmall.copy(
            fontWeight = FontWeight.SemiBold,
            letterSpacing = 0.8.sp,
        ),
        color = InkMuted,
        modifier = Modifier.padding(horizontal = 20.dp, vertical = 12.dp),
    )
}

@Composable
private fun EmptyServers(loading: Boolean) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 24.dp, vertical = 48.dp),
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(
                text = if (loading) "Loading…" else "No servers yet",
                style = MaterialTheme.typography.titleMedium,
                color = Ink,
            )
            Spacer(Modifier.height(6.dp))
            Text(
                text = "Tap + to import a key or subscription URL",
                style = MaterialTheme.typography.bodyMedium,
                color = InkMuted,
            )
        }
    }
}

@Composable
private fun PaidServerRow(
    server: VpnServerItem,
    pingMs: Int?,
    pingKnown: Boolean,
    onClick: () -> Unit,
    onBuy: () -> Unit,
) {
    val plans = server.allPlans
    val fromPrice = plans.mapNotNull { it.priceKs }.minOrNull()
    val subtitle = when {
        plans.size > 1 && fromPrice != null ->
            "From %,d Ks · %d plans".format(fromPrice, plans.size)
        plans.size == 1 -> plans.first().summary
        else -> "Buy in Telegram"
    }

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(start = 20.dp, end = 12.dp, top = 12.dp, bottom = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        FlagIcon(
            region = server.region,
            name = server.name,
            serverId = server.id,
            size = 42.dp,
        )
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = server.name,
                style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Medium),
                color = contentColorFor(SurfaceBg),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Spacer(Modifier.height(2.dp))
            Text(
                text = subtitle,
                style = MaterialTheme.typography.bodyMedium,
                color = mutedContentColorFor(SurfaceBg),
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
        if (server.online) {
            PingLabel(pingMs = pingMs, known = pingKnown)
        }
        Text(
            text = "Buy",
            style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.SemiBold),
            color = accentContentColor(Navy),
            modifier = Modifier
                .border(1.dp, Navy.copy(alpha = 0.35f), RoundedCornerShape(6.dp))
                .clickable(onClick = onBuy)
                .padding(horizontal = 10.dp, vertical = 6.dp),
        )
    }
}

@Composable
private fun ServerRow(
    server: VpnServerItem,
    selected: Boolean,
    showHost: Boolean,
    pingMs: Int?,
    pingKnown: Boolean,
    onClick: () -> Unit,
    onDelete: (() -> Unit)?,
) {
    val bg by animateColorAsState(
        targetValue = if (selected) softSurface(Navy, alpha = 0.12f) else Color.Transparent,
        animationSpec = tween(140),
        label = "rowBg",
    )
    val nameColor by animateColorAsState(
        targetValue = if (selected) accentContentColor(Navy) else contentColorFor(SurfaceBg),
        animationSpec = tween(140),
        label = "nameColor",
    )
    val subtitleColor by animateColorAsState(
        targetValue = if (selected) Navy.copy(alpha = 0.72f) else mutedContentColorFor(SurfaceBg),
        animationSpec = tween(140),
        label = "subtitleColor",
    )
    val address = remember(server.id, server.host, server.configUri) {
        server.host?.takeIf { it.isNotBlank() }
            ?: VpnKeyImport.hostFromUri(server.configUri)
    }

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(bg)
            .clickable(onClick = onClick)
            .padding(start = 20.dp, end = 4.dp, top = 12.dp, bottom = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        FlagIcon(
            region = server.region,
            name = server.name,
            serverId = server.id,
            size = 42.dp,
        )
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = server.name,
                style = MaterialTheme.typography.titleMedium.copy(
                    fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium,
                ),
                color = if (server.online) nameColor else InkMuted,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            val subtitle = buildString {
                if (showHost && !address.isNullOrBlank()) {
                    append(address)
                }
                if (!server.online) {
                    if (isNotEmpty()) append(" · ")
                    append("Down")
                } else if (!showHost && server.isImported) {
                    if (isNotEmpty()) append(" · ")
                    append("Imported")
                }
            }
            if (subtitle.isNotBlank()) {
                Spacer(Modifier.height(2.dp))
                Text(
                    subtitle,
                    style = MaterialTheme.typography.bodyMedium,
                    color = if (!server.online) Danger else subtitleColor,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        if (server.online) {
            PingLabel(pingMs = pingMs, known = pingKnown)
        } else {
            Text(
                text = "DOWN",
                style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.SemiBold),
                color = Danger,
                modifier = Modifier
                    .border(1.dp, Danger.copy(alpha = 0.35f), RoundedCornerShape(4.dp))
                    .padding(horizontal = 8.dp, vertical = 2.dp),
            )
        }
        if (onDelete != null) {
            IconButton(onClick = onDelete) {
                Icon(
                    Icons.Outlined.DeleteOutline,
                    contentDescription = "Delete",
                    tint = InkMuted,
                )
            }
        }
    }
}

@Composable
private fun PingLabel(pingMs: Int?, known: Boolean) {
    val text = when {
        !known -> "…"
        pingMs == null -> "—"
        else -> "$pingMs ms"
    }
    val color = when {
        !known -> InkMuted
        pingMs == null -> Danger
        pingMs < 100 -> Cyan
        pingMs < 250 -> Navy
        else -> InkMuted
    }
    Text(
        text = text,
        style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.SemiBold),
        color = color,
        modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp),
    )
}
