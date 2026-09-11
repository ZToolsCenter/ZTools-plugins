import { useEffect, useState, useSyncExternalStore } from "react";
import { generateTOTP, generateHOTP } from "@/lib/otp";
import type { AccountData } from "@/lib/types";

interface OtpResult {
  code: string;
  remaining: number;
  period: number;
}

export function useOtpCode(account: AccountData): OtpResult {
  const [code, setCode] = useState("------");
  const nowSeconds = useSyncExternalStore(subscribeClock, getClockSnapshot, getClockSnapshot);
  const period = account.period || 30;
  const step = account.type === "totp" ? Math.floor(nowSeconds / period) : account.counter;
  const remaining = account.type === "totp" ? period - (nowSeconds % period) : -1;

  useEffect(() => {
    let active = true;
    const generate = async () => {
      try {
        const next = account.type === "hotp"
          ? await generateHOTP(account.secret, account.counter, account.digits, account.algorithm)
          : (await generateTOTP(account.secret, period, account.digits, account.algorithm)).code;
        if (active) setCode(next);
      } catch {
        if (active) setCode("ERROR");
      }
    };
    void generate();
    return () => {
      active = false;
    };
  }, [
    account.secret,
    account.type,
    account.period,
    account.digits,
    account.algorithm,
    account.counter,
    period,
    step,
  ]);

  return { code, remaining, period };
}

let clockSeconds = Math.floor(Date.now() / 1000);
let clockTimer: ReturnType<typeof setInterval> | undefined;
const clockListeners = new Set<() => void>();

function getClockSnapshot() {
  return clockSeconds;
}

function subscribeClock(listener: () => void) {
  clockListeners.add(listener);
  if (!clockTimer) {
    clockTimer = setInterval(() => {
      const next = Math.floor(Date.now() / 1000);
      if (next === clockSeconds) return;
      clockSeconds = next;
      clockListeners.forEach((notify) => notify());
    }, 250);
  }
  return () => {
    clockListeners.delete(listener);
    if (clockListeners.size === 0 && clockTimer) {
      clearInterval(clockTimer);
      clockTimer = undefined;
    }
  };
}
