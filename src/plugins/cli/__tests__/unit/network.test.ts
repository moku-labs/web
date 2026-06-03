/* eslint-disable sonarjs/no-hardcoded-ip -- these are synthetic interface fixtures for LAN-address derivation, not real hosts. */
/* eslint-disable sonarjs/no-clear-text-protocols -- the derived dev-server URL is intentionally http (local LAN preview). */
import { describe, expect, it } from "vitest";
import { lanAddress, type NetworkAddress, networkUrl } from "../../network";

/** Build an interface source from a flat map of interface name → addresses. */
function source(map: Record<string, NetworkAddress[] | undefined>) {
  return () => map;
}

describe("cli/lanAddress", () => {
  it("picks the first non-internal IPv4 (family string form)", () => {
    const fromSource = source({
      lo0: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
      en0: [
        { address: "::1", family: "IPv6", internal: false },
        { address: "192.168.1.42", family: "IPv4", internal: false }
      ]
    });
    expect(lanAddress(fromSource)).toBe("192.168.1.42");
  });

  it("accepts the legacy numeric family (4)", () => {
    const fromSource = source({
      en0: [{ address: "10.0.0.5", family: 4, internal: false }]
    });
    expect(lanAddress(fromSource)).toBe("10.0.0.5");
  });

  it("returns null when only internal/IPv6 addresses exist", () => {
    const fromSource = source({
      lo0: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
      en0: [{ address: "fe80::1", family: "IPv6", internal: false }]
    });
    expect(lanAddress(fromSource)).toBeNull();
  });

  it("returns null for an empty interface set", () => {
    expect(lanAddress(source({}))).toBeNull();
  });

  it("skips an undefined interface entry", () => {
    const fromSource = source({
      down: undefined,
      en0: [{ address: "172.16.0.9", family: "IPv4", internal: false }]
    });
    expect(lanAddress(fromSource)).toBe("172.16.0.9");
  });
});

describe("cli/networkUrl", () => {
  it("builds http://<ip>:<port> from the first external IPv4", () => {
    const fromSource = source({
      en0: [{ address: "192.168.0.10", family: "IPv4", internal: false }]
    });
    expect(networkUrl(4173, fromSource)).toBe("http://192.168.0.10:4173");
  });

  it("returns null when no LAN address is available", () => {
    expect(networkUrl(4173, source({}))).toBeNull();
  });
});
