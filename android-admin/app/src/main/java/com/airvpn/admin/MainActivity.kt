package com.airvpn.admin

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.SizeTransform
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.core.view.WindowCompat
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ListAlt
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material.icons.outlined.AccountBalanceWallet
import androidx.compose.material.icons.outlined.Campaign
import androidx.compose.material.icons.outlined.Dashboard
import androidx.compose.material.icons.outlined.Dns
import androidx.compose.material.icons.outlined.NotificationsActive
import androidx.compose.material.icons.outlined.Payments
import androidx.compose.material.icons.outlined.People
import androidx.compose.material.icons.outlined.PhoneAndroid
import androidx.compose.material.icons.outlined.Devices
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.pulltorefresh.rememberPullToRefreshState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.lifecycle.viewmodel.compose.viewModel
import com.airvpn.admin.ui.accounts.AccountsScreen
import com.airvpn.admin.ui.ads.AdsScreen
import com.airvpn.admin.ui.appconfig.AppConfigScreen
import com.airvpn.admin.ui.catalog.CatalogScreen
import com.airvpn.admin.ui.components.AdminBottomNav
import com.airvpn.admin.ui.components.AdminNavItem
import com.airvpn.admin.ui.components.AdminTopChrome
import com.airvpn.admin.ui.components.LoadingTopBar
import com.airvpn.admin.ui.components.ShimmerList
import com.airvpn.admin.ui.dashboard.DashboardScreen
import com.airvpn.admin.ui.devices.DevicesScreen
import com.airvpn.admin.ui.login.LoginScreen
import com.airvpn.admin.ui.notify.NotifyScreen
import com.airvpn.admin.ui.payments.PaymentsScreen
import com.airvpn.admin.ui.servers.ServersPlansScreen
import com.airvpn.admin.ui.theme.AirVpnAdminTheme
import com.airvpn.admin.ui.theme.Navy
import com.airvpn.admin.ui.theme.SurfaceBg
import com.airvpn.admin.ui.users.UsersScreen

private val TabAirEase = CubicBezierEasing(0.16f, 1f, 0.3f, 1f)

class MainActivity : ComponentActivity() {
    private var viewModel: AdminViewModel? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        WindowCompat.getInsetsController(window, window.decorView).apply {
            isAppearanceLightStatusBars = true
            isAppearanceLightNavigationBars = true
        }
        setContent {
            AirVpnAdminTheme {
                val vm: AdminViewModel = viewModel()
                viewModel = vm
                LaunchedEffect(intent) {
                    handleLoginIntent(intent, vm)
                }
                AdminRoot(vm)
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        viewModel?.let { handleLoginIntent(intent, it) }
    }

    companion object {
        fun handleLoginIntent(intent: Intent?, vm: AdminViewModel) {
            val uri = intent?.data ?: return
            parseLoginUri(uri)?.let { (tid, code) ->
                vm.applyLoginDeepLink(tid, code)
            }
        }

        fun parseLoginUri(uri: Uri): Pair<Long, String>? {
            val tid = (
                uri.getQueryParameter("tid")
                    ?: uri.getQueryParameter("telegram_id")
                    ?: ""
            ).filter { it.isDigit() }.toLongOrNull() ?: return null
            val code = (
                uri.getQueryParameter("code")
                    ?: uri.getQueryParameter("otp")
                    ?: ""
            ).filter { it.isDigit() }
            if (tid <= 0 || code.length < 4) return null
            return tid to code
        }
    }
}

private enum class AdminTab(val label: String, val icon: ImageVector) {
    Dashboard("Home", Icons.Outlined.Dashboard),
    Payments("Pay", Icons.Outlined.Payments),
    Users("Users", Icons.Outlined.People),
    Notify("Notify", Icons.Outlined.NotificationsActive),
    Accounts("Accts", Icons.Outlined.AccountBalanceWallet),
    Servers("Plans", Icons.Outlined.Dns),
    Catalog("Catalog", Icons.AutoMirrored.Outlined.ListAlt),
    Ads("Ads", Icons.Outlined.Campaign),
    App("App", Icons.Outlined.PhoneAndroid),
    Devices("Devices", Icons.Outlined.Devices),
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AdminRoot(vm: AdminViewModel) {
    val state by vm.state.collectAsState()
    val snack = remember { SnackbarHostState() }
    var tab by remember { mutableStateOf(AdminTab.Dashboard) }
    val navItems = remember {
        AdminTab.entries.map { AdminNavItem(it.name, it.label, it.icon) }
    }

    LaunchedEffect(state.message, state.error) {
        state.message?.let {
            snack.showSnackbar(it)
            vm.clearFlash()
        }
        state.error?.let {
            snack.showSnackbar(it)
            vm.clearFlash()
        }
    }

    LaunchedEffect(
        state.booting,
        state.loggedIn,
        state.pendingLoginTid,
        state.pendingLoginCode,
    ) {
        if (!state.booting && !state.loggedIn &&
            state.pendingLoginTid != null &&
            !state.pendingLoginCode.isNullOrBlank()
        ) {
            vm.loginFromPendingDeepLink()
        }
    }

    when {
        state.booting -> {
            Box(
                Modifier
                    .fillMaxSize()
                    .background(SurfaceBg)
                    .statusBarsPadding(),
                contentAlignment = Alignment.Center,
            ) {
                CircularProgressIndicator(color = Navy)
            }
        }
        !state.loggedIn -> {
            LoginScreen(
                loading = state.loading,
                error = state.error,
                initialTelegramId = state.pendingLoginTid ?: state.telegramId.takeIf { it > 0 },
                initialCode = state.pendingLoginCode,
                onLogin = vm::login,
            )
        }
        else -> {
            Scaffold(
                containerColor = SurfaceBg,
                contentWindowInsets = WindowInsets(0, 0, 0, 0),
                topBar = {
                    Column {
                        AdminTopChrome(
                            title = "AirVPN Admin",
                            subtitle = state.telegramId.toString(),
                            onRefresh = { vm.pullRefresh() },
                            onLogout = { vm.logout() },
                            refreshIcon = Icons.Outlined.Refresh,
                            logoutIcon = Icons.AutoMirrored.Outlined.Logout,
                        )
                        LoadingTopBar(visible = state.refreshing || state.loading)
                    }
                },
                bottomBar = {
                    AdminBottomNav(
                        items = navItems,
                        selectedKey = tab.name,
                        onSelect = { key ->
                            AdminTab.entries.find { it.name == key }?.let { next ->
                                tab = next
                                if (next == AdminTab.Catalog && state.servers.isEmpty()) {
                                    vm.refreshServersPlans()
                                }
                            }
                        },
                    )
                },
                snackbarHost = { SnackbarHost(snack) },
            ) { padding ->
                val pullState = rememberPullToRefreshState()
                PullToRefreshBox(
                    isRefreshing = state.refreshing,
                    onRefresh = { vm.pullRefresh() },
                    state = pullState,
                    modifier = Modifier
                        .padding(padding)
                        .fillMaxSize(),
                ) {
                    val showShimmer = state.refreshing && when (tab) {
                        AdminTab.Dashboard -> false
                        AdminTab.Payments -> state.payments.isEmpty()
                        AdminTab.Accounts -> state.accounts.isEmpty()
                        AdminTab.Servers -> state.servers.isEmpty() && state.plans.isEmpty()
                        AdminTab.Users -> state.users.isEmpty()
                        AdminTab.Notify -> false
                        AdminTab.Catalog -> state.catalog.isEmpty()
                        AdminTab.Ads -> state.ads.isEmpty()
                        AdminTab.App -> state.appConfig == null
                        AdminTab.Devices -> state.deviceKeys.isEmpty() && state.dauDevices.isEmpty()
                    }
                    if (showShimmer) {
                        ShimmerList(count = 5, modifier = Modifier.fillMaxSize())
                    } else {
                        AnimatedContent(
                            targetState = tab,
                            modifier = Modifier.fillMaxSize(),
                            transitionSpec = {
                                val forward = targetState.ordinal >= initialState.ordinal
                                // Feather-light drift + soft crossfade (no spring overshoot).
                                val enter = if (forward) 0.045f else -0.045f
                                val exit = if (forward) -0.03f else 0.03f
                                (
                                    fadeIn(animationSpec = tween(420, easing = TabAirEase)) +
                                        slideInHorizontally(
                                            animationSpec = tween(460, easing = TabAirEase),
                                        ) { full -> (full * enter).toInt() }
                                    togetherWith
                                        fadeOut(animationSpec = tween(260, easing = FastOutSlowInEasing)) +
                                        slideOutHorizontally(
                                            animationSpec = tween(300, easing = FastOutSlowInEasing),
                                        ) { full -> (full * exit).toInt() }
                                    ).using(SizeTransform(clip = false))
                            },
                            label = "adminTabFlow",
                        ) { current ->
                            val mod = Modifier.fillMaxSize()
                            when (current) {
                                AdminTab.Dashboard -> DashboardScreen(state.stats, mod)
                                AdminTab.Payments -> PaymentsScreen(
                                    payments = state.payments,
                                    filter = state.paymentFilter,
                                    authToken = state.authToken,
                                    loadingMore = state.paymentsLoadingMore,
                                    canLoadMore = state.paymentsCanLoadMore,
                                    onFilter = vm::setPaymentFilter,
                                    onApprove = vm::approvePayment,
                                    onReject = vm::rejectPayment,
                                    onLoadMore = vm::loadMorePayments,
                                    modifier = mod,
                                )
                                AdminTab.Accounts -> AccountsScreen(
                                    accounts = state.accounts,
                                    onSave = vm::saveAccount,
                                    onToggle = vm::setAccountActive,
                                    modifier = mod,
                                )
                                AdminTab.Servers -> ServersPlansScreen(
                                    servers = state.servers,
                                    plans = state.plans,
                                    onSaveServer = vm::saveServer,
                                    onToggleServer = vm::setServerEnabled,
                                    onDeleteServer = vm::deleteServer,
                                    onSavePlan = vm::savePlan,
                                    onTogglePlan = vm::setPlanActive,
                                    onDeletePlan = vm::deletePlan,
                                    modifier = mod,
                                )
                                AdminTab.Users -> UsersScreen(
                                    users = state.users,
                                    query = state.userQuery,
                                    onQueryChange = vm::setUserQuery,
                                    onSearch = { vm.refreshUsers(reset = true) },
                                    onBan = vm::banUser,
                                    managedTelegramId = state.managedTelegramId,
                                    managedSubs = state.managedSubs,
                                    lastCreatedKey = state.lastCreatedKey,
                                    lastCreatedSubUrl = state.lastCreatedSubUrl,
                                    serverIds = state.servers.map { it.id },
                                    onManage = vm::openUserKeys,
                                    onCloseManage = vm::closeUserKeys,
                                    onAdjust = { id, days, gb ->
                                        vm.adjustSubscription(id, daysDelta = days, dataGbDelta = gb)
                                    },
                                    onSetQuota = { id, gb, days ->
                                        vm.adjustSubscription(
                                            id,
                                            setDataGb = gb,
                                            setDaysLeft = days,
                                        )
                                    },
                                    onReplaceKey = { id, uri ->
                                        vm.replaceSubscriptionKey(id, uri)
                                    },
                                    onRemoveKey = vm::removeSubscriptionKey,
                                    onCreateKey = { tid, server, gb, days, notify ->
                                        vm.createManualSubscription(tid, server, gb, days, notify)
                                    },
                                    onClearCreatedFlash = vm::clearCreatedKeyFlash,
                                    loadingMore = state.usersLoadingMore,
                                    canLoadMore = state.usersCanLoadMore,
                                    onLoadMore = vm::loadMoreUsers,
                                    modifier = mod,
                                )
                                AdminTab.Notify -> NotifyScreen(
                                    audience = state.notifyAudience,
                                    message = state.notifyMessage,
                                    sending = state.notifySending,
                                    counts = state.audienceCounts,
                                    history = state.notifications,
                                    onAudienceChange = vm::setNotifyAudience,
                                    onMessageChange = vm::setNotifyMessage,
                                    onSend = vm::sendBroadcast,
                                    modifier = mod,
                                )
                                AdminTab.Catalog -> CatalogScreen(
                                    servers = state.catalog,
                                    vpnNodes = state.servers,
                                    issuedKey = state.issuedCatalogKey,
                                    issuingKey = state.issuingCatalogKey,
                                    loadingMore = state.catalogLoadingMore,
                                    canLoadMore = state.catalogCanLoadMore,
                                    onSave = vm::saveCatalog,
                                    onIssueKey = { ids, gb, days, remark ->
                                        vm.issueCatalogKeys(ids, gb, days, remark)
                                    },
                                    onConsumeIssuedKey = vm::consumeIssuedCatalogKey,
                                    onToggle = vm::setCatalogEnabled,
                                    onDelete = vm::deleteCatalog,
                                    onLoadMore = vm::loadMoreCatalog,
                                    modifier = mod,
                                )
                                AdminTab.Ads -> AdsScreen(
                                    ads = state.ads,
                                    loadingMore = state.adsLoadingMore,
                                    canLoadMore = state.adsCanLoadMore,
                                    onSave = vm::saveAd,
                                    onToggle = vm::setAdEnabled,
                                    onDelete = vm::deleteAd,
                                    onUpload = vm::uploadAdImage,
                                    onLoadMore = vm::loadMoreAds,
                                    modifier = mod,
                                )
                                AdminTab.App -> AppConfigScreen(
                                    config = state.appConfig,
                                    saving = state.appConfigSaving,
                                    onSave = vm::saveAppConfig,
                                    modifier = mod,
                                )
                                AdminTab.Devices -> DevicesScreen(
                                    keys = state.deviceKeys,
                                    dauDevices = state.dauDevices,
                                    dauDay = state.dauDay,
                                    dauCount = state.dauCount,
                                    onSaveKey = vm::saveDeviceKey,
                                    onToggleKey = vm::setDeviceKeyEnabled,
                                    onDeleteKey = vm::deleteDeviceKey,
                                    onRefreshDau = vm::refreshDau,
                                    modifier = mod,
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}
