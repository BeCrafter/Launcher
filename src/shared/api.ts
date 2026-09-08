export interface LauncherApi {
  appName: string
  versions: {
    electron: string
    node: string
    chrome: string
  }
  ping: () => Promise<string>
  logoList: () => Promise<string[]>
  logoGet: () => Promise<string>
  logoSet: (variant: string) => Promise<string>
}
