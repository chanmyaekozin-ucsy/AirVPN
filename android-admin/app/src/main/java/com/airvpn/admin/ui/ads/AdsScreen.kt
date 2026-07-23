package com.airvpn.admin.ui.ads

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.airvpn.admin.data.api.ApiFactory
import com.airvpn.admin.data.model.AdItem
import com.airvpn.admin.ui.components.AdminDialog
import com.airvpn.admin.ui.components.AdminOutlinedButton
import com.airvpn.admin.ui.components.AdminPrimaryButton
import com.airvpn.admin.ui.components.AdminScreen
import com.airvpn.admin.ui.components.AdminTextButton
import com.airvpn.admin.ui.components.InfiniteListHandler
import com.airvpn.admin.ui.components.ListRowCard
import com.airvpn.admin.ui.components.LoadMoreFooter
import com.airvpn.admin.ui.components.SortChipRow
import com.airvpn.admin.ui.components.SortOption
import com.airvpn.admin.ui.components.StatusChip
import com.airvpn.admin.ui.components.StatusTone
import com.airvpn.admin.ui.components.adminFieldColors
import com.airvpn.admin.ui.theme.Cyan
import com.airvpn.admin.ui.theme.Danger
import com.airvpn.admin.ui.theme.Hairline
import com.airvpn.admin.ui.theme.Ink
import com.airvpn.admin.ui.theme.InkMuted
import com.airvpn.admin.ui.theme.Navy
import java.io.File

@Composable
fun AdsScreen(
    ads: List<AdItem>,
    loadingMore: Boolean = false,
    canLoadMore: Boolean = false,
    onSave: (
        id: String,
        placement: String,
        imageUrl: String,
        clickUrl: String,
        title: String,
        width: Int,
        height: Int,
        enabled: Boolean,
        sortOrder: Int,
    ) -> Unit,
    onToggle: (String, Boolean) -> Unit,
    onDelete: (String) -> Unit,
    onUpload: (File, (String) -> Unit) -> Unit,
    onLoadMore: () -> Unit = {},
    modifier: Modifier = Modifier,
) {
    var filter by remember { mutableStateOf<String?>(null) }
    var sortKey by remember { mutableStateOf("order") }
    var editing by remember { mutableStateOf<AdItem?>(null) }
    var creating by remember { mutableStateOf(false) }
    val shown = remember(ads, filter, sortKey) {
        val filtered = ads.filter { filter == null || it.placement == filter }
        when (sortKey) {
            "title" -> filtered.sortedBy { it.title.ifBlank { it.id }.lowercase() }
            "enabled" -> filtered.sortedByDescending { it.enabled }
            else -> filtered.sortedWith(compareBy({ it.sortOrder }, { it.id }))
        }
    }
    val listState = rememberLazyListState()

    InfiniteListHandler(
        listState = listState,
        enabled = canLoadMore && !loadingMore,
        onLoadMore = onLoadMore,
    )

    AdminScreen(
        title = "Ads Manager",
        eyebrow = "Growth",
        subtitle = "Banner and connect-dialog creatives",
        modifier = modifier.fillMaxSize(),
        actions = {
            AdminPrimaryButton(
                text = "Add ad",
                onClick = { creating = true },
                compact = true,
            )
        },
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            listOf(null to "All", "banner" to "Banner", "dialog" to "Dialog").forEach { (v, label) ->
                FilterChip(
                    selected = filter == v,
                    onClick = { filter = v },
                    label = { Text(label) },
                    shape = RoundedCornerShape(10.dp),
                    colors = FilterChipDefaults.filterChipColors(
                        selectedContainerColor = Cyan.copy(alpha = 0.18f),
                        selectedLabelColor = Navy,
                    ),
                )
            }
        }
        Spacer(Modifier.height(10.dp))
        SortChipRow(
            options = listOf(
                SortOption("order", "Sort order"),
                SortOption("title", "Title"),
                SortOption("enabled", "Enabled first"),
            ),
            selectedKey = sortKey,
            onSelect = { sortKey = it },
        )
        Spacer(Modifier.height(16.dp))
        LazyColumn(
            state = listState,
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            items(shown, key = { it.id }) { ad ->
                ListRowCard {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        AsyncImage(
                            model = ApiFactory.absoluteUrl(ad.imageUrl),
                            contentDescription = ad.title,
                            modifier = Modifier
                                .width(96.dp)
                                .height(56.dp)
                                .clip(RoundedCornerShape(10.dp))
                                .border(1.dp, Hairline, RoundedCornerShape(10.dp))
                                .background(Hairline),
                            contentScale = ContentScale.Crop,
                        )
                        Spacer(Modifier.width(12.dp))
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                "${ad.placement.uppercase()} · ${ad.id}",
                                fontWeight = FontWeight.SemiBold,
                                color = Ink,
                            )
                            Spacer(Modifier.height(4.dp))
                            Text(
                                ad.title.ifBlank { ad.clickUrl.ifBlank { "—" } },
                                style = MaterialTheme.typography.bodyMedium,
                                color = InkMuted,
                                maxLines = 1,
                            )
                            Spacer(Modifier.height(8.dp))
                            StatusChip(
                                if (ad.enabled) "Live" else "Off",
                                if (ad.enabled) StatusTone.Success else StatusTone.Neutral,
                            )
                        }
                        Switch(
                            checked = ad.enabled,
                            onCheckedChange = { onToggle(ad.id, it) },
                            colors = SwitchDefaults.colors(checkedTrackColor = Cyan),
                        )
                    }
                    Spacer(Modifier.height(12.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        AdminOutlinedButton(
                            text = "Edit",
                            onClick = { editing = ad },
                            compact = true,
                        )
                        AdminTextButton(
                            text = "Delete",
                            onClick = { onDelete(ad.id) },
                            contentColor = Danger,
                        )
                    }
                }
            }
            item(key = "ads-footer") {
                LoadMoreFooter(visible = loadingMore)
            }
        }
    }

    if (creating || editing != null) {
        AdDialog(
            initial = editing,
            onDismiss = { creating = false; editing = null },
            onUpload = onUpload,
            onSave = { id, placement, image, click, title, w, h, enabled, sort ->
                onSave(id, placement, image, click, title, w, h, enabled, sort)
                creating = false
                editing = null
            },
        )
    }
}

@Composable
private fun AdDialog(
    initial: AdItem?,
    onDismiss: () -> Unit,
    onUpload: (File, (String) -> Unit) -> Unit,
    onSave: (String, String, String, String, String, Int, Int, Boolean, Int) -> Unit,
) {
    val context = LocalContext.current
    var id by remember { mutableStateOf(initial?.id ?: "") }
    var placement by remember { mutableStateOf(initial?.placement ?: "banner") }
    var imageUrl by remember { mutableStateOf(initial?.imageUrl ?: "") }
    var clickUrl by remember { mutableStateOf(initial?.clickUrl ?: "") }
    var title by remember { mutableStateOf(initial?.title ?: "") }
    var width by remember { mutableStateOf(initial?.imageWidth?.takeIf { it > 0 }?.toString() ?: "") }
    var height by remember { mutableStateOf(initial?.imageHeight?.takeIf { it > 0 }?.toString() ?: "") }
    var enabled by remember { mutableStateOf(initial?.enabled ?: true) }
    var sort by remember { mutableStateOf(initial?.sortOrder?.toString() ?: "0") }

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri: Uri? ->
        if (uri == null) return@rememberLauncherForActivityResult
        val tmp = File(context.cacheDir, "ad-upload-${System.currentTimeMillis()}.bin")
        context.contentResolver.openInputStream(uri)?.use { input ->
            tmp.outputStream().use { output -> input.copyTo(output) }
        }
        onUpload(tmp) { url -> imageUrl = url }
    }

    AdminDialog(
        onDismissRequest = onDismiss,
        title = if (initial == null) "Add ad" else "Edit ad",
        eyebrow = "Ads",
        subtitle = "Banner or connect-dialog creative",
        confirmLabel = "Save",
        onConfirm = confirm@{
            if (id.isBlank() || imageUrl.isBlank()) return@confirm
            onSave(
                id.trim(),
                placement.trim().ifBlank { "banner" },
                imageUrl.trim(),
                clickUrl.trim(),
                title.trim(),
                width.toIntOrNull() ?: 0,
                height.toIntOrNull() ?: 0,
                enabled,
                sort.toIntOrNull() ?: 0,
            )
        },
    ) {
        OutlinedTextField(
            id, { id = it },
            label = { Text("Public id") },
            enabled = initial == null,
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(12.dp),
            colors = adminFieldColors(),
        )
        OutlinedTextField(
            placement, { placement = it },
            label = { Text("Placement (banner/dialog)") },
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(12.dp),
            colors = adminFieldColors(),
        )
        OutlinedTextField(
            imageUrl, { imageUrl = it },
            label = { Text("Image URL") },
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(12.dp),
            colors = adminFieldColors(),
        )
        AdminOutlinedButton(
            text = "Upload image",
            onClick = { picker.launch("image/*") },
            compact = true,
        )
        if (imageUrl.isNotBlank()) {
            AsyncImage(
                model = ApiFactory.absoluteUrl(imageUrl),
                contentDescription = null,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(100.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .border(1.dp, Hairline, RoundedCornerShape(12.dp))
                    .background(Hairline),
                contentScale = ContentScale.Fit,
            )
        }
        OutlinedTextField(
            clickUrl, { clickUrl = it },
            label = { Text("Click URL") },
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(12.dp),
            colors = adminFieldColors(),
        )
        OutlinedTextField(
            title, { title = it },
            label = { Text("Title") },
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(12.dp),
            colors = adminFieldColors(),
        )
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(
                width, { width = it },
                label = { Text("W") },
                modifier = Modifier.weight(1f),
                shape = RoundedCornerShape(12.dp),
                colors = adminFieldColors(),
            )
            OutlinedTextField(
                height, { height = it },
                label = { Text("H") },
                modifier = Modifier.weight(1f),
                shape = RoundedCornerShape(12.dp),
                colors = adminFieldColors(),
            )
            OutlinedTextField(
                sort, { sort = it },
                label = { Text("Sort") },
                modifier = Modifier.weight(1f),
                shape = RoundedCornerShape(12.dp),
                colors = adminFieldColors(),
            )
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Enabled", color = Ink)
            Spacer(Modifier.weight(1f))
            Switch(
                checked = enabled,
                onCheckedChange = { enabled = it },
                colors = SwitchDefaults.colors(checkedTrackColor = Cyan),
            )
        }
    }
}
