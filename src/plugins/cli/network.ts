/**
 * @file cli plugin — LAN network-URL derivation. Picks the first non-internal IPv4
 * from `node:os` `networkInterfaces()` to render the "Network" URL in the
 * server-ready panel. The interface source is injectable so it is unit-testable.
 */
import { networkInterfaces } from "node:os";

/**
 * The minimal shape read from one `networkInterfaces()` entry. Declared structurally
 * (no `node:os` `NetworkInterfaceInfo` import) so tests can supply plain objects.
 *
 * @example
 * const entry: NetworkAddress = { address: "192.168.1.10", family: "IPv4", internal: false };
 */
export type NetworkAddress = {
  /** The address string (e.g. `192.168.1.10`). */
  address: string;
  /** Address family — modern Node reports `"IPv4"`/`"IPv6"`; older `4`/`6`. */
  family: string | number;
  /** Whether this is an internal/loopback address. */
  internal: boolean;
};

/** A source of network interfaces (the `networkInterfaces()` return shape). */
export type InterfaceSource = () => Record<string, NetworkAddress[] | undefined>;

/**
 * Whether an interface entry is a usable, non-internal IPv4 address.
 *
 * @param entry - One interface address entry.
 * @returns `true` when it is an external IPv4 address.
 * @example
 * isExternalIPv4({ address: "10.0.0.2", family: "IPv4", internal: false }); // true
 */
function isExternalIPv4(entry: NetworkAddress): boolean {
  return !entry.internal && (entry.family === "IPv4" || entry.family === 4);
}

/**
 * Pick the first non-internal IPv4 address from the interface source, or `null` when
 * none exists (offline / loopback-only).
 *
 * @param source - Interface source (defaults to `node:os` `networkInterfaces`).
 * @returns The first external IPv4 address string, or `null`.
 * @example
 * const ip = lanAddress();
 */
export function lanAddress(source: InterfaceSource = networkInterfaces): string | null {
  for (const entries of Object.values(source())) {
    for (const entry of entries ?? []) {
      if (isExternalIPv4(entry)) return entry.address;
    }
  }
  // eslint-disable-next-line unicorn/no-null -- contract returns null when no LAN address exists.
  return null;
}

/**
 * Build the LAN URL (`http://<ip>:<port>`) for the server-ready panel, or `null`
 * when no non-internal IPv4 is available.
 *
 * @param port - The port the server is bound to.
 * @param source - Interface source (defaults to `node:os` `networkInterfaces`).
 * @returns The `http://<ip>:<port>` URL, or `null` when offline.
 * @example
 * networkUrl(4173); // "http://192.168.1.10:4173" or null
 */
export function networkUrl(
  port: number,
  source: InterfaceSource = networkInterfaces
): string | null {
  const ip = lanAddress(source);
  // eslint-disable-next-line unicorn/no-null -- contract returns null when no LAN address exists.
  return ip === null ? null : `http://${ip}:${port}`;
}
