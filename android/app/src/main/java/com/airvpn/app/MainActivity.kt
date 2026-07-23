package com.airvpn.app

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.net.VpnService
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Dns
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.Shield
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.lifecycle.viewmodel.compose.viewModel
import com.airvpn.app.data.model.AdCreative
import com.airvpn.app.ui.components.AirDialog
import com.airvpn.app.ui.components.AirToastHost
import com.airvpn.app.ui.components.ConnectAdDialog
import com.airvpn.app.ui.components.PrefetchAdImages
import com.airvpn.app.ui.info.InfoScreen
import com.airvpn.app.ui.main.MainScreen
import com.airvpn.app.ui.servers.ServersScreen
import com.airvpn.app.ui.theme.AirVpnTheme
import com.airvpn.app.ui.theme.Cyan
import com.airvpn.app.ui.theme.Hairline
import com.airvpn.app.ui.theme.InkMuted
import com.airvpn.app.ui.theme.Navy
import com.airvpn.app.ui.theme.SurfaceBg
import com.airvpn.app.vpn.AirVpnService
import com.airvpn.app.vpn.VpnState

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val importCode = intent?.data?.getQueryParameter("code")
            ?: intent?.data?.getQueryParameter("url")
        setContent {
            AirVpnTheme {
                AirVpnRoot(initialImportCode = importCode)
            }
        }
    }

    override fun onNewIntent(intent: android.content.Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
    }
}

private enum class Tab(val label: String) {
    Main("Main"),
    Servers("Servers"),
    Info("Info"),
}

@Composable
fun AirVpnRoot(initialImportCode: String?, vm: AirVpnViewModel = viewModel()) {
    var current by remember { mutableStateOf(Tab.Main) }
    val ui by vm.ui.collectAsState()
    val vpnState by AirVpnService.state.collectAsState()
    val vpnError by AirVpnService.errorMessage.collectAsState()
    val context = LocalContext.current
    val app = context.applicationContext as AirVpnApp
    var showDisclosure by remember { mutableStateOf(false) }
    var pendingConnect by remember { mutableStateOf(false) }
    var showConnectAd by remember { mutableStateOf(false) }
    var connectAdShown by remember { mutableStateOf(false) }
    var pendingConnectAd by remember { mutableStateOf<AdCreative?>(null) }
    var toastMessage by remember { mutableStateOf<String?>(null) }

    fun vpnBusy(): Boolean =
        vpnState == VpnState.Connected || vpnState == VpnState.Connecting

    fun warnDisconnectToSwitchServers() {
        toastMessage = "Please disconnect first to switch servers again."
    }

    val vpnPrepareLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.StartActivityForResult(),
    ) { result ->
        if (result.resultCode == Activity.RESULT_OK && pendingConnect) {
            pendingConnect = false
            vm.connectSelected(context)
        } else {
            pendingConnect = false
        }
    }

    val notificationPermission = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) {
        // Continue connect flow after notification prompt (ad already shown if needed)
        val prepare = VpnService.prepare(context)
        if (prepare != null) {
            pendingConnect = true
            vpnPrepareLauncher.launch(prepare)
        } else {
            vm.connectSelected(context)
        }
    }

    LaunchedEffect(Unit) {
        vm.bootstrap(app.session, context)
        if (!initialImportCode.isNullOrBlank()) {
            if (initialImportCode.contains("://")) {
                vm.importPaste(initialImportCode)
            }
        }
    }

    // Prefetch banner + dialog images on home so connect does not wait on download
    if (ui.showAds) {
        PrefetchAdImages(ui.appConfig.ads)
    }

    LaunchedEffect(vpnState) {
        when (vpnState) {
            VpnState.Connected -> {
                vm.onVpnConnected()
                connectAdShown = false
            }
            VpnState.Idle, VpnState.Error, VpnState.Disconnecting -> {
                vm.onVpnDisconnected()
                if (vpnState == VpnState.Idle || vpnState == VpnState.Error) {
                    connectAdShown = false
                }
            }
            else -> Unit
        }
    }

    fun proceedVpnPrepare() {
        if (Build.VERSION.SDK_INT >= 33) {
            val granted = ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.POST_NOTIFICATIONS,
            ) == PackageManager.PERMISSION_GRANTED
            if (!granted) {
                notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
                return
            }
        }
        val prepare = VpnService.prepare(context)
        if (prepare != null) {
            pendingConnect = true
            vpnPrepareLauncher.launch(prepare)
        } else {
            vm.connectSelected(context)
        }
    }

    fun requestConnect() {
        if (ui.forceUpdate || ui.maintenanceMode) return
        if (!app.session.disclosureAccepted) {
            showDisclosure = true
            return
        }
        val dialogAd = ui.randomDialogAd()
        if (dialogAd != null && !connectAdShown) {
            pendingConnectAd = dialogAd
            showConnectAd = true
            return
        }
        connectAdShown = false
        pendingConnectAd = null
        proceedVpnPrepare()
    }

    // --- Soft / force update notice (store / Telegram download link) ---
    if (ui.maintenanceMode) {
        val msg = ui.appConfig.maintenanceMessage.ifBlank {
            "AirVPN is under maintenance. Please try again later."
        }
        AirDialog(
            title = "Maintenance",
            onDismiss = { },
            confirmLabel = "OK",
            onConfirm = { },
            dismissLabel = null,
        ) {
            Text(msg)
        }
    } else if (ui.updateAvailable) {
        val cfg = ui.appConfig
        AirDialog(
            title = if (ui.forceUpdate) "Update required" else "Update available",
            onDismiss = { if (!ui.forceUpdate) vm.skipUpdate() },
            confirmLabel = "Download update",
            onConfirm = { vm.openUpdatePage(context) },
            dismissLabel = if (ui.forceUpdate) null else "Later",
        ) {
            Column {
                Text(
                    "AirVPN ${cfg.latestVersionName.ifBlank { cfg.latestVersionCode.toString() }} is ready.",
                )
                if (cfg.changelog.isNotBlank()) {
                    Spacer(Modifier.height(8.dp))
                    Text(cfg.changelog, color = InkMuted)
                }
            }
        }
    }

    // --- Announcement dialog (after update / maintenance handled) ---
    val ann = ui.pendingAnnouncement
    if (!ui.maintenanceMode && !ui.updateAvailable && ann != null) {
        AirDialog(
            title = ann.title.ifBlank { "Announcement" },
            onDismiss = {
                if (ann.dismissible) vm.dismissAnnouncement()
            },
            confirmLabel = ann.ctaLabel.ifBlank { "OK" },
            onConfirm = {
                if (ann.ctaUrl.isNotBlank()) {
                    vm.openUrl(context, ann.ctaUrl)
                }
                vm.dismissAnnouncement()
            },
            dismissLabel = if (ann.dismissible) "Dismiss" else null,
        ) {
            Text(ann.body)
        }
    }

    if (showDisclosure) {
        AirDialog(
            title = stringResource(R.string.vpn_disclosure_title),
            onDismiss = { showDisclosure = false },
            confirmLabel = stringResource(R.string.continue_connect),
            onConfirm = {
                app.session.disclosureAccepted = true
                showDisclosure = false
                requestConnect()
            },
            dismissLabel = stringResource(R.string.cancel),
        ) {
            Text(stringResource(R.string.vpn_disclosure_body))
        }
    }

    val connectAd = pendingConnectAd
    if (showConnectAd && connectAd != null) {
        ConnectAdDialog(
            ad = connectAd,
            onClickAd = {
                vm.trackAdClick(connectAd)
                if (connectAd.clickUrl.isNotBlank()) {
                    vm.openUrl(context, connectAd.clickUrl)
                }
            },
            onFinished = {
                showConnectAd = false
                connectAdShown = true
                pendingConnectAd = null
                proceedVpnPrepare()
            },
        )
    }

    fun goToTab(tab: Tab) {
        // Keep VPN up when browsing tabs; only the connect button disconnects.
        current = tab
    }

    Box(modifier = Modifier.fillMaxSize()) {
        Scaffold(
            containerColor = SurfaceBg,
            contentWindowInsets = WindowInsets(0, 0, 0, 0),
            bottomBar = {
                if (!ui.forceUpdate && !ui.maintenanceMode) {
                    HorizontalDivider(thickness = 1.dp, color = Hairline)
                    NavigationBar(
                        containerColor = SurfaceBg,
                        tonalElevation = 0.dp,
                    ) {
                        Tab.entries.forEach { tab ->
                            val selected = current == tab
                            NavigationBarItem(
                                selected = selected,
                                onClick = { goToTab(tab) },
                                icon = {
                                    Icon(
                                        when (tab) {
                                            Tab.Main -> Icons.Outlined.Shield
                                            Tab.Servers -> Icons.Outlined.Dns
                                            Tab.Info -> Icons.Outlined.Info
                                        },
                                        contentDescription = tab.label,
                                    )
                                },
                                label = {
                                    Text(
                                        text = tab.label,
                                        fontWeight = if (selected) {
                                            FontWeight.SemiBold
                                        } else {
                                            FontWeight.Normal
                                        },
                                    )
                                },
                                colors = NavigationBarItemDefaults.colors(
                                    selectedIconColor = Navy,
                                    selectedTextColor = Navy,
                                    indicatorColor = Cyan.copy(alpha = 0.10f),
                                    unselectedIconColor = InkMuted,
                                    unselectedTextColor = InkMuted,
                                ),
                            )
                        }
                    }
                }
            },
        ) { padding ->
            val contentModifier = Modifier
                .padding(padding)
                .statusBarsPadding()

            when (current) {
                Tab.Main -> MainScreen(
                    modifier = contentModifier,
                    vpnState = vpnState,
                    selectedServer = ui.selectedServer,
                    statusLine = when {
                        vpnState == VpnState.Error && !vpnError.isNullOrBlank() -> vpnError!!
                        else -> ui.statusMessage
                    },
                    pingMs = ui.selectedServer?.id?.let { ui.pings[it] },
                    bannerAds = ui.bannerAds,
                    onAdClick = { ad ->
                        vm.trackAdClick(ad)
                        ad.clickUrl.takeIf { it.isNotBlank() }?.let { vm.openUrl(context, it) }
                    },
                    onOpenServers = { goToTab(Tab.Servers) },
                    onToggle = {
                        if (vpnBusy()) {
                            vm.disconnect(context)
                        } else {
                            if (vpnState == VpnState.Error) AirVpnService.clearError()
                            requestConnect()
                        }
                    },
                )
                Tab.Servers -> ServersScreen(
                    modifier = contentModifier,
                    catalog = ui.catalog,
                    selectedId = ui.selectedServer?.id,
                    loading = ui.loadingServers,
                    importing = ui.importing,
                    importError = ui.importError,
                    subscriptions = ui.subscriptions,
                    pings = ui.pings,
                    pinging = ui.pinging,
                    onAppear = { vm.onServersTabOpened() },
                    onRefresh = { vm.refreshServers() },
                    onSelect = { item ->
                        if (vpnBusy() && item.id != ui.selectedServer?.id) {
                            warnDisconnectToSwitchServers()
                        } else if (!vpnBusy()) {
                            vm.selectServer(item)
                        }
                    },
                    onImportPaste = { vm.importPaste(it) },
                    onRefreshSubscription = { vm.refreshSubscription() },
                    onDeleteImported = { vm.deleteImportedServer(it) },
                    onRemoveSubscription = { vm.removeSubscription(it) },
                    onBuyPaid = { server ->
                        val url = server.buyUrl
                            ?.takeIf { it.isNotBlank() }
                            ?: ui.appConfig.buyUrl.ifBlank { ui.appConfig.telegramUrl }
                                .ifBlank { BuildConfig.TELEGRAM_URL }
                        vm.openUrl(context, url)
                    },
                )
                Tab.Info -> InfoScreen(
                    modifier = contentModifier,
                    profile = ui.profile,
                    activated = !ui.token.isNullOrBlank(),
                    subscriptions = ui.subscriptions,
                    telegramUrl = ui.appConfig.telegramUrl.ifBlank { BuildConfig.TELEGRAM_URL },
                    privacyUrl = ui.appConfig.privacyUrl.ifBlank { BuildConfig.PRIVACY_URL },
                    versionName = BuildConfig.VERSION_NAME,
                    versionCode = BuildConfig.VERSION_CODE,
                    latestVersionName = ui.appConfig.latestVersionName,
                    updateAvailable = ui.updateAvailable ||
                        BuildConfig.VERSION_CODE < ui.appConfig.latestVersionCode,
                    onOpenUrl = { vm.openUrl(context, it) },
                    onCheckUpdate = { vm.openUpdatePage(context) },
                    onClear = { vm.clearSession() },
                    onClearSubscription = { vm.clearSubscription() },
                    onRemoveSubscription = { vm.removeSubscription(it) },
                )
            }
        }

        AirToastHost(
            message = toastMessage,
            onDismiss = { toastMessage = null },
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .padding(bottom = if (ui.forceUpdate || ui.maintenanceMode) 12.dp else 80.dp),
        )
    }
}
