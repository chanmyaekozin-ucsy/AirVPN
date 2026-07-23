package com.airvpn.admin.ui.notify

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.airvpn.admin.data.model.AudienceCounts
import com.airvpn.admin.data.model.NotificationItem
import com.airvpn.admin.ui.components.AdminConfirmDialog
import com.airvpn.admin.ui.components.AdminPanel
import com.airvpn.admin.ui.components.AdminPrimaryButton
import com.airvpn.admin.ui.components.AdminScreen
import com.airvpn.admin.ui.components.ListRowCard
import com.airvpn.admin.ui.components.MetricTile
import com.airvpn.admin.ui.components.SectionLabel
import com.airvpn.admin.ui.components.StatusChip
import com.airvpn.admin.ui.components.StatusTone
import com.airvpn.admin.ui.components.adminFieldColors
import com.airvpn.admin.ui.theme.Cyan
import com.airvpn.admin.ui.theme.Ink
import com.airvpn.admin.ui.theme.InkMuted
import com.airvpn.admin.ui.theme.Navy
import com.airvpn.admin.ui.theme.Success
import com.airvpn.admin.ui.theme.Warning

@Composable
fun NotifyScreen(
    audience: String,
    message: String,
    sending: Boolean,
    counts: AudienceCounts,
    history: List<NotificationItem>,
    onAudienceChange: (String) -> Unit,
    onMessageChange: (String) -> Unit,
    onSend: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var confirmSend by remember { mutableStateOf(false) }
    val targetCount = when (audience) {
        "paid" -> counts.paid
        "active" -> counts.active
        else -> counts.all
    }
    val audienceLabel = when (audience) {
        "paid" -> "Paid users"
        "active" -> "Active subscribers"
        else -> "All users"
    }

    AdminScreen(
        title = "Notify",
        eyebrow = "Telegram",
        subtitle = "Broadcast a bot message to users",
        modifier = modifier.fillMaxSize(),
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                MetricTile("All", counts.all.toString(), Navy, Modifier.weight(1f))
                MetricTile("Paid", counts.paid.toString(), Success, Modifier.weight(1f))
                MetricTile("Active", counts.active.toString(), Cyan, Modifier.weight(1f))
            }

            AdminPanel {
                Text("Audience", fontWeight = FontWeight.SemiBold, color = Ink)
                Spacer(Modifier.height(10.dp))
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    listOf(
                        "all" to "All users",
                        "paid" to "Paid users",
                        "active" to "Active subs",
                    ).forEach { (value, label) ->
                        FilterChip(
                            selected = audience == value,
                            onClick = { onAudienceChange(value) },
                            label = { Text(label) },
                            shape = RoundedCornerShape(10.dp),
                            colors = FilterChipDefaults.filterChipColors(
                                selectedContainerColor = Cyan.copy(alpha = 0.18f),
                                selectedLabelColor = Navy,
                            ),
                        )
                    }
                }
                Spacer(Modifier.height(14.dp))
                OutlinedTextField(
                    value = message,
                    onValueChange = onMessageChange,
                    label = { Text("Message") },
                    placeholder = { Text("Maintenance window, promo, …") },
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = 120.dp),
                    shape = RoundedCornerShape(12.dp),
                    colors = adminFieldColors(),
                    minLines = 4,
                    enabled = !sending,
                )
                Spacer(Modifier.height(8.dp))
                Text(
                    "Will send to ~$targetCount Telegram chats ($audienceLabel).",
                    style = MaterialTheme.typography.bodyMedium,
                    color = InkMuted,
                )
                if (sending) {
                    Spacer(Modifier.height(12.dp))
                    LinearProgressIndicator(
                        modifier = Modifier.fillMaxWidth(),
                        color = Navy,
                        trackColor = Cyan.copy(alpha = 0.15f),
                    )
                    Spacer(Modifier.height(6.dp))
                    Text(
                        "Sending… this can take a minute for large audiences.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = Warning,
                    )
                }
                Spacer(Modifier.height(14.dp))
                AdminPrimaryButton(
                    text = if (sending) "Sending…" else "Send via bot",
                    onClick = { confirmSend = true },
                    enabled = !sending && message.isNotBlank() && targetCount > 0,
                    modifier = Modifier.fillMaxWidth(),
                )
            }

            SectionLabel("Recent broadcasts")
            if (history.isEmpty()) {
                Text("No broadcasts yet.", color = InkMuted)
            } else {
                history.forEach { n ->
                    ListRowCard {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                        ) {
                            Text(
                                "#${n.id} · ${n.audience.uppercase()}",
                                fontWeight = FontWeight.SemiBold,
                                color = Ink,
                            )
                            StatusChip(
                                "${n.sentCount} ok",
                                if (n.failedCount > 0) StatusTone.Warning else StatusTone.Success,
                            )
                        }
                        Spacer(Modifier.height(6.dp))
                        Text(
                            n.message.take(140) + if (n.message.length > 140) "…" else "",
                            style = MaterialTheme.typography.bodyMedium,
                            color = InkMuted,
                        )
                        Spacer(Modifier.height(6.dp))
                        Text(
                            buildString {
                                append(n.createdAt?.take(16) ?: "—")
                                if (n.failedCount > 0) append(" · ${n.failedCount} failed")
                            },
                            style = MaterialTheme.typography.labelSmall,
                            color = InkMuted,
                        )
                    }
                    Spacer(Modifier.height(10.dp))
                }
            }
            Spacer(Modifier.height(8.dp))
        }
    }

    if (confirmSend) {
        AdminConfirmDialog(
            onDismissRequest = { confirmSend = false },
            title = "Send broadcast?",
            message = "Telegram will message ~$targetCount users ($audienceLabel). This cannot be undone.",
            confirmLabel = "Send",
            onConfirm = onSend,
            eyebrow = "Notify",
            destructive = false,
        )
    }
}
