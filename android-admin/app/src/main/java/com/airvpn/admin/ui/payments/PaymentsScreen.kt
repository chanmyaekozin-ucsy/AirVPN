package com.airvpn.admin.ui.payments

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import coil.request.ImageRequest
import com.airvpn.admin.data.api.ApiFactory
import com.airvpn.admin.data.model.PaymentItem
import com.airvpn.admin.ui.components.AdminOutlinedButton
import com.airvpn.admin.ui.components.AdminPrimaryButton
import com.airvpn.admin.ui.components.AdminScreen
import com.airvpn.admin.ui.components.AdminTextButton
import com.airvpn.admin.ui.components.InfiniteListHandler
import com.airvpn.admin.ui.components.ListRowCard
import com.airvpn.admin.ui.components.LoadMoreFooter
import com.airvpn.admin.ui.components.StatusChip
import com.airvpn.admin.ui.components.StatusTone
import com.airvpn.admin.ui.theme.Cyan
import com.airvpn.admin.ui.theme.Danger
import com.airvpn.admin.ui.theme.Hairline
import com.airvpn.admin.ui.theme.Ink
import com.airvpn.admin.ui.theme.InkMuted
import com.airvpn.admin.ui.theme.Navy
import com.airvpn.admin.ui.theme.Success
import com.airvpn.admin.ui.theme.Warning
import java.text.NumberFormat
import java.util.Locale

@Composable
fun PaymentsScreen(
    payments: List<PaymentItem>,
    filter: String?,
    authToken: String?,
    loadingMore: Boolean = false,
    canLoadMore: Boolean = false,
    onFilter: (String?) -> Unit,
    onApprove: (Int) -> Unit,
    onReject: (Int, String) -> Unit,
    onLoadMore: () -> Unit = {},
    modifier: Modifier = Modifier,
) {
    var rejectId by remember { mutableStateOf<Int?>(null) }
    var reason by remember { mutableStateOf("") }
    var previewUrl by remember { mutableStateOf<String?>(null) }
    val fmt = NumberFormat.getIntegerInstance(Locale.US)
    val context = LocalContext.current
    val listState = rememberLazyListState()

    InfiniteListHandler(
        listState = listState,
        enabled = canLoadMore && !loadingMore,
        onLoadMore = onLoadMore,
    )

    AdminScreen(
        title = "Payments",
        eyebrow = "Finance",
        subtitle = "${payments.size} records in view",
        modifier = modifier.fillMaxSize(),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            listOf(
                null to "All",
                "pending" to "Pending",
                "approved" to "Approved",
                "rejected" to "Rejected",
            ).forEach { (value, label) ->
                FilterChip(
                    selected = filter == value,
                    onClick = { onFilter(value) },
                    label = { Text(label) },
                    shape = RoundedCornerShape(10.dp),
                    colors = FilterChipDefaults.filterChipColors(
                        selectedContainerColor = Cyan.copy(alpha = 0.18f),
                        selectedLabelColor = Navy,
                    ),
                )
            }
        }
        Spacer(Modifier.height(16.dp))
        LazyColumn(
            state = listState,
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            items(payments, key = { it.id }) { p ->
                ListRowCard {
                    Row(modifier = Modifier.fillMaxWidth()) {
                        Text(
                            "#${p.id}",
                            fontWeight = FontWeight.SemiBold,
                            color = Ink,
                            modifier = Modifier.weight(1f),
                        )
                        StatusChip(
                            text = p.status,
                            tone = when (p.status.lowercase()) {
                                "pending" -> StatusTone.Warning
                                "approved" -> StatusTone.Success
                                "rejected" -> StatusTone.Danger
                                else -> StatusTone.Neutral
                            },
                        )
                    }
                    Spacer(Modifier.height(8.dp))
                    Text(
                        "${p.firstName ?: "User"} · @${p.username ?: "—"} · ${p.telegramId}",
                        style = MaterialTheme.typography.bodyMedium,
                        color = InkMuted,
                    )
                    Spacer(Modifier.height(4.dp))
                    Text(
                        "${p.planTitle ?: "Plan"} · ${fmt.format(p.amountKs)} Ks · ${p.serverId.uppercase()}",
                        style = MaterialTheme.typography.bodyMedium,
                        color = InkMuted,
                    )
                    if (p.dataGb != null || p.durationDays != null) {
                        Spacer(Modifier.height(4.dp))
                        Text(
                            buildString {
                                p.dataGb?.let { append("%.0f GB".format(it)) }
                                if (p.dataGb != null && p.durationDays != null) append(" · ")
                                p.durationDays?.let { append("$it days") }
                            },
                            style = MaterialTheme.typography.bodyMedium,
                            color = InkMuted,
                        )
                    }

                    Spacer(Modifier.height(8.dp))
                    if (!p.receiptTxId.isNullOrBlank()) {
                        Text(
                            "Trx ID: ${p.receiptTxId}",
                            fontWeight = FontWeight.SemiBold,
                            color = Ink,
                            style = MaterialTheme.typography.bodyMedium,
                        )
                    } else {
                        Text(
                            "Trx ID: —",
                            style = MaterialTheme.typography.bodyMedium,
                            color = InkMuted,
                        )
                    }
                    if (!p.receiptNote.isNullOrBlank()) {
                        Spacer(Modifier.height(4.dp))
                        Text(
                            p.receiptNote,
                            style = MaterialTheme.typography.bodyMedium,
                            color = InkMuted,
                        )
                    }

                    if (p.hasReceipt && !p.receiptUrl.isNullOrBlank() && !authToken.isNullOrBlank()) {
                        Spacer(Modifier.height(10.dp))
                        val url = ApiFactory.absoluteUrl(p.receiptUrl)
                        val req = ImageRequest.Builder(context)
                            .data(url)
                            .addHeader("Authorization", ApiFactory.auth(authToken))
                            .crossfade(true)
                            .build()
                        AsyncImage(
                            model = req,
                            contentDescription = "Payment receipt",
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(160.dp)
                                .clip(RoundedCornerShape(10.dp))
                                .border(1.dp, Hairline, RoundedCornerShape(10.dp))
                                .background(Hairline),
                            contentScale = ContentScale.Crop,
                        )
                        Spacer(Modifier.height(6.dp))
                        AdminTextButton(
                            text = "View screenshot",
                            onClick = { previewUrl = url },
                        )
                    } else if (!p.hasReceipt) {
                        Spacer(Modifier.height(4.dp))
                        Text(
                            "No screenshot attached",
                            style = MaterialTheme.typography.labelSmall,
                            color = InkMuted,
                        )
                    }

                    if (p.status.equals("approved", ignoreCase = true) && p.subDataLeftGb != null) {
                        Spacer(Modifier.height(10.dp))
                        val days = p.subDaysLeft
                        val daysLabel = when {
                            days == null -> "days —"
                            days < 0 -> "expired"
                            days == 0 -> "expires today"
                            else -> "$days days left"
                        }
                        val gbLabel = "%.2f GB left".format(p.subDataLeftGb)
                        val usedLabel = if (p.subDataUsedGb != null && p.subDataLimitGb != null) {
                            " · used %.2f / %.2f GB".format(p.subDataUsedGb, p.subDataLimitGb)
                        } else {
                            ""
                        }
                        Text(
                            "$gbLabel · $daysLabel$usedLabel",
                            fontWeight = FontWeight.Medium,
                            color = when {
                                days != null && days < 0 -> Danger
                                days != null && days <= 3 -> Warning
                                (p.subDataLeftGb ?: 0.0) <= 1.0 -> Warning
                                else -> Success
                            },
                            style = MaterialTheme.typography.bodyMedium,
                        )
                        if (p.subIsActive == false) {
                            Spacer(Modifier.height(4.dp))
                            StatusChip("Key inactive", StatusTone.Neutral)
                        }
                    }

                    if (!p.createdAt.isNullOrBlank()) {
                        Spacer(Modifier.height(6.dp))
                        Text(p.createdAt, style = MaterialTheme.typography.labelSmall, color = InkMuted)
                    }
                    if (p.status == "pending") {
                        Spacer(Modifier.height(14.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            AdminPrimaryButton(
                                text = "Approve",
                                onClick = { onApprove(p.id) },
                                containerColor = Success,
                                compact = true,
                            )
                            AdminOutlinedButton(
                                text = "Reject",
                                onClick = { rejectId = p.id; reason = "" },
                                contentColor = Danger,
                                compact = true,
                            )
                        }
                    }
                    if (!p.rejectReason.isNullOrBlank()) {
                        Spacer(Modifier.height(6.dp))
                        Text(
                            "Reason: ${p.rejectReason}",
                            style = MaterialTheme.typography.bodyMedium,
                            color = Danger,
                        )
                    }
                }
            }
            item(key = "payments-footer") {
                LoadMoreFooter(visible = loadingMore)
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
                AdminTextButton(
                    text = "Reject",
                    onClick = {
                        onReject(id, reason)
                        rejectId = null
                    },
                    contentColor = Danger,
                )
            },
            dismissButton = {
                AdminTextButton(
                    text = "Cancel",
                    onClick = { rejectId = null },
                    contentColor = InkMuted,
                )
            },
        )
    }

    previewUrl?.let { url ->
        if (!authToken.isNullOrBlank()) {
            AlertDialog(
                onDismissRequest = { previewUrl = null },
                title = { Text("Receipt") },
                text = {
                    AsyncImage(
                        model = ImageRequest.Builder(context)
                            .data(url)
                            .addHeader("Authorization", ApiFactory.auth(authToken))
                            .build(),
                        contentDescription = "Receipt full",
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(360.dp),
                        contentScale = ContentScale.Fit,
                    )
                },
                confirmButton = {
                    AdminTextButton(
                        text = "Close",
                        onClick = { previewUrl = null },
                        contentColor = Navy,
                    )
                },
            )
        }
    }
}
