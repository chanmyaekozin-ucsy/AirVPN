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
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.airvpn.admin.data.model.CatalogServer
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
import com.airvpn.admin.ui.theme.Navy

@Composable
fun CatalogScreen(
    servers: List<CatalogServer>,
    loadingMore: Boolean = false,
    canLoadMore: Boolean = false,
    onSave: (id: String, name: String, region: String, tier: String, configUri: String?, enabled: Boolean, sortOrder: Int) -> Unit,
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
                                "${s.id} · ${s.region.ifBlank { "—" }}",
                                style = MaterialTheme.typography.bodyMedium,
                                color = InkMuted,
                            )
                            val cfg = s.configUri.orEmpty()
                            if (cfg.isNotBlank()) {
                                Spacer(Modifier.height(4.dp))
                                Text(
                                    when {
                                        cfg.startsWith("http", ignoreCase = true) -> "Source: subscription link"
                                        else -> "Source: share key"
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
            onDismiss = { creating = false; editing = null },
            onSave = { id, name, region, tier, uri, enabled, sort ->
                onSave(id, name, region, tier, uri, enabled, sort)
                creating = false
                editing = null
            },
        )
    }
}

@Composable
private fun CatalogDialog(
    initial: CatalogServer?,
    onDismiss: () -> Unit,
    onSave: (String, String, String, String, String?, Boolean, Int) -> Unit,
) {
    var id by remember { mutableStateOf(initial?.id ?: "") }
    var name by remember { mutableStateOf(initial?.name ?: "") }
    var region by remember { mutableStateOf(initial?.region ?: "") }
    var tier by remember { mutableStateOf(initial?.tier ?: "free") }
    var uri by remember { mutableStateOf(initial?.configUri ?: "") }
    var enabled by remember { mutableStateOf(initial?.enabled ?: true) }
    var sort by remember { mutableStateOf(initial?.sortOrder?.toString() ?: "0") }

    AdminDialog(
        onDismissRequest = onDismiss,
        title = if (initial == null) "Add server" else "Edit server",
        eyebrow = "App catalog",
        subtitle = "vless:// share key or https:// subscription",
        confirmLabel = "Save",
        onConfirm = confirm@{
            if (id.isBlank() || name.isBlank()) return@confirm
            onSave(id, name, region, tier, uri.ifBlank { null }, enabled, sort.toIntOrNull() ?: 0)
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
        OutlinedTextField(
            tier, { tier = it },
            label = { Text("Tier (free/paid)") },
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(12.dp),
            colors = adminFieldColors(),
        )
        OutlinedTextField(
            uri, { uri = it },
            label = { Text("Config: vless:// or https:// sub") },
            placeholder = { Text("vless://… or https://…/sub") },
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(12.dp),
            colors = adminFieldColors(),
            minLines = 2,
        )
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
    }
}
