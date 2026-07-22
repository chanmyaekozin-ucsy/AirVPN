package com.airvpn.admin

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.airvpn.admin.data.api.AccountBody
import com.airvpn.admin.data.api.AdBody
import com.airvpn.admin.data.api.AdPatchBody
import com.airvpn.admin.data.api.ApiFactory
import com.airvpn.admin.data.api.BanBody
import com.airvpn.admin.data.api.CatalogBody
import com.airvpn.admin.data.api.LoginBody
import com.airvpn.admin.data.api.PlanBody
import com.airvpn.admin.data.api.RejectBody
import com.airvpn.admin.data.local.SessionStore
import com.airvpn.admin.data.model.AdItem
import com.airvpn.admin.data.model.AdminStats
import com.airvpn.admin.data.model.CatalogServer
import com.airvpn.admin.data.model.PaymentAccount
import com.airvpn.admin.data.model.PaymentItem
import com.airvpn.admin.data.model.PlanItem
import com.airvpn.admin.data.model.UserItem
import com.airvpn.admin.data.model.VpnServerInfo
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
    val loading: Boolean = false,
    val message: String? = null,
    val error: String? = null,
    val stats: AdminStats = AdminStats(),
    val payments: List<PaymentItem> = emptyList(),
    val paymentFilter: String? = "pending",
    val accounts: List<PaymentAccount> = emptyList(),
    val servers: List<VpnServerInfo> = emptyList(),
    val plans: List<PlanItem> = emptyList(),
    val users: List<UserItem> = emptyList(),
    val userQuery: String = "",
    val catalog: List<CatalogServer> = emptyList(),
    val ads: List<AdItem> = emptyList(),
)

class AdminViewModel(app: Application) : AndroidViewModel(app) {
    private val store = SessionStore(app)
    private val api = ApiFactory.api

    private val _state = MutableStateFlow(AdminUiState())
    val state: StateFlow<AdminUiState> = _state.asStateFlow()

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
                    it.copy(booting = false, loggedIn = true, telegramId = me.telegramId)
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

    fun login(telegramId: Long, code: String) {
        viewModelScope.launch {
            _state.update { it.copy(loading = true, error = null) }
            try {
                val res = api.login(LoginBody(telegramId, code.trim()))
                store.adminToken = res.adminToken
                store.telegramId = res.telegramId
                _state.update {
                    it.copy(loading = false, loggedIn = true, telegramId = res.telegramId)
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

    fun refreshAll() {
        refreshStats()
        refreshPayments()
        refreshAccounts()
        refreshServersPlans()
        refreshUsers()
        refreshCatalog()
        refreshAds()
    }

    fun refreshStats() = launch("stats") {
        val s = api.stats(auth()).toModel()
        _state.update { it.copy(stats = s) }
    }

    fun setPaymentFilter(status: String?) {
        _state.update { it.copy(paymentFilter = status) }
        refreshPayments()
    }

    fun refreshPayments() = launch("payments") {
        val page = api.payments(auth(), status = _state.value.paymentFilter)
        _state.update { it.copy(payments = page.items.map { p -> p.toModel() }) }
    }

    fun approvePayment(id: Int) = launch("approve") {
        api.approvePayment(auth(), id)
        _state.update { it.copy(message = "Payment #$id approved") }
        refreshPayments()
        refreshStats()
    }

    fun rejectPayment(id: Int, reason: String) = launch("reject") {
        api.rejectPayment(auth(), id, RejectBody(reason.ifBlank { "Rejected by admin" }))
        _state.update { it.copy(message = "Payment #$id rejected") }
        refreshPayments()
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

    fun setUserQuery(q: String) {
        _state.update { it.copy(userQuery = q) }
    }

    fun refreshUsers() = launch("users") {
        val page = api.users(auth(), q = _state.value.userQuery)
        _state.update { it.copy(users = page.users.map { u -> u.toModel() }) }
    }

    fun banUser(telegramId: Long, banned: Boolean) = launch("ban") {
        api.banUser(auth(), telegramId, BanBody(banned))
        _state.update { it.copy(message = if (banned) "User banned" else "User unbanned") }
        refreshUsers()
        refreshStats()
    }

    fun refreshCatalog() = launch("catalog") {
        val rows = api.catalog(auth()).servers.map { it.toModel() }
        _state.update { it.copy(catalog = rows) }
    }

    fun saveCatalog(
        id: String,
        name: String,
        region: String,
        tier: String,
        configUri: String?,
        enabled: Boolean,
        sortOrder: Int,
    ) = launch("saveCatalog") {
        api.upsertCatalog(
            auth(),
            CatalogBody(
                publicId = id,
                name = name,
                region = region,
                tier = tier,
                configUri = configUri?.ifBlank { null },
                enabled = enabled,
                sortOrder = sortOrder,
            ),
        )
        _state.update { it.copy(message = "Catalog server saved") }
        refreshCatalog()
    }

    fun setCatalogEnabled(id: String, enabled: Boolean) = launch("catalogEnabled") {
        api.setCatalogEnabled(auth(), id, enabled)
        refreshCatalog()
    }

    fun deleteCatalog(id: String) = launch("deleteCatalog") {
        api.deleteCatalog(auth(), id)
        refreshCatalog()
    }

    fun refreshAds() = launch("ads") {
        val rows = api.ads(auth()).ads.map { it.toModel() }
        _state.update { it.copy(ads = rows) }
    }

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

    fun setAdEnabled(id: String, enabled: Boolean) = launch("adEnabled") {
        api.patchAd(auth(), id, AdPatchBody(enabled = enabled))
        refreshAds()
    }

    fun deleteAd(id: String) = launch("deleteAd") {
        api.deleteAd(auth(), id)
        refreshAds()
    }

    fun uploadAdImage(file: File, onUrl: (String) -> Unit) = launch("upload") {
        val res = api.uploadAd(auth(), ApiFactory.imagePart(file))
        onUrl(res.imageUrl)
        _state.update { it.copy(message = "Image uploaded") }
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
