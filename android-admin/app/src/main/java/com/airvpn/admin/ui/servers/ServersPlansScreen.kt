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
import androidx.compose.material3.AlertDialog
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
import com.airvpn.admin.ui.components.AdminOutlinedButton
import com.airvpn.admin.ui.components.AdminPrimaryButton
import com.airvpn.admin.ui.components.AdminScreen
import com.airvpn.admin.ui.components.AdminTextButton
import com.airvpn.admin.ui.components.ListRowCard
import com.airvpn.admin.ui.components.SectionLabel
import com.airvpn.admin.ui.components.StatusChip
import com.airvpn.admin.ui.components.StatusTone
import com.airvpn.admin.ui.theme.Cyan
import com.airvpn.admin.ui.theme.Ink
import com.airvpn.admin.ui.theme.InkMuted
import com.airvpn.admin.ui.theme.Navy
import java.text.NumberFormat
import java.util.Locale

@Composable
fun ServersPlansScreen(
    servers: List<VpnServerInfo>,
    plans: List<PlanItem>,
    onSavePlan: (id: Int?, title: String, dataGb: Double, priceKs: Int, days: Int, serverId: String, sortOrder: Int, active: Boolean) -> Unit,
    onTogglePlan: (Int, Boolean) -> Unit,
    modifier: Modifier = Modifier,
) {
    var editing by remember { mutableStateOf<PlanItem?>(null) }
    var creating by remember { mutableStateOf(false) }
    val fmt = NumberFormat.getIntegerInstance(Locale.US)

    AdminScreen(
        title = "Servers & plans",
        eyebrow = "Catalog",
        subtitle = "Locations from .env · prices from database",
        modifier = modifier.fillMaxSize(),
        actions = {
            AdminPrimaryButton(
                text = "Add plan",
                onClick = { creating = true },
                compact = true,
            )
        },
    ) {
        LazyColumn(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item { SectionLabel("VPN locations") }
            items(servers, key = { it.id }) { s ->
                ListRowCard {
                    Text("${s.id.uppercase()} · ${s.nameEn}", fontWeight = FontWeight.SemiBold, color = Ink)
                    Spacer(Modifier.height(4.dp))
                    Text(
                        "${s.vpsHost}:${s.vpsPort}",
                        style = MaterialTheme.typography.bodyMedium,
                        color = InkMuted,
                    )
                    Spacer(Modifier.height(8.dp))
                    StatusChip(
                        if (s.panelConfigured) "Panel OK" else "Panel missing",
                        if (s.panelConfigured) StatusTone.Success else StatusTone.Warning,
                    )
                }
            }
            item {
                Spacer(Modifier.height(8.dp))
                SectionLabel("Price plans")
            }
            items(plans, key = { it.id }) { p ->
                ListRowCard {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                "${p.title} · ${p.serverId.uppercase()}",
                                fontWeight = FontWeight.SemiBold,
                                color = Ink,
                            )
                            Spacer(Modifier.height(4.dp))
                            Text(
                                "${p.dataGb} GB · ${fmt.format(p.priceKs)} Ks · ${p.durationDays}d",
                                style = MaterialTheme.typography.bodyMedium,
                                color = InkMuted,
                            )
                        }
                        Switch(
                            checked = p.isActive,
                            onCheckedChange = { onTogglePlan(p.id, it) },
                            colors = SwitchDefaults.colors(checkedTrackColor = Cyan),
                        )
                        AdminOutlinedButton(
                            text = "Edit",
                            onClick = { editing = p },
                            compact = true,
                        )
                    }
                }
            }
        }
    }

    if (creating || editing != null) {
        PlanDialog(
            initial = editing,
            defaultServer = servers.firstOrNull()?.id ?: "sg",
            onDismiss = { creating = false; editing = null },
            onSave = { id, title, data, price, days, server, sort, active ->
                onSavePlan(id, title, data, price, days, server, sort, active)
                creating = false
                editing = null
            },
        )
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

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (initial == null) "Add plan" else "Edit plan") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedTextField(title, { title = it }, label = { Text("Title") }, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(data, { data = it }, label = { Text("Data GB") }, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(price, { price = it }, label = { Text("Price Ks") }, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(days, { days = it }, label = { Text("Duration days") }, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(server, { server = it }, label = { Text("Server id") }, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(sort, { sort = it }, label = { Text("Sort order") }, modifier = Modifier.fillMaxWidth())
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Active", color = Ink)
                    Spacer(Modifier.weight(1f))
                    Switch(checked = active, onCheckedChange = { active = it })
                }
            }
        },
        confirmButton = {
            AdminTextButton(
                text = "Save",
                onClick = {
                    onSave(
                        initial?.id,
                        title,
                        data.toDoubleOrNull() ?: return@AdminTextButton,
                        price.toIntOrNull() ?: return@AdminTextButton,
                        days.toIntOrNull() ?: return@AdminTextButton,
                        server,
                        sort.toIntOrNull() ?: 0,
                        active,
                    )
                },
                contentColor = Navy,
            )
        },
        dismissButton = {
            AdminTextButton(text = "Cancel", onClick = onDismiss, contentColor = InkMuted)
        },
    )
}
