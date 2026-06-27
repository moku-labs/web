import { describe, expect, it } from "vitest";
import { collectionUrl, relativeShardFile, shardSuffix } from "../../convention";

describe("shardSuffix() — the pure (collection, shard) → shard-file convention", () => {
  it("joins the collection and shard into <collection>/<shard>.json", () => {
    expect(shardSuffix("bank", "ru")).toBe("bank/ru.json");
  });

  it("keeps the shard's INTERNAL slashes as nested path segments", () => {
    expect(shardSuffix("bank", "en/animals")).toBe("bank/en/animals.json");
  });

  it("strips leading/trailing slashes from both collection and shard", () => {
    expect(shardSuffix("/bank/", "/en/")).toBe("bank/en.json");
    expect(shardSuffix("bank", "/en/animals/")).toBe("bank/en/animals.json");
  });

  it("keeps the key's percent-encoding (the browser fetches the encoded path)", () => {
    expect(shardSuffix("bank", "en/a%20%26%20b")).toBe("bank/en/a%20%26%20b.json");
  });
});

describe("collectionUrl() — the (baseUrl, collection, shard) → fetch URL convention", () => {
  it("prefixes the shard suffix with the baseUrl", () => {
    expect(collectionUrl("/", "bank", "en/animals")).toBe("/bank/en/animals.json");
    expect(collectionUrl("/cdn/", "bank", "ru")).toBe("/cdn/bank/ru.json");
  });
});

describe("relativeShardFile() — the (collection, shard) → on-disk file convention", () => {
  it("is the shard suffix with no extra output-dir wrapper", () => {
    expect(relativeShardFile("bank", "en/animals")).toBe("bank/en/animals.json");
    expect(relativeShardFile("/bank/", "/ru/")).toBe("bank/ru.json");
  });

  it("decodes percent-escapes so the file matches the decoded request path", () => {
    expect(relativeShardFile("bank", "en/a%20%26%20b")).toBe("bank/en/a & b.json");
  });

  it("keeps a malformed escape raw instead of throwing", () => {
    expect(relativeShardFile("bank", "en/100%")).toBe("bank/en/100%.json");
  });
});
