import { NativeModule, registerWebModule } from 'expo';

class XhareNavigationModule extends NativeModule<Record<string, never>> {
  async openViewUriInPackage(_url: string, _packageName: string): Promise<boolean> {
    return false;
  }

  async isPackageInstalled(_packageName: string): Promise<boolean> {
    return false;
  }
}

export default registerWebModule(XhareNavigationModule, 'XhareNavigation');
