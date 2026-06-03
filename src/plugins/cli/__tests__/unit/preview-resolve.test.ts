import { describe, expect, it } from "vitest";
import { resolveCleanUrl, safePath } from "../../preview";

/** Build a FileProbe over a fixed set of "existing" paths (using "/" as separator). */
function probe(existing: string[]) {
  const set = new Set(existing);
  return (path: string): boolean => set.has(path);
}

describe("cli/resolveCleanUrl (pure clean-URL resolver)", () => {
  it("maps a trailing-slash path to its directory index.html (200)", () => {
    const isFile = probe(["dist/about/index.html"]);
    expect(resolveCleanUrl("dist", "/about/", isFile)).toEqual({
      file: "dist/about/index.html",
      status: 200
    });
  });

  it("serves an exact file hit (200)", () => {
    const isFile = probe(["dist/assets/main.css"]);
    expect(resolveCleanUrl("dist", "/assets/main.css", isFile)).toEqual({
      file: "dist/assets/main.css",
      status: 200
    });
  });

  it("resolves an extensionless path to <path>/index.html (200)", () => {
    const isFile = probe(["dist/blog/index.html"]);
    expect(resolveCleanUrl("dist", "/blog", isFile)).toEqual({
      file: "dist/blog/index.html",
      status: 200
    });
  });

  it("serves the root index.html for / (200)", () => {
    const isFile = probe(["dist/index.html"]);
    expect(resolveCleanUrl("dist", "/", isFile)).toEqual({
      file: "dist/index.html",
      status: 200
    });
  });

  it("falls back to the nearest 404.html climbing toward the root (404)", () => {
    const isFile = probe(["dist/blog/404.html", "dist/404.html"]);
    expect(resolveCleanUrl("dist", "/blog/missing", isFile)).toEqual({
      file: "dist/blog/404.html",
      status: 404
    });
  });

  it("falls back to the root 404.html when no nearer one exists (404)", () => {
    const isFile = probe(["dist/404.html"]);
    expect(resolveCleanUrl("dist", "/deep/nested/missing", isFile)).toEqual({
      file: "dist/404.html",
      status: 404
    });
  });

  it("returns a null file with status 404 when not even a 404.html exists", () => {
    const isFile = probe([]);
    const resolved = resolveCleanUrl("dist", "/whatever", isFile);
    expect(resolved.file).toBeNull();
    expect(resolved.status).toBe(404);
  });

  it("strips ../ traversal so a request cannot escape the root", () => {
    // A decoded pathname always starts with "/", so normalize collapses the climb
    // to "/etc/passwd"; joined under dist/ it stays at dist/etc/passwd (never escapes).
    const isFile = probe(["dist/etc/passwd"]);
    const result = resolveCleanUrl("dist", "/../../etc/passwd", isFile);
    expect(result).toEqual({ file: "dist/etc/passwd", status: 200 });
  });

  it("keeps a relative ../ climb contained under the root", () => {
    const isFile = probe(["dist/secret"]);
    // safePath strips the leading ../ so it resolves to dist/secret, not ../secret.
    expect(resolveCleanUrl("dist", "../secret", isFile)).toEqual({
      file: "dist/secret",
      status: 200
    });
  });
});

describe("cli/safePath", () => {
  it("strips leading ../ segments from a relative climb", () => {
    expect(safePath("../../etc/passwd")).toBe("etc/passwd");
  });

  it("collapses an absolute climb to a rooted path (joined under dist it stays contained)", () => {
    expect(safePath("/../../etc/passwd")).toBe("/etc/passwd");
  });

  it("leaves a normal path intact", () => {
    expect(safePath("/about/index.html")).toBe("/about/index.html");
  });
});
