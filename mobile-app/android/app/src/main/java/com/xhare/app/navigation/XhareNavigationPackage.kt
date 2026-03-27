package com.xhare.app.navigation

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider
import com.facebook.react.uimanager.ViewManager

class XhareNavigationPackage : BaseReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
    if (name == XhareNavigationModule.NAME) {
      XhareNavigationModule(reactContext)
    } else {
      null
    }

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider =
    ReactModuleInfoProvider {
      mapOf(
        XhareNavigationModule.NAME to
          ReactModuleInfo(
            XhareNavigationModule.NAME,
            XhareNavigationModule::class.java.name,
            false,
            false,
            false,
            false,
          )
      )
    }

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
    emptyList()
}
