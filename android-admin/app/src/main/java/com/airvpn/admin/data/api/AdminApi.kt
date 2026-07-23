package com.airvpn.admin.data.api

import com.airvpn.admin.BuildConfig
import com.airvpn.admin.data.model.AdItem
import com.airvpn.admin.data.model.AdminStats
import com.airvpn.admin.data.model.CatalogServer
import com.airvpn.admin.data.model.NotificationItem
import com.airvpn.admin.data.model.PaymentAccount
import com.airvpn.admin.data.model.PaymentItem
import com.airvpn.admin.data.model.PlanItem
import com.airvpn.admin.data.model.SubscriptionItem
import com.airvpn.admin.data.model.UserItem
import com.airvpn.admin.data.model.VpnServerInfo
import com.squareup.moshi.FromJson
import com.squareup.moshi.Json
import com.squareup.moshi.JsonReader
import com.squareup.moshi.Moshi
import com.squareup.moshi.ToJson
import com.squareup.moshi.kotlin.reflect.KotlinJsonAdapterFactory
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.RequestBody.Companion.asRequestBody
import retrofit2.Retrofit
import retrofit2.converter.moshi.MoshiConverterFactory
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.Multipart
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.PUT
import retrofit2.http.Part
import retrofit2.http.Path
import retrofit2.http.Query
import java.io.File
import java.util.concurrent.TimeUnit

interface AdminApi {
    @POST("v1/admin/auth/login")
    suspend fun login(@Body body: LoginBody): LoginResponse

    @POST("v1/admin/auth/logout")
    suspend fun logout(@Header("Authorization") auth: String): StatusResponse

    @GET("v1/admin/me")
    suspend fun me(@Header("Authorization") auth: String): MeResponse

    @GET("v1/admin/stats")
    suspend fun stats(@Header("Authorization") auth: String): StatsDto

    @GET("v1/admin/payments")
    suspend fun payments(
        @Header("Authorization") auth: String,
        @Query("status") status: String? = null,
        @Query("page") page: Int = 1,
        @Query("per_page") perPage: Int = 20,
    ): PaymentsPageDto

    @POST("v1/admin/payments/{id}/approve")
    suspend fun approvePayment(
        @Header("Authorization") auth: String,
        @Path("id") id: Int,
    ): StatusResponse

    @POST("v1/admin/payments/{id}/reject")
    suspend fun rejectPayment(
        @Header("Authorization") auth: String,
        @Path("id") id: Int,
        @Body body: RejectBody,
    ): StatusResponse

    @GET("v1/admin/payment-accounts")
    suspend fun paymentAccounts(@Header("Authorization") auth: String): AccountsDto

    @POST("v1/admin/payment-accounts")
    suspend fun createAccount(
        @Header("Authorization") auth: String,
        @Body body: AccountBody,
    ): AccountWrapDto

    @PATCH("v1/admin/payment-accounts/{id}")
    suspend fun updateAccount(
        @Header("Authorization") auth: String,
        @Path("id") id: Int,
        @Body body: AccountBody,
    ): AccountWrapDto

    @POST("v1/admin/payment-accounts/{id}/active")
    suspend fun setAccountActive(
        @Header("Authorization") auth: String,
        @Path("id") id: Int,
        @Query("active") active: Boolean,
    ): StatusResponse

    @GET("v1/admin/servers")
    suspend fun servers(@Header("Authorization") auth: String): ServersDto

    @POST("v1/admin/servers")
    suspend fun upsertServer(
        @Header("Authorization") auth: String,
        @Body body: VpnNodeBody,
    ): ServerWrapDto

    @POST("v1/admin/servers/{id}/enabled")
    suspend fun setServerEnabled(
        @Header("Authorization") auth: String,
        @Path("id") id: String,
        @Query("enabled") enabled: Boolean,
    ): StatusResponse

    @DELETE("v1/admin/servers/{id}")
    suspend fun deleteServer(
        @Header("Authorization") auth: String,
        @Path("id") id: String,
    ): StatusResponse

    @GET("v1/admin/plans")
    suspend fun plans(
        @Header("Authorization") auth: String,
        @Query("server_id") serverId: String? = null,
    ): PlansDto

    @POST("v1/admin/plans")
    suspend fun createPlan(
        @Header("Authorization") auth: String,
        @Body body: PlanBody,
    ): PlanWrapDto

    @PATCH("v1/admin/plans/{id}")
    suspend fun updatePlan(
        @Header("Authorization") auth: String,
        @Path("id") id: Int,
        @Body body: PlanBody,
    ): PlanWrapDto

    @POST("v1/admin/plans/{id}/active")
    suspend fun setPlanActive(
        @Header("Authorization") auth: String,
        @Path("id") id: Int,
        @Query("active") active: Boolean,
    ): StatusResponse

    @DELETE("v1/admin/plans/{id}")
    suspend fun deletePlan(
        @Header("Authorization") auth: String,
        @Path("id") id: Int,
    ): StatusResponse

    @GET("v1/admin/users")
    suspend fun users(
        @Header("Authorization") auth: String,
        @Query("q") q: String = "",
        @Query("page") page: Int = 1,
        @Query("per_page") perPage: Int = 20,
    ): UsersPageDto

    @POST("v1/admin/users/{telegramId}/ban")
    suspend fun banUser(
        @Header("Authorization") auth: String,
        @Path("telegramId") telegramId: Long,
        @Body body: BanBody,
    ): BanResponse

    @GET("v1/admin/users/{telegramId}/subscriptions")
    suspend fun userSubscriptions(
        @Header("Authorization") auth: String,
        @Path("telegramId") telegramId: Long,
    ): UserSubsDto

    @POST("v1/admin/subscriptions/{id}/adjust")
    suspend fun adjustSubscription(
        @Header("Authorization") auth: String,
        @Path("id") id: Int,
        @Body body: SubAdjustBody,
    ): SubWrapDto

    @POST("v1/admin/subscriptions/{id}/replace-key")
    suspend fun replaceSubscriptionKey(
        @Header("Authorization") auth: String,
        @Path("id") id: Int,
        @Body body: ReplaceKeyBody = ReplaceKeyBody(),
    ): SubWrapDto

    @POST("v1/admin/subscriptions/{id}/remove-key")
    suspend fun removeSubscriptionKey(
        @Header("Authorization") auth: String,
        @Path("id") id: Int,
    ): SubWrapDto

    @POST("v1/admin/subscriptions/create")
    suspend fun createSubscription(
        @Header("Authorization") auth: String,
        @Body body: ManualSubBody,
    ): SubWrapDto

    @GET("v1/admin/catalog")
    suspend fun catalog(
        @Header("Authorization") auth: String,
        @Query("page") page: Int = 1,
        @Query("per_page") perPage: Int = 20,
    ): CatalogDto

    @POST("v1/admin/catalog/issue-key")
    suspend fun issueCatalogKey(
        @Header("Authorization") auth: String,
        @Body body: CatalogIssueKeyBody,
    ): CatalogIssueKeyDto

    @POST("v1/admin/catalog")
    suspend fun upsertCatalog(
        @Header("Authorization") auth: String,
        @Body body: CatalogBody,
    ): CatalogWrapDto

    @POST("v1/admin/catalog/{id}/enabled")
    suspend fun setCatalogEnabled(
        @Header("Authorization") auth: String,
        @Path("id") id: String,
        @Query("enabled") enabled: Boolean,
    ): StatusResponse

    @DELETE("v1/admin/catalog/{id}")
    suspend fun deleteCatalog(
        @Header("Authorization") auth: String,
        @Path("id") id: String,
    ): StatusResponse

    @GET("v1/admin/ads")
    suspend fun ads(
        @Header("Authorization") auth: String,
        @Query("page") page: Int = 1,
        @Query("per_page") perPage: Int = 20,
    ): AdsDto

    @POST("v1/admin/ads")
    suspend fun upsertAd(
        @Header("Authorization") auth: String,
        @Body body: AdBody,
    ): AdWrapDto

    @PATCH("v1/admin/ads/{id}")
    suspend fun patchAd(
        @Header("Authorization") auth: String,
        @Path("id") id: String,
        @Body body: AdPatchBody,
    ): AdWrapDto

    @DELETE("v1/admin/ads/{id}")
    suspend fun deleteAd(
        @Header("Authorization") auth: String,
        @Path("id") id: String,
    ): StatusResponse

    @Multipart
    @POST("v1/admin/ads/upload")
    suspend fun uploadAd(
        @Header("Authorization") auth: String,
        @Part file: MultipartBody.Part,
    ): UploadDto

    @GET("v1/admin/app-config")
    suspend fun appConfig(@Header("Authorization") auth: String): AppConfigWrapDto

    @PUT("v1/admin/app-config")
    suspend fun putAppConfig(
        @Header("Authorization") auth: String,
        @Body body: AppConfigBody,
    ): AppConfigWrapDto

    @GET("v1/admin/dau")
    suspend fun dau(
        @Header("Authorization") auth: String,
        @Query("day") day: String? = null,
        @Query("limit") limit: Int = 100,
    ): DauDto

    @GET("v1/admin/device-keys")
    suspend fun deviceKeys(
        @Header("Authorization") auth: String,
        @Query("q") q: String = "",
        @Query("device_id") deviceId: String = "",
        @Query("page") page: Int = 1,
        @Query("per_page") perPage: Int = 50,
    ): DeviceKeysDto

    @POST("v1/admin/device-keys")
    suspend fun upsertDeviceKey(
        @Header("Authorization") auth: String,
        @Body body: DeviceExclusiveBody,
    ): DeviceKeyWrapDto

    @POST("v1/admin/device-keys/{id}/enabled")
    suspend fun setDeviceKeyEnabled(
        @Header("Authorization") auth: String,
        @Path("id") id: String,
        @Query("enabled") enabled: Boolean,
    ): StatusResponse

    @DELETE("v1/admin/device-keys/{id}")
    suspend fun deleteDeviceKey(
        @Header("Authorization") auth: String,
        @Path("id") id: String,
    ): StatusResponse

    @GET("v1/admin/notifications")
    suspend fun notifications(
        @Header("Authorization") auth: String,
        @Query("limit") limit: Int = 20,
    ): NotificationsDto

    @POST("v1/admin/notifications/broadcast")
    suspend fun broadcast(
        @Header("Authorization") auth: String,
        @Body body: BroadcastBody,
    ): BroadcastResultDto
}

data class LoginBody(
    @Json(name = "telegram_id") val telegramId: Long,
    val code: String,
)

data class LoginResponse(
    @Json(name = "admin_token") val adminToken: String,
    @Json(name = "telegram_id") val telegramId: Long,
)

data class MeResponse(@Json(name = "telegram_id") val telegramId: Long)
data class StatusResponse(val status: String? = null, val message: String? = null, val detail: String? = null)
data class RejectBody(val reason: String)
data class BanBody(val banned: Boolean)
data class BanResponse(@Json(name = "telegram_id") val telegramId: Long, val banned: Boolean)

data class StatsDto(
    val users: Int = 0,
    val banned: Int = 0,
    @Json(name = "active_users") val activeUsers: Int = 0,
    @Json(name = "active_keys") val activeKeys: Int = 0,
    @Json(name = "paid_keys") val paidKeys: Int = 0,
    @Json(name = "free_keys") val freeKeys: Int = 0,
    val pending: Int = 0,
    val approved: Int = 0,
    val rejected: Int = 0,
    @Json(name = "revenue_ks") val revenueKs: Int = 0,
    @Json(name = "used_gb") val usedGb: Double = 0.0,
    @Json(name = "limit_gb") val limitGb: Double = 0.0,
    @Json(name = "keys_by_server") val keysByServer: String? = null,
    @Json(name = "dau_today") val dauToday: Int = 0,
    @Json(name = "dau_7d") val dau7d: Int = 0,
    @Json(name = "ad_clicks_today") val adClicksToday: Int = 0,
    @Json(name = "ad_clicks_total") val adClicksTotal: Int = 0,
) {
    fun toModel() = AdminStats(
        users = users,
        banned = banned,
        activeUsers = activeUsers,
        activeKeys = activeKeys,
        paidKeys = paidKeys,
        freeKeys = freeKeys,
        pending = pending,
        approved = approved,
        rejected = rejected,
        revenueKs = revenueKs,
        usedGb = usedGb,
        limitGb = limitGb,
        keysByServer = keysByServer.orEmpty(),
        dauToday = dauToday,
        dau7d = dau7d,
        adClicksToday = adClicksToday,
        adClicksTotal = adClicksTotal,
    )
}

data class PaymentDto(
    val id: Int,
    val status: String? = null,
    val method: String? = null,
    @Json(name = "amount_ks") val amountKs: Int = 0,
    @Json(name = "server_id") val serverId: String? = null,
    @Json(name = "plan_title") val planTitle: String? = null,
    @Json(name = "telegram_id") val telegramId: Long = 0,
    val username: String? = null,
    @Json(name = "first_name") val firstName: String? = null,
    @Json(name = "reject_reason") val rejectReason: String? = null,
    @Json(name = "created_at") val createdAt: String? = null,
    @Json(name = "receipt_tx_id") val receiptTxId: String? = null,
    @Json(name = "receipt_note") val receiptNote: String? = null,
    @Json(name = "has_receipt") val hasReceipt: Boolean = false,
    @Json(name = "receipt_url") val receiptUrl: String? = null,
    @Json(name = "data_gb") val dataGb: Double? = null,
    @Json(name = "duration_days") val durationDays: Int? = null,
    @Json(name = "sub_data_limit_gb") val subDataLimitGb: Double? = null,
    @Json(name = "sub_data_used_gb") val subDataUsedGb: Double? = null,
    @Json(name = "sub_data_left_gb") val subDataLeftGb: Double? = null,
    @Json(name = "sub_expires_at") val subExpiresAt: String? = null,
    @Json(name = "sub_days_left") val subDaysLeft: Int? = null,
    @Json(name = "sub_is_active") val subIsActive: Boolean? = null,
) {
    fun toModel() = PaymentItem(
        id = id,
        status = status.orEmpty(),
        method = method.orEmpty(),
        amountKs = amountKs,
        serverId = serverId ?: "sg",
        planTitle = planTitle,
        telegramId = telegramId,
        username = username,
        firstName = firstName,
        rejectReason = rejectReason,
        createdAt = createdAt,
        receiptTxId = receiptTxId?.takeIf { it.isNotBlank() },
        receiptNote = receiptNote?.takeIf { it.isNotBlank() },
        hasReceipt = hasReceipt,
        receiptUrl = receiptUrl?.takeIf { it.isNotBlank() },
        dataGb = dataGb,
        durationDays = durationDays,
        subDataLimitGb = subDataLimitGb,
        subDataUsedGb = subDataUsedGb,
        subDataLeftGb = subDataLeftGb,
        subExpiresAt = subExpiresAt,
        subDaysLeft = subDaysLeft,
        subIsActive = subIsActive,
    )
}

data class PaymentsPageDto(
    val items: List<PaymentDto> = emptyList(),
    val total: Int = 0,
    val page: Int = 1,
    @Json(name = "per_page") val perPage: Int = 20,
    @Json(name = "total_pages") val totalPages: Int = 1,
)

data class AccountDto(
    val id: Int,
    val method: String,
    @Json(name = "account_number") val accountNumber: String,
    @Json(name = "account_name") val accountName: String,
    @Json(name = "is_active") val isActive: Boolean = true,
) {
    fun toModel() = PaymentAccount(id, method, accountNumber, accountName, isActive)
}

data class AccountsDto(val accounts: List<AccountDto> = emptyList())
data class AccountWrapDto(val account: AccountDto)
data class AccountBody(
    val method: String,
    @Json(name = "account_number") val accountNumber: String,
    @Json(name = "account_name") val accountName: String,
    @Json(name = "is_active") val isActive: Boolean = true,
)

data class ServerDto(
    val id: String,
    @Json(name = "name_en") val nameEn: String? = null,
    @Json(name = "name_my") val nameMy: String? = null,
    @Json(name = "panel_url") val panelUrl: String? = null,
    @Json(name = "panel_username") val panelUsername: String? = null,
    @Json(name = "panel_password_set") val panelPasswordSet: Boolean = false,
    @Json(name = "panel_inbound_id") val panelInboundId: Int = 1,
    @Json(name = "panel_verify_ssl") val panelVerifySsl: Boolean = true,
    @Json(name = "vps_host") val vpsHost: String? = null,
    @Json(name = "vps_port") val vpsPort: Int = 443,
    @Json(name = "vless_security") val vlessSecurity: String? = null,
    @Json(name = "vless_flow") val vlessFlow: String? = null,
    @Json(name = "vless_sni") val vlessSni: String? = null,
    @Json(name = "vless_fp") val vlessFp: String? = null,
    @Json(name = "vless_pbk_set") val vlessPbkSet: Boolean = false,
    @Json(name = "vless_sid") val vlessSid: String? = null,
    @Json(name = "vless_spx") val vlessSpx: String? = null,
    val enabled: Boolean = true,
    @Json(name = "sort_order") val sortOrder: Int = 0,
    @Json(name = "panel_configured") val panelConfigured: Boolean = false,
    @Json(name = "plan_count") val planCount: Int = 0,
    val source: String? = null,
) {
    fun toModel() = VpnServerInfo(
        id = id,
        nameEn = nameEn.orEmpty(),
        nameMy = nameMy.orEmpty(),
        panelUrl = panelUrl.orEmpty(),
        panelUsername = panelUsername.orEmpty(),
        panelPasswordSet = panelPasswordSet,
        panelInboundId = panelInboundId,
        panelVerifySsl = panelVerifySsl,
        vpsHost = vpsHost.orEmpty(),
        vpsPort = vpsPort,
        vlessSecurity = vlessSecurity ?: "reality",
        vlessFlow = vlessFlow ?: "xtls-rprx-vision",
        vlessSni = vlessSni.orEmpty(),
        vlessFp = vlessFp ?: "chrome",
        vlessPbkSet = vlessPbkSet,
        vlessSid = vlessSid.orEmpty(),
        vlessSpx = vlessSpx ?: "/",
        enabled = enabled,
        sortOrder = sortOrder,
        panelConfigured = panelConfigured,
        planCount = planCount,
        source = source ?: "db",
    )
}

data class ServersDto(val servers: List<ServerDto> = emptyList())
data class ServerWrapDto(val server: ServerDto)

data class VpnNodeBody(
    val id: String,
    @Json(name = "name_en") val nameEn: String,
    @Json(name = "name_my") val nameMy: String = "",
    @Json(name = "panel_url") val panelUrl: String = "",
    @Json(name = "panel_username") val panelUsername: String = "",
    @Json(name = "panel_password") val panelPassword: String = "",
    @Json(name = "panel_inbound_id") val panelInboundId: Int = 1,
    @Json(name = "panel_verify_ssl") val panelVerifySsl: Boolean = true,
    @Json(name = "vps_host") val vpsHost: String = "",
    @Json(name = "vps_port") val vpsPort: Int = 443,
    @Json(name = "vless_security") val vlessSecurity: String = "reality",
    @Json(name = "vless_flow") val vlessFlow: String = "xtls-rprx-vision",
    @Json(name = "vless_sni") val vlessSni: String = "",
    @Json(name = "vless_fp") val vlessFp: String = "chrome",
    @Json(name = "vless_pbk") val vlessPbk: String = "",
    @Json(name = "vless_sid") val vlessSid: String = "",
    @Json(name = "vless_spx") val vlessSpx: String = "/",
    val enabled: Boolean = true,
    @Json(name = "sort_order") val sortOrder: Int = 0,
)

data class PlanDto(
    val id: Int,
    val title: String,
    @Json(name = "data_gb") val dataGb: Double = 0.0,
    @Json(name = "price_ks") val priceKs: Int = 0,
    @Json(name = "duration_days") val durationDays: Int = 30,
    @Json(name = "server_id") val serverId: String? = null,
    @Json(name = "sort_order") val sortOrder: Int = 0,
    @Json(name = "is_active") val isActive: Boolean = true,
) {
    fun toModel() = PlanItem(
        id = id,
        title = title,
        dataGb = dataGb,
        priceKs = priceKs,
        durationDays = durationDays,
        serverId = serverId ?: "sg",
        sortOrder = sortOrder,
        isActive = isActive,
    )
}

data class PlansDto(val plans: List<PlanDto> = emptyList())
data class PlanWrapDto(val plan: PlanDto)
data class PlanBody(
    val title: String,
    @Json(name = "data_gb") val dataGb: Double,
    @Json(name = "price_ks") val priceKs: Int,
    @Json(name = "duration_days") val durationDays: Int,
    @Json(name = "server_id") val serverId: String,
    @Json(name = "sort_order") val sortOrder: Int = 0,
    @Json(name = "is_active") val isActive: Boolean = true,
)

data class UserDto(
    @Json(name = "telegram_id") val telegramId: Long,
    val username: String? = null,
    @Json(name = "first_name") val firstName: String? = null,
    @Json(name = "is_banned") val isBanned: Int = 0,
    @Json(name = "free_keys") val freeKeys: Int = 0,
    @Json(name = "paid_keys") val paidKeys: Int = 0,
) {
    fun toModel() = UserItem(
        telegramId = telegramId,
        username = username,
        firstName = firstName,
        isBanned = isBanned != 0,
        freeKeys = freeKeys,
        paidKeys = paidKeys,
    )
}

data class UsersPageDto(
    val users: List<UserDto> = emptyList(),
    val total: Int = 0,
    val page: Int = 1,
    @Json(name = "per_page") val perPage: Int = 20,
    @Json(name = "total_pages") val totalPages: Int = 1,
)

data class SubscriptionDto(
    val id: Int,
    @Json(name = "telegram_id") val telegramId: Long = 0,
    val username: String? = null,
    @Json(name = "first_name") val firstName: String? = null,
    @Json(name = "plan_title") val planTitle: String? = null,
    @Json(name = "server_id") val serverId: String? = null,
    @Json(name = "is_free") val isFree: Boolean = false,
    @Json(name = "is_active") val isActive: Boolean = true,
    @Json(name = "data_limit_gb") val dataLimitGb: Double = 0.0,
    @Json(name = "data_used_gb") val dataUsedGb: Double = 0.0,
    @Json(name = "data_left_gb") val dataLeftGb: Double = 0.0,
    @Json(name = "expires_at") val expiresAt: String? = null,
    @Json(name = "days_left") val daysLeft: Int? = null,
    @Json(name = "vless_key") val vlessKey: String? = null,
    @Json(name = "subscription_url") val subscriptionUrl: String? = null,
    @Json(name = "payment_id") val paymentId: Int? = null,
) {
    fun toModel() = SubscriptionItem(
        id = id,
        telegramId = telegramId,
        username = username,
        firstName = firstName,
        planTitle = planTitle,
        serverId = serverId ?: "sg",
        isFree = isFree,
        isActive = isActive,
        dataLimitGb = dataLimitGb,
        dataUsedGb = dataUsedGb,
        dataLeftGb = dataLeftGb,
        expiresAt = expiresAt,
        daysLeft = daysLeft,
        vlessKey = vlessKey,
        subscriptionUrl = subscriptionUrl,
        paymentId = paymentId,
    )
}

data class UserSubsDto(
    @Json(name = "telegram_id") val telegramId: Long = 0,
    val subscriptions: List<SubscriptionDto> = emptyList(),
)

data class SubWrapDto(val status: String? = null, val subscription: SubscriptionDto? = null)

data class SubAdjustBody(
    @Json(name = "days_delta") val daysDelta: Int = 0,
    @Json(name = "data_gb_delta") val dataGbDelta: Double = 0.0,
    @Json(name = "set_data_gb") val setDataGb: Double? = null,
    @Json(name = "set_days_left") val setDaysLeft: Int? = null,
)

data class ReplaceKeyBody(
    @Json(name = "share_uri") val shareUri: String? = null,
)

data class ManualSubBody(
    @Json(name = "telegram_id") val telegramId: Long,
    @Json(name = "server_id") val serverId: String = "sg",
    @Json(name = "data_gb") val dataGb: Double,
    val days: Int,
    @Json(name = "plan_id") val planId: Int? = null,
    val notify: Boolean = false,
)

data class CatalogServerDto(
    val id: String,
    val name: String,
    val region: String? = null,
    val protocol: String? = null,
    val tier: String? = null,
    val enabled: Boolean = true,
    @Json(name = "sort_order") val sortOrder: Int = 0,
    @Json(name = "config_uri") val configUri: String? = null,
    @Json(name = "nodes_text") val nodesText: String? = null,
    @Json(name = "manual_data_gb") val manualDataGb: Double? = null,
    @Json(name = "manual_used_gb") val manualUsedGb: Double? = null,
    @Json(name = "manual_expire_at") val manualExpireAt: Long? = null,
    @Json(name = "list_when_disabled") val listWhenDisabled: Boolean = false,
    @Json(name = "ssh_host") val sshHost: String? = null,
    @Json(name = "ssh_port") val sshPort: Int? = null,
    @Json(name = "ssh_user") val sshUser: String? = null,
    @Json(name = "ssh_sni") val sshSni: String? = null,
    @Json(name = "ssh_tls") val sshTls: Boolean? = null,
    @Json(name = "ssh_allow_insecure") val sshAllowInsecure: Boolean? = null,
    @Json(name = "ssh_password_set") val sshPasswordSet: Boolean? = null,
) {
    fun toModel() = CatalogServer(
        id = id,
        name = name,
        region = region.orEmpty(),
        protocol = protocol ?: "vless",
        tier = tier ?: "free",
        enabled = enabled,
        sortOrder = sortOrder,
        configUri = configUri,
        nodesText = nodesText.orEmpty(),
        manualDataGb = manualDataGb,
        manualUsedGb = manualUsedGb,
        manualExpireAt = manualExpireAt,
        listWhenDisabled = listWhenDisabled,
        sshHost = sshHost.orEmpty(),
        sshPort = sshPort ?: 443,
        sshUser = sshUser.orEmpty(),
        sshSni = sshSni.orEmpty(),
        sshTls = sshTls ?: true,
        sshAllowInsecure = sshAllowInsecure ?: false,
        sshPasswordSet = sshPasswordSet ?: false,
    )
}

data class CatalogDto(
    val servers: List<CatalogServerDto> = emptyList(),
    val total: Int = 0,
    val page: Int = 1,
    @Json(name = "per_page") val perPage: Int = 20,
    @Json(name = "total_pages") val totalPages: Int = 1,
)
data class CatalogWrapDto(val server: CatalogServerDto)
data class CatalogIssueKeyBody(
    @Json(name = "server_id") val serverId: String,
    @Json(name = "data_gb") val dataGb: Double = 50.0,
    val days: Int = 30,
    val remark: String = "",
)
data class CatalogIssueKeyDto(
    @Json(name = "server_id") val serverId: String = "",
    val enabled: Boolean = true,
    @Json(name = "vless_key") val vlessKey: String = "",
    val uuid: String? = null,
    @Json(name = "panel_email") val panelEmail: String? = null,
    @Json(name = "data_gb") val dataGb: Double = 0.0,
    val days: Int = 0,
    val remark: String? = null,
)
data class CatalogBody(
    @Json(name = "public_id") val publicId: String,
    val name: String,
    val region: String = "",
    val protocol: String = "vless",
    val tier: String = "free",
    @Json(name = "config_uri") val configUri: String? = null,
    @Json(name = "nodes_text") val nodesText: String? = null,
    @Json(name = "manual_data_gb") val manualDataGb: Double? = null,
    @Json(name = "manual_used_gb") val manualUsedGb: Double? = null,
    @Json(name = "manual_expire_at") val manualExpireAt: Long? = null,
    @Json(name = "list_when_disabled") val listWhenDisabled: Boolean = false,
    val enabled: Boolean = true,
    @Json(name = "sort_order") val sortOrder: Int = 0,
    @Json(name = "ssh_host") val sshHost: String? = null,
    @Json(name = "ssh_port") val sshPort: Int? = null,
    @Json(name = "ssh_user") val sshUser: String? = null,
    @Json(name = "ssh_password") val sshPassword: String? = null,
    @Json(name = "ssh_sni") val sshSni: String? = null,
    @Json(name = "ssh_tls") val sshTls: Boolean? = null,
    @Json(name = "ssh_allow_insecure") val sshAllowInsecure: Boolean? = null,
)

data class AdDto(
    val id: String,
    val placement: String,
    val title: String? = null,
    @Json(name = "image_url") val imageUrl: String,
    @Json(name = "click_url") val clickUrl: String? = null,
    @Json(name = "image_width") val imageWidth: Int = 0,
    @Json(name = "image_height") val imageHeight: Int = 0,
    val enabled: Boolean = true,
    @Json(name = "sort_order") val sortOrder: Int = 0,
) {
    fun toModel() = AdItem(
        id = id,
        placement = placement,
        title = title.orEmpty(),
        imageUrl = imageUrl,
        clickUrl = clickUrl.orEmpty(),
        imageWidth = imageWidth,
        imageHeight = imageHeight,
        enabled = enabled,
        sortOrder = sortOrder,
    )
}

data class AdsDto(
    val ads: List<AdDto> = emptyList(),
    val total: Int = 0,
    val page: Int = 1,
    @Json(name = "per_page") val perPage: Int = 20,
    @Json(name = "total_pages") val totalPages: Int = 1,
)

data class AppConfigDto(
    @Json(name = "min_version_code") val minVersionCode: Int = 1,
    @Json(name = "latest_version_code") val latestVersionCode: Int = 1,
    @Json(name = "latest_version_name") val latestVersionName: String = "1.0.0",
    @Json(name = "force_update") val forceUpdate: Boolean = false,
    val changelog: String = "",
    val maintenance: Boolean = false,
    @Json(name = "maintenance_message") val maintenanceMessage: String = "",
    @Json(name = "telegram_url") val telegramUrl: String = "",
    @Json(name = "play_url") val playUrl: String = "",
    @Json(name = "update_url") val updateUrl: String = "",
    @Json(name = "buy_url") val buyUrl: String = "",
    @Json(name = "privacy_url") val privacyUrl: String = "",
    @Json(name = "updated_at") val updatedAt: String? = null,
) {
    fun toModel() = com.airvpn.admin.data.model.AppConfigSettings(
        minVersionCode = minVersionCode,
        latestVersionCode = latestVersionCode,
        latestVersionName = latestVersionName,
        forceUpdate = forceUpdate,
        changelog = changelog,
        maintenance = maintenance,
        maintenanceMessage = maintenanceMessage,
        telegramUrl = telegramUrl,
        playUrl = playUrl,
        updateUrl = updateUrl,
        buyUrl = buyUrl,
        privacyUrl = privacyUrl,
        updatedAt = updatedAt,
    )
}

data class AppConfigBody(
    @Json(name = "min_version_code") val minVersionCode: Int,
    @Json(name = "latest_version_code") val latestVersionCode: Int,
    @Json(name = "latest_version_name") val latestVersionName: String,
    @Json(name = "force_update") val forceUpdate: Boolean,
    val changelog: String,
    val maintenance: Boolean,
    @Json(name = "maintenance_message") val maintenanceMessage: String,
    @Json(name = "telegram_url") val telegramUrl: String,
    @Json(name = "play_url") val playUrl: String,
    @Json(name = "update_url") val updateUrl: String,
    @Json(name = "buy_url") val buyUrl: String,
    @Json(name = "privacy_url") val privacyUrl: String,
)

data class AppConfigWrapDto(
    val status: String? = null,
    val config: AppConfigDto = AppConfigDto(),
)

data class DauDeviceDto(
    @Json(name = "device_id") val deviceId: String = "",
    @Json(name = "first_seen_at") val firstSeenAt: String? = null,
) {
    fun toModel() = com.airvpn.admin.data.model.DauDevice(
        deviceId = deviceId,
        firstSeenAt = firstSeenAt,
    )
}

data class DauDto(
    val day: String = "",
    val count: Int = 0,
    val devices: List<DauDeviceDto> = emptyList(),
)

data class DeviceExclusiveDto(
    val id: Int = 0,
    @Json(name = "device_id") val deviceId: String = "",
    @Json(name = "public_id") val publicId: String = "",
    val name: String = "",
    val region: String = "",
    val protocol: String = "vless",
    @Json(name = "config_uri") val configUri: String = "",
    val note: String = "",
    val tier: String = "free",
    val enabled: Boolean = true,
    @Json(name = "created_at") val createdAt: String? = null,
    @Json(name = "updated_at") val updatedAt: String? = null,
) {
    fun toModel() = com.airvpn.admin.data.model.DeviceExclusiveKey(
        id = id,
        deviceId = deviceId,
        publicId = publicId,
        name = name,
        region = region,
        protocol = protocol,
        configUri = configUri,
        note = note,
        tier = tier.ifBlank { "free" },
        enabled = enabled,
        createdAt = createdAt,
        updatedAt = updatedAt,
    )
}

data class DeviceExclusiveBody(
    @Json(name = "device_id") val deviceId: String,
    val name: String,
    @Json(name = "config_uri") val configUri: String,
    val region: String = "",
    val protocol: String = "vless",
    val note: String = "",
    val tier: String = "free",
    @Json(name = "public_id") val publicId: String? = null,
    val enabled: Boolean = true,
)

data class DeviceKeysDto(
    val keys: List<DeviceExclusiveDto> = emptyList(),
    val total: Int = 0,
    val page: Int = 1,
    @Json(name = "per_page") val perPage: Int = 20,
    @Json(name = "total_pages") val totalPages: Int = 1,
)

data class DeviceKeyWrapDto(
    val status: String? = null,
    val key: DeviceExclusiveDto = DeviceExclusiveDto(),
)
data class AdWrapDto(val ad: AdDto)
data class AdBody(
    @Json(name = "public_id") val publicId: String,
    val placement: String,
    @Json(name = "image_url") val imageUrl: String,
    @Json(name = "click_url") val clickUrl: String = "",
    val title: String = "",
    @Json(name = "image_width") val imageWidth: Int = 0,
    @Json(name = "image_height") val imageHeight: Int = 0,
    val enabled: Boolean = true,
    @Json(name = "sort_order") val sortOrder: Int = 0,
)

data class AdPatchBody(
    val placement: String? = null,
    @Json(name = "image_url") val imageUrl: String? = null,
    @Json(name = "click_url") val clickUrl: String? = null,
    val title: String? = null,
    @Json(name = "image_width") val imageWidth: Int? = null,
    @Json(name = "image_height") val imageHeight: Int? = null,
    val enabled: Boolean? = null,
    @Json(name = "sort_order") val sortOrder: Int? = null,
)

data class UploadDto(
    @Json(name = "image_url") val imageUrl: String,
    val filename: String? = null,
    @Json(name = "image_width") val imageWidth: Int = 0,
    @Json(name = "image_height") val imageHeight: Int = 0,
)

data class BroadcastBody(
    val audience: String,
    val message: String,
)

data class BroadcastResultDto(
    val status: String? = null,
    val id: Int = 0,
    val audience: String? = null,
    val sent: Int = 0,
    val failed: Int = 0,
    val targets: Int = 0,
)

data class AudienceCountsDto(
    val all: Int = 0,
    val paid: Int = 0,
    val active: Int = 0,
)

data class NotificationDto(
    val id: Int,
    val audience: String? = null,
    val message: String? = null,
    @Json(name = "sent_by") val sentBy: Long? = null,
    @Json(name = "sent_count") val sentCount: Int = 0,
    @Json(name = "failed_count") val failedCount: Int = 0,
    @Json(name = "created_at") val createdAt: String? = null,
) {
    fun toModel() = NotificationItem(
        id = id,
        audience = audience.orEmpty(),
        message = message.orEmpty(),
        sentBy = sentBy,
        sentCount = sentCount,
        failedCount = failedCount,
        createdAt = createdAt,
    )
}

data class NotificationsDto(
    val audiences: AudienceCountsDto = AudienceCountsDto(),
    val notifications: List<NotificationDto> = emptyList(),
)

object ApiFactory {
    /** SQLite often returns 0/1 for booleans — accept both JSON forms. */
    private class TolerantBooleanAdapter {
        @FromJson
        fun fromJson(reader: JsonReader): Boolean {
            return when (reader.peek()) {
                JsonReader.Token.NULL -> {
                    reader.nextNull<Unit>()
                    false
                }
                JsonReader.Token.BOOLEAN -> reader.nextBoolean()
                JsonReader.Token.NUMBER -> reader.nextInt() != 0
                JsonReader.Token.STRING -> {
                    val s = reader.nextString().trim().lowercase()
                    s == "1" || s == "true" || s == "yes"
                }
                else -> {
                    reader.skipValue()
                    false
                }
            }
        }

        @ToJson
        fun toJson(writer: com.squareup.moshi.JsonWriter, value: Boolean) {
            writer.value(value)
        }
    }

    private val moshi: Moshi = Moshi.Builder()
        .add(TolerantBooleanAdapter())
        .add(KotlinJsonAdapterFactory())
        .build()

    private val client = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(180, TimeUnit.SECONDS)
        .writeTimeout(60, TimeUnit.SECONDS)
        .build()

    val api: AdminApi = Retrofit.Builder()
        .baseUrl(BuildConfig.API_BASE_URL)
        .client(client)
        .addConverterFactory(MoshiConverterFactory.create(moshi))
        .build()
        .create(AdminApi::class.java)

    fun auth(token: String) = "Bearer $token"

    fun imagePart(file: File): MultipartBody.Part {
        val name = file.name.lowercase()
        val mime = when {
            name.endsWith(".png") -> "image/png"
            name.endsWith(".webp") -> "image/webp"
            name.endsWith(".gif") -> "image/gif"
            name.endsWith(".jpg") || name.endsWith(".jpeg") -> "image/jpeg"
            else -> "image/*"
        }
        val body = file.asRequestBody(mime.toMediaTypeOrNull())
        return MultipartBody.Part.createFormData("file", file.name, body)
    }

    fun absoluteUrl(path: String): String {
        if (path.startsWith("http://") || path.startsWith("https://")) return path
        val base = BuildConfig.API_BASE_URL.trimEnd('/')
        return if (path.startsWith("/")) "$base$path" else "$base/$path"
    }
}
