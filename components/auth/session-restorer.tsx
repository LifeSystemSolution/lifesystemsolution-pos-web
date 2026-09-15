"use client"

import { useEffect } from "react"
import { useAuth } from "@/contexts/auth-context"

/**
 * SessionRestorer - Simple placeholder for session restoration
 *
 * This component serves as a marker for session restoration logic.
 * Restoration is automatic via the mount effect in auth-context.tsx, which
 * reads the session token from lib/local/session.ts (localStorage).
 *
 * No manual restoration needed here.
 */
export function SessionRestorer() {
  const { user } = useAuth()

  // Session restoration is handled automatically by AuthProvider's mount
  // effect in auth-context.tsx. No manual intervention needed.

  return null
}
