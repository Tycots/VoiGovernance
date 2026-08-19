import { LogLevel, NetworkConfigBuilder, WalletId, WalletManager, type SupportedWallet } from '@txnlab/use-wallet'
import { VOI_NETWORK, WALLETCONNECT_PROJECT_ID } from '../config'

const networks = new NetworkConfigBuilder()
  .addNetwork(VOI_NETWORK.id, {
    algod: { token: '', baseServer: VOI_NETWORK.algodServer, port: 443 },
    genesisId: VOI_NETWORK.genesisId,
    genesisHash: VOI_NETWORK.genesisHash,
    caipChainId: VOI_NETWORK.caipChainId,
    isTestnet: false,
  })
  .build()

const wallets: SupportedWallet[] = [WalletId.DEFLY_WEB, WalletId.LUTE]

if (WALLETCONNECT_PROJECT_ID) {
  wallets.push({
    id: WalletId.WALLETCONNECT,
    options: {
      projectId: WALLETCONNECT_PROJECT_ID,
      skin: 'voiwallet',
      metadata: {
        name: 'Voi Council Voting',
        description: 'On-chain governance for council members',
        url: typeof window !== 'undefined' ? window.location.origin : undefined,
        icons: typeof window !== 'undefined' ? [`${window.location.origin}/favicon.svg`] : undefined,
      },
    },
  })
}

export const walletManager = new WalletManager({
  wallets,
  networks,
  defaultNetwork: VOI_NETWORK.id,
  options: { debug: import.meta.env.DEV, logLevel: import.meta.env.DEV ? LogLevel.DEBUG : LogLevel.WARN },
})
