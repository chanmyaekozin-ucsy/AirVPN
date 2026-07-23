package com.airvpn.admin

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.airvpn.admin.data.api.AccountBody
import com.airvpn.admin.data.api.AdBody
import com.airvpn.admin.data.api.AdPatchBody
import com.airvpn.admin.data.api.ApiFactory
import com.airvpn.admin.data.api.AppConfigBody
import com.airvpn.admin.data.api.BanBody
import com.airvpn.admin.data.api.BroadcastBody
import com.airvpn.admin.data.api.CatalogBody
import com.airvpn.admin.data.api.CatalogIssueKeyBody
import com.airvpn.admin.data.api.DeviceExclusiveBody
import com.airvpn.admin.data.api.LoginBody
import com.airvpn.admin.data.api.ManualSubBody
import com.airvpn.admin.data.api.PlanBody
import com.airvpn.admin.data.api.RejectBody
import com.airvpn.admin.data.api.ReplaceKeyBody
import com.airvpn.admin.data.api.SubAdjustBody
import com.airvpn.admin.data.api.VpnNodeBody
import com.airvpn.admin.data.local.SessionStore
import com.airvpn.admin.data.model.AdItem
import com.airvpn.admin.data.model.AdminStats
import com.airvpn.admin.data.model.AppConfigSettings
import com.airvpn.admin.data.model.AudienceCounts
import com.airvpn.admin.data.model.CatalogServer
import com.airvpn.admin.data.model.DauDevice
import com.airvpn.admin.data.model.DeviceExclusiveKey
import com.airvpn.admin.data.model.NotificationItem
import com.airvpn.admin.data.model.PaymentAccount
import com.airvpn.admin.data.model.PaymentItem
import com.airvpn.admin.data.model.PlanItem
import com.airvpn.admin.data.model.SubscriptionItem
import com.airvpn.admin.data.model.UserItem
import com.airvpn.admin.data.model.VpnServerInfo
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import retrofit2.HttpException
import java.io.File

data class AdminUiState(
    val booting: Boolean = true,
    val loggedIn: Boolean = false,
    val telegramId: Long = 0,
    val authToken: String? = null,
    val loading: Boolean = false,
    val message: String? = null,
    val error: String? = null,
    val pendingLoginTid: Long? = null,
    val pendingLoginCode: String? = null,
    val stats: AdminStats = AdminStats(),
    val payments: List<PaymentItem> = emptyList(),
    val paymentFilter: String? = "pending",
    val paymentsPage: Int = 0,
    val paymentsTotalPages: Int = 1,
    val paymentsLoadingMore: Boolean = false,
    val accounts: List<PaymentAccount> = emptyList(),
    val servers: List<VpnServerInfo> = emptyList(),
    val plans: List<PlanItem> = emptyList(),
    val users: List<UserItem> = emptyList(),
    val userQuery: String = "",
    val usersPage: Int = 0,
    val usersTotalPages: Int = 1,
    val usersLoadingMore: Boolean = false,
    val catalog: List<CatalogServer> = emptyList(),
    val catalogPage: Int = 0,
    val catalogTotalPages: Int = 1,
    val catalogLoadingMore: Boolean = false,
    val ads: List<AdItem> = emptyList(),
    val adsPage: Int = 0,
    val adsTotalPages: Int = 1,
    val adsLoadingMore: Boolean = false,
    val appConfig: AppConfigSettings? = null,
    val appConfigSaving: Boolean = false,
    val deviceKeys: List<DeviceExclusiveKey> = emptyList(),
    val dauDevices: List<DauDevice> = emptyList(),
    val dauDay: String = "",
    val dauCount: Int = 0,
    val notifyAudience: String = "all",
    val notifyMessage: String = "",
    val notifySending: Boolean = false,
    val audienceCounts: AudienceCounts = AudienceCounts(),
    val notifications: List<NotificationItem> = emptyList(),
    val refreshing: Boolean = false,
    val managedTelegramId: Long? = null,
    val managedSubs: List<SubscriptionItem> = emptyList(),
    val lastCreatedKey: String? = null,
    val lastCreatedSubUrl: String? = null,
    val issuedCatalogKey: String? = null,
    val issuingCatalogKey: Boolean = false,
) {
    val paymentsCanLoadMore: Boolean
        get() = paymentsPage > 0 && paymentsPage < paymentsTotalPages && !paymentsLoadingMore
    val usersCanLoadMore: Boolean
        get() = usersPage > 0 && usersPage < usersTotalPages && !usersLoadingMore
    val catalogCanLoadMore: Boolean
        get() = catalogPage > 0 && catalogPage < catalogTotalPages && !catalogLoadingMore
    val adsCanLoadMore: Boolean
        get() = adsPage > 0 && adsPage < adsTotalPages && !adsLoadingMore
}

class AdminViewModel(app: Application) : AndroidViewModel(app) {
    private val store = SessionStore(app)
    private val api = ApiFactory.api

    private val _state = MutableStateFlow(AdminUiState())
    val state: StateFlow<AdminUiState> = _state.asStateFlow()

    companion object {
        const val PAGE_SIZE = 20
    }

    init {
        viewModelScope.launch {
            val token = store.adminToken
            if (token.isNullOrBlank()) {
                _state.update { it.copy(booting = false, loggedIn = false) }
                return@launch
            }
            try {
                val me = api.me(ApiFactory.auth(token))
                store.telegramId = me.telegramId
                _state.update {
                    it.copy(
                        booting = false,
                        loggedIn = true,
                        telegramId = me.telegramId,
                        authToken = token,
                    )
                }
                refreshAll()
            } catch (_: Exception) {
                store.clear()
                _state.update { it.copy(booting = false, loggedIn = false) }
            }
        }
    }

    private fun auth(): String {
        val token = store.adminToken ?: throw IllegalStateException("Not logged in")
        return ApiFactory.auth(token)
    }

    private fun errMsg(e: Throwable): String {
        if (e is HttpException) {
            val body = e.response()?.errorBody()?.string().orEmpty()
            if (body.contains("detail")) {
                val m = Regex("\"detail\"\\s*:\\s*\"([^\"]+)\"").find(body)
                if (m != null) return m.groupValues[1]
            }
            return "HTTP ${e.code()}"
        }
        return e.message ?: "Request failed"
    }

    fun clearFlash() {
        _state.update { it.copy(message = null, error = null) }
    }

    /** Deep link / intent: queue credentials for auto-login after boot. */
    fun applyLoginDeepLink(telegramId: Long, code: String) {
        if (telegramId <= 0L || code.isBlank()) return
        val clean = code.filter { it.isDigit() }
        if (clean.length < 4) return
        if (_state.value.loggedIn) {
            _state.update { it.copy(message = "Already signed in") }
            return
        }
        _state.update {
            it.copy(
                pendingLoginTid = telegramId,
                pendingLoginCode = clean,
                error = null,
            )
        }
    }

    fun consumePendingLogin() {
        _state.update { it.copy(pendingLoginTid = null, pendingLoginCode = null) }
    }

    /** One-shot auto-login from a deep link (OTP is single-use). */
    fun loginFromPendingDeepLink() {
        val tid = _state.value.pendingLoginTid ?: return
        val code = _state.value.pendingLoginCode ?: return
        if (_state.value.loggedIn || _state.value.loading || _state.value.booting) return
        consumePendingLogin()
        login(tid, code)
    }

    fun login(telegramId: Long, code: String) {
        viewModelScope.launch {
            _state.update { it.copy(loading = true, error = null) }
            try {
                val res = api.login(LoginBody(telegramId, code.trim()))
                store.adminToken = res.adminToken
                store.telegramId = res.telegramId
                _state.update {
                    it.copy(
                        loading = false,
                        loggedIn = true,
                        telegramId = res.telegramId,
                        authToken = res.adminToken,
                    )
                }
                refreshAll()
            } catch (e: Exception) {
                _state.update { it.copy(loading = false, error = errMsg(e)) }
            }
        }
    }

    fun logout() {
        viewModelScope.launch {
            try {
                store.adminToken?.let { api.logout(ApiFactory.auth(it)) }
            } catch (_: Exception) {
            }
            store.clear()
            _state.value = AdminUiState(booting = false, loggedIn = false)
        }
    }

    fun refreshAll() = pullRefresh()

    /** Pull-to-refresh / top-bar refresh: reload all admin data in parallel. */
    fun pullRefresh() {
        if (_state.value.refreshing) return
        viewModelScope.launch {
            _state.update { it.copy(refreshing = true, error = null) }
            try {
                coroutineScope {
                    val jobs = listOf(
                        async {
                            runCatching {
                                val s = api.stats(auth()).toModel()
                                _state.update { it.copy(stats = s) }
                            }.onFailure { e ->
                                _state.update { it.copy(error = "stats: ${errMsg(e)}") }
                            }
                        },
                        async {
                            runCatching {
                                val page = api.payments(
                                    auth(),
                                    status = _state.value.paymentFilter,
                                    page = 1,
                                    perPage = PAGE_SIZE,
                                )
                                _state.update {
                                    it.copy(
                                        payments = page.items.map { p -> p.toModel() },
                                        paymentsPage = page.page,
                                        paymentsTotalPages = page.totalPages.coerceAtLeast(1),
                                        paymentsLoadingMore = false,
                                    )
                                }
                            }.onFailure { e ->
                                _state.update { it.copy(error = "payments: ${errMsg(e)}") }
                            }
                        },
                        async {
                            runCatching {
                                val rows = api.paymentAccounts(auth()).accounts.map { it.toModel() }
                                _state.update { it.copy(accounts = rows) }
                            }.onFailure { e ->
                                _state.update { it.copy(error = "accounts: ${errMsg(e)}") }
                            }
                        },
                        async {
                            runCatching {
                                val servers = api.servers(auth()).servers.map { it.toModel() }
                                val plans = api.plans(auth()).plans.map { it.toModel() }
                                _state.update { it.copy(servers = servers, plans = plans) }
                            }.onFailure { e ->
                                _state.update { it.copy(error = "servers: ${errMsg(e)}") }
                            }
                        },
                        async {
                            runCatching {
                                val page = api.users(
                                    auth(),
                                    q = _state.value.userQuery,
                                    page = 1,
                                    perPage = PAGE_SIZE,
                                )
                                _state.update {
                                    it.copy(
                                        users = page.users.map { u -> u.toModel() },
                                        usersPage = page.page,
                                        usersTotalPages = page.totalPages.coerceAtLeast(1),
                                        usersLoadingMore = false,
                                    )
                                }
                            }.onFailure { e ->
                                _state.update { it.copy(error = "users: ${errMsg(e)}") }
                            }
                        },
                        async {
                            runCatching {
                                val page = api.catalog(auth(), page = 1, perPage = PAGE_SIZE)
                                _state.update {
                                    it.copy(
                                        catalog = page.servers.map { s -> s.toModel() },
                                        catalogPage = page.page,
                                        catalogTotalPages = page.totalPages.coerceAtLeast(1),
                                        catalogLoadingMore = false,
                                    )
                                }
                            }.onFailure { e ->
                                _state.update { it.copy(error = "catalog: ${errMsg(e)}") }
                            }
                        },
                        async {
                            runCatching {
                                val page = api.ads(auth(), page = 1, perPage = PAGE_SIZE)
                                _state.update {
                                    it.copy(
                                        ads = page.ads.map { a -> a.toModel() },
                                        adsPage = page.page,
                                        adsTotalPages = page.totalPages.coerceAtLeast(1),
                                        adsLoadingMore = false,
                                    )
                                }
                            }.onFailure { e ->
                                _state.update { it.copy(error = "ads: ${errMsg(e)}") }
                            }
                        },
                        async {
                            runCatching {
                                val wrap = api.appConfig(auth())
                                _state.update { it.copy(appConfig = wrap.config.toModel()) }
                            }.onFailure { e ->
                                _state.update { it.copy(error = "app-config: ${errMsg(e)}") }
                            }
                        },
                        async {
                            runCatching {
                                loadDeviceKeysAndDau()
                            }.onFailure { e ->
                                _state.update { it.copy(error = "devices: ${errMsg(e)}") }
                            }
                        },
                        async {
                            runCatching {
                                loadNotificationsIntoState()
                            }.onFailure { e ->
                                _state.update { it.copy(error = "notify: ${errMsg(e)}") }
                            }
                        },
                    )
                    jobs.awaitAll()
                }
            } finally {
                _state.update { it.copy(refreshing = false) }
            }
        }
    }

    private suspend fun loadDeviceKeysAndDau() {
        val keys = api.deviceKeys(auth(), perPage = 50)
        val dau = api.dau(auth(), limit = 100)
        _state.update {
            it.copy(
                deviceKeys = keys.keys.map { k -> k.toModel() },
                dauDevices = dau.devices.map { d -> d.toModel() },
                dauDay = dau.day,
                dauCount = dau.count,
            )
        }
    }

    fun refreshStats() = launch("stats") {
        val s = api.stats(auth()).toModel()
        _state.update { it.copy(stats = s) }
    }

    fun setPaymentFilter(status: String?) {
        _state.update {
            it.copy(
                paymentFilter = status,
                paymentsPage = 0,
                paymentsTotalPages = 1,
            )
        }
        refreshPayments(reset = true)
    }

    fun refreshPayments(reset: Boolean = true) {
        if (!reset) {
            val st = _state.value
            if (!st.paymentsCanLoadMore || st.refreshing) return
        }
        viewModelScope.launch {
            val nextPage = if (reset) 1 else _state.value.paymentsPage + 1
            if (reset) {
                _state.update { it.copy(loading = true, error = null) }
            } else {
                _state.update { it.copy(paymentsLoadingMore = true, error = null) }
            }
            try {
                val page = api.payments(
                    auth(),
                    status = _state.value.paymentFilter,
                    page = nextPage,
                    perPage = PAGE_SIZE,
                )
                val mapped = page.items.map { it.toModel() }
                _state.update {
                    it.copy(
                        loading = false,
                        paymentsLoadingMore = false,
                        payments = if (reset) mapped else it.payments + mapped,
                        paymentsPage = page.page,
                        paymentsTotalPages = page.totalPages.coerceAtLeast(1),
                    )
                }
            } catch (e: Exception) {
                _state.update {
                    it.copy(loading = false, paymentsLoadingMore = false, error = "payments: ${errMsg(e)}")
                }
            }
        }
    }

    fun loadMorePayments() = refreshPayments(reset = false)

    fun approvePayment(id: Int) = launch("approve") {
        api.approvePayment(auth(), id)
        _state.update { it.copy(message = "Payment #$id approved") }
        refreshPayments(reset = true)
        refreshStats()
    }

    fun rejectPayment(id: Int, reason: String) = launch("reject") {
        api.rejectPayment(auth(), id, RejectBody(reason.ifBlank { "Rejected by admin" }))
        _state.update { it.copy(message = "Payment #$id rejected") }
        refreshPayments(reset = true)
        refreshStats()
    }

    fun refreshAccounts() = launch("accounts") {
        val rows = api.paymentAccounts(auth()).accounts.map { it.toModel() }
        _state.update { it.copy(accounts = rows) }
    }

    fun saveAccount(
        id: Int?,
        method: String,
        number: String,
        name: String,
        active: Boolean,
    ) = launch("saveAccount") {
        val body = AccountBody(method, number, name, active)
        if (id == null) api.createAccount(auth(), body) else api.updateAccount(auth(), id, body)
        _state.update { it.copy(message = "Account saved") }
        refreshAccounts()
    }

    fun setAccountActive(id: Int, active: Boolean) = launch("accountActive") {
        api.setAccountActive(auth(), id, active)
        refreshAccounts()
    }

    fun refreshServersPlans() = launch("servers") {
        val servers = api.servers(auth()).servers.map { it.toModel() }
        val plans = api.plans(auth()).plans.map { it.toModel() }
        _state.update { it.copy(servers = servers, plans = plans) }
    }

    fun saveServer(
        id: String,
        nameEn: String,
        nameMy: String,
        panelUrl: String,
        panelUsername: String,
        panelPassword: String,
        panelInboundId: Int,
        panelVerifySsl: Boolean,
        vpsHost: String,
        vpsPort: Int,
        vlessSecurity: String,
        vlessFlow: String,
        vlessSni: String,
        vlessFp: String,
        vlessPbk: String,
        vlessSid: String,
        vlessSpx: String,
        enabled: Boolean,
        sortOrder: Int,
    ) = launch("saveServer") {
        api.upsertServer(
            auth(),
            VpnNodeBody(
                id = id.trim().lowercase(),
                nameEn = nameEn,
                nameMy = nameMy,
                panelUrl = panelUrl,
                panelUsername = panelUsername,
                panelPassword = panelPassword,
                panelInboundId = panelInboundId,
                panelVerifySsl = panelVerifySsl,
                vpsHost = vpsHost,
                vpsPort = vpsPort,
                vlessSecurity = vlessSecurity,
                vlessFlow = vlessFlow,
                vlessSni = vlessSni,
                vlessFp = vlessFp,
                vlessPbk = vlessPbk,
                vlessSid = vlessSid,
                vlessSpx = vlessSpx,
                enabled = enabled,
                sortOrder = sortOrder,
            ),
        )
        _state.update { it.copy(message = "Node saved") }
        refreshServersPlans()
    }

    fun setServerEnabled(id: String, enabled: Boolean) = launch("serverEnabled") {
        api.setServerEnabled(auth(), id, enabled)
        refreshServersPlans()
    }

    fun deleteServer(id: String) = launch("deleteServer") {
        api.deleteServer(auth(), id)
        _state.update { it.copy(message = "Node deleted") }
        refreshServersPlans()
    }

    fun savePlan(
        id: Int?,
        title: String,
        dataGb: Double,
        priceKs: Int,
        days: Int,
        serverId: String,
        sortOrder: Int,
        active: Boolean,
    ) = launch("savePlan") {
        val body = PlanBody(title, dataGb, priceKs, days, serverId, sortOrder, active)
        if (id == null) api.createPlan(auth(), body) else api.updatePlan(auth(), id, body)
        _state.update { it.copy(message = "Plan saved") }
        refreshServersPlans()
    }

    fun setPlanActive(id: Int, active: Boolean) = launch("planActive") {
        api.setPlanActive(auth(), id, active)
        refreshServersPlans()
    }

    fun deletePlan(id: Int) = launch("deletePlan") {
        api.deletePlan(auth(), id)
        _state.update { it.copy(message = "Plan deleted") }
        refreshServersPlans()
    }

    fun setUserQuery(q: String) {
        _state.update { it.copy(userQuery = q) }
    }

    fun refreshUsers(reset: Boolean = true) {
        if (!reset) {
            val st = _state.value
            if (!st.usersCanLoadMore || st.refreshing) return
        }
        viewModelScope.launch {
            val nextPage = if (reset) 1 else _state.value.usersPage + 1
            if (reset) {
                _state.update { it.copy(loading = true, error = null) }
            } else {
                _state.update { it.copy(usersLoadingMore = true, error = null) }
            }
            try {
                val page = api.users(
                    auth(),
                    q = _state.value.userQuery,
                    page = nextPage,
                    perPage = PAGE_SIZE,
                )
                val mapped = page.users.map { it.toModel() }
                _state.update {
                    it.copy(
                        loading = false,
                        usersLoadingMore = false,
                        users = if (reset) mapped else it.users + mapped,
                        usersPage = page.page,
                        usersTotalPages = page.totalPages.coerceAtLeast(1),
                    )
                }
            } catch (e: Exception) {
                _state.update {
                    it.copy(loading = false, usersLoadingMore = false, error = "users: ${errMsg(e)}")
                }
            }
        }
    }

    fun loadMoreUsers() = refreshUsers(reset = false)

    fun banUser(telegramId: Long, banned: Boolean) = launch("ban") {
        api.banUser(auth(), telegramId, BanBody(banned))
        _state.update { it.copy(message = if (banned) "User banned" else "User unbanned") }
        refreshUsers(reset = true)
        refreshStats()
    }

    fun openUserKeys(telegramId: Long) = launch("userSubs") {
        val res = api.userSubscriptions(auth(), telegramId)
        _state.update {
            it.copy(
                managedTelegramId = telegramId,
                managedSubs = res.subscriptions.map { s -> s.toModel() },
            )
        }
    }

    fun closeUserKeys() {
        _state.update {
            it.copy(
                managedTelegramId = null,
                managedSubs = emptyList(),
                lastCreatedKey = null,
                lastCreatedSubUrl = null,
            )
        }
    }

    fun adjustSubscription(
        subId: Int,
        daysDelta: Int = 0,
        dataGbDelta: Double = 0.0,
        setDataGb: Double? = null,
        setDaysLeft: Int? = null,
    ) = launch("adjust") {
        api.adjustSubscription(
            auth(),
            subId,
            SubAdjustBody(
                daysDelta = daysDelta,
                dataGbDelta = dataGbDelta,
                setDataGb = setDataGb,
                setDaysLeft = setDaysLeft,
            ),
        )
        val tid = _state.value.managedTelegramId
        if (tid != null) {
            val res = api.userSubscriptions(auth(), tid)
            _state.update {
                it.copy(
                    managedSubs = res.subscriptions.map { s -> s.toModel() },
                    message = "Subscription #$subId updated",
                )
            }
        } else {
            _state.update { it.copy(message = "Subscription #$subId updated") }
        }
        refreshStats()
    }

    fun replaceSubscriptionKey(subId: Int, shareUri: String? = null) = launch("replaceKey") {
        val res = api.replaceSubscriptionKey(
            auth(),
            subId,
            ReplaceKeyBody(shareUri = shareUri?.ifBlank { null }),
        )
        val sub = res.subscription?.toModel()
        val tid = _state.value.managedTelegramId
        if (tid != null) {
            val list = api.userSubscriptions(auth(), tid)
            _state.update {
                it.copy(
                    managedSubs = list.subscriptions.map { s -> s.toModel() },
                    message = if (shareUri.isNullOrBlank()) {
                        "New key issued for #$subId"
                    } else {
                        "Pasted key saved for #$subId"
                    },
                    lastCreatedKey = sub?.vlessKey,
                    lastCreatedSubUrl = sub?.subscriptionUrl,
                )
            }
        } else {
            _state.update {
                it.copy(
                    message = "Key updated for #$subId",
                    lastCreatedKey = sub?.vlessKey,
                    lastCreatedSubUrl = sub?.subscriptionUrl,
                )
            }
        }
    }

    fun removeSubscriptionKey(subId: Int) = launch("removeKey") {
        api.removeSubscriptionKey(auth(), subId)
        val tid = _state.value.managedTelegramId
        if (tid != null) {
            val list = api.userSubscriptions(auth(), tid)
            _state.update {
                it.copy(
                    managedSubs = list.subscriptions.map { s -> s.toModel() },
                    message = "Key removed from sub link (#$subId)",
                )
            }
        } else {
            _state.update { it.copy(message = "Key removed (#$subId)") }
        }
        refreshStats()
    }

    fun createManualSubscription(
        telegramId: Long,
        serverId: String,
        dataGb: Double,
        days: Int,
        notify: Boolean,
    ) = launch("createSub") {
        val res = api.createSubscription(
            auth(),
            ManualSubBody(
                telegramId = telegramId,
                serverId = serverId,
                dataGb = dataGb,
                days = days,
                notify = notify,
            ),
        )
        val sub = res.subscription?.toModel()
        val list = api.userSubscriptions(auth(), telegramId)
        _state.update {
            it.copy(
                message = "Key created for $telegramId",
                lastCreatedKey = sub?.vlessKey,
                lastCreatedSubUrl = sub?.subscriptionUrl,
                managedTelegramId = telegramId,
                managedSubs = list.subscriptions.map { s -> s.toModel() },
            )
        }
        refreshUsers(reset = true)
        refreshStats()
    }

    fun clearCreatedKeyFlash() {
        _state.update { it.copy(lastCreatedKey = null, lastCreatedSubUrl = null) }
    }

    fun issueCatalogKey(
        serverId: String,
        dataGb: Double,
        days: Int,
        remark: String = "",
    ) {
        issueCatalogKeys(listOf(serverId), dataGb, days, remark)
    }

    fun issueCatalogKeys(
        serverIds: List<String>,
        dataGb: Double,
        days: Int,
        remark: String = "",
    ) {
        val ids = serverIds.map { it.trim().lowercase() }.filter { it.isNotBlank() }.distinct()
        if (ids.isEmpty()) return
        viewModelScope.launch {
            _state.update { it.copy(issuingCatalogKey = true, error = null) }
            val created = mutableListOf<String>()
            val labels = mutableListOf<String>()
            try {
                for (sid in ids) {
                    val res = api.issueCatalogKey(
                        auth(),
                        CatalogIssueKeyBody(
                            serverId = sid,
                            dataGb = dataGb,
                            days = days,
                            remark = if (remark.isBlank()) "catalog-$sid" else "$remark-$sid",
                        ),
                    )
                    val key = res.vlessKey.trim()
                    if (key.isNotBlank()) {
                        created += key
                        labels += sid + if (res.enabled) "" else "(off)"
                    }
                }
                _state.update {
                    it.copy(
                        issuingCatalogKey = false,
                        issuedCatalogKey = created.joinToString("\n"),
                        message = "Created ${created.size} VLESS key(s): ${labels.joinToString(", ")}",
                    )
                }
            } catch (e: Exception) {
                _state.update {
                    it.copy(
                        issuingCatalogKey = false,
                        issuedCatalogKey = created.joinToString("\n").ifBlank { null },
                        error = "issue key: ${errMsg(e)}",
                    )
                }
            }
        }
    }

    fun consumeIssuedCatalogKey() {
        _state.update { it.copy(issuedCatalogKey = null) }
    }

    fun refreshCatalog(reset: Boolean = true) {
        if (!reset) {
            val st = _state.value
            if (!st.catalogCanLoadMore || st.refreshing) return
        }
        viewModelScope.launch {
            val nextPage = if (reset) 1 else _state.value.catalogPage + 1
            if (reset) {
                _state.update { it.copy(loading = true, error = null) }
            } else {
                _state.update { it.copy(catalogLoadingMore = true, error = null) }
            }
            try {
                val page = api.catalog(auth(), page = nextPage, perPage = PAGE_SIZE)
                val mapped = page.servers.map { it.toModel() }
                _state.update {
                    it.copy(
                        loading = false,
                        catalogLoadingMore = false,
                        catalog = if (reset) mapped else it.catalog + mapped,
                        catalogPage = page.page,
                        catalogTotalPages = page.totalPages.coerceAtLeast(1),
                    )
                }
            } catch (e: Exception) {
                _state.update {
                    it.copy(loading = false, catalogLoadingMore = false, error = "catalog: ${errMsg(e)}")
                }
            }
        }
    }

    fun loadMoreCatalog() = refreshCatalog(reset = false)

    fun saveCatalog(
        id: String,
        name: String,
        region: String,
        protocol: String,
        tier: String,
        configUri: String?,
        nodesText: String?,
        manualDataGb: Double?,
        manualUsedGb: Double?,
        manualExpireAt: Long?,
        listWhenDisabled: Boolean,
        enabled: Boolean,
        sortOrder: Int,
        sshHost: String? = null,
        sshPort: Int? = null,
        sshUser: String? = null,
        sshPassword: String? = null,
        sshSni: String? = null,
        sshTls: Boolean? = null,
        sshAllowInsecure: Boolean? = null,
    ) = launch("saveCatalog") {
        val proto = protocol.trim().ifBlank { "vless" }.lowercase()
        api.upsertCatalog(
            auth(),
            CatalogBody(
                publicId = id,
                name = name,
                region = region,
                protocol = proto,
                tier = tier,
                configUri = if (proto == "ssh") null else configUri?.ifBlank { null },
                nodesText = if (proto == "ssh") null else nodesText?.ifBlank { null },
                manualDataGb = manualDataGb,
                manualUsedGb = manualUsedGb,
                manualExpireAt = manualExpireAt,
                listWhenDisabled = listWhenDisabled,
                enabled = enabled,
                sortOrder = sortOrder,
                sshHost = if (proto == "ssh") sshHost?.ifBlank { null } else null,
                sshPort = if (proto == "ssh") sshPort else null,
                sshUser = if (proto == "ssh") sshUser?.ifBlank { null } else null,
                sshPassword = if (proto == "ssh") sshPassword else null,
                sshSni = if (proto == "ssh") sshSni?.ifBlank { null } else null,
                sshTls = if (proto == "ssh") sshTls else null,
                sshAllowInsecure = if (proto == "ssh") sshAllowInsecure else null,
            ),
        )
        _state.update { it.copy(message = "Catalog server saved") }
        refreshCatalog(reset = true)
    }

    fun setCatalogEnabled(id: String, enabled: Boolean) = launch("catalogEnabled") {
        api.setCatalogEnabled(auth(), id, enabled)
        refreshCatalog(reset = true)
    }

    fun deleteCatalog(id: String) = launch("deleteCatalog") {
        api.deleteCatalog(auth(), id)
        refreshCatalog(reset = true)
    }

    fun refreshAds(reset: Boolean = true) {
        if (!reset) {
            val st = _state.value
            if (!st.adsCanLoadMore || st.refreshing) return
        }
        viewModelScope.launch {
            val nextPage = if (reset) 1 else _state.value.adsPage + 1
            if (reset) {
                _state.update { it.copy(loading = true, error = null) }
            } else {
                _state.update { it.copy(adsLoadingMore = true, error = null) }
            }
            try {
                val page = api.ads(auth(), page = nextPage, perPage = PAGE_SIZE)
                val mapped = page.ads.map { it.toModel() }
                _state.update {
                    it.copy(
                        loading = false,
                        adsLoadingMore = false,
                        ads = if (reset) mapped else it.ads + mapped,
                        adsPage = page.page,
                        adsTotalPages = page.totalPages.coerceAtLeast(1),
                    )
                }
            } catch (e: Exception) {
                _state.update {
                    it.copy(loading = false, adsLoadingMore = false, error = "ads: ${errMsg(e)}")
                }
            }
        }
    }

    fun loadMoreAds() = refreshAds(reset = false)

    fun saveAd(
        id: String,
        placement: String,
        imageUrl: String,
        clickUrl: String,
        title: String,
        width: Int,
        height: Int,
        enabled: Boolean,
        sortOrder: Int,
    ) = launch("saveAd") {
        api.upsertAd(
            auth(),
            AdBody(
                publicId = id,
                placement = placement,
                imageUrl = imageUrl,
                clickUrl = clickUrl,
                title = title,
                imageWidth = width,
                imageHeight = height,
                enabled = enabled,
                sortOrder = sortOrder,
            ),
        )
        _state.update { it.copy(message = "Ad saved") }
        refreshAds()
    }

    fun refreshAppConfig() = launch("appConfig") {
        val wrap = api.appConfig(auth())
        _state.update { it.copy(appConfig = wrap.config.toModel()) }
    }

    fun saveAppConfig(cfg: AppConfigSettings) {
        viewModelScope.launch {
            _state.update { it.copy(appConfigSaving = true, error = null) }
            try {
                val wrap = api.putAppConfig(
                    auth(),
                    AppConfigBody(
                        minVersionCode = cfg.minVersionCode,
                        latestVersionCode = cfg.latestVersionCode,
                        latestVersionName = cfg.latestVersionName,
                        forceUpdate = cfg.forceUpdate,
                        changelog = cfg.changelog,
                        maintenance = cfg.maintenance,
                        maintenanceMessage = cfg.maintenanceMessage,
                        telegramUrl = cfg.telegramUrl,
                        playUrl = cfg.playUrl,
                        updateUrl = cfg.updateUrl,
                        buyUrl = cfg.buyUrl,
                        privacyUrl = cfg.privacyUrl,
                    ),
                )
                _state.update {
                    it.copy(
                        appConfigSaving = false,
                        appConfig = wrap.config.toModel(),
                        message = "App config saved",
                    )
                }
            } catch (e: Exception) {
                _state.update {
                    it.copy(appConfigSaving = false, error = "app-config: ${errMsg(e)}")
                }
            }
        }
    }

    fun refreshDau() = launch("dau") {
        val dau = api.dau(auth(), limit = 100)
        _state.update {
            it.copy(
                dauDevices = dau.devices.map { d -> d.toModel() },
                dauDay = dau.day,
                dauCount = dau.count,
            )
        }
    }

    fun refreshDeviceKeys() = launch("deviceKeys") {
        loadDeviceKeysAndDau()
    }

    fun saveDeviceKey(key: DeviceExclusiveKey) = launch("saveDeviceKey") {
        api.upsertDeviceKey(
            auth(),
            DeviceExclusiveBody(
                deviceId = key.deviceId,
                name = key.name,
                configUri = key.configUri,
                region = key.region,
                protocol = key.protocol.ifBlank { "vless" },
                note = key.note,
                tier = key.tier.ifBlank { "free" },
                publicId = key.publicId.ifBlank { null },
                enabled = key.enabled,
            ),
        )
        _state.update { it.copy(message = "Exclusive key saved") }
        loadDeviceKeysAndDau()
    }

    fun setDeviceKeyEnabled(publicId: String, enabled: Boolean) = launch("deviceKeyEnabled") {
        api.setDeviceKeyEnabled(auth(), publicId, enabled)
        loadDeviceKeysAndDau()
    }

    fun deleteDeviceKey(publicId: String) = launch("deleteDeviceKey") {
        api.deleteDeviceKey(auth(), publicId)
        _state.update { it.copy(message = "Exclusive key deleted") }
        loadDeviceKeysAndDau()
    }

    fun setAdEnabled(id: String, enabled: Boolean) = launch("adEnabled") {
        api.patchAd(auth(), id, AdPatchBody(enabled = enabled))
        refreshAds()
    }

    fun deleteAd(id: String) = launch("deleteAd") {
        api.deleteAd(auth(), id)
        refreshAds()
    }

    fun uploadAdImage(file: File, onDone: (url: String, width: Int, height: Int) -> Unit) =
        launch("upload") {
            val res = api.uploadAd(auth(), ApiFactory.imagePart(file))
            onDone(res.imageUrl, res.imageWidth, res.imageHeight)
            _state.update { it.copy(message = "Image uploaded") }
        }

    fun setNotifyAudience(audience: String) {
        _state.update { it.copy(notifyAudience = audience) }
    }

    fun setNotifyMessage(message: String) {
        _state.update { it.copy(notifyMessage = message) }
    }

    fun refreshNotifications() = launch("notifications") {
        loadNotificationsIntoState()
    }

    private suspend fun loadNotificationsIntoState() {
        val res = api.notifications(auth())
        _state.update {
            it.copy(
                audienceCounts = AudienceCounts(
                    all = res.audiences.all,
                    paid = res.audiences.paid,
                    active = res.audiences.active,
                ),
                notifications = res.notifications.map { n -> n.toModel() },
            )
        }
    }

    fun sendBroadcast() {
        val st = _state.value
        val msg = st.notifyMessage.trim()
        if (msg.isBlank()) {
            _state.update { it.copy(error = "Enter a message first") }
            return
        }
        if (st.notifySending) return
        viewModelScope.launch {
            _state.update { it.copy(notifySending = true, error = null) }
            try {
                val res = api.broadcast(
                    auth(),
                    BroadcastBody(audience = st.notifyAudience, message = msg),
                )
                _state.update {
                    it.copy(
                        notifySending = false,
                        notifyMessage = "",
                        message = "Sent to ${res.sent} · failed ${res.failed}",
                    )
                }
                loadNotificationsIntoState()
            } catch (e: Exception) {
                _state.update {
                    it.copy(notifySending = false, error = "broadcast: ${errMsg(e)}")
                }
            }
        }
    }

    private fun launch(label: String, block: suspend () -> Unit) {
        viewModelScope.launch {
            _state.update { it.copy(loading = true, error = null) }
            try {
                block()
                _state.update { it.copy(loading = false) }
            } catch (e: Exception) {
                _state.update { it.copy(loading = false, error = "$label: ${errMsg(e)}") }
            }
        }
    }
}
