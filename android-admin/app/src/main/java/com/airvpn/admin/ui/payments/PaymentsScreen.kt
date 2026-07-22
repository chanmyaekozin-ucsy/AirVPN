package com.airvpn.admin.ui.payments

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
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.airvpn.admin.data.model.PaymentItem
import com.airvpn.admin.ui.theme.Danger
import com.airvpn.admin.ui.theme.InkMuted
import com.airvpn.admin.ui.theme.Navy
import com.airvpn.admin.ui.theme.Success
import java.text.NumberFormat
import java.util.Locale

@Composable
fun PaymentsScreen(
    payments: List<PaymentItem>,
    filter: String?,
    onFilter: (String?) -> Unit,
    onApprove: (Int) -> Unit,
    onReject: (Int, String) -> Unit,
    modifier: Modifier = Modifier,
) {
    var rejectId by remember { mutableStateOf<Int?>(null) }
    var reason by remember { mutableStateOf("") }
    val fmt = NumberFormat.getIntegerInstance(Locale.US)

    Column(modifier = modifier.fillMaxSize().padding(16.dp)) {
        Text("Payments", style = MaterialTheme.typography.titleLarge, color = Navy)
        Spacer(Modifier.height(8.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf(null to "All", "pending" to "Pending", "approved" to "Approved", "rejected" to "Rejected")
                .forEach { (value, label) ->
                    FilterChip(
                        selected = filter == value,
                        onClick = { onFilter(value) },
                        label = { Text(label) },
                    )
                }
        }
        Spacer(Modifier.height(12.dp))
        LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            items(payments, key = { it.id }) { p ->
                Column(modifier = Modifier.fillMaxWidth()) {
                    Text("#${p.id} · ${p.status.uppercase()}", fontWeight = FontWeight.SemiBold)
                    Text(
                        "${p.firstName ?: ""} @${p.username ?: "—"} · ${p.telegramId}",
                        color = InkMuted,
                    )
                    Text(
                        "${p.planTitle ?: "Plan"} · ${fmt.format(p.amountKs)} Ks · ${p.serverId.uppercase()}",
                        color = InkMuted,
                    )
                    Text(p.createdAt.orEmpty(), color = InkMuted, style = MaterialTheme.typography.bodyMedium)
                    if (p.status == "pending") {
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Button(onClick = { onApprove(p.id) }) {
                                Text("Approve", color = Success)
                            }
                            OutlinedButton(onClick = { rejectId = p.id; reason = "" }) {
                                Text("Reject", color = Danger)
                            }
                        }
                    }
                }
            }
        }
    }

    rejectId?.let { id ->
        AlertDialog(
            onDismissRequest = { rejectId = null },
            title = { Text("Reject #$id") },
            text = {
                OutlinedTextField(
                    value = reason,
                    onValueChange = { reason = it },
                    label = { Text("Reason") },
                    modifier = Modifier.fillMaxWidth(),
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    onReject(id, reason)
                    rejectId = null
                }) { Text("Reject") }
            },
            dismissButton = {
                TextButton(onClick = { rejectId = null }) { Text("Cancel") }
            },
        )
    }
}
