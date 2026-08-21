import { describe, expect, it } from "bun:test"
import { Either, Schema } from "effect"
import { VendorManifestJson } from "./vendor-manifest.ts"

const decode = Schema.decodeUnknownEither(VendorManifestJson)

describe("VendorManifestJson", () => {
  it("accepts the consumed vendor record and rejects an incomplete one", () => {
    expect(
      Either.isRight(
        decode(JSON.stringify({ vendors: [{ source: "anthropic/skills", pinnedCommit: "abc123", vendoredOn: "2026-08-21" }] })),
      ),
    ).toBe(true)
    expect(Either.isLeft(decode(JSON.stringify({ vendors: [{ source: "anthropic/skills" }] })))).toBe(true)
  })
})
