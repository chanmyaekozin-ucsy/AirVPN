package com.airvpn.admin.ui.servers

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
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
import com.airvpn.admin.data.model.PlanItem
import com.airvpn.admin.data.model.VpnServerInfo
import com.airvpn.admin.ui.components.AdminDialog
import com.airvpn.admin.ui.components.AdminOutlinedButton
import com.airvpn.admin.ui.components.AdminPrimaryButton
import com.airvpn.admin.ui.components.AdminScreen
import com.airvpn.admin.ui.components.AdminTextButton
import com.airvpn.admin.ui.components.ListRowCard
import com.airvpn.admin.ui.components.SectionLabel
import com.airvpn.admin.ui.components.StatusChip
import com.airvpn.admin.ui.components.StatusTone
import com.airvpn.admin.ui.components.adminFieldColors
import com.airvpn.admin.ui.theme.Cyan
import com.airvpn.admin.ui.theme.Danger
import com.airvpn.admin.ui.theme.Ink
import com.airvpn.admin.ui.theme.InkMuted
import com.airvpn.admin.ui.theme.Navy
import java.text.NumberFormat
import java.util.Locale

@Composable
fun ServersPlansScreen(
    servers: List<VpnServerInfo>,
    plans: List<PlanItem>,
    onSaveServer: (
        id: String,
        nameEn: String,
        nameMy: String,
        panelUrl: String,
        panelUsername: String,
        panelPassword: String,
        panelInboundId: Int,
        panelVerifySsl: Boolean,
        vpsHost: String,
        vpsPort: Int,
        vlessSecurity: String,
        vlessFlow: String,
        vlessSni: String,
        vlessFp: String,
        vlessPbk: String,
        vlessSid: String,
        vlessSpx: String,
        enabled: Boolean,
        sortOrder: Int,
    ) -> Unit,
    onToggleServer: (String, Boolean) -> Unit,
    onDeleteServer: (String) -> Unit,
    onSavePlan: (id: Int?, title: String, dataGb: Double, priceKs: Int, days: Int, serverId: String, sortOrder: Int, active: Boolean) -> Unit,
    onTogglePlan: (Int, Boolean) -> Unit,
    modifier: Modifier = Modifier,
) {
    var editingPlan by remember { mutableStateOf<PlanItem?>(null) }
    var creatingPlan by remember { mutableStateOf(false) }
    var editingNode by remember { mutableStateOf<VpnServerInfo?>(null) }
    var creatingNode by remember { mutableStateOf(false) }
    val fmt = NumberFormat.getIntegerInstance(Locale.US)
    val enabledPlans = remember(plans) { plans.filter { it.isActive } }
    val disabledPlans = remember(plans) { plans.filter { !it.isActive } }
    val enabledNodes = remember(servers) { servers.filter { it.enabled } }
    val disabledNodes = remember(servers) { servers.filter { !it.enabled } }

    AdminScreen(
        title = "Servers & plans",
        eyebrow = "Catalog",
        subtitle = "Nodes and prices managed in Admin (DB)",
        modifier = modifier.fillMaxSize(),
        actions = {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                AdminOutlinedButton(
                    text = "Add node",
                    onClick = { creatingNode = true },
                    compact = true,
                )
                AdminPrimaryButton(
                    text = "Add plan",
                    onClick = { creatingPlan = true },
                    compact = true,
                )
            }
        },
    ) {
        LazyColumn(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item { SectionLabel("Enabled nodes") }
            if (enabledNodes.isEmpty()) {
                item {
                    Text("No enabled nodes yet.", color = InkMuted)
                }
            }
            items(enabledNodes, key = { "en-${it.id}" }) { s ->
                NodeCard(
                    server = s,
                    onEdit = { editingNode = s },
                    onToggle = onToggleServer,
                    onDelete = onDeleteServer,
                )
            }

            item {
                Spacer(Modifier.height(4.dp))
                SectionLabel("Disabled nodes")
            }
            if (disabledNodes.isEmpty()) {
                item {
                    Text("None disabled.", color = InkMuted)
                }
            }
            items(disabledNodes, key = { "dis-${it.id}" }) { s ->
                NodeCard(
                    server = s,
                    onEdit = { editingNode = s },
                    onToggle = onToggleServer,
                    onDelete = onDeleteServer,
                )
            }

            item {
                Spacer(Modifier.height(8.dp))
                SectionLabel("Enabled plans")
            }
            if (enabledPlans.isEmpty()) {
                item { Text("No enabled plans.", color = InkMuted) }
            }
            items(enabledPlans, key = { "ep-${it.id}" }) { p ->
                PlanCard(
                    plan = p,
                    fmt = fmt,
                    onEdit = { editingPlan = p },
                    onToggle = onTogglePlan,
                )
            }

            item {
                Spacer(Modifier.height(4.dp))
                SectionLabel("Disabled plans")
            }
            if (disabledPlans.isEmpty()) {
                item { Text("None disabled.", color = InkMuted) }
            }
            items(disabledPlans, key = { "dp-${it.id}" }) { p ->
                PlanCard(
                    plan = p,
                    fmt = fmt,
                    onEdit = { editingPlan = p },
                    onToggle = onTogglePlan,
                )
            }
            item { Spacer(Modifier.height(12.dp)) }
        }
    }

    if (creatingNode || editingNode != null) {
        NodeDialog(
            initial = editingNode,
            onDismiss = { creatingNode = false; editingNode = null },
            onSave = { args ->
                onSaveServer(
                    args.id, args.nameEn, args.nameMy, args.panelUrl, args.panelUsername,
                    args.panelPassword, args.panelInboundId, args.panelVerifySsl,
                    args.vpsHost, args.vpsPort, args.vlessSecurity, args.vlessFlow,
                    args.vlessSni, args.vlessFp, args.vlessPbk, args.vlessSid, args.vlessSpx,
                    args.enabled, args.sortOrder,
                )
                creatingNode = false
                editingNode = null
            },
        )
    }

    if (creatingPlan || editingPlan != null) {
        PlanDialog(
            initial = editingPlan,
            defaultServer = servers.firstOrNull { it.enabled }?.id
                ?: servers.firstOrNull()?.id
                ?: "sg",
            onDismiss = { creatingPlan = false; editingPlan = null },
            onSave = { id, title, data, price, days, server, sort, active ->
                onSavePlan(id, title, data, price, days, server, sort, active)
                creatingPlan = false
                editingPlan = null
            },
        )
    }
}

@Composable
private fun NodeCard(
    server: VpnServerInfo,
    onEdit: () -> Unit,
    onToggle: (String, Boolean) -> Unit,
    onDelete: (String) -> Unit,
) {
    ListRowCard {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    "${server.id.uppercase()} · ${server.nameEn}",
                    fontWeight = FontWeight.SemiBold,
                    color = Ink,
                )
                Spacer(Modifier.height(4.dp))
                Text(
                    "${server.vpsHost.ifBlank { "—" }}:${server.vpsPort} · ${server.planCount} plans",
                    style = MaterialTheme.typography.bodyMedium,
                    color = InkMuted,
                )
            }
            Switch(
                checked = server.enabled,
                onCheckedChange = { onToggle(server.id, it) },
                colors = SwitchDefaults.colors(checkedTrackColor = Cyan),
            )
        }
        Spacer(Modifier.height(8.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            StatusChip(
                if (server.panelConfigured) "Panel OK" else "Panel missing",
                if (server.panelConfigured) StatusTone.Success else StatusTone.Warning,
            )
            StatusChip(
                if (server.enabled) "Enabled" else "Disabled",
                if (server.enabled) StatusTone.Success else StatusTone.Neutral,
            )
        }
        Spacer(Modifier.height(10.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            AdminOutlinedButton(text = "Edit", onClick = onEdit, compact = true)
            AdminTextButton(
                text = "Delete",
                onClick = { onDelete(server.id) },
                contentColor = Danger,
            )
        }
    }
}

@Composable
private fun PlanCard(
    plan: PlanItem,
    fmt: NumberFormat,
    onEdit: () -> Unit,
    onToggle: (Int, Boolean) -> Unit,
) {
    ListRowCard {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    "${plan.title} · ${plan.serverId.uppercase()}",
                    fontWeight = FontWeight.SemiBold,
                    color = Ink,
                )
                Spacer(Modifier.height(4.dp))
                Text(
                    "${plan.dataGb} GB · ${fmt.format(plan.priceKs)} Ks · ${plan.durationDays}d",
                    style = MaterialTheme.typography.bodyMedium,
                    color = InkMuted,
                )
            }
            Switch(
                checked = plan.isActive,
                onCheckedChange = { onToggle(plan.id, it) },
                colors = SwitchDefaults.colors(checkedTrackColor = Cyan),
            )
            AdminOutlinedButton(
                text = "Edit",
                onClick = onEdit,
                compact = true,
            )
        }
    }
}

private data class NodeForm(
    val id: String,
    val nameEn: String,
    val nameMy: String,
    val panelUrl: String,
    val panelUsername: String,
    val panelPassword: String,
    val panelInboundId: Int,
    val panelVerifySsl: Boolean,
    val vpsHost: String,
    val vpsPort: Int,
    val vlessSecurity: String,
    val vlessFlow: String,
    val vlessSni: String,
    val vlessFp: String,
    val vlessPbk: String,
    val vlessSid: String,
    val vlessSpx: String,
    val enabled: Boolean,
    val sortOrder: Int,
)

@Composable
private fun NodeDialog(
    initial: VpnServerInfo?,
    onDismiss: () -> Unit,
    onSave: (NodeForm) -> Unit,
) {
    var id by remember { mutableStateOf(initial?.id ?: "") }
    var nameEn by remember { mutableStateOf(initial?.nameEn ?: "") }
    var nameMy by remember { mutableStateOf(initial?.nameMy ?: "") }
    var panelUrl by remember { mutableStateOf(initial?.panelUrl ?: "") }
    var panelUsername by remember { mutableStateOf(initial?.panelUsername ?: "admin") }
    var panelPassword by remember { mutableStateOf("") }
    var panelInboundId by remember { mutableStateOf(initial?.panelInboundId?.toString() ?: "1") }
    var panelVerifySsl by remember { mutableStateOf(initial?.panelVerifySsl ?: true) }
    var vpsHost by remember { mutableStateOf(initial?.vpsHost ?: "") }
    var vpsPort by remember { mutableStateOf(initial?.vpsPort?.toString() ?: "443") }
    var vlessSecurity by remember { mutableStateOf(initial?.vlessSecurity ?: "reality") }
    var vlessFlow by remember { mutableStateOf(initial?.vlessFlow ?: "xtls-rprx-vision") }
    var vlessSni by remember { mutableStateOf(initial?.vlessSni ?: "") }
    var vlessFp by remember { mutableStateOf(initial?.vlessFp ?: "chrome") }
    var vlessPbk by remember { mutableStateOf("") }
    var vlessSid by remember { mutableStateOf(initial?.vlessSid ?: "") }
    var vlessSpx by remember { mutableStateOf(initial?.vlessSpx ?: "/") }
    var enabled by remember { mutableStateOf(initial?.enabled ?: true) }
    var sort by remember { mutableStateOf(initial?.sortOrder?.toString() ?: "0") }

    AdminDialog(
        onDismissRequest = onDismiss,
        title = if (initial == null) "Add node" else "Edit node",
        eyebrow = "VPN location",
        subtitle = "Panel + Reality settings stored in database",
        confirmLabel = "Save",
        onConfirm = confirm@{
            if (id.isBlank() || nameEn.isBlank()) return@confirm
            onSave(
                NodeForm(
                    id = id.trim().lowercase(),
                    nameEn = nameEn.trim(),
                    nameMy = nameMy.trim().ifBlank { nameEn.trim() },
                    panelUrl = panelUrl.trim(),
                    panelUsername = panelUsername.trim(),
                    panelPassword = panelPassword,
                    panelInboundId = panelInboundId.toIntOrNull() ?: 1,
                    panelVerifySsl = panelVerifySsl,
                    vpsHost = vpsHost.trim(),
                    vpsPort = vpsPort.toIntOrNull() ?: 443,
                    vlessSecurity = vlessSecurity.trim().ifBlank { "reality" },
                    vlessFlow = vlessFlow.trim(),
                    vlessSni = vlessSni.trim(),
                    vlessFp = vlessFp.trim().ifBlank { "chrome" },
                    vlessPbk = vlessPbk.trim(),
                    vlessSid = vlessSid.trim(),
                    vlessSpx = vlessSpx.trim().ifBlank { "/" },
                    enabled = enabled,
                    sortOrder = sort.toIntOrNull() ?: 0,
                ),
            )
        },
        maxContentHeight = 520,
    ) {
        OutlinedTextField(
            id, { id = it.lowercase().filter { c -> c.isLetterOrDigit() || c == '_' || c == '-' } },
            label = { Text("Node id (e.g. sg, jp)") },
            enabled = initial == null,
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(12.dp),
            colors = adminFieldColors(),
        )
        OutlinedTextField(
            nameEn, { nameEn = it },
            label = { Text("Name (EN)") },
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(12.dp),
            colors = adminFieldColors(),
        )
        OutlinedTextField(
            nameMy, { nameMy = it },
            label = { Text("Name (MY)") },
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(12.dp),
            colors = adminFieldColors(),
        )
        OutlinedTextField(
            panelUrl, { panelUrl = it },
            label = { Text("Panel URL") },
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(12.dp),
            colors = adminFieldColors(),
        )
        OutlinedTextField(
            panelUsername, { panelUsername = it },
            label = { Text("Panel username") },
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(12.dp),
            colors = adminFieldColors(),
        )
        OutlinedTextField(
            panelPassword, { panelPassword = it },
            label = {
                Text(
                    if (initial?.panelPasswordSet == true) {
                        "Panel password (leave blank to keep)"
                    } else {
                        "Panel password"
                    },
                )
            },
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(12.dp),
            colors = adminFieldColors(),
        )
        OutlinedTextField(
            panelInboundId, { panelInboundId = it.filter { c -> c.isDigit() } },
            label = { Text("Inbound id") },
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(12.dp),
            colors = adminFieldColors(),
        )
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Verify SSL", color = Ink, modifier = Modifier.weight(1f))
            Switch(
                checked = panelVerifySsl,
                onCheckedChange = { panelVerifySsl = it },
                colors = SwitchDefaults.colors(checkedTrackColor = Cyan),
            )
        }
        OutlinedTextField(
            vpsHost, { vpsHost = it },
            label = { Text("VPS host") },
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(12.dp),
            colors = adminFieldColors(),
        )
        OutlinedTextField(
            vpsPort, { vpsPort = it.filter { c -> c.isDigit() } },
            label = { Text("VPS port") },
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(12.dp),
            colors = adminFieldColors(),
        )
        OutlinedTextField(
            vlessSni, { vlessSni = it },
            label = { Text("VLESS SNI") },
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(12.dp),
            colors = adminFieldColors(),
        )
        OutlinedTextField(
            vlessPbk, { vlessPbk = it },
            label = {
                Text(
                    if (initial?.vlessPbkSet == true) {
                        "Reality PBK (leave blank to keep)"
                    } else {
                        "Reality public key (PBK)"
                    },
                )
            },
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(12.dp),
            colors = adminFieldColors(),
        )
        OutlinedTextField(
            vlessSid, { vlessSid = it },
            label = { Text("Reality short id (SID)") },
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(12.dp),
            colors = adminFieldColors(),
        )
        OutlinedTextField(
            vlessFp, { vlessFp = it },
            label = { Text("Fingerprint") },
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(12.dp),
            colors = adminFieldColors(),
        )
        OutlinedTextField(
            vlessSecurity, { vlessSecurity = it },
            label = { Text("Security") },
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(12.dp),
            colors = adminFieldColors(),
        )
        OutlinedTextField(
            vlessFlow, { vlessFlow = it },
            label = { Text("Flow") },
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(12.dp),
            colors = adminFieldColors(),
        )
        OutlinedTextField(
            vlessSpx, { vlessSpx = it },
            label = { Text("Spider X") },
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(12.dp),
            colors = adminFieldColors(),
        )
        OutlinedTextField(
            sort, { sort = it.filter { c -> c == '-' || c.isDigit() } },
            label = { Text("Sort order") },
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(12.dp),
            colors = adminFieldColors(),
        )
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Enabled", color = Ink, modifier = Modifier.weight(1f))
            Switch(
                checked = enabled,
                onCheckedChange = { enabled = it },
                colors = SwitchDefaults.colors(checkedTrackColor = Cyan),
            )
        }
    }
}

@Composable
private fun PlanDialog(
    initial: PlanItem?,
    defaultServer: String,
    onDismiss: () -> Unit,
    onSave: (Int?, String, Double, Int, Int, String, Int, Boolean) -> Unit,
) {
    var title by remember { mutableStateOf(initial?.title ?: "") }
    var data by remember { mutableStateOf(initial?.dataGb?.toString() ?: "30") }
    var price by remember { mutableStateOf(initial?.priceKs?.toString() ?: "10000") }
    var days by remember { mutableStateOf(initial?.durationDays?.toString() ?: "30") }
    var server by remember { mutableStateOf(initial?.serverId ?: defaultServer) }
    var sort by remember { mutableStateOf(initial?.sortOrder?.toString() ?: "0") }
    var active by remember { mutableStateOf(initial?.isActive ?: true) }

    AdminDialog(
        onDismissRequest = onDismiss,
        title = if (initial == null) "Add plan" else "Edit plan",
        eyebrow = "Catalog",
        confirmLabel = "Save",
        onConfirm = confirm@{
            onSave(
                initial?.id,
                title,
                data.toDoubleOrNull() ?: return@confirm,
                price.toIntOrNull() ?: return@confirm,
                days.toIntOrNull() ?: return@confirm,
                server,
                sort.toIntOrNull() ?: 0,
                active,
            )
        },
    ) {
        OutlinedTextField(
            title, { title = it },
            label = { Text("Title") },
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(12.dp),
            colors = adminFieldColors(),
        )
        OutlinedTextField(
            data, { data = it },
            label = { Text("Data GB") },
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(12.dp),
            colors = adminFieldColors(),
        )
        OutlinedTextField(
            price, { price = it },
            label = { Text("Price Ks") },
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(12.dp),
            colors = adminFieldColors(),
        )
        OutlinedTextField(
            days, { days = it },
            label = { Text("Duration days") },
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(12.dp),
            colors = adminFieldColors(),
        )
        OutlinedTextField(
            server, { server = it.lowercase().trim() },
            label = { Text("Server id") },
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(12.dp),
            colors = adminFieldColors(),
        )
        OutlinedTextField(
            sort, { sort = it },
            label = { Text("Sort order") },
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(12.dp),
            colors = adminFieldColors(),
        )
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Enabled", color = Ink)
            Spacer(Modifier.weight(1f))
            Switch(
                checked = active,
                onCheckedChange = { active = it },
                colors = SwitchDefaults.colors(checkedTrackColor = Cyan),
            )
        }
    }
}
