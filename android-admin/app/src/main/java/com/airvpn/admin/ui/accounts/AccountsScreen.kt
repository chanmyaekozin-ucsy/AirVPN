package com.airvpn.admin.ui.accounts

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
import com.airvpn.admin.data.model.PaymentAccount
import com.airvpn.admin.ui.theme.InkMuted
import com.airvpn.admin.ui.theme.Navy

@Composable
fun AccountsScreen(
    accounts: List<PaymentAccount>,
    onSave: (id: Int?, method: String, number: String, name: String, active: Boolean) -> Unit,
    onToggle: (Int, Boolean) -> Unit,
    modifier: Modifier = Modifier,
) {
    var editing by remember { mutableStateOf<PaymentAccount?>(null) }
    var creating by remember { mutableStateOf(false) }

    Column(modifier = modifier.fillMaxSize().padding(16.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text("Payment accounts", style = MaterialTheme.typography.titleLarge, color = Navy)
            Button(onClick = { creating = true }) { Text("Add") }
        }
        Spacer(Modifier.height(12.dp))
        LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            items(accounts, key = { it.id }) { a ->
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text("${a.method} · ${a.accountName}", fontWeight = FontWeight.SemiBold)
                        Text(a.accountNumber, color = InkMuted)
                        Text(if (a.isActive) "Active" else "Disabled", color = InkMuted)
                    }
                    Switch(checked = a.isActive, onCheckedChange = { onToggle(a.id, it) })
                    OutlinedButton(onClick = { editing = a }) { Text("Edit") }
                }
            }
        }
    }

    val draft = editing
    if (creating || draft != null) {
        AccountDialog(
            initial = draft,
            onDismiss = { creating = false; editing = null },
            onSave = { id, method, number, name, active ->
                onSave(id, method, number, name, active)
                creating = false
                editing = null
            },
        )
    }
}

@Composable
private fun AccountDialog(
    initial: PaymentAccount?,
    onDismiss: () -> Unit,
    onSave: (Int?, String, String, String, Boolean) -> Unit,
) {
    var method by remember { mutableStateOf(initial?.method ?: "KBZPay") }
    var number by remember { mutableStateOf(initial?.accountNumber ?: "") }
    var name by remember { mutableStateOf(initial?.accountName ?: "") }
    var active by remember { mutableStateOf(initial?.isActive ?: true) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (initial == null) "Add account" else "Edit account") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(method, { method = it }, label = { Text("Method") }, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(number, { number = it }, label = { Text("Account number") }, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(name, { name = it }, label = { Text("Account name") }, modifier = Modifier.fillMaxWidth())
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Active")
                    Spacer(Modifier.weight(1f))
                    Switch(checked = active, onCheckedChange = { active = it })
                }
            }
        },
        confirmButton = {
            TextButton(onClick = { onSave(initial?.id, method, number, name, active) }) {
                Text("Save")
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}
