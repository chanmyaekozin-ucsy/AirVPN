package com.airvpn.admin.ui.users

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
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
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.airvpn.admin.data.model.SubscriptionItem
import com.airvpn.admin.data.model.UserItem
import com.airvpn.admin.ui.components.AdminOutlinedButton
import com.airvpn.admin.ui.components.AdminPrimaryButton
import com.airvpn.admin.ui.components.AdminScreen
import com.airvpn.admin.ui.components.AdminTextButton
import com.airvpn.admin.ui.components.InfiniteListHandler
import com.airvpn.admin.ui.components.ListRowCard
import com.airvpn.admin.ui.components.LoadMoreFooter
import com.airvpn.admin.ui.components.QuietDivider
import com.airvpn.admin.ui.components.StatusChip
import com.airvpn.admin.ui.components.StatusTone
import com.airvpn.admin.ui.theme.Danger
import com.airvpn.admin.ui.theme.Ink
import com.airvpn.admin.ui.theme.InkMuted
import com.airvpn.admin.ui.theme.Navy
import com.airvpn.admin.ui.theme.Success
import com.airvpn.admin.ui.theme.Warning

@Composable
fun UsersScreen(
    users: List<UserItem>,
    query: String,
    onQueryChange: (String) -> Unit,
    onSearch: () -> Unit,
    onBan: (Long, Boolean) -> Unit,
    managedTelegramId: Long?,
    managedSubs: List<SubscriptionItem>,
    lastCreatedKey: String?,
    lastCreatedSubUrl: String?,
    serverIds: List<String>,
    onManage: (Long) -> Unit,
    onCloseManage: () -> Unit,
    onAdjust: (subId: Int, daysDelta: Int, dataGbDelta: Double) -> Unit,
    onReplaceKey: (Int) -> Unit,
    onCreateKey: (telegramId: Long, serverId: String, dataGb: Double, days: Int, notify: Boolean) -> Unit,
    onClearCreatedFlash: () -> Unit,
    loadingMore: Boolean = false,
    canLoadMore: Boolean = false,
    onLoadMore: () -> Unit = {},
    modifier: Modifier = Modifier,
) {
    var showCreate by remember { mutableStateOf(false) }
    val context = LocalContext.current
    val listState = rememberLazyListState()

    InfiniteListHandler(
        listState = listState,
        enabled = canLoadMore && !loadingMore,
        onLoadMore = onLoadMore,
    )

    AdminScreen(
        title = "Users",
        eyebrow = "Directory",
        subtitle = "Search, ban, keys, and manual gifts",
        modifier = modifier.fillMaxSize(),
        actions = {
            AdminPrimaryButton(
                text = "Create key",
                onClick = { showCreate = true },
                compact = true,
            )
        },
    ) {
        Row(
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            OutlinedTextField(
                value = query,
                onValueChange = onQueryChange,
                label = { Text("Search ID / username") },
                modifier = Modifier.weight(1f),
                singleLine = true,
                shape = RoundedCornerShape(12.dp),
            )
            AdminPrimaryButton(
                text = "Go",
                onClick = onSearch,
                compact = true,
            )
        }
        Spacer(Modifier.height(16.dp))
        LazyColumn(
            state = listState,
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            items(users, key = { it.telegramId }) { u ->
                ListRowCard {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                "${u.firstName ?: "User"} · @${u.username ?: "—"}",
                                fontWeight = FontWeight.SemiBold,
                                color = Ink,
                            )
                            Spacer(Modifier.height(4.dp))
                            Text(
                                "${u.telegramId} · free ${u.freeKeys} · paid ${u.paidKeys}",
                                style = MaterialTheme.typography.bodyMedium,
                                color = InkMuted,
                            )
                            if (u.isBanned) {
                                Spacer(Modifier.height(8.dp))
                                StatusChip("Banned", StatusTone.Danger)
                            }
                        }
                        AdminOutlinedButton(
                            text = "Keys",
                            onClick = { onManage(u.telegramId) },
                            compact = true,
                        )
                        if (u.isBanned) {
                            AdminOutlinedButton(
                                text = "Unban",
                                onClick = { onBan(u.telegramId, false) },
                                contentColor = Success,
                                compact = true,
                            )
                        } else {
                            AdminOutlinedButton(
                                text = "Ban",
                                onClick = { onBan(u.telegramId, true) },
                                contentColor = Danger,
                                compact = true,
                            )
                        }
                    }
                }
            }
            item(key = "users-footer") {
                LoadMoreFooter(visible = loadingMore)
            }
        }
    }

    if (managedTelegramId != null) {
        ManageKeysDialog(
            telegramId = managedTelegramId,
            subs = managedSubs,
            lastKey = lastCreatedKey,
            lastSubUrl = lastCreatedSubUrl,
            onDismiss = onCloseManage,
            onAdjust = onAdjust,
            onReplaceKey = onReplaceKey,
            onCopy = { text -> copyText(context, text) },
            onClearFlash = onClearCreatedFlash,
        )
    }

    if (showCreate) {
        CreateKeyDialog(
            defaultServer = serverIds.firstOrNull() ?: "sg",
            serverIds = serverIds.ifEmpty { listOf("sg") },
            initialTelegramId = managedTelegramId?.toString().orEmpty(),
            onDismiss = { showCreate = false },
            onCreate = { tid, server, gb, days, notify ->
                onCreateKey(tid, server, gb, days, notify)
                showCreate = false
            },
        )
    }
}

@Composable
private fun ManageKeysDialog(
    telegramId: Long,
    subs: List<SubscriptionItem>,
    lastKey: String?,
    lastSubUrl: String?,
    onDismiss: () -> Unit,
    onAdjust: (Int, Int, Double) -> Unit,
    onReplaceKey: (Int) -> Unit,
    onCopy: (String) -> Unit,
    onClearFlash: () -> Unit,
) {
    var daysText by remember { mutableStateOf("7") }
    var dataText by remember { mutableStateOf("5") }
    var selectedSub by remember(subs) { mutableStateOf(subs.firstOrNull()?.id) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Keys · $telegramId") },
        text = {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(max = 480.dp)
                    .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                if (!lastKey.isNullOrBlank() || !lastSubUrl.isNullOrBlank()) {
                    Text("Copy links", fontWeight = FontWeight.SemiBold, color = Ink)
                    if (!lastSubUrl.isNullOrBlank()) {
                        Text(lastSubUrl, style = MaterialTheme.typography.bodyMedium, color = Navy)
                        AdminTextButton("Copy sub URL", onClick = { onCopy(lastSubUrl) })
                    }
                    if (!lastKey.isNullOrBlank()) {
                        Text(
                            lastKey.take(64) + if (lastKey.length > 64) "…" else "",
                            style = MaterialTheme.typography.bodyMedium,
                            color = InkMuted,
                        )
                        AdminTextButton("Copy vless://", onClick = { onCopy(lastKey) })
                    }
                    AdminTextButton("Dismiss copy bar", onClick = onClearFlash, contentColor = InkMuted)
                    QuietDivider()
                }

                if (subs.isEmpty()) {
                    Text("No subscriptions for this user.", color = InkMuted)
                } else {
                    subs.forEach { s ->
                        val selected = selectedSub == s.id
                        ListRowCard {
                            Text(
                                "#${s.id} · ${s.planTitle ?: "Plan"} · ${s.serverId.uppercase()}",
                                fontWeight = FontWeight.SemiBold,
                                color = Ink,
                            )
                            Spacer(Modifier.height(4.dp))
                            Text(
                                "%.2f GB left · %s".format(
                                    s.dataLeftGb,
                                    when {
                                        s.daysLeft == null -> "days —"
                                        s.daysLeft < 0 -> "expired"
                                        else -> "${s.daysLeft}d left"
                                    },
                                ),
                                style = MaterialTheme.typography.bodyMedium,
                                color = if ((s.daysLeft ?: 0) < 0) Danger else InkMuted,
                            )
                            Spacer(Modifier.height(6.dp))
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                StatusChip(
                                    if (s.isActive) "Active" else "Off",
                                    if (s.isActive) StatusTone.Success else StatusTone.Neutral,
                                )
                                if (s.isFree) StatusChip("Free", StatusTone.Info)
                                if (selected) StatusChip("Selected", StatusTone.Warning)
                            }
                            Spacer(Modifier.height(8.dp))
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                AdminOutlinedButton(
                                    text = if (selected) "Selected" else "Select",
                                    onClick = { selectedSub = s.id },
                                    compact = true,
                                )
                                if (!s.vlessKey.isNullOrBlank()) {
                                    AdminTextButton("Copy key", onClick = { onCopy(s.vlessKey) })
                                }
                                if (!s.subscriptionUrl.isNullOrBlank()) {
                                    AdminTextButton("Copy sub", onClick = { onCopy(s.subscriptionUrl) })
                                }
                            }
                            if (!s.isFree) {
                                Spacer(Modifier.height(4.dp))
                                AdminOutlinedButton(
                                    text = "Replace key",
                                    onClick = { onReplaceKey(s.id) },
                                    contentColor = Warning,
                                    compact = true,
                                )
                            }
                        }
                    }

                    QuietDivider()
                    Text("Adjust selected", fontWeight = FontWeight.SemiBold, color = Ink)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedTextField(
                            value = daysText,
                            onValueChange = { daysText = it.filter { c -> c == '-' || c.isDigit() } },
                            label = { Text("Days ±") },
                            modifier = Modifier.weight(1f),
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        )
                        OutlinedTextField(
                            value = dataText,
                            onValueChange = { dataText = it.filter { c -> c == '-' || c == '.' || c.isDigit() } },
                            label = { Text("GB ±") },
                            modifier = Modifier.weight(1f),
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                        )
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        AdminPrimaryButton(
                            text = "+Days",
                            onClick = {
                                val id = selectedSub ?: return@AdminPrimaryButton
                                val d = daysText.toIntOrNull()?.coerceAtLeast(0) ?: return@AdminPrimaryButton
                                if (d > 0) onAdjust(id, d, 0.0)
                            },
                            compact = true,
                        )
                        AdminOutlinedButton(
                            text = "−Days",
                            onClick = {
                                val id = selectedSub ?: return@AdminOutlinedButton
                                val d = daysText.toIntOrNull()?.coerceAtLeast(0) ?: return@AdminOutlinedButton
                                if (d > 0) onAdjust(id, -d, 0.0)
                            },
                            contentColor = Danger,
                            compact = true,
                        )
                        AdminPrimaryButton(
                            text = "+GB",
                            onClick = {
                                val id = selectedSub ?: return@AdminPrimaryButton
                                val g = dataText.toDoubleOrNull() ?: return@AdminPrimaryButton
                                if (g != 0.0) onAdjust(id, 0, kotlin.math.abs(g))
                            },
                            compact = true,
                        )
                        AdminOutlinedButton(
                            text = "−GB",
                            onClick = {
                                val id = selectedSub ?: return@AdminOutlinedButton
                                val g = dataText.toDoubleOrNull() ?: return@AdminOutlinedButton
                                if (g != 0.0) onAdjust(id, 0, -kotlin.math.abs(g))
                            },
                            contentColor = Danger,
                            compact = true,
                        )
                    }
                }
            }
        },
        confirmButton = {
            AdminTextButton(text = "Close", onClick = onDismiss, contentColor = Navy)
        },
    )
}

@Composable
private fun CreateKeyDialog(
    defaultServer: String,
    serverIds: List<String>,
    initialTelegramId: String,
    onDismiss: () -> Unit,
    onCreate: (Long, String, Double, Int, Boolean) -> Unit,
) {
    var tid by remember { mutableStateOf(initialTelegramId) }
    var server by remember { mutableStateOf(defaultServer) }
    var gb by remember { mutableStateOf("30") }
    var days by remember { mutableStateOf("30") }
    var notify by remember { mutableStateOf(true) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Create subscription") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedTextField(
                    tid,
                    { tid = it.filter { c -> c.isDigit() } },
                    label = { Text("Telegram ID") },
                    modifier = Modifier.fillMaxWidth(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                )
                OutlinedTextField(
                    server,
                    { server = it.lowercase().trim() },
                    label = { Text("Server (${serverIds.joinToString("/")})") },
                    modifier = Modifier.fillMaxWidth(),
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(
                        gb, { gb = it.filter { c -> c == '.' || c.isDigit() } },
                        label = { Text("Data GB") },
                        modifier = Modifier.weight(1f),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    )
                    OutlinedTextField(
                        days, { days = it.filter { c -> c.isDigit() } },
                        label = { Text("Days") },
                        modifier = Modifier.weight(1f),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    )
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Notify user on Telegram", color = Ink, modifier = Modifier.weight(1f))
                    Switch(checked = notify, onCheckedChange = { notify = it })
                }
            }
        },
        confirmButton = {
            AdminTextButton(
                text = "Create",
                onClick = {
                    val id = tid.toLongOrNull() ?: return@AdminTextButton
                    val data = gb.toDoubleOrNull() ?: return@AdminTextButton
                    val d = days.toIntOrNull() ?: return@AdminTextButton
                    if (id <= 0 || data <= 0 || d <= 0) return@AdminTextButton
                    onCreate(id, server.ifBlank { defaultServer }, data, d, notify)
                },
                contentColor = Navy,
            )
        },
        dismissButton = {
            AdminTextButton(text = "Cancel", onClick = onDismiss, contentColor = InkMuted)
        },
    )
}

private fun copyText(context: Context, text: String) {
    val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    cm.setPrimaryClip(ClipData.newPlainText("AirVPN", text))
}
