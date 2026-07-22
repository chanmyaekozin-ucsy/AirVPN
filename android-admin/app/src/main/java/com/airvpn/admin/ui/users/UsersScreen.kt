package com.airvpn.admin.ui.users

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
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.airvpn.admin.data.model.UserItem
import com.airvpn.admin.ui.theme.Danger
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
    Column(modifier = modifier.fillMaxSize().padding(16.dp)) {
        Text("Users", style = MaterialTheme.typography.titleLarge, color = Navy)
        Spacer(Modifier.height(8.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(
                value = query,
                onValueChange = onQueryChange,
                label = { Text("Search ID / username") },
                modifier = Modifier.weight(1f),
                singleLine = true,
            )
            Button(onClick = onSearch) { Text("Go") }
        }
        Spacer(Modifier.height(12.dp))
        LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            items(users, key = { it.telegramId }) { u ->
                Row(modifier = Modifier.fillMaxWidth()) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            "${u.firstName ?: "User"} @${u.username ?: "—"}",
                            fontWeight = FontWeight.SemiBold,
                        )
                        Text(
                            "${u.telegramId} · free ${u.freeKeys} · paid ${u.paidKeys}" +
                                if (u.isBanned) " · BANNED" else "",
                            color = InkMuted,
                        )
                    }
                    if (u.isBanned) {
                        OutlinedButton(onClick = { onBan(u.telegramId, false) }) {
                            Text("Unban", color = Success)
                        }
                    } else {
                        OutlinedButton(onClick = { onBan(u.telegramId, true) }) {
                            Text("Ban", color = Danger)
                        }
                    }
                }
            }
        }
    }
}
