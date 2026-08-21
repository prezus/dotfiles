import { Schema } from "effect"

const Vendor = Schema.Struct({
  source: Schema.String,
  pinnedCommit: Schema.String,
  vendoredOn: Schema.String,
})

/** Parse the JSON representation written by the skills vendoring process. */
export const VendorManifestJson = Schema.parseJson(
  Schema.Struct({
    vendors: Schema.Array(Vendor),
  }),
)
