/**
 * Edge-safe CIDR utility — no Node.js or DB dependencies.
 * Imported by middleware (Edge runtime) and ip-allowlist.ts (Node.js runtime).
 */
import IPCIDR from 'ip-cidr'

export function isIpInCidr(ip: string, cidr: string): boolean {
  try {
    const range = new IPCIDR(cidr)
    return range.contains(ip)
  } catch {
    return false
  }
}
