package com.airvpn.app

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.airvpn.app.data.api.ApiFactory
import com.airvpn.app.data.api.AnalyticsEventBody
import com.airvpn.app.data.api.ConnectBody
import com.airvpn.app.data.api.toModel
import com.airvpn.app.data.local.SessionStore
import com.airvpn.app.data.model.AdCreative
import com.airvpn.app.data.model.Announcement
import com.airvpn.app.data.model.AppConfig
import com.airvpn.app.data.model.ServerCatalog
import com.airvpn.app.data.model.SubscriptionInfo
import com.airvpn.app.data.model.UserProfile
import com.airvpn.app.data.model.VpnServerItem
import com.airvpn.app.util.AdImagePrefetcher
import com.airvpn.app.util.ConfigCrypto
import com.airvpn.app.util.GeoIpLookup
import com.airvpn.app.util.ServerPinger
import com.airvpn.app.util.SubscriptionFetcher
import com.airvpn.app.util.TelegramLinks
import com.airvpn.app.util.VpnKeyImport
import com.airvpn.app.vpn.AirVpnService
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import retrofit2.HttpException
import java.io.IOException

data class AirUiState(
    val token: String? = null,
    val catalog: ServerCatalog = ServerCatalog(),
    val selectedServer: VpnServerItem? = null,
    val profile: UserProfile? = null,
    val appConfig: AppConfig = AppConfig(),
    /** All imported subscription feeds (merged into the server list). */
    val subscriptions: List<SubscriptionInfo> = emptyList(),
    /** TCP latency ms by server id; null value = unreachable. Missing = not pinged yet. */
    val pings: Map<String, Int?> = emptyMap(),
    val pinging: Boolean = false,
    val loadingServers: Boolean = false,
    val importing: Boolean = false,
    val statusMessage: String = "Not connected",
    val importError: String? = null,
    val pendingAnnouncement: Announcement? = null,
    val updateAvailable: Boolean = false,
    val forceUpdate: Boolean = false,
    /** Server-side maintenance — blocks connect like force update. */
    val maintenanceMode: Boolean = false,
) {
    val subscription: SubscriptionInfo? get() = subscriptions.firstOrNull()

    /** Hide first-party ads for paid profile or live *imported* subs — not free catalog subs. */
    val showAds: Boolean
        get() {
            if (profile?.hasPaid == true) return false
            if (subscriptions.any { !it.isCatalogManaged && !it.isExpired }) return false
            return true
        }

    val bannerAds: List<AdCreative>
        get() = if (showAds) {
            appConfig.ads.filter { it.isBanner && it.imageUrl.isNotBlank() }
        } else {
            emptyList()
        }

    val dialogAds: List<AdCreative>
        get() = if (showAds) {
            appConfig.ads.filter { it.isDialog && it.imageUrl.isNotBlank() }
        } else {
            emptyList()
        }

    /** Random dialog creative for this connect attempt (null = no ad). */
    fun randomDialogAd(): AdCreative? = dialogAds.randomOrNull()
}

class AirVpnViewModel : ViewModel() {
    private val _ui = MutableStateFlow(AirUiState())
    val ui: StateFlow<AirUiState> = _ui.asStateFlow()

    private var session: SessionStore? = null
    private var appContext: Context? = null
    private var pingJob: Job? = null
    private var geoJob: Job? = null
    private var connectedPingJob: Job? = null
    private var lastServersTabRefreshMs: Long = 0L

    companion object {
        private const val SERVERS_TAB_REFRESH_MIN_MS = 15_000L
    }

    fun bootstrap(store: SessionStore, context: Context) {
        session = store
        appContext = context.applicationContext
        GeoIpLookup.init(context)
        _ui.update {
            it.copy(
                token = store.restoreToken,
                subscriptions = store.getSubscriptions(),
            )
        }
        viewModelScope.launch {
            runCatching { ApiFactory.api.appConfig().toModel() }
                .onSuccess { cfg ->
                    applyAppConfig(cfg)
                }
            trackAppOpen()
            refreshServers()
            val urls = store.getSubscriptions().map { it.url }.filter { it.isNotBlank() }
            if (urls.isNotEmpty()) {
                refreshAllSubscriptions(silent = true)
            }
            val token = store.restoreToken
            if (!token.isNullOrBlank()) {
                runCatching { ApiFactory.api.me("Bearer $token").profile.toModel() }
                    .onSuccess { p -> _ui.update { it.copy(profile = p) } }
            }
        }
    }

    fun trackAppOpen() {
        val store = session ?: return
        viewModelScope.launch {
            runCatching {
                ApiFactory.api.trackEvent(
                    AnalyticsEventBody(
                        event = "app_open",
                        deviceId = store.deviceId,
                    ),
                )
            }
        }
    }

    fun trackAdClick(ad: AdCreative) {
        val store = session ?: return
        viewModelScope.launch {
            runCatching {
                ApiFactory.api.trackEvent(
                    AnalyticsEventBody(
                        event = "ad_click",
                        deviceId = store.deviceId,
                        adId = ad.id,
                        placement = ad.placement,
                    ),
                )
            }
        }
    }

    private fun applyAppConfig(cfg: AppConfig) {
        val current = BuildConfig.VERSION_CODE
        val latest = cfg.latestVersionCode.coerceAtLeast(cfg.minVersionCode)
        val belowMin = current < cfg.minVersionCode
        val hasNewer = current < latest
        val force = belowMin || (cfg.forceUpdate && hasNewer)
        val skipped = session?.updatePromptDismissedCode == latest
        val showUpdate = !cfg.maintenance && hasNewer && (force || !skipped)
        val maintenance = cfg.maintenance

        val pending = cfg.announcements
            .firstOrNull { a -> session?.isAnnouncementDismissed(a.id) != true }

        _ui.update {
            it.copy(
                appConfig = cfg,
                updateAvailable = showUpdate,
                forceUpdate = force && !maintenance,
                maintenanceMode = maintenance,
                pendingAnnouncement = if (maintenance || (showUpdate && force)) null else pending,
            )
        }
        // Prefetch banner + dialog creatives so connect doesn't wait on download
        val ctx = appContext
        if (ctx != null && cfg.ads.isNotEmpty()) {
            viewModelScope.launch {
                AdImagePrefetcher.prefetch(ctx, cfg.ads)
            }
        }
    }

    fun refreshServers() {
        viewModelScope.launch {
            _ui.update { it.copy(loadingServers = true, importError = null) }
            val imported = session?.getImportedServers().orEmpty()
            runCatching { ApiFactory.api.servers().toModel() }
                .onSuccess { remote ->
                    val free = mergeFree(remote.free, imported)
                    applyCatalog(
                        ServerCatalog(
                            free = free,
                            paid = remote.paid,
                            freeSubscriptions = remote.freeSubscriptions,
                        ),
                    )
                }
                .onFailure { e ->
                    val msg = when {
                        e is HttpException && e.code() == 429 ->
                            "Too many refreshes — wait a minute"
                        imported.isNotEmpty() -> null
                        else -> "Could not load servers"
                    }
                    if (imported.isNotEmpty()) {
                        applyCatalog(
                            ServerCatalog(
                                free = imported,
                                paid = _ui.value.catalog.paid,
                                freeSubscriptions = _ui.value.catalog.freeSubscriptions,
                            ),
                        )
                        if (msg != null) {
                            _ui.update { it.copy(statusMessage = msg) }
                        }
                    } else {
                        _ui.update {
                            it.copy(
                                loadingServers = false,
                                statusMessage = msg ?: "Could not load servers",
                            )
                        }
                    }
                }
        }
    }

    private fun combinedSubscriptions(
        catalogSubs: List<SubscriptionInfo> = _ui.value.catalog.freeSubscriptions,
    ): List<SubscriptionInfo> {
        val imported = session?.getSubscriptions().orEmpty()
            .filter { !it.isCatalogManaged }
        return imported + catalogSubs
    }

    private fun applyCatalog(catalog: ServerCatalog) {
        val all = catalog.free
        val preferredId = session?.selectedServerId ?: session?.lastConnectedServerId
        val selected = pickServer(all, preferredId)
        if (selected != null) {
            session?.selectedServerId = selected.id
        }
        _ui.update {
            it.copy(
                catalog = catalog,
                selectedServer = selected,
                loadingServers = false,
                subscriptions = combinedSubscriptions(catalog.freeSubscriptions),
                statusMessage = when {
                    selected == null -> "Choose a server"
                    !selected.online -> "Server is down"
                    else -> it.statusMessage.ifBlank { "Not connected" }
                },
            )
        }
        // Ping free + paid (host known) for latency display
        pingServers(catalog.free + catalog.paid)
        resolveFlagsFromIp(catalog.free)
    }

    private fun mergeFree(
        remoteFree: List<VpnServerItem>,
        imported: List<VpnServerItem>,
    ): List<VpnServerItem> {
        val remoteIds = remoteFree.map { it.id }.toSet()
        val remoteUris = remoteFree.mapNotNull { it.configUri }.toSet()
        val extras = imported.filter { it.id !in remoteIds && it.configUri !in remoteUris }
        return extras + remoteFree
    }

    fun selectServer(item: VpnServerItem) {
        session?.selectedServerId = item.id
        _ui.update {
            it.copy(
                selectedServer = item,
                statusMessage = if (!item.online) "Server is down" else "Not connected",
            )
        }
        // Refresh ping for the newly selected node
        viewModelScope.launch {
            pingOne(item)
        }
    }

    /**
     * Import paste: vless://, ss://, or http(s) subscription URL.
     */
    fun importPaste(raw: String) {
        val t = raw.trim()
        when {
            t.startsWith("http://", true) || t.startsWith("https://", true) ->
                importSubscription(t, silent = false)
            else -> importVpnKey(t)
        }
    }

    fun importVpnKey(raw: String) {
        VpnKeyImport.parse(raw)
            .onSuccess { item ->
                val store = session ?: return@onSuccess
                store.upsertImportedServer(item)
                store.selectedServerId = item.id
                rebuildCatalogFromStore(selected = item, status = "Key imported")
            }
            .onFailure { e ->
                _ui.update { it.copy(importError = e.message ?: "Invalid VPN key") }
            }
    }

    fun deleteImportedServer(id: String) {
        val store = session ?: return
        store.deleteImportedServer(id)
        val nextId = store.selectedServerId
        rebuildCatalogFromStore(
            selectedId = nextId,
            status = "Server removed",
        )
    }

    private fun rebuildCatalogFromStore(
        selected: VpnServerItem? = null,
        selectedId: String? = null,
        status: String? = null,
    ) {
        val store = session ?: return
        val remoteOnly = _ui.value.catalog.free.filter { !it.isImported }
        val paid = _ui.value.catalog.paid
        val catalogSubs = _ui.value.catalog.freeSubscriptions
        val merged = mergeFree(remoteOnly, store.getImportedServers())
        val pick = selected
            ?: selectedId?.let { id -> merged.firstOrNull { it.id == id } }
            ?: pickServer(merged, store.selectedServerId)
        if (pick != null) store.selectedServerId = pick.id
        _ui.update {
            it.copy(
                catalog = ServerCatalog(
                    free = merged,
                    paid = paid,
                    freeSubscriptions = catalogSubs,
                ),
                selectedServer = pick,
                importError = null,
                statusMessage = status ?: it.statusMessage,
                subscriptions = combinedSubscriptions(catalogSubs),
            )
        }
        pingServers(merged + paid)
        resolveFlagsFromIp(merged)
    }

    fun importSubscription(url: String, silent: Boolean) {
        viewModelScope.launch {
            _ui.update {
                it.copy(
                    importing = true,
                    importError = null,
                    statusMessage = if (silent) it.statusMessage else "Fetching subscription…",
                )
            }
            SubscriptionFetcher.fetch(url)
                .onSuccess { result ->
                    val store = session ?: return@onSuccess
                    store.upsertSubscriptionInfo(result.info)
                    store.mergeSubscriptionNodes(result.info.url, result.servers)
                    if (store.selectedServerId == null) {
                        store.selectedServerId = result.servers.firstOrNull()?.id
                    }
                    val remoteOnly = _ui.value.catalog.free.filter { !it.isImported }
                    val paid = _ui.value.catalog.paid
                    val catalogSubs = _ui.value.catalog.freeSubscriptions
                    val merged = mergeFree(remoteOnly, store.getImportedServers())
                    val selected = pickServer(merged, store.selectedServerId)
                    val subCount = combinedSubscriptions(catalogSubs).size
                    _ui.update {
                        it.copy(
                            catalog = ServerCatalog(
                                free = merged,
                                paid = paid,
                                freeSubscriptions = catalogSubs,
                            ),
                            selectedServer = selected,
                            subscriptions = combinedSubscriptions(catalogSubs),
                            importing = false,
                            importError = null,
                            statusMessage = if (silent) {
                                it.statusMessage
                            } else {
                                "Merged: ${result.servers.size} nodes · $subCount sub(s)"
                            },
                        )
                    }
                    pingServers(merged + paid)
                    resolveFlagsFromIp(merged)
                }
                .onFailure { e ->
                    _ui.update {
                        it.copy(
                            importing = false,
                            importError = e.message ?: "Subscription failed",
                            statusMessage = if (silent) it.statusMessage else "Subscription failed",
                        )
                    }
                }
        }
    }

    fun refreshSubscription() {
        refreshAllSubscriptions(silent = false)
    }

    /**
     * Called when the Servers tab becomes visible.
     * Silently refreshes imported + catalog subscription usage/nodes (throttled).
     */
    fun onServersTabOpened() {
        val now = System.currentTimeMillis()
        if (now - lastServersTabRefreshMs < SERVERS_TAB_REFRESH_MIN_MS) return
        lastServersTabRefreshMs = now
        refreshAllSubscriptions(silent = true)
    }

    fun refreshAllSubscriptions(silent: Boolean) {
        val urls = session?.getSubscriptions()
            ?.map { it.url }
            ?.filter { it.isNotBlank() && !it.startsWith("catalog://", ignoreCase = true) }
            .orEmpty()
        val hasCatalogSubs = _ui.value.catalog.freeSubscriptions.isNotEmpty()
        if (urls.isEmpty() && !hasCatalogSubs) {
            refreshServers()
            return
        }
        viewModelScope.launch {
            _ui.update {
                it.copy(
                    importing = true,
                    importError = null,
                    statusMessage = if (silent) it.statusMessage else "Refreshing subscriptions…",
                )
            }
            // Refresh free catalog sub usage/expiry from API
            val remoteCatalog = runCatching { ApiFactory.api.servers().toModel() }.getOrNull()
            var added = 0
            var failed = 0
            for (url in urls) {
                SubscriptionFetcher.fetch(url)
                    .onSuccess { result ->
                        val store = session ?: return@onSuccess
                        store.upsertSubscriptionInfo(result.info)
                        store.mergeSubscriptionNodes(result.info.url, result.servers)
                        added += result.servers.size
                    }
                    .onFailure { failed++ }
            }
            val store = session ?: return@launch
            val remoteFree = remoteCatalog?.free ?: _ui.value.catalog.free.filter { !it.isImported }
            val paid = remoteCatalog?.paid ?: _ui.value.catalog.paid
            val catalogSubs = remoteCatalog?.freeSubscriptions
                ?: _ui.value.catalog.freeSubscriptions
            val merged = mergeFree(remoteFree, store.getImportedServers())
            val selected = pickServer(merged, store.selectedServerId)
            _ui.update {
                it.copy(
                    catalog = ServerCatalog(
                        free = merged,
                        paid = paid,
                        freeSubscriptions = catalogSubs,
                    ),
                    selectedServer = selected,
                    subscriptions = combinedSubscriptions(catalogSubs),
                    importing = false,
                    importError = if (failed > 0 && added == 0 && urls.isNotEmpty()) {
                        "Subscription refresh failed"
                    } else {
                        null
                    },
                    statusMessage = if (silent) {
                        it.statusMessage
                    } else if (failed > 0) {
                        "Refreshed with $failed error(s)"
                    } else {
                        "Subscriptions refreshed · $added nodes"
                    },
                )
            }
            pingServers(merged + paid)
            resolveFlagsFromIp(merged)
        }
    }

    fun clearSubscription() {
        session?.clearSubscription()
        _ui.update {
            it.copy(subscriptions = combinedSubscriptions())
        }
        refreshServers()
    }

    fun removeSubscription(url: String) {
        if (url.startsWith("catalog://", ignoreCase = true)) return
        session?.removeSubscription(url)
        val store = session ?: return
        rebuildCatalogFromStore(status = "Subscription removed")
        _ui.update { it.copy(subscriptions = combinedSubscriptions()) }
    }

    fun dismissAnnouncement() {
        val a = _ui.value.pendingAnnouncement ?: return
        if (a.dismissible) {
            session?.dismissAnnouncement(a.id)
        }
        val next = _ui.value.appConfig.announcements
            .firstOrNull { x -> x.id != a.id && session?.isAnnouncementDismissed(x.id) != true }
        _ui.update { it.copy(pendingAnnouncement = next) }
    }

    fun skipUpdate() {
        if (_ui.value.forceUpdate || _ui.value.maintenanceMode) return
        val code = _ui.value.appConfig.latestVersionCode
        session?.updatePromptDismissedCode = code
        _ui.update {
            it.copy(
                updateAvailable = false,
                pendingAnnouncement = it.appConfig.announcements
                    .firstOrNull { a -> session?.isAnnouncementDismissed(a.id) != true },
            )
        }
    }

    /** Open update download (Telegram preferred) / Play listing. */
    fun openUpdatePage(context: Context) {
        val cfg = _ui.value.appConfig
        val url = cfg.updateUrl.ifBlank { cfg.playUrl.ifBlank { cfg.telegramUrl } }
        openUrl(context, url)
    }

    fun clearSession() {
        session?.clearToken()
        _ui.update { it.copy(token = null, profile = null, statusMessage = "Signed out of restore") }
    }

    fun openUrl(context: Context, url: String) {
        if (url.isBlank()) return
        val target = TelegramLinks.toOpenUri(url)
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(target))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
            context.startActivity(intent)
        } catch (_: ActivityNotFoundException) {
            val fallback = TelegramLinks.toHttpsFallback(url)
                ?: TelegramLinks.toHttpsFallback(target)
            if (!fallback.isNullOrBlank()) {
                context.startActivity(
                    Intent(Intent.ACTION_VIEW, Uri.parse(fallback))
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                )
            }
        }
    }

    fun disconnect(context: Context) {
        stopConnectedPing()
        val i = Intent(context, AirVpnService::class.java).apply {
            action = AirVpnService.ACTION_DISCONNECT
        }
        context.startService(i)
        _ui.update { it.copy(statusMessage = "Not connected") }
    }

    fun connectSelected(context: Context) {
        val server = _ui.value.selectedServer
        if (server == null) {
            _ui.update { it.copy(statusMessage = "Select a server first") }
            return
        }
        if (!server.online) {
            _ui.update { it.copy(statusMessage = "Server is down") }
            return
        }
        val expired = _ui.value.subscriptions.any {
            it.isExpired && it.url == server.subscriptionUrl
        } || run {
            // Legacy single-imported-sub case (not free catalog)
            val imported = _ui.value.subscriptions.filter { !it.isCatalogManaged }
            server.fromSubscription &&
                !server.subscriptionUrl.orEmpty().startsWith("catalog://", ignoreCase = true) &&
                imported.size == 1 &&
                imported.first().isExpired
        }
        if (expired) {
            _ui.update { it.copy(statusMessage = "Subscription expired") }
            return
        }
        val poolEmpty = _ui.value.subscriptions.any {
            it.isCatalogManaged && it.isExhausted && it.url == server.subscriptionUrl
        }
        if (poolEmpty) {
            _ui.update { it.copy(statusMessage = "Free data finished") }
            return
        }
        if (server.protocol.equals("ssh", true)) {
            _ui.update { it.copy(statusMessage = "${server.tag} coming soon") }
            return
        }

        val localUri = server.configUri
        if (!localUri.isNullOrBlank()) {
            startVpn(context, localUri, server)
            return
        }

        viewModelScope.launch {
            _ui.update { it.copy(statusMessage = "Connecting…") }
            val token = _ui.value.token
            val auth = token?.let { "Bearer $it" }
            val deviceId = session?.deviceId.orEmpty()
            AirVpnService.clearError()
            runCatching {
                ApiFactory.api.connect(
                    auth,
                    ConnectBody(serverId = server.id, deviceId = deviceId),
                ).toModel()
            }.onSuccess { resp ->
                val uri = ConfigCrypto.decrypt(resp.payload)
                if (uri.isNullOrBlank()) {
                    _ui.update {
                        it.copy(statusMessage = "Could not decrypt config")
                    }
                    return@onSuccess
                }
                startVpn(context, uri, server)
            }.onFailure { e ->
                _ui.update { it.copy(statusMessage = connectErrorMessage(e)) }
            }
        }
    }

    private fun startVpn(context: Context, configUri: String, server: VpnServerItem) {
        _ui.update { it.copy(statusMessage = "Connecting…") }
        AirVpnService.clearError()
        val i = Intent(context, AirVpnService::class.java).apply {
            action = AirVpnService.ACTION_CONNECT
            putExtra(AirVpnService.EXTRA_CONFIG_URI, configUri)
            putExtra(AirVpnService.EXTRA_SERVER_NAME, server.name)
        }
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(i)
            } else {
                context.startService(i)
            }
            session?.saveLastConnected(server)
            _ui.update { it.copy(statusMessage = "Connected") }
            startConnectedPing(server)
        } catch (e: Exception) {
            _ui.update {
                it.copy(statusMessage = "Could not start VPN: ${e.message ?: "error"}")
            }
        }
    }

    /** Called when VPN state becomes Connected (e.g. from service observer). */
    fun onVpnConnected() {
        val server = _ui.value.selectedServer ?: return
        startConnectedPing(server)
    }

    fun onVpnDisconnected() {
        stopConnectedPing()
    }

    private fun startConnectedPing(server: VpnServerItem) {
        stopConnectedPing()
        connectedPingJob = viewModelScope.launch {
            while (isActive) {
                pingOne(server)
                delay(5_000)
            }
        }
    }

    private fun stopConnectedPing() {
        connectedPingJob?.cancel()
        connectedPingJob = null
    }

    fun pingServers(servers: List<VpnServerItem> = _ui.value.catalog.free) {
        pingJob?.cancel()
        pingJob = viewModelScope.launch {
            _ui.update { it.copy(pinging = true) }
            runCatching {
                val targets = servers.mapNotNull { s ->
                    val host = s.host?.takeIf { it.isNotBlank() }
                        ?: VpnKeyImport.hostFromUri(s.configUri)
                        ?: return@mapNotNull null
                    val port = when {
                        s.port > 0 -> s.port
                        else -> VpnKeyImport.portFromUri(s.configUri)
                    }
                    s.id to (host to port)
                }
                ServerPinger.pingAll(targets)
            }.onSuccess { results ->
                _ui.update {
                    it.copy(
                        pings = it.pings + results,
                        pinging = false,
                    )
                }
            }.onFailure {
                _ui.update { it.copy(pinging = false) }
            }
        }
    }

    /**
     * For subscription (and imported) nodes: resolve host → public IP → country code,
     * then set [VpnServerItem.region] so flags match the real IP location.
     */
    fun resolveFlagsFromIp(servers: List<VpnServerItem> = _ui.value.catalog.free) {
        val ctx = appContext ?: return
        val targets = servers.filter { it.fromSubscription || it.isImported }
        if (targets.isEmpty()) return
        geoJob?.cancel()
        geoJob = viewModelScope.launch {
            val hostById = targets.mapNotNull { s ->
                val host = s.host?.takeIf { it.isNotBlank() }
                    ?: VpnKeyImport.hostFromUri(s.configUri)
                    ?: return@mapNotNull null
                s.id to host
            }
            if (hostById.isEmpty()) return@launch
            val hosts = hostById.map { it.second }.distinct()
            val hostToCc = GeoIpLookup.countryCodesForHosts(ctx, hosts)
            if (hostToCc.isEmpty()) return@launch

            val idToCc = hostById.mapNotNull { (id, host) ->
                hostToCc[host]?.let { id to it }
            }.toMap()
            if (idToCc.isEmpty()) return@launch

            session?.patchImportedRegions(idToCc)

            _ui.update { state ->
                val updatedFree = state.catalog.free.map { s ->
                    idToCc[s.id]?.let { s.copy(region = it) } ?: s
                }
                val selected = state.selectedServer?.let { sel ->
                    idToCc[sel.id]?.let { sel.copy(region = it) } ?: sel
                }
                state.copy(
                    catalog = state.catalog.copy(free = updatedFree),
                    selectedServer = selected,
                )
            }
        }
    }

    private suspend fun pingOne(server: VpnServerItem) {
        val host = server.host?.takeIf { it.isNotBlank() }
            ?: VpnKeyImport.hostFromUri(server.configUri)
            ?: return
        val port = when {
            server.port > 0 -> server.port
            else -> VpnKeyImport.portFromUri(server.configUri)
        }
        val ms = ServerPinger.ping(host, port)
        _ui.update { it.copy(pings = it.pings + (server.id to ms)) }
    }

    private fun pickServer(all: List<VpnServerItem>, preferredId: String?): VpnServerItem? {
        if (all.isEmpty()) return null
        preferredId?.let { id ->
            all.firstOrNull { it.id == id }?.let { return it }
        }
        return all.firstOrNull { it.online } ?: all.firstOrNull()
    }

    private fun connectErrorMessage(e: Throwable): String {
        return when (e) {
            is HttpException -> when (e.code()) {
                400 -> "Update the app and try again"
                401 -> "Import restore code for paid servers"
                403 -> {
                    val body = runCatching { e.response()?.errorBody()?.string().orEmpty() }
                        .getOrDefault("")
                    when {
                        body.contains("finished", ignoreCase = true) ||
                            body.contains("pool", ignoreCase = true) ->
                            "Free data finished"
                        body.contains("expired", ignoreCase = true) ->
                            "Free giveaway expired"
                        else -> "Buy this plan in Telegram"
                    }
                }
                404 -> "Server not found"
                429 -> "Too many attempts — wait a minute"
                501 -> "Protocol not ready yet"
                503 -> {
                    val body = runCatching { e.response()?.errorBody()?.string().orEmpty() }
                        .getOrDefault("")
                    when {
                        body.contains("down", ignoreCase = true) -> "Server is down"
                        else -> "Server unavailable"
                    }
                }
                else -> "Connect failed (HTTP ${e.code()})"
            }
            is IOException -> "Cannot reach API — check Wi‑Fi / API URL"
            else -> e.message?.takeIf { it.isNotBlank() } ?: "Connect failed"
        }
    }
}
