package com.airvpn.app.data.api

import com.airvpn.app.BuildConfig
import com.airvpn.app.data.model.AdCreative
import com.airvpn.app.data.model.Announcement
import com.airvpn.app.data.model.AppConfig
import com.airvpn.app.data.model.ConnectResponse
import com.airvpn.app.data.model.ServerCatalog
import com.airvpn.app.data.model.ServerPlan
import com.airvpn.app.data.model.UserProfile
import com.airvpn.app.data.model.VpnServerItem
import com.squareup.moshi.Json
import com.squareup.moshi.Moshi
import com.squareup.moshi.kotlin.reflect.KotlinJsonAdapterFactory
import okhttp3.OkHttpClient
import retrofit2.Retrofit
import retrofit2.converter.moshi.MoshiConverterFactory
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.POST
import java.util.concurrent.TimeUnit

data class AppConfigDto(
    @Json(name = "min_version_code") val minVersionCode: Int = 1,
    @Json(name = "latest_version_code") val latestVersionCode: Int = 1,
    @Json(name = "latest_version_name") val latestVersionName: String = "",
    @Json(name = "force_update") val forceUpdate: Boolean = false,
    val changelog: String = "",
    @Json(name = "telegram_url") val telegramUrl: String = "",
    @Json(name = "play_url") val playUrl: String = "",
    @Json(name = "buy_url") val buyUrl: String = "",
    @Json(name = "privacy_url") val privacyUrl: String = "",
    val maintenance: Boolean = false,
    val announcements: List<AnnouncementDto> = emptyList(),
    val ads: List<AdDto> = emptyList(),
)

data class AnnouncementDto(
    val id: String = "",
    val title: String = "",
    val body: String = "",
    val level: String = "info",
    val dismissible: Boolean = true,
    @Json(name = "cta_label") val ctaLabel: String = "",
    @Json(name = "cta_url") val ctaUrl: String = "",
)

data class AdDto(
    val id: String = "",
    val placement: String = "banner",
    val title: String = "",
    @Json(name = "image_url") val imageUrl: String = "",
    @Json(name = "click_url") val clickUrl: String = "",
    val width: Int = 0,
    val height: Int = 0,
)

data class PlanDto(
    val title: String? = null,
    @Json(name = "price_ks") val priceKs: Int? = null,
    @Json(name = "data_gb") val dataGb: Double? = null,
    @Json(name = "duration_days") val durationDays: Int? = null,
)

data class ServerDto(
    val id: String,
    val name: String,
    val region: String = "",
    val protocol: String = "vless",
    val tag: String = "Vless",
    val tier: String = "free",
    val plan: PlanDto? = null,
    val plans: List<PlanDto> = emptyList(),
    @Json(name = "buy_url") val buyUrl: String? = null,
    val online: Boolean = true,
    val host: String? = null,
    val port: Int = 0,
    @Json(name = "parent_id") val parentId: String = "",
    @Json(name = "from_subscription") val fromSubscription: Boolean = false,
)

data class FreeSubscriptionDto(
    val id: String,
    val name: String = "",
    val upload: Long = 0,
    val download: Long = 0,
    val total: Long = 0,
    val expire: Long = 0,
    @Json(name = "node_count") val nodeCount: Int = 0,
)

data class ServersDto(
    val free: List<ServerDto> = emptyList(),
    val paid: List<ServerDto> = emptyList(),
    @Json(name = "free_subscriptions") val freeSubscriptions: List<FreeSubscriptionDto> = emptyList(),
)

data class ProfileDto(
    @Json(name = "user_id") val userId: Int = 0,
    @Json(name = "has_paid") val hasPaid: Boolean = false,
    @Json(name = "data_used_gb") val dataUsedGb: Double = 0.0,
    @Json(name = "data_limit_gb") val dataLimitGb: Double = 0.0,
    @Json(name = "expires_at") val expiresAt: String? = null,
)

data class ImportBody(val code: String)
data class ImportDto(val token: String, val profile: ProfileDto)
data class MeDto(val profile: ProfileDto)
data class ConnectBody(@Json(name = "server_id") val serverId: String)
data class AnalyticsEventBody(
    val event: String,
    @Json(name = "device_id") val deviceId: String,
    @Json(name = "ad_id") val adId: String = "",
    val placement: String = "",
)
data class AnalyticsEventDto(val ok: Boolean = false, val event: String = "")
data class PayloadDto(
    val alg: String,
    val nonce: String,
    val ciphertext: String,
    @Json(name = "expires_at") val expiresAt: Long,
)
data class ConnectDto(
    @Json(name = "server_id") val serverId: String,
    val protocol: String,
    val payload: PayloadDto,
)

interface AirVpnApi {
    @GET("v1/app/config")
    suspend fun appConfig(): AppConfigDto

    @GET("v1/servers")
    suspend fun servers(): ServersDto

    @POST("v1/import")
    suspend fun importCode(@Body body: ImportBody): ImportDto

    @GET("v1/me")
    suspend fun me(@Header("Authorization") authorization: String): MeDto

    @POST("v1/connect")
    suspend fun connect(
        @Header("Authorization") authorization: String?,
        @Body body: ConnectBody,
    ): ConnectDto

    @POST("v1/analytics/event")
    suspend fun trackEvent(@Body body: AnalyticsEventBody): AnalyticsEventDto
}

object ApiFactory {
    private val moshi = Moshi.Builder().add(KotlinJsonAdapterFactory()).build()

    private val client = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

    val api: AirVpnApi = Retrofit.Builder()
        .baseUrl(BuildConfig.API_BASE_URL)
        .client(client)
        .addConverterFactory(MoshiConverterFactory.create(moshi))
        .build()
        .create(AirVpnApi::class.java)

    fun absoluteUrl(path: String): String {
        val t = path.trim()
        if (t.isEmpty()) return t
        if (t.startsWith("http://", ignoreCase = true) ||
            t.startsWith("https://", ignoreCase = true)
        ) {
            return t
        }
        val base = BuildConfig.API_BASE_URL.trimEnd('/')
        return if (t.startsWith("/")) "$base$t" else "$base/$t"
    }
}

fun AppConfigDto.toModel() = AppConfig(
    minVersionCode = minVersionCode,
    latestVersionCode = latestVersionCode,
    latestVersionName = latestVersionName,
    forceUpdate = forceUpdate,
    changelog = changelog,
    telegramUrl = telegramUrl,
    playUrl = playUrl,
    buyUrl = buyUrl,
    privacyUrl = privacyUrl,
    maintenance = maintenance,
    announcements = announcements.map { it.toModel() }.filter { it.id.isNotBlank() },
    ads = ads.map { it.toModel() }.filter { it.id.isNotBlank() && it.imageUrl.isNotBlank() },
)

fun AnnouncementDto.toModel() = Announcement(
    id = id,
    title = title,
    body = body,
    level = level,
    dismissible = dismissible,
    ctaLabel = ctaLabel,
    ctaUrl = ctaUrl,
)

fun AdDto.toModel() = AdCreative(
    id = id,
    placement = placement.ifBlank { "banner" },
    title = title,
    imageUrl = ApiFactory.absoluteUrl(imageUrl),
    clickUrl = clickUrl,
    width = width,
    height = height,
)

fun PlanDto.toModel() = ServerPlan(title, priceKs, dataGb, durationDays)
fun FreeSubscriptionDto.toModel() = com.airvpn.app.data.model.SubscriptionInfo(
    url = "catalog://$id",
    name = name,
    uploadBytes = upload,
    downloadBytes = download,
    totalBytes = total,
    expireAt = expire,
    nodeCount = nodeCount,
    lastFetchedAt = System.currentTimeMillis() / 1000,
)

fun ServerDto.toModel(): VpnServerItem {
    val mappedPlans = plans.map { it.toModel() }.ifEmpty {
        listOfNotNull(plan?.toModel())
    }
    val parent = parentId.trim()
    val isSub = fromSubscription || parent.isNotBlank()
    return VpnServerItem(
        id = id,
        name = name,
        region = region,
        protocol = protocol,
        tag = tag,
        tier = tier,
        plan = mappedPlans.firstOrNull() ?: plan?.toModel(),
        plans = mappedPlans,
        buyUrl = buyUrl,
        online = online,
        host = host?.takeIf { it.isNotBlank() },
        port = if (port > 0) port else 0,
        fromSubscription = isSub,
        subscriptionUrl = if (isSub && parent.isNotBlank()) "catalog://$parent" else null,
    )
}
fun ServersDto.toModel() = ServerCatalog(
    free = free.map { it.toModel() },
    paid = paid.map { it.toModel() },
    freeSubscriptions = freeSubscriptions.map { it.toModel() },
)
fun ProfileDto.toModel() = UserProfile(userId, hasPaid, dataUsedGb, dataLimitGb, expiresAt)
fun ConnectDto.toModel() = ConnectResponse(
    serverId,
    protocol,
    com.airvpn.app.data.model.ConnectPayload(
        payload.alg,
        payload.nonce,
        payload.ciphertext,
        payload.expiresAt,
    ),
)
