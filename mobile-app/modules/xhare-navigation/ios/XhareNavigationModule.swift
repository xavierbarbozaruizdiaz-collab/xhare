import ExpoModulesCore
import UIKit

public class XhareNavigationModule: Module {
  public func definition() -> ModuleDefinition {
    Name("XhareNavigation")

    AsyncFunction("openViewUriInPackage") { (urlString: String, _: String) -> Bool in
      guard let url = URL(string: urlString) else { return false }
      guard UIApplication.shared.canOpenURL(url) else { return false }
      DispatchQueue.main.async {
        UIApplication.shared.open(url, options: [:], completionHandler: nil)
      }
      return true
    }

    AsyncFunction("isPackageInstalled") { (packageName: String) -> Bool in
      switch packageName {
      case "com.waze":
        guard let u = URL(string: "waze://") else { return false }
        return UIApplication.shared.canOpenURL(u)
      case "com.google.android.apps.maps":
        if let u = URL(string: "comgooglemaps://"), UIApplication.shared.canOpenURL(u) { return true }
        if let u = URL(string: "googlemaps://"), UIApplication.shared.canOpenURL(u) { return true }
        return false
      default:
        return false
      }
    }
  }
}
