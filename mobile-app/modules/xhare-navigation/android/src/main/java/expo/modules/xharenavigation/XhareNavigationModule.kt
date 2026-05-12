package expo.modules.xharenavigation

import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class XhareNavigationModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("XhareNavigation")

    AsyncFunction("openViewUriInPackage") { url: String, packageName: String ->
      val context = appContext.reactContext ?: return@AsyncFunction false
      return@AsyncFunction try {
        val uri = Uri.parse(url)
        val intent = Intent(Intent.ACTION_VIEW, uri).apply {
          setPackage(packageName)
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        val pm = context.packageManager
        if (intent.resolveActivity(pm) != null) {
          context.startActivity(intent)
          true
        } else {
          false
        }
      } catch (_: Exception) {
        false
      }
    }

    AsyncFunction("isPackageInstalled") { packageName: String ->
      val context = appContext.reactContext ?: return@AsyncFunction false
      return@AsyncFunction try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
          context.packageManager.getPackageInfo(
            packageName,
            PackageManager.PackageInfoFlags.of(0)
          )
        } else {
          @Suppress("DEPRECATION")
          context.packageManager.getPackageInfo(packageName, 0)
        }
        true
      } catch (_: PackageManager.NameNotFoundException) {
        false
      } catch (_: Exception) {
        false
      }
    }
  }
}
