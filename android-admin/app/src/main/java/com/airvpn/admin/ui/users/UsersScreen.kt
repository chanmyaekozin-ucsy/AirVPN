package com.airvpn.admin.ui.users

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
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.airvpn.admin.data.model.UserItem
import com.airvpn.admin.ui.components.AdminScreen
import com.airvpn.admin.ui.components.ListRowCard
import com.airvpn.admin.ui.components.StatusChip
import com.airvpn.admin.ui.components.StatusTone
import com.airvpn.admin.ui.theme.Danger
import com.airvpn.admin.ui.theme.Ink
import com.airvpn.admin.ui.theme.InkMuted
import com.airvpn.admin.ui.theme.Navy
import com.airvpn.admin.ui.theme.Success

@Composable
fun UsersScreen(
    users: List<UserItem>,
    query: String,
    onQueryChange: (String) -> Unit,
    onSearch: () -> Unit,
    onBan: (Long, Boolean) -> Unit,
    modifier: Modifier = Modifier,
) {
    AdminScreen(
        title = "Users",
        eyebrow = "Directory",
        subtitle = "Search, ban, and review key counts",
        modifier = modifier.fillMaxSize(),
    ) {
        Row(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
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
            Button(
                onClick = onSearch,
                shape = RoundedCornerShape(12.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Navy),
            ) { Text("Go") }
        }
        Spacer(Modifier.height(12.dp))
        LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            items(users, key = { it.telegramId }) { u ->
                ListRowCard {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                "${u.firstName ?: "User"} · @${u.username ?: "—"}",
                                fontWeight = FontWeight.SemiBold,
                                color = Ink,
                            )
                            Text(
                                "${u.telegramId} · free ${u.freeKeys} · paid ${u.paidKeys}",
                                style = MaterialTheme.typography.bodyMedium,
                                color = InkMuted,
                            )
                            if (u.isBanned) {
                                Spacer(Modifier.height(6.dp))
                                StatusChip("Banned", StatusTone.Danger)
                            }
                        }
                        if (u.isBanned) {
                            OutlinedButton(
                                onClick = { onBan(u.telegramId, false) },
                                shape = RoundedCornerShape(10.dp),
                            ) { Text("Unban", color = Success) }
                        } else {
                            OutlinedButton(
                                onClick = { onBan(u.telegramId, true) },
                                shape = RoundedCornerShape(10.dp),
                            ) { Text("Ban", color = Danger) }
                        }
                    }
                }
            }
        }
    }
}
