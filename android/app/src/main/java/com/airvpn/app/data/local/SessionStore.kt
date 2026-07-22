package com.airvpn.app.data.local

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.airvpn.app.data.model.SubscriptionInfo
import com.airvpn.app.data.model.VpnServerItem
import com.airvpn.app.util.VpnKeyImport
import org.json.JSONArray
import org.json.JSONObject

class SessionStore(context: Context) {
    private val prefs = EncryptedSharedPreferences.create(
        context,
        "airvpn_secure",
        MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    var restoreToken: String?
        get() = prefs.getString(KEY_TOKEN, null)
        set(value) {
            prefs.edit().putString(KEY_TOKEN, value).apply()
        }

    var selectedServerId: String?
        get() = prefs.getString(KEY_SERVER, null)
        set(value) {
            prefs.edit().putString(KEY_SERVER, value).apply()
        }

    var disclosureAccepted: Boolean
        get() = prefs.getBoolean(KEY_DISCLOSURE, false)
        set(value) {
            prefs.edit().putBoolean(KEY_DISCLOSURE, value).apply()
        }

    val lastConnectedServerId: String?
        get() = prefs.getString(KEY_LAST_ID, null)

    val lastConnectedServerName: String?
        get() = prefs.getString(KEY_LAST_NAME, null)

    val lastConnectedRegion: String?
        get() = prefs.getString(KEY_LAST_REGION, null)

    fun saveLastConnected(server: VpnServerItem) {
        prefs.edit()
            .putString(KEY_LAST_ID, server.id)
            .putString(KEY_LAST_NAME, server.name)
            .putString(KEY_LAST_REGION, server.region)
            .putString(KEY_SERVER, server.id)
            .apply()
    }

    fun getImportedServers(): List<VpnServerItem> {
        val raw = prefs.getString(KEY_IMPORTED, null) ?: return emptyList()
        return try {
            val arr = JSONArray(raw)
            buildList {
                for (i in 0 until arr.length()) {
                    add(VpnKeyImport.fromJson(arr.getJSONObject(i)))
                }
            }
        } catch (_: Exception) {
            emptyList()
        }
    }

    fun saveImportedServers(items: List<VpnServerItem>) {
        val arr = JSONArray()
        items.forEach { arr.put(VpnKeyImport.toJson(it)) }
        prefs.edit().putString(KEY_IMPORTED, arr.toString()).apply()
    }

    fun upsertImportedServer(item: VpnServerItem) {
        val list = getImportedServers().toMutableList()
        val idx = list.indexOfFirst { it.id == item.id || it.configUri == item.configUri }
        if (idx >= 0) list[idx] = item else list.add(0, item)
        saveImportedServers(list)
    }

    /** Patch region (country code) on imported servers by id. */
    fun patchImportedRegions(idToRegion: Map<String, String>) {
        if (idToRegion.isEmpty()) return
        val list = getImportedServers().map { item ->
            idToRegion[item.id]?.let { cc -> item.copy(region = cc) } ?: item
        }
        saveImportedServers(list)
    }

    fun deleteImportedServer(id: String) {
        val list = getImportedServers().filter { it.id != id }
        saveImportedServers(list)
        if (selectedServerId == id) {
            selectedServerId = list.firstOrNull()?.id
        }
    }

    fun replaceImportedWithSubscription(servers: List<VpnServerItem>) {
        // Keep manual single-key imports; replace subscription nodes
        val keepManual = getImportedServers().filter { !it.fromSubscription }
        saveImportedServers(servers + keepManual.filter { s ->
            servers.none { it.configUri == s.configUri }
        })
    }

    /**
     * Merge nodes for one subscription URL: replace only that URL's nodes,
     * keep other subscriptions + manual keys.
     */
    fun mergeSubscriptionNodes(url: String, servers: List<VpnServerItem>) {
        val clean = url.trim()
        val tagged = servers.map {
            it.copy(fromSubscription = true, subscriptionUrl = clean)
        }
        val existing = getImportedServers()
        val keepOther = existing.filter { item ->
            when {
                !item.fromSubscription -> true
                item.subscriptionUrl.isNullOrBlank() -> false // legacy single-sub nodes → drop on merge
                item.subscriptionUrl.equals(clean, ignoreCase = true) -> false
                else -> true
            }
        }
        val keepManualDeduped = keepOther.filter { s ->
            tagged.none { it.configUri == s.configUri }
        }
        saveImportedServers(tagged + keepManualDeduped)
    }

    var subscriptionUrl: String?
        get() = prefs.getString(KEY_SUB_URL, null)
            ?: getSubscriptions().firstOrNull()?.url
        set(value) {
            prefs.edit().putString(KEY_SUB_URL, value).apply()
        }

    fun getSubscriptionInfo(): SubscriptionInfo? =
        getSubscriptions().firstOrNull()

    fun getSubscriptions(): List<SubscriptionInfo> {
        val multi = prefs.getString(KEY_SUB_LIST, null)
        if (!multi.isNullOrBlank()) {
            return try {
                val arr = JSONArray(multi)
                buildList {
                    for (i in 0 until arr.length()) {
                        add(subscriptionFromJson(arr.getJSONObject(i)))
                    }
                }
            } catch (_: Exception) {
                emptyList()
            }
        }
        // Migrate legacy single-sub fields
        val legacy = prefs.getString(KEY_SUB_INFO, null) ?: return emptyList()
        return try {
            val info = subscriptionFromJson(JSONObject(legacy))
            if (info.url.isNotBlank()) {
                saveSubscriptions(listOf(info))
                listOf(info)
            } else {
                emptyList()
            }
        } catch (_: Exception) {
            emptyList()
        }
    }

    fun saveSubscriptions(list: List<SubscriptionInfo>) {
        val arr = JSONArray()
        list.forEach { arr.put(subscriptionToJson(it)) }
        val first = list.firstOrNull()
        val editor = prefs.edit()
            .putString(KEY_SUB_LIST, arr.toString())
        if (first != null) {
            editor
                .putString(KEY_SUB_INFO, subscriptionToJson(first).toString())
                .putString(KEY_SUB_URL, first.url)
        } else {
            editor.remove(KEY_SUB_INFO).remove(KEY_SUB_URL)
        }
        editor.apply()
    }

    fun upsertSubscriptionInfo(info: SubscriptionInfo) {
        val list = getSubscriptions().toMutableList()
        val idx = list.indexOfFirst { it.url.equals(info.url, ignoreCase = true) }
        if (idx >= 0) list[idx] = info else list.add(info)
        saveSubscriptions(list)
    }

    fun removeSubscription(url: String) {
        val clean = url.trim()
        saveSubscriptions(getSubscriptions().filterNot { it.url.equals(clean, ignoreCase = true) })
        val remaining = getImportedServers().filter { item ->
            when {
                !item.fromSubscription -> true
                item.subscriptionUrl.isNullOrBlank() -> false
                item.subscriptionUrl.equals(clean, ignoreCase = true) -> false
                else -> true
            }
        }
        saveImportedServers(remaining)
    }

    fun saveSubscriptionInfo(info: SubscriptionInfo) {
        upsertSubscriptionInfo(info)
    }

    fun clearSubscription() {
        prefs.edit()
            .remove(KEY_SUB_URL)
            .remove(KEY_SUB_INFO)
            .remove(KEY_SUB_LIST)
            .apply()
        // Drop subscription nodes only; keep manual imports
        saveImportedServers(getImportedServers().filter { !it.fromSubscription })
    }

    private fun subscriptionToJson(info: SubscriptionInfo): JSONObject =
        JSONObject()
            .put("url", info.url)
            .put("upload", info.uploadBytes)
            .put("download", info.downloadBytes)
            .put("total", info.totalBytes)
            .put("expire", info.expireAt)
            .put("nodes", info.nodeCount)
            .put("fetched", info.lastFetchedAt)

    private fun subscriptionFromJson(o: JSONObject): SubscriptionInfo =
        SubscriptionInfo(
            url = o.optString("url", ""),
            uploadBytes = o.optLong("upload", 0),
            downloadBytes = o.optLong("download", 0),
            totalBytes = o.optLong("total", 0),
            expireAt = o.optLong("expire", 0),
            nodeCount = o.optInt("nodes", 0),
            lastFetchedAt = o.optLong("fetched", 0),
        )

    fun isAnnouncementDismissed(id: String): Boolean =
        prefs.getStringSet(KEY_DISMISSED_ANN, emptySet())?.contains(id) == true

    fun dismissAnnouncement(id: String) {
        val set = prefs.getStringSet(KEY_DISMISSED_ANN, emptySet())?.toMutableSet() ?: mutableSetOf()
        set.add(id)
        prefs.edit().putStringSet(KEY_DISMISSED_ANN, set).apply()
    }

    var updatePromptDismissedCode: Int
        get() = prefs.getInt(KEY_UPDATE_SKIP, 0)
        set(value) {
            prefs.edit().putInt(KEY_UPDATE_SKIP, value).apply()
        }

    fun clearToken() {
        prefs.edit().remove(KEY_TOKEN).apply()
    }

    /** Stable anonymous install id for DAU / ad analytics. */
    val deviceId: String
        get() {
            val existing = prefs.getString(KEY_DEVICE_ID, null)
            if (!existing.isNullOrBlank()) return existing
            val id = java.util.UUID.randomUUID().toString()
            prefs.edit().putString(KEY_DEVICE_ID, id).apply()
            return id
        }

    companion object {
        private const val KEY_TOKEN = "restore_token"
        private const val KEY_SERVER = "selected_server"
        private const val KEY_DISCLOSURE = "vpn_disclosure_ok"
        private const val KEY_LAST_ID = "last_connected_id"
        private const val KEY_LAST_NAME = "last_connected_name"
        private const val KEY_LAST_REGION = "last_connected_region"
        private const val KEY_IMPORTED = "imported_vpn_keys"
        private const val KEY_SUB_URL = "subscription_url"
        private const val KEY_SUB_INFO = "subscription_info"
        private const val KEY_SUB_LIST = "subscription_list"
        private const val KEY_DISMISSED_ANN = "dismissed_announcements"
        private const val KEY_UPDATE_SKIP = "update_prompt_skip_code"
        private const val KEY_DEVICE_ID = "analytics_device_id"
    }
}
