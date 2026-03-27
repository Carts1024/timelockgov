"use client";

import { useCallback, useEffect, useState } from "react";

import { canUseFreighter, connectFreighter, getFreighterAddress } from "@/lib/soroban/wallet";

export function useWallet() {
  const [address, setAddress] = useState<string | null>(null);
  const [isAvailable, setIsAvailable] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const syncWallet = useCallback(async () => {
    const available = await canUseFreighter();
    setIsAvailable(available);

    if (!available) {
      setAddress(null);
      return;
    }

    const existingAddress = await getFreighterAddress();
    setAddress(existingAddress);
  }, []);

  useEffect(() => {
    void syncWallet();
  }, [syncWallet]);

  const connect = useCallback(async () => {
    setIsConnecting(true);
    setError(null);

    try {
      const connectedAddress = await connectFreighter();
      setAddress(connectedAddress);
      return connectedAddress;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to connect wallet.";
      setError(message);
      throw err;
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    setAddress(null);
  }, []);

  return {
    address,
    isAvailable,
    isConnecting,
    error,
    connect,
    disconnect,
    refresh: syncWallet,
  };
}
