package com.airvpn.app

import android.app.Application
import com.airvpn.app.data.local.SessionStore

class AirVpnApp : Application() {
    lateinit var session: SessionStore
        private set

    override fun onCreate() {
        super.onCreate()
        session = SessionStore(this)
    }
}
