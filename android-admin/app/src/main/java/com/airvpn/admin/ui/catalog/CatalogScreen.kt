package com.airvpn.admin.ui.catalog

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.airvpn.admin.data.model.CatalogServer
import com.airvpn.admin.data.model.VpnServerInfo
import com.airvpn.admin.ui.components.AdminDialog
import com.airvpn.admin.ui.components.AdminOutlinedButton
import com.airvpn.admin.ui.components.AdminPrimaryButton
import com.airvpn.admin.ui.components.AdminScreen
import com.airvpn.admin.ui.components.AdminTextButton
import com.airvpn.admin.ui.components.InfiniteListHandler
import com.airvpn.admin.ui.components.ListRowCard
import com.airvpn.admin.ui.components.LoadMoreFooter
import com.airvpn.admin.ui.components.SortChipRow
import com.airvpn.admin.ui.components.SortOption
import com.airvpn.admin.ui.components.adminFieldColors
import com.airvpn.admin.ui.theme.Cyan
import com.airvpn.admin.ui.theme.Danger
import com.airvpn.admin.ui.theme.Ink
import com.airvpn.admin.ui.theme.InkMuted
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.TimeZone

@Composable
fun CatalogScreen(
    servers: List<CatalogServer>,
    vpnNodes: List<VpnServerInfo> = emptyList(),
    issuedKey: String? = null,
    issuingKey: Boolean = false,
    loadingMore: Boolean = false,
    canLoadMore: Boolean = false,
    onSave: (
        id: String,
        name: String,
        region: String,
        protocol: String,
        tier: String,
        configUri: String?,
        nodesText: String?,
        manualDataGb: Double?,
        manualUsedGb: Double?,
        manualExpireAt: Long?,
        listWhenDisabled: Boolean,
        enabled: Boolean,
        sortOrder: Int,
        sshHost: String?,
        sshPort: Int?,
        sshUser: String?,
        sshPassword: String?,
        sshSni: String?,
        sshTls: Boolean?,
        sshAllowInsecure: Boolean?,
    ) -> Unit,
    onIssueKey: (serverIds: List<String>, dataGb: Double, days: Int, remark: String) -> Unit,
    onConsumeIssuedKey: () -> Unit,
    onToggle: (String, Boolean) -> Unit,
    onDelete: (String) -> Unit,
    onLoadMore: () -> Unit = {},
    modifier: Modifier = Modifier,
) {
    var editing by remember { mutableStateOf<CatalogServer?>(null) }
    var creating by remember { mutableStateOf(false) }
    var sortKey by remember { mutableStateOf("order") }
    val listState = rememberLazyListState()
    val sorted = remember(servers, sortKey) {
        when (sortKey) {
            "name" -> servers.sortedBy { it.name.lowercase() }
            "tier" -> servers.sortedBy { it.tier.lowercase() }
            "enabled" -> servers.sortedByDescending { it.enabled }
            else -> servers.sortedWith(compareBy({ it.sortOrder }, { it.name.lowercase() }))
        }
    }

    InfiniteListHandler(
        listState = listState,
        enabled = canLoadMore && !loadingMore,
        onLoadMore = onLoadMore,
    )

    AdminScreen(
        title = "App catalog",
        eyebrow = "Mobile",
        subtitle = "Free and paid nodes shown in the consumer app",
        modifier = modifier.fillMaxSize(),
        actions = {
            AdminPrimaryButton(
                text = "Add",
                onClick = { creating = true },
                compact = true,
            )
        },
    ) {
        SortChipRow(
            options = listOf(
                SortOption("order", "Sort order"),
                SortOption("name", "Name"),
                SortOption("tier", "Tier"),
                SortOption("enabled", "Enabled first"),
            ),
            selectedKey = sortKey,
            onSelect = { sortKey = it },
        )
        Spacer(Modifier.height(16.dp))
        LazyColumn(
            state = listState,
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            items(sorted, key = { it.id }) { s ->
                ListRowCard {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text("${s.name} · ${s.tier}", fontWeight = FontWeight.SemiBold, color = Ink)
                            Spacer(Modifier.height(4.dp))
                            Text(
                                buildString {
                                    append("${s.id} · ${s.protocol.uppercase()} · ${s.region.ifBlank { "—" }}")
                                    if (s.listWhenDisabled) append(" · list if off")
                                },
                                style = MaterialTheme.typography.bodyMedium,
                                color = InkMuted,
                            )
                            val cfg = s.configUri.orEmpty()
                            val source = when {
                                s.protocol.equals("ssh", true) ->
                                    if (s.sshPasswordSet) "Source: SSH (password set)" else "Source: SSH (no password)"
                                s.nodesText.isNotBlank() -> "Source: manual nodes"
                                cfg.startsWith("http", ignoreCase = true) -> "Source: subscription link"
                                cfg.isNotBlank() -> "Source: share key"
                                else -> null
                            }
                            if (source != null) {
                                Spacer(Modifier.height(4.dp))
                                Text(
                                    source,
                                    style = MaterialTheme.typography.labelSmall,
                                    color = InkMuted,
                                )
                            }
                            if (s.manualDataGb != null || s.manualExpireAt != null) {
                                Spacer(Modifier.height(4.dp))
                                Text(
                                    buildString {
                                        s.manualDataGb?.let { append("%.1f GB".format(it)) }
                                        s.manualExpireAt?.let { exp ->
                                            if (isNotEmpty()) append(" · ")
                                            append("exp ${formatExpire(exp)}")
                                        }
                                    },
                                    style = MaterialTheme.typography.labelSmall,
                                    color = InkMuted,
                                )
                            }
                        }
                        Switch(
                            checked = s.enabled,
                            onCheckedChange = { onToggle(s.id, it) },
                            colors = SwitchDefaults.colors(checkedTrackColor = Cyan),
                        )
                    }
                    Spacer(Modifier.height(12.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        AdminOutlinedButton(
                            text = "Edit",
                            onClick = { editing = s },
                            compact = true,
                        )
                        AdminTextButton(
                            text = "Delete",
                            onClick = { onDelete(s.id) },
                            contentColor = Danger,
                        )
                    }
                }
            }
            item(key = "catalog-footer") {
                LoadMoreFooter(visible = loadingMore)
            }
        }
    }

    if (creating || editing != null) {
        CatalogDialog(
            initial = editing,
            vpnNodes = vpnNodes,
            issuedKey = issuedKey,
            issuingKey = issuingKey,
            onDismiss = {
                creating = false
                editing = null
                onConsumeIssuedKey()
            },
            onIssueKey = onIssueKey,
            onConsumeIssuedKey = onConsumeIssuedKey,
            onSave = { id, name, region, protocol, tier, uri, nodes, dataGb, usedGb, expireAt, listOff, enabled, sort,
                sshHost, sshPort, sshUser, sshPassword, sshSni, sshTls, sshAllowInsecure ->
                onSave(
                    id, name, region, protocol, tier, uri, nodes, dataGb, usedGb, expireAt,
                    listOff, enabled, sort,
                    sshHost, sshPort, sshUser, sshPassword, sshSni, sshTls, sshAllowInsecure,
                )
                creating = false
                editing = null
                onConsumeIssuedKey()
            },
        )
    }
}

@Composable
private fun CatalogDialog(
    initial: CatalogServer?,
    vpnNodes: List<VpnServerInfo>,
    issuedKey: String?,
    issuingKey: Boolean,
    onDismiss: () -> Unit,
    onIssueKey: (serverIds: List<String>, dataGb: Double, days: Int, remark: String) -> Unit,
    onConsumeIssuedKey: () -> Unit,
    onSave: (
        String,
        String,
        String,
        String,
        String,
        String?,
        String?,
        Double?,
        Double?,
        Long?,
        Boolean,
        Boolean,
        Int,
        String?,
        Int?,
        String?,
        String?,
        String?,
        Boolean?,
        Boolean?,
    ) -> Unit,
) {
    var id by remember { mutableStateOf(initial?.id ?: "") }
    var name by remember { mutableStateOf(initial?.name ?: "") }
    var region by remember { mutableStateOf(initial?.region ?: "") }
    var protocol by remember { mutableStateOf(initial?.protocol ?: "vless") }
    var tier by remember { mutableStateOf(initial?.tier ?: "free") }
    var uri by remember { mutableStateOf(initial?.configUri ?: "") }
    var nodes by remember { mutableStateOf(initial?.nodesText ?: "") }
    var sshHost by remember { mutableStateOf(initial?.sshHost ?: "") }
    var sshPort by remember { mutableStateOf((initial?.sshPort ?: 9443).toString()) }
    var sshUser by remember { mutableStateOf(initial?.sshUser ?: "") }
    var sshPassword by remember { mutableStateOf("") }
    var sshSni by remember { mutableStateOf(initial?.sshSni ?: "") }
    var sshTls by remember { mutableStateOf(initial?.sshTls ?: true) }
    var sshAllowInsecure by remember {
        mutableStateOf(initial?.sshAllowInsecure ?: (initial?.sshTls != false))
    }
    var dataGb by remember {
        mutableStateOf(initial?.manualDataGb?.let { trimGb(it) } ?: "50")
    }
    var usedGb by remember {
        mutableStateOf(initial?.manualUsedGb?.let { trimGb(it) } ?: "")
    }
    var expireDate by remember {
        mutableStateOf(initial?.manualExpireAt?.let { formatExpire(it) } ?: "")
    }
    var expireDays by remember { mutableStateOf(if (initial == null) "30" else "") }
    var listWhenDisabled by remember { mutableStateOf(initial?.listWhenDisabled ?: false) }
    var enabled by remember { mutableStateOf(initial?.enabled ?: true) }
    var sort by remember { mutableStateOf(initial?.sortOrder?.toString() ?: "0") }
    var selectedNodes by remember {
        mutableStateOf(
            vpnNodes.filter { it.panelConfigured }.map { it.id }.take(2).toSet()
                .ifEmpty { vpnNodes.firstOrNull()?.id?.let { setOf(it) }.orEmpty() },
        )
    }
    val isSsh = protocol.equals("ssh", ignoreCase = true)

    LaunchedEffect(issuedKey) {
        if (isSsh) return@LaunchedEffect
        val chunk = issuedKey?.trim().orEmpty()
        if (chunk.isBlank()) return@LaunchedEffect
        // Multi-node free sub: always append into Available nodes (one catalog sub link)
        val existingShare = uri.trim().takeIf {
            it.startsWith("vless://", ignoreCase = true) || it.startsWith("ss://", ignoreCase = true)
        }
        var merged = nodes.trim()
        if (!existingShare.isNullOrBlank() && !merged.contains(existingShare)) {
            merged = if (merged.isBlank()) existingShare else "$existingShare\n$merged"
            uri = ""
        }
        for (line in chunk.split('\n')) {
            val key = line.trim()
            if (key.isBlank()) continue
            if (merged.contains(key)) continue
            merged = if (merged.isBlank()) key else "$merged\n$key"
        }
        nodes = merged
        if (dataGb.isBlank()) dataGb = "50"
        if (expireDays.isBlank() && expireDate.isBlank()) expireDays = "30"
        onConsumeIssuedKey()
    }

    AdminDialog(
        onDismissRequest = onDismiss,
        title = if (initial == null) "Add server" else "Edit server",
        eyebrow = "App catalog",
        subtitle = if (isSsh) {
            "SSH over TLS (custom SNI). Password is write-only and never shown again."
        } else {
            "Pick SG + US (etc), create keys → one free sub with all nodes"
        },
        confirmLabel = "Save",
        maxContentHeight = 560,
        onConfirm = confirm@{
            if (id.isBlank() || name.isBlank()) return@confirm
            if (isSsh) {
                if (sshHost.isBlank() || sshUser.isBlank()) return@confirm
                if (sshPassword.isBlank() && initial?.sshPasswordSet != true) return@confirm
            }
            val expireAt = resolveExpireAt(expireDate, expireDays)
            onSave(
                id,
                name,
                region,
                protocol.trim().ifBlank { "vless" },
                tier,
                if (isSsh) null else uri.ifBlank { null },
                if (isSsh) null else nodes.ifBlank { null },
                dataGb.toDoubleOrNull(),
                usedGb.toDoubleOrNull(),
                expireAt,
                listWhenDisabled,
                enabled,
                sort.toIntOrNull() ?: 0,
                if (isSsh) sshHost.trim() else null,
                if (isSsh) sshPort.toIntOrNull() ?: 443 else null,
                if (isSsh) sshUser.trim() else null,
                if (isSsh) sshPassword.ifBlank { null } else null,
                if (isSsh) sshSni.trim() else null,
                if (isSsh) sshTls else null,
                if (isSsh) sshAllowInsecure else null,
            )
        },
    ) {
        OutlinedTextField(
            id, { id = it },
            label = { Text("Public id") },
            enabled = initial == null,
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(12.dp),
            colors = adminFieldColors(),
        )
        OutlinedTextField(
            name, { name = it },
            label = { Text("Name") },
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(12.dp),
            colors = adminFieldColors(),
        )
        OutlinedTextField(
            region, { region = it },
            label = { Text("Region / CC") },
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(12.dp),
            colors = adminFieldColors(),
        )
        Text("Protocol", style = MaterialTheme.typography.labelMedium, color = InkMuted)
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            listOf("vless" to "VLESS", "ss" to "SS", "ssh" to "SSH").forEach { (value, label) ->
                FilterChip(
                    selected = protocol.equals(value, ignoreCase = true),
                    onClick = { protocol = value },
                    label = { Text(label) },
                    colors = FilterChipDefaults.filterChipColors(
                        selectedContainerColor = Cyan.copy(alpha = 0.25f),
                        selectedLabelColor = Ink,
                    ),
                )
            }
        }
        Text("Tier", style = MaterialTheme.typography.labelMedium, color = InkMuted)
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            listOf("free" to "Free", "paid" to "Paid").forEach { (value, label) ->
                FilterChip(
                    selected = tier.equals(value, ignoreCase = true),
                    onClick = { tier = value },
                    label = { Text(label) },
                    colors = FilterChipDefaults.filterChipColors(
                        selectedContainerColor = Cyan.copy(alpha = 0.25f),
                        selectedLabelColor = Ink,
                    ),
                )
            }
        }

        if (isSsh) {
            OutlinedTextField(
                sshHost, { sshHost = it },
                label = { Text("SSH host") },
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(12.dp),
                colors = adminFieldColors(),
            )
            OutlinedTextField(
                sshPort, { sshPort = it },
                label = { Text("SSH / TLS port") },
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(12.dp),
                colors = adminFieldColors(),
            )
            OutlinedTextField(
                sshUser, { sshUser = it },
                label = { Text("SSH username") },
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(12.dp),
                colors = adminFieldColors(),
            )
            OutlinedTextField(
                sshPassword, { sshPassword = it },
                label = {
                    Text(
                        if (initial?.sshPasswordSet == true) {
                            "SSH password (blank = keep)"
                        } else {
                            "SSH password"
                        },
                    )
                },
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(12.dp),
                colors = adminFieldColors(),
            )
            OutlinedTextField(
                sshSni, { sshSni = it },
                label = { Text("TLS SNI (e.g. www.microsoft.com)") },
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(12.dp),
                colors = adminFieldColors(),
            )
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text("TLS wrap (stunnel)", color = Ink)
                Switch(
                    checked = sshTls,
                    onCheckedChange = {
                        sshTls = it
                        if (it) sshAllowInsecure = true
                    },
                    colors = SwitchDefaults.colors(checkedTrackColor = Cyan),
                )
            }
            if (sshTls) {
                Text(
                    "HTTP Injector style: custom SNI + stunnel. Self-signed certs need Allow insecure ON.",
                    style = MaterialTheme.typography.labelSmall,
                    color = InkMuted,
                )
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Text("Allow insecure TLS", color = InkMuted)
                    Switch(
                        checked = sshAllowInsecure,
                        onCheckedChange = { sshAllowInsecure = it },
                        colors = SwitchDefaults.colors(checkedTrackColor = Cyan),
                    )
                }
            }
            if (!sshTls) {
                Text(
                    "Plain SSH — use sshd port (usually 22).",
                    style = MaterialTheme.typography.labelSmall,
                    color = InkMuted,
                )
            }
            Text(
                "Use a tunnel-only SSH user (no shell/root). See docs/SSH_STUNNEL.md.",
                style = MaterialTheme.typography.labelSmall,
                color = InkMuted,
            )
        } else {
        Text(
            "Create VLESS keys from VPN nodes → Available nodes (one free sub)",
            style = MaterialTheme.typography.labelMedium,
            color = InkMuted,
        )
        if (vpnNodes.isEmpty()) {
            Text(
                "No VPN nodes loaded — open Servers & Plans once, then retry.",
                style = MaterialTheme.typography.bodySmall,
                color = InkMuted,
            )
        } else {
            Text(
                "Tap to multi-select (e.g. SG1 + US1). Disabled nodes allowed.",
                style = MaterialTheme.typography.labelSmall,
                color = InkMuted,
            )
            vpnNodes.forEach { node ->
                val selected = node.id in selectedNodes
                val label = buildString {
                    append(node.id.uppercase())
                    append(" · ")
                    append(node.nameEn.ifBlank { node.vpsHost })
                    if (!node.enabled) append(" · OFF")
                    if (!node.panelConfigured) append(" · not configured")
                }
                AdminOutlinedButton(
                    text = if (selected) "✓ $label" else label,
                    onClick = {
                        selectedNodes = if (selected) {
                            selectedNodes - node.id
                        } else {
                            selectedNodes + node.id
                        }
                    },
                    compact = true,
                    enabled = node.panelConfigured,
                    contentColor = when {
                        selected -> Cyan
                        !node.enabled -> InkMuted
                        else -> Ink
                    },
                )
            }
            AdminPrimaryButton(
                text = when {
                    issuingKey -> "Creating…"
                    selectedNodes.isEmpty() -> "Select nodes first"
                    else -> "Create ${selectedNodes.size} VLESS key(s)"
                },
                onClick = {
                    if (selectedNodes.isEmpty() || issuingKey) return@AdminPrimaryButton
                    val gb = dataGb.toDoubleOrNull() ?: 50.0
                    val days = expireDays.toIntOrNull()
                        ?: ((initial?.manualExpireAt?.let {
                            ((it - System.currentTimeMillis() / 1000L) / 86400L).toInt().coerceAtLeast(1)
                        }) ?: 30)
                    val remark = name.ifBlank { id }.ifBlank { "catalog" }
                    onIssueKey(selectedNodes.toList(), gb, days.coerceAtLeast(1), remark)
                },
                compact = true,
            )
        }

        OutlinedTextField(
            uri, { uri = it },
            label = { Text("Config: https:// sub only (optional)") },
            placeholder = { Text("Leave blank when using Available nodes") },
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(12.dp),
            colors = adminFieldColors(),
            minLines = 2,
        )
        OutlinedTextField(
            nodes, { nodes = it },
            label = { Text("Available nodes (one vless:// per line = free sub)") },
            placeholder = { Text("vless://…sg…\nvless://…us…") },
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(12.dp),
            colors = adminFieldColors(),
            minLines = 4,
        )
        Text(
            "Manual free-sub usage (shown in app; overrides upstream when set)",
            style = MaterialTheme.typography.labelMedium,
            color = InkMuted,
        )
        OutlinedTextField(
            dataGb, { dataGb = it },
            label = { Text("Data limit GB (panel + app display)") },
            placeholder = { Text("e.g. 50") },
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(12.dp),
            colors = adminFieldColors(),
        )
        OutlinedTextField(
            usedGb, { usedGb = it },
            label = { Text("Used GB (optional)") },
            placeholder = { Text("e.g. 12.5") },
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(12.dp),
            colors = adminFieldColors(),
        )
        OutlinedTextField(
            expireDate, { expireDate = it },
            label = { Text("Expire date (yyyy-MM-dd) or unix") },
            placeholder = { Text("2026-12-31") },
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(12.dp),
            colors = adminFieldColors(),
        )
        OutlinedTextField(
            expireDays, { expireDays = it },
            label = { Text("Or expire in N days from now") },
            placeholder = { Text("30") },
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(12.dp),
            colors = adminFieldColors(),
        )
        } // end non-SSH fields

        OutlinedTextField(
            sort, { sort = it },
            label = { Text("Sort") },
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(12.dp),
            colors = adminFieldColors(),
        )
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Enabled", color = Ink)
            Spacer(Modifier.weight(1f))
            Switch(
                checked = enabled,
                onCheckedChange = { enabled = it },
                colors = SwitchDefaults.colors(checkedTrackColor = Cyan),
            )
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(modifier = Modifier.weight(1f)) {
                Text("List when disabled", color = Ink)
                Text(
                    "Still show free nodes in app if Enabled is off",
                    style = MaterialTheme.typography.labelSmall,
                    color = InkMuted,
                )
            }
            Switch(
                checked = listWhenDisabled,
                onCheckedChange = { listWhenDisabled = it },
                colors = SwitchDefaults.colors(checkedTrackColor = Cyan),
            )
        }
    }
}

private fun trimGb(v: Double): String =
    if (v == v.toLong().toDouble()) v.toLong().toString() else v.toString()

private fun formatExpire(unixSec: Long): String {
    val fmt = SimpleDateFormat("yyyy-MM-dd", Locale.US)
    fmt.timeZone = TimeZone.getDefault()
    return fmt.format(Date(unixSec * 1000L))
}

private fun resolveExpireAt(dateOrUnix: String, daysFromNow: String): Long? {
    val days = daysFromNow.trim().toIntOrNull()
    if (days != null && days > 0) {
        return System.currentTimeMillis() / 1000L + days * 86400L
    }
    val raw = dateOrUnix.trim()
    if (raw.isEmpty()) return null
    raw.toLongOrNull()?.let { return it }
    val parts = raw.split("-")
    if (parts.size == 3) {
        val y = parts[0].toIntOrNull() ?: return null
        val m = parts[1].toIntOrNull() ?: return null
        val d = parts[2].toIntOrNull() ?: return null
        val cal = Calendar.getInstance()
        cal.set(y, m - 1, d, 23, 59, 59)
        cal.set(Calendar.MILLISECOND, 0)
        return cal.timeInMillis / 1000L
    }
    return null
}
