package com.airvpn.admin.ui.dashboard

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.airvpn.admin.data.model.AdminStats
import com.airvpn.admin.ui.theme.InkMuted
import com.airvpn.admin.ui.theme.Navy
import java.text.NumberFormat
import java.util.Locale

@Composable
fun DashboardScreen(stats: AdminStats, modifier: Modifier = Modifier) {
    val fmt = NumberFormat.getIntegerInstance(Locale.US)
    Column(
        modifier = modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("Dashboard", style = MaterialTheme.typography.titleLarge, color = Navy)
        StatGrid(
            "Pending" to stats.pending.toString(),
            "Revenue" to "${fmt.format(stats.revenueKs)} Ks",
            "Users" to stats.users.toString(),
            "Active keys" to stats.activeKeys.toString(),
            "Paid / Free" to "${stats.paidKeys} / ${stats.freeKeys}",
            "Banned" to stats.banned.toString(),
            "DAU today" to stats.dauToday.toString(),
            "DAU 7d" to stats.dau7d.toString(),
            "Ad clicks today" to stats.adClicksToday.toString(),
            "Ad clicks total" to stats.adClicksTotal.toString(),
        )
        if (stats.keysByServer.isNotBlank()) {
            Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)) {
                Column(Modifier.padding(14.dp)) {
                    Text("Keys by server", fontWeight = FontWeight.SemiBold)
                    Spacer(Modifier.height(4.dp))
                    Text(stats.keysByServer, color = InkMuted)
                }
            }
        }
        Text(
            "Usage ${"%.1f".format(stats.usedGb)} / ${"%.1f".format(stats.limitGb)} GB",
            color = InkMuted,
        )
    }
}

@Composable
private fun StatGrid(vararg pairs: Pair<String, String>) {
    pairs.toList().chunked(2).forEach { row ->
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            row.forEach { (label, value) ->
                Card(
                    modifier = Modifier.weight(1f),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
                ) {
                    Column(Modifier.padding(14.dp)) {
                        Text(label, style = MaterialTheme.typography.bodyMedium, color = InkMuted)
                        Text(value, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                    }
                }
            }
            if (row.size == 1) Spacer(Modifier.weight(1f))
        }
    }
}
