package com.xhare.app.navigation

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.module.annotations.ReactModule

/**
 * Abre ACTION_VIEW con [Intent.setPackage] para Maps/Waze/Chrome sin chooser "Abrir con"
 * y sin el ciclo startActivityForResult de expo-intent-launcher (evita estado bloqueado y mensajes falsos).
 */
@ReactModule(name = XhareNavigationModule.NAME)
class XhareNavigationModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = NAME

  @ReactMethod
  fun openViewUriInPackage(uriString: String, packageName: String, promise: Promise) {
    try {
      val uri = Uri.parse(uriString)
      val intent =
        Intent(Intent.ACTION_VIEW, uri).apply {
          setPackage(packageName)
          addCategory(Intent.CATEGORY_BROWSABLE)
        }
      val activity = reactApplicationContext.currentActivity
      if (activity != null) {
        activity.startActivity(intent)
      } else {
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        reactApplicationContext.applicationContext.startActivity(intent)
      }
      promise.resolve(true)
    } catch (_: ActivityNotFoundException) {
      promise.resolve(false)
    } catch (e: Exception) {
      promise.reject(NAV_ERROR_CODE, e.message, e)
    }
  }

  companion object {
    const val NAME = "XhareNavigation"
    const val NAV_ERROR_CODE = "E_XHARE_NAV"
  }
}
