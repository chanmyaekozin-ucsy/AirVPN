package com.airvpn.admin.ui.devices

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import androidx.compose.foundation.clickable
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.airvpn.admin.data.model.DauDevice
import com.airvpn.admin.data.model.DeviceExclusiveKey
import com.airvpn.admin.ui.components.AdminConfirmDialog
import com.airvpn.admin.ui.components.AdminDialog
import com.airvpn.admin.ui.components.AdminOutlinedButton
import com.airvpn.admin.ui.components.AdminPrimaryButton
import com.airvpn.admin.ui.components.AdminScreen
import com.airvpn.admin.ui.components.AdminTextButton
import com.airvpn.admin.ui.components.ListRowCard
import com.airvpn.admin.ui.components.StatusChip
import com.airvpn.admin.ui.components.StatusTone
import com.airvpn.admin.ui.components.adminFieldColors
import com.airvpn.admin.ui.theme.Cyan
import com.airvpn.admin.ui.theme.Ink
import com.airvpn.admin.ui.theme.InkMuted
import com.airvpn.admin.ui.theme.Navy

@Composable
fun DevicesScreen(
    keys: List<DeviceExclusiveKey>,
    dauDevices: List<DauDevice>,
    dauDay: String,
    dauCount: Int,
    onSaveKey: (DeviceExclusiveKey) -> Unit,
    onToggleKey: (String, Boolean) -> Unit,
    onDeleteKey: (String) -> Unit,
    onRefreshDau: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    var creating by remember { mutableStateOf(false) }
    var editing by remember { mutableStateOf<DeviceExclusiveKey?>(null) }
    var deleteId by remember { mutableStateOf<String?>(null) }
    var showDau by remember { mutableStateOf(true) }

    AdminScreen(
        title = "Devices",
        subtitle = "DAU UUIDs + exclusive share keys",
        modifier = modifier,
        actions = {
            AdminPrimaryButton(
                text = "Add key",
                onClick = { creating = true },
                compact = true,
            )
        },
    ) {
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            item {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            "DAU $dauDay",
                            style = MaterialTheme.typography.titleMedium,
                            color = Ink,
                            fontWeight = FontWeight.SemiBold,
                        )
                        Text(
                            "$dauCount unique device UUID(s)",
                            style = MaterialTheme.typography.bodySmall,
                            color = InkMuted,
                        )
                    }
                    AdminTextButton(
                        text = if (showDau) "Hide" else "Show",
                        onClick = { showDau = !showDau },
                    )
                    AdminOutlinedButton(
                        text = "Refresh",
                        onClick = onRefreshDau,
                        compact = true,
                    )
                }
            }
            if (showDau) {
                if (dauDevices.isEmpty()) {
                    item {
                        Text("No opens recorded today yet.", color = InkMuted)
                    }
                } else {
                    items(dauDevices, key = { it.deviceId }) { d ->
                        ListRowCard(
                            modifier = Modifier.clickable {
                                copyText(context, d.deviceId)
                            },
                        ) {
                            Text(
                                d.deviceId,
                                style = MaterialTheme.typography.bodyMedium,
                                color = Navy,
                                maxLines = 2,
                                overflow = TextOverflow.Ellipsis,
                            )
                            Text(
                                (d.firstSeenAt ?: "seen today") + " · tap to copy",
                                style = MaterialTheme.typography.bodySmall,
                                color = InkMuted,
                            )
                        }
                    }
                }
            }

            item {
                Spacer(Modifier.height(6.dp))
                Text(
                    "EXCLUSIVE KEYS",
                    style = MaterialTheme.typography.labelSmall,
                    color = Navy,
                    fontWeight = FontWeight.SemiBold,
                )
            }
            if (keys.isEmpty()) {
                item {
                    Text(
                        "Paste a vless:// / ss:// key bound to a device UUID from Info → Device ID.",
                        color = InkMuted,
                    )
                }
            }
            items(keys, key = { it.publicId }) { key ->
                ListRowCard(
                    modifier = Modifier.clickable { editing = key },
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                key.name,
                                style = MaterialTheme.typography.titleMedium,
                                color = Ink,
                                fontWeight = FontWeight.SemiBold,
                            )
                            Text(
                                "${key.deviceId.take(22)}… · ${key.protocol.uppercase()}",
                                style = MaterialTheme.typography.bodySmall,
                                color = InkMuted,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                            if (key.note.isNotBlank()) {
                                Text(key.note, style = MaterialTheme.typography.bodySmall, color = InkMuted)
                            }
                        }
                        StatusChip(
                            if (key.enabled) "On" else "Off",
                            if (key.enabled) StatusTone.Success else StatusTone.Neutral,
                        )
                        Switch(
                            checked = key.enabled,
                            onCheckedChange = { onToggleKey(key.publicId, it) },
                            colors = SwitchDefaults.colors(
                                checkedTrackColor = Navy,
                                checkedThumbColor = Cyan,
                            ),
                        )
                    }
                }
            }
            item { Spacer(Modifier.height(24.dp)) }
        }
    }

    if (creating) {
        ExclusiveKeyDialog(
            initial = DeviceExclusiveKey(),
            title = "Add exclusive key",
            onDismiss = { creating = false },
            onSave = {
                onSaveKey(it)
                creating = false
            },
        )
    }
    editing?.let { key ->
        ExclusiveKeyDialog(
            initial = key,
            title = "Edit exclusive key",
            onDismiss = { editing = null },
            onSave = {
                onSaveKey(it)
                editing = null
            },
            onDelete = {
                deleteId = key.publicId
                editing = null
            },
        )
    }
    deleteId?.let { id ->
        AdminConfirmDialog(
            onDismissRequest = { deleteId = null },
            title = "Delete exclusive key?",
            message = "This device will lose that private server.",
            confirmLabel = "Delete",
            onConfirm = { onDeleteKey(id) },
            destructive = true,
        )
    }
}

@Composable
private fun ExclusiveKeyDialog(
    initial: DeviceExclusiveKey,
    title: String,
    onDismiss: () -> Unit,
    onSave: (DeviceExclusiveKey) -> Unit,
    onDelete: (() -> Unit)? = null,
) {
    var deviceId by remember { mutableStateOf(initial.deviceId) }
    var name by remember { mutableStateOf(initial.name) }
    var region by remember { mutableStateOf(initial.region) }
    var uri by remember { mutableStateOf(initial.configUri) }
    var note by remember { mutableStateOf(initial.note) }
    var enabled by remember { mutableStateOf(initial.enabled) }

    AdminDialog(
        onDismissRequest = onDismiss,
        title = title,
        eyebrow = "Device key",
        confirmLabel = "Save",
        onConfirm = {
            onSave(
                initial.copy(
                    deviceId = deviceId.trim(),
                    name = name.trim(),
                    region = region.trim(),
                    configUri = uri.trim(),
                    note = note.trim(),
                    enabled = enabled,
                ),
            )
        },
        dismissLabel = "Cancel",
        showDismiss = true,
        maxContentHeight = 520,
    ) {
        OutlinedTextField(
            value = deviceId,
            onValueChange = { deviceId = it.take(128) },
            label = { Text("Device UUID") },
            supportingText = { Text("From client Info → Device ID") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
            colors = adminFieldColors(),
            shape = RoundedCornerShape(12.dp),
        )
        OutlinedTextField(
            value = name,
            onValueChange = { name = it.take(128) },
            label = { Text("Display name") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
            colors = adminFieldColors(),
            shape = RoundedCornerShape(12.dp),
        )
        OutlinedTextField(
            value = region,
            onValueChange = { region = it.take(16) },
            label = { Text("Region (optional)") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
            colors = adminFieldColors(),
            shape = RoundedCornerShape(12.dp),
        )
        OutlinedTextField(
            value = uri,
            onValueChange = { uri = it.take(8192) },
            label = { Text("Share key (vless:// or ss://)") },
            modifier = Modifier.fillMaxWidth().height(120.dp),
            colors = adminFieldColors(),
            shape = RoundedCornerShape(12.dp),
        )
        OutlinedTextField(
            value = note,
            onValueChange = { note = it.take(256) },
            label = { Text("Note (optional)") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
            colors = adminFieldColors(),
            shape = RoundedCornerShape(12.dp),
        )
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Enabled", modifier = Modifier.weight(1f), color = Ink)
            Switch(
                checked = enabled,
                onCheckedChange = { enabled = it },
                colors = SwitchDefaults.colors(
                    checkedTrackColor = Navy,
                    checkedThumbColor = Cyan,
                ),
            )
        }
        if (onDelete != null && initial.publicId.isNotBlank()) {
            AdminTextButton(text = "Delete key", onClick = onDelete)
        }
    }
}

private fun copyText(context: Context, text: String) {
    val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    cm.setPrimaryClip(ClipData.newPlainText("Device ID", text))
}
