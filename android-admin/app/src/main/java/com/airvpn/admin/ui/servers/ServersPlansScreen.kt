package com.airvpn.admin.ui.servers

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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

    LazyColumn(
        modifier = modifier.fillMaxSize().padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        item {
            Text("VPN locations", style = MaterialTheme.typography.titleLarge, color = Navy)
            Spacer(Modifier.height(8.dp))
        }
        items(servers, key = { it.id }) { s ->
            Column {
                Text("${s.id.uppercase()} · ${s.nameEn}", fontWeight = FontWeight.SemiBold)
                Text(
                    "${s.vpsHost}:${s.vpsPort} · panel ${if (s.panelConfigured) "OK" else "missing"} · ${s.planCount} env plans",
                    color = InkMuted,
                )
            }
        }
        item {
            Spacer(modifier.height(12.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text("Price plans (DB)", style = MaterialTheme.typography.titleMedium, color = Navy)
                Button(onClick = { creating = true }) { Text("Add plan") }
            }
        }
        items(plans, key = { it.id }) { p ->
            Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Column(modifier = Modifier.weight(1f)) {
                    Text("${p.title} · ${p.serverId.uppercase()}", fontWeight = FontWeight.SemiBold)
                    Text(
                        "${p.dataGb} GB · ${fmt.format(p.priceKs)} Ks · ${p.durationDays}d",
                        color = InkMuted,
                    )
                }
                Switch(checked = p.isActive, onCheckedChange = { onTogglePlan(p.id, it) })
                OutlinedButton(onClick = { editing = p }) { Text("Edit") }
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
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(title, { title = it }, label = { Text("Title") }, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(data, { data = it }, label = { Text("Data GB") }, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(price, { price = it }, label = { Text("Price Ks") }, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(days, { days = it }, label = { Text("Duration days") }, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(server, { server = it }, label = { Text("Server id") }, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(sort, { sort = it }, label = { Text("Sort order") }, modifier = Modifier.fillMaxWidth())
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Active")
                    Spacer(Modifier.weight(1f))
                    Switch(checked = active, onCheckedChange = { active = it })
                }
            }
        },
        confirmButton = {
            TextButton(onClick = {
                onSave(
                    initial?.id,
                    title,
                    data.toDoubleOrNull() ?: return@TextButton,
                    price.toIntOrNull() ?: return@TextButton,
                    days.toIntOrNull() ?: return@TextButton,
                    server,
                    sort.toIntOrNull() ?: 0,
                    active,
                )
            }) { Text("Save") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}
