package com.airvpn.admin.ui.dashboard

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.airvpn.admin.data.model.AdminStats
import com.airvpn.admin.ui.components.AdminPanel
import com.airvpn.admin.ui.components.AdminScreen
import com.airvpn.admin.ui.components.MetricTile
import com.airvpn.admin.ui.components.SectionLabel
import com.airvpn.admin.ui.theme.Cyan
import com.airvpn.admin.ui.theme.Danger
import com.airvpn.admin.ui.theme.Ink
import com.airvpn.admin.ui.theme.InkMuted
import com.airvpn.admin.ui.theme.Navy
import com.airvpn.admin.ui.theme.Success
import com.airvpn.admin.ui.theme.Warning
import java.text.NumberFormat
import java.util.Locale

@Composable
fun DashboardScreen(stats: AdminStats, modifier: Modifier = Modifier) {
    val fmt = NumberFormat.getIntegerInstance(Locale.US)
    val usageRatio = if (stats.limitGb > 0) {
        (stats.usedGb / stats.limitGb).toFloat().coerceIn(0f, 1f)
    } else {
        0f
    }

    AdminScreen(
        title = "Overview",
        eyebrow = "Operations",
        subtitle = "Live snapshot of revenue, keys, and app traffic",
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
                MetricTile(
                    label = "Pending",
                    value = stats.pending.toString(),
                    accent = Warning,
                    modifier = Modifier.weight(1f),
                )
                MetricTile(
                    label = "Revenue",
                    value = "${fmt.format(stats.revenueKs)}",
                    accent = Success,
                    modifier = Modifier.weight(1f),
                )
            }
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                MetricTile(
                    label = "Users",
                    value = stats.users.toString(),
                    accent = Navy,
                    modifier = Modifier.weight(1f),
                )
                MetricTile(
                    label = "Active keys",
                    value = stats.activeKeys.toString(),
                    accent = Cyan,
                    modifier = Modifier.weight(1f),
                )
            }

            SectionLabel("Subscriptions")
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                MetricTile("Paid", stats.paidKeys.toString(), Success, Modifier.weight(1f))
                MetricTile("Free", stats.freeKeys.toString(), Cyan, Modifier.weight(1f))
                MetricTile("Banned", stats.banned.toString(), Danger, Modifier.weight(1f))
            }

            SectionLabel("Mobile app")
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                MetricTile("DAU today", stats.dauToday.toString(), Cyan, Modifier.weight(1f))
                MetricTile("DAU 7d", stats.dau7d.toString(), Navy, Modifier.weight(1f))
            }
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                MetricTile("Ad clicks", stats.adClicksToday.toString(), Warning, Modifier.weight(1f))
                MetricTile("Clicks total", stats.adClicksTotal.toString(), InkMuted, Modifier.weight(1f))
            }

            if (stats.keysByServer.isNotBlank()) {
                AdminPanel {
                    Text("Keys by server", fontWeight = FontWeight.SemiBold, color = Ink)
                    Spacer(Modifier.height(6.dp))
                    Text(stats.keysByServer, style = MaterialTheme.typography.bodyMedium, color = InkMuted)
                }
            }

            AdminPanel {
                Text("Bandwidth pool", fontWeight = FontWeight.SemiBold, color = Ink)
                Spacer(Modifier.height(6.dp))
                Text(
                    "${"%.1f".format(stats.usedGb)} / ${"%.1f".format(stats.limitGb)} GB",
                    style = MaterialTheme.typography.bodyMedium,
                    color = InkMuted,
                )
                Spacer(Modifier.height(10.dp))
                LinearProgressIndicator(
                    progress = { usageRatio },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(8.dp)
                        .clip(RoundedCornerShape(99.dp)),
                    color = Cyan,
                    trackColor = Cyan.copy(alpha = 0.15f),
                )
            }
            Spacer(Modifier.height(8.dp))
        }
    }
}
