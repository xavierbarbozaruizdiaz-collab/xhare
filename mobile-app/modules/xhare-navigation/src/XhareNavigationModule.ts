import { type NativeModule, requireNativeModule } from 'expo';

declare class XhareNavigationModule extends NativeModule<Record<string, never>> {
  openViewUriInPackage(url: string, packageName: string): Promise<boolean>;
  isPackageInstalled(packageName: string): Promise<boolean>;
}

export default requireNativeModule<XhareNavigationModule>('XhareNavigation');
