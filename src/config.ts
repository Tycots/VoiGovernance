export const APP_ID = 50192887;
export const APP_ADDRESS =
  "T7LZHHCCA4ZXP3QHGF4FWUDJ4FCRMJ7VZNA5KYUS4SLNOIW34SL23ZAVUQ";

export const VOI_NETWORK = {
  id: "voi",
  genesisId: "voimain-v1.0",
  genesisHash: "r20fSQI8gWe/kFZziNonSPCXLwcQmH/nxROvnnueWOk=",
  caipChainId: "algorand:r20fSQI8gWe_kFZziNonSPCXLwcQmH_n",
  algodServer: "https://mainnet-api.voi.nodely.dev",
  indexerServer: "https://mainnet-idx.voi.nodely.dev",
} as const;

export const WALLETCONNECT_PROJECT_ID =
  import.meta.env.VITE_WALLETCONNECT_PROJECT_ID ??
  "ab802c07b45ec4107b154be5e14234ff";
export const MAX_SLOTS = 10;
export const MAX_WHITELIST = 10;
export const VOTE_TYPES = { YEA: 1, NAY: 2, ABSTAIN: 3 } as const;
