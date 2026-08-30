import algosdk from "algosdk";
import type { TransactionSigner } from "algosdk";
import { APP_ID, MAX_SLOTS, VOI_NETWORK } from "../config";
import contractSpec from "../abi/VoiGovernance.json";

export const algodClient = new algosdk.Algodv2(
  "",
  VOI_NETWORK.algodServer,
  443,
);
const abiContract = new algosdk.ABIContract(contractSpec);
const textEncoder = new TextEncoder();

export interface ContractGlobalState {
  admin?: string;
  maxSlots: number;
  whitelist: string[];
}

export interface ProposalState {
  slot: number;
  active: boolean;
  proposalId: number;
  yea: number;
  nay: number;
  abstain: number;
  expiration: number;
  voteMask: bigint;
  exists: boolean;
}

function bytesFromValue(value: string | Uint8Array): Uint8Array {
  if (value instanceof Uint8Array) return value;
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function readUint64(data: Uint8Array, start: number): number {
  let value = 0n;
  for (let index = 0; index < 8; index += 1)
    value = (value << 8n) | BigInt(data[start + index] ?? 0);
  return Number(value);
}

function decodeAddress(value: Uint8Array): string {
  return algosdk.encodeAddress(value);
}

function decodeWhitelist(value: Uint8Array): string[] {
  if (value.length < 2) return [];
  const count = (value[0] << 8) | value[1];
  return Array.from({ length: count }, (_, index) =>
    decodeAddress(value.slice(2 + index * 32, 34 + index * 32)),
  );
}

export function slotBoxName(slot: number): Uint8Array {
  const prefix = textEncoder.encode("slot_");
  const slotBytes = algosdk.encodeUint64(slot);
  const name = new Uint8Array(prefix.length + slotBytes.length);
  name.set(prefix);
  name.set(slotBytes, prefix.length);
  return name;
}

export function whitelistBoxName(): Uint8Array {
  return textEncoder.encode("whitelist");
}

export async function fetchGlobalState(): Promise<ContractGlobalState> {
  const app = await algodClient.getApplicationByID(APP_ID).do();
  let admin: string | undefined;
  let maxSlots = MAX_SLOTS;

  for (const item of app.params?.globalState ?? []) {
    const key = new TextDecoder().decode(bytesFromValue(item.key));
    if (item.value.type === 1 && key === "admin")
      admin = decodeAddress(bytesFromValue(item.value.bytes));
    if (item.value.type === 2 && key === "maxSlots")
      maxSlots = Number(item.value.uint);
  }

  let whitelist: string[] = [];
  try {
    const box = await algodClient
      .getApplicationBoxByName(APP_ID, whitelistBoxName())
      .do();
    whitelist = decodeWhitelist(bytesFromValue(box.value));
  } catch {
    whitelist = [];
  }

  return { admin, maxSlots, whitelist };
}

export async function fetchProposal(slot: number): Promise<ProposalState> {
  const empty = {
    slot,
    active: false,
    proposalId: 0,
    yea: 0,
    nay: 0,
    abstain: 0,
    expiration: 0,
    voteMask: 0n,
    exists: false,
  };
  try {
    const box = await algodClient
      .getApplicationBoxByName(APP_ID, slotBoxName(slot))
      .do();
    const data = bytesFromValue(box.value);
    if (data.length < 49) return empty;
    return {
      slot,
      active: data[0] === 1,
      proposalId: readUint64(data, 1),
      yea: readUint64(data, 9),
      nay: readUint64(data, 17),
      abstain: readUint64(data, 25),
      expiration: readUint64(data, 33),
      voteMask: BigInt(readUint64(data, 41)),
      exists: true,
    };
  } catch {
    return empty;
  }
}

export async function fetchAllProposals(): Promise<ProposalState[]> {
  return Promise.all(
    Array.from({ length: MAX_SLOTS }, (_, slot) => fetchProposal(slot)),
  );
}

export function hasVoted(proposal: ProposalState, voterIndex: number): boolean {
  return (proposal.voteMask & (1n << BigInt(voterIndex))) !== 0n;
}

export function truncateAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

type MethodArgs = algosdk.ABIValue[];

export async function sendContractCall(params: {
  methodName: string;
  methodArgs: MethodArgs;
  sender: string;
  signer: TransactionSigner;
  boxNames?: Uint8Array[];
}): Promise<string> {
  const atc = new algosdk.AtomicTransactionComposer();
  const suggestedParams = await algodClient.getTransactionParams().do();
  atc.addMethodCall({
    appID: APP_ID,
    method: abiContract.getMethodByName(params.methodName),
    methodArgs: params.methodArgs,
    sender: params.sender,
    signer: params.signer,
    suggestedParams: { ...suggestedParams, flatFee: true, fee: 3000 },
    boxes: params.boxNames?.map((name) => ({ appIndex: APP_ID, name })),
  });
  const result = await atc.execute(algodClient, 4);
  const txId = result.txIDs[0];
  if (!txId) throw new Error("Transaction failed to submit");
  return txId;
}

export const updateWhitelist = (
  addresses: string[],
  sender: string,
  signer: TransactionSigner,
) =>
  sendContractCall({
    methodName: "updateWhitelist",
    methodArgs: [addresses],
    sender,
    signer,
    boxNames: [whitelistBoxName()],
  });

export const initializeProposal = (
  slot: number,
  proposalId: number,
  duration: number,
  sender: string,
  signer: TransactionSigner,
) =>
  sendContractCall({
    methodName: "initializeProposal",
    methodArgs: [slot, proposalId, duration],
    sender,
    signer,
    boxNames: [slotBoxName(slot)],
  });

export const castVote = (
  slot: number,
  voteType: number,
  sender: string,
  signer: TransactionSigner,
) =>
  sendContractCall({
    methodName: "castVote",
    methodArgs: [slot, voteType],
    sender,
    signer,
    boxNames: [slotBoxName(slot), whitelistBoxName()],
  });

export const resolveExpiredProposal = (
  slot: number,
  resolution: number,
  sender: string,
  signer: TransactionSigner,
) =>
  sendContractCall({
    methodName: "resolveExpiredProposal",
    methodArgs: [slot, resolution],
    sender,
    signer,
    boxNames: [slotBoxName(slot)],
  });

export const evaluateExpiration = (
  slot: number,
  sender: string,
  signer: TransactionSigner,
) =>
  resolveExpiredProposal(slot, 1, sender, signer);

export const resolveProposal = (
  slot: number,
  resolution: number,
  sender: string,
  signer: TransactionSigner,
) =>
  sendContractCall({
    methodName: "resolveProposal",
    methodArgs: [slot, resolution],
    sender,
    signer,
    boxNames: [slotBoxName(slot)],
  });

export const terminateProposal = (
  slot: number,
  reason: Uint8Array,
  sender: string,
  signer: TransactionSigner,
) =>
  sendContractCall({
    methodName: "terminateProposal",
    methodArgs: [slot, reason],
    sender,
    signer,
    boxNames: [slotBoxName(slot)],
  });

export function explorerTxUrl(txId: string): string {
  return `https://explorer.voi.network/tx/${txId}`;
}
