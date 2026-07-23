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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
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
import com.airvpn.admin.ui.components.AdminConfirmDialog
import com.airvpn.admin.ui.components.AdminDialog
import com.airvpn.admin.ui.components.AdminOutlinedButton
import com.airvpn.admin.ui.components.AdminPrimaryButton
import com.airvpn.admin.ui.components.AdminScreen
import com.airvpn.admin.ui.components.AdminTextButton
import com.airvpn.admin.ui.components.InfiniteListHandler
import com.airvpn.admin.ui.components.ListRowCard
import com.airvpn.admin.ui.components.LoadMoreFooter
import com.airvpn.admin.ui.components.QuietDivider
import com.airvpn.admin.ui.components.SortChipRow
import com.airvpn.admin.ui.components.SortOption
import com.airvpn.admin.ui.components.StatusChip
import com.airvpn.admin.ui.components.StatusTone
import com.airvpn.admin.ui.components.adminFieldColors
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
    onSetQuota: (subId: Int, dataGb: Double?, daysLeft: Int?) -> Unit,
    onReplaceKey: (subId: Int, shareUri: String?) -> Unit,
    onRemoveKey: (subId: Int) -> Unit,
    onCreateKey: (telegramId: Long, serverId: String, dataGb: Double, days: Int, notify: Boolean) -> Unit,
    onClearCreatedFlash: () -> Unit,
    loadingMore: Boolean = false,
    canLoadMore: Boolean = false,
    onLoadMore: () -> Unit = {},
    modifier: Modifier = Modifier,
) {
    var showCreate by remember { mutableStateOf(false) }
    var sortKey by remember { mutableStateOf("newest") }
    val context = LocalContext.current
    val listState = rememberLazyListState()
    val sorted = remember(users, sortKey) {
        when (sortKey) {
            "oldest" -> users.sortedBy { it.telegramId }
            "paid" -> users.sortedByDescending { it.paidKeys }
            "free" -> users.sortedByDescending { it.freeKeys }
            "name" -> users.sortedBy { (it.firstName ?: it.username ?: "").lowercase() }
            else -> users.sortedByDescending { it.telegramId }
        }
    }

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
                colors = adminFieldColors(),
            )
            AdminPrimaryButton(
                text = "Go",
                onClick = onSearch,
                compact = true,
            )
        }
        Spacer(Modifier.height(10.dp))
        SortChipRow(
            options = listOf(
                SortOption("newest", "Newest"),
                SortOption("oldest", "Oldest"),
                SortOption("paid", "Paid keys"),
                SortOption("free", "Free keys"),
                SortOption("name", "Name"),
            ),
            selectedKey = sortKey,
            onSelect = { sortKey = it },
        )
        Spacer(Modifier.height(16.dp))
        LazyColumn(
            state = listState,
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            items(sorted, key = { it.telegramId }) { u ->
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
            onSetQuota = onSetQuota,
            onReplaceKey = onReplaceKey,
            onRemoveKey = onRemoveKey,
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
    onSetQuota: (Int, Double?, Int?) -> Unit,
    onReplaceKey: (Int, String?) -> Unit,
    onRemoveKey: (Int) -> Unit,
    onCopy: (String) -> Unit,
    onClearFlash: () -> Unit,
) {
    var daysText by remember { mutableStateOf("7") }
    var dataText by remember { mutableStateOf("5") }
    var setDaysText by remember { mutableStateOf("") }
    var setDataText by remember { mutableStateOf("") }
    var selectedSub by remember(subs) { mutableStateOf(subs.firstOrNull()?.id) }
    var replaceSubId by remember { mutableStateOf<Int?>(null) }
    var removeSubId by remember { mutableStateOf<Int?>(null) }

    AdminDialog(
        onDismissRequest = onDismiss,
        title = "Manage keys",
        eyebrow = "Subscriptions",
        subtitle = "Telegram · $telegramId",
        dismissLabel = "Close",
        showDismiss = true,
        confirmLabel = null,
        onConfirm = null,
        maxContentHeight = 560,
    ) {
        if (!lastKey.isNullOrBlank() || !lastSubUrl.isNullOrBlank()) {
            Text("Fresh links", fontWeight = FontWeight.SemiBold, color = Ink)
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
                        "%.2f / %.2f GB · %s".format(
                            s.dataUsedGb,
                            s.dataLimitGb,
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
                            onClick = {
                                selectedSub = s.id
                                setDataText = trimNum(s.dataLimitGb)
                                setDaysText = (s.daysLeft?.coerceAtLeast(0) ?: 0).toString()
                            },
                            compact = true,
                        )
                        if (!s.vlessKey.isNullOrBlank()) {
                            AdminTextButton("Copy key", onClick = { onCopy(s.vlessKey) })
                        }
                        if (!s.subscriptionUrl.isNullOrBlank()) {
                            AdminTextButton("Copy sub", onClick = { onCopy(s.subscriptionUrl) })
                        }
                    }
                    Spacer(Modifier.height(4.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        AdminOutlinedButton(
                            text = "Replace / paste",
                            onClick = { replaceSubId = s.id },
                            contentColor = Warning,
                            compact = true,
                        )
                        if (s.isActive || !s.vlessKey.isNullOrBlank()) {
                            AdminOutlinedButton(
                                text = "Remove key",
                                onClick = { removeSubId = s.id },
                                contentColor = Danger,
                                compact = true,
                            )
                        }
                    }
                }
            }

            QuietDivider()
            Text("Set exact quota (selected)", fontWeight = FontWeight.SemiBold, color = Ink)
            Text(
                "Type any GB / days — not limited to ± buttons",
                style = MaterialTheme.typography.labelSmall,
                color = InkMuted,
            )
            Spacer(Modifier.height(6.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = setDataText,
                    onValueChange = { setDataText = it.filter { c -> c == '.' || c.isDigit() } },
                    label = { Text("Data GB") },
                    placeholder = { Text("e.g. 42.5") },
                    modifier = Modifier.weight(1f),
                    singleLine = true,
                    shape = RoundedCornerShape(12.dp),
                    colors = adminFieldColors(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                )
                OutlinedTextField(
                    value = setDaysText,
                    onValueChange = { setDaysText = it.filter { c -> c.isDigit() } },
                    label = { Text("Days left") },
                    placeholder = { Text("e.g. 14") },
                    modifier = Modifier.weight(1f),
                    singleLine = true,
                    shape = RoundedCornerShape(12.dp),
                    colors = adminFieldColors(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                )
            }
            AdminPrimaryButton(
                text = "Apply exact values",
                onClick = {
                    val id = selectedSub ?: return@AdminPrimaryButton
                    val gb = setDataText.toDoubleOrNull()
                    val days = setDaysText.toIntOrNull()
                    if (gb == null && days == null) return@AdminPrimaryButton
                    onSetQuota(id, gb, days)
                },
                compact = true,
            )

            QuietDivider()
            Text("Quick ± adjust", fontWeight = FontWeight.SemiBold, color = Ink)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = daysText,
                    onValueChange = { daysText = it.filter { c -> c == '-' || c.isDigit() } },
                    label = { Text("Days ±") },
                    modifier = Modifier.weight(1f),
                    singleLine = true,
                    shape = RoundedCornerShape(12.dp),
                    colors = adminFieldColors(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                )
                OutlinedTextField(
                    value = dataText,
                    onValueChange = { dataText = it.filter { c -> c == '-' || c == '.' || c.isDigit() } },
                    label = { Text("GB ±") },
                    modifier = Modifier.weight(1f),
                    singleLine = true,
                    shape = RoundedCornerShape(12.dp),
                    colors = adminFieldColors(),
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

    replaceSubId?.let { subId ->
        ReplaceKeyDialog(
            subId = subId,
            onDismiss = { replaceSubId = null },
            onConfirm = { paste ->
                onReplaceKey(subId, paste)
                replaceSubId = null
            },
        )
    }

    removeSubId?.let { subId ->
        AdminConfirmDialog(
            onDismissRequest = { removeSubId = null },
            title = "Remove key from sub?",
            message = "Subscription #$subId will be deactivated and the share key removed from the user’s subscription link. Panel client is deleted when possible.",
            confirmLabel = "Remove",
            onConfirm = { onRemoveKey(subId) },
            eyebrow = "Danger zone",
            destructive = true,
        )
    }
}

@Composable
private fun ReplaceKeyDialog(
    subId: Int,
    onDismiss: () -> Unit,
    onConfirm: (shareUri: String?) -> Unit,
) {
    var paste by remember { mutableStateOf("") }

    AdminDialog(
        onDismissRequest = onDismiss,
        title = "Replace key",
        eyebrow = "Subscription #$subId",
        subtitle = "Paste a vless:// / ss:// from 3x-ui or elsewhere — or leave blank to auto-issue from panel (paid only)",
        confirmLabel = if (paste.isBlank()) "Auto new key" else "Save pasted key",
        onConfirm = {
            onConfirm(paste.trim().ifBlank { null })
        },
        dismissLabel = "Cancel",
        showDismiss = true,
    ) {
        OutlinedTextField(
            value = paste,
            onValueChange = { paste = it },
            label = { Text("Share key (optional)") },
            placeholder = { Text("vless://uuid@host:443?…") },
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(12.dp),
            colors = adminFieldColors(),
            minLines = 3,
        )
    }
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

    AdminDialog(
        onDismissRequest = onDismiss,
        title = "Create subscription",
        eyebrow = "Gift key",
        subtitle = "Manual plan for a Telegram user",
        confirmLabel = "Create",
        onConfirm = confirm@{
            val id = tid.toLongOrNull() ?: return@confirm
            val data = gb.toDoubleOrNull() ?: return@confirm
            val d = days.toIntOrNull() ?: return@confirm
            if (id <= 0 || data <= 0 || d <= 0) return@confirm
            onCreate(id, server.ifBlank { defaultServer }, data, d, notify)
        },
    ) {
        OutlinedTextField(
            tid,
            { tid = it.filter { c -> c.isDigit() } },
            label = { Text("Telegram ID") },
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(12.dp),
            colors = adminFieldColors(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
        )
        OutlinedTextField(
            server,
            { server = it.lowercase().trim() },
            label = { Text("Server (${serverIds.joinToString("/")})") },
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(12.dp),
            colors = adminFieldColors(),
        )
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(
                gb, { gb = it.filter { c -> c == '.' || c.isDigit() } },
                label = { Text("Data GB") },
                modifier = Modifier.weight(1f),
                shape = RoundedCornerShape(12.dp),
                colors = adminFieldColors(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
            )
            OutlinedTextField(
                days, { days = it.filter { c -> c.isDigit() } },
                label = { Text("Days") },
                modifier = Modifier.weight(1f),
                shape = RoundedCornerShape(12.dp),
                colors = adminFieldColors(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
            )
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Notify user on Telegram", color = Ink, modifier = Modifier.weight(1f))
            Switch(checked = notify, onCheckedChange = { notify = it })
        }
    }
}

private fun trimNum(v: Double): String =
    if (v == v.toLong().toDouble()) v.toLong().toString() else "%.3f".format(v).trimEnd('0').trimEnd('.')

private fun copyText(context: Context, text: String) {
    val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    cm.setPrimaryClip(ClipData.newPlainText("AirVPN", text))
}
