package com.airvpn.app.util

import android.content.Context
import coil.imageLoader
import coil.request.CachePolicy
import coil.request.ImageRequest
import com.airvpn.app.data.model.AdCreative
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** Warm Coil memory/disk cache for banner + dialog creatives. */
object AdImagePrefetcher {
    suspend fun prefetch(context: Context, ads: List<AdCreative>) {
        if (ads.isEmpty()) return
        val app = context.applicationContext
        val loader = app.imageLoader
        withContext(Dispatchers.IO) {
            for (ad in ads) {
                val url = ad.imageUrl.trim()
                if (url.isBlank()) continue
                runCatching {
                    val request = ImageRequest.Builder(app)
                        .data(url)
                        .memoryCachePolicy(CachePolicy.ENABLED)
                        .diskCachePolicy(CachePolicy.ENABLED)
                        .build()
                    loader.execute(request)
                }
            }
        }
    }
}
