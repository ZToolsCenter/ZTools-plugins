import {
  Sparkles,
  Flame,
  Crown,
  Zap,
  Sword,
  Handshake,
  type LucideIcon,
} from "lucide-react";

/** Maps an achievement's `icon` string to a lucide component. Kept in one place
 *  so the toasts (hook) and the achievement grid (App) stay in sync. */
export const ACH_ICON: Record<string, LucideIcon> = {
  Sparkles,
  Flame,
  Crown,
  Zap,
  Sword,
  Handshake,
};
