import {
  getAddress,
  isConnected,
  requestAccess,
  signTransaction,
} from "@stellar/freighter-api";

export async function canUseFreighter(): Promise<boolean> {
  const res = await isConnected();
  return Boolean(res.isConnected) && !res.error;
}

export async function connectFreighter(): Promise<string> {
  const res = await requestAccess();
  if (res.error || !res.address) {
    throw new Error(res.error?.message ?? "Unable to connect Freighter wallet.");
  }
  return res.address;
}

export async function getFreighterAddress(): Promise<string | null> {
  const res = await getAddress();
  if (res.error || !res.address) {
    return null;
  }
  return res.address;
}

export { signTransaction };
