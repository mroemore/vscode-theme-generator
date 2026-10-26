// Canonical serialisation and content hash for theme duplicate detection (spec §5).
// Everything hashed here comes out of JSON.parse, so only plain data — objects,
// arrays, scalars — ever reaches canonicalise.

// Objects get their keys sorted ascending, recursively; arrays keep their order
// (tokenColors is semantically ordered); scalars pass through unchanged.
export function canonicalise(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalise)
  }
  if (typeof value === 'object' && value !== null) {
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(value).sort()) {
      sorted[key] = canonicalise((value as Record<string, unknown>)[key])
    }
    return sorted
  }
  return value
}

export function canonicalString(value: unknown): string {
  return JSON.stringify(canonicalise(value))
}

// 64-bit FNV-1a over the UTF-8 bytes of the input, as 16 lowercase hex chars.
// BigInt via constructor strings: the tsconfig target is ES2017, which rejects
// bigint literal syntax.
const FNV_OFFSET = BigInt('0xcbf29ce484222325')
const FNV_PRIME = BigInt('0x100000001b3')
const FNV_MASK = BigInt('0xffffffffffffffff')

export function fnv1a64(input: string): string {
  let h = FNV_OFFSET
  for (const byte of new TextEncoder().encode(input)) {
    h ^= BigInt(byte)
    h = (h * FNV_PRIME) & FNV_MASK
  }
  return h.toString(16).padStart(16, '0')
}

// SHA-256 hex via WebCrypto; falls back to fnv1a64 where crypto.subtle is
// unavailable (insecure contexts, e.g. a phone on a plain-http LAN IP — spec §5.1).
// Same input, same output everywhere; the fallback only trades collision resistance.
export async function digest(input: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  if (subtle) {
    const buf = await subtle.digest('SHA-256', new TextEncoder().encode(input))
    return [...new Uint8Array(buf)]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }
  return fnv1a64(input)
}

// Identity is { type, colors } only — name and x-themegen never affect the hash,
// so the two exporters' differing token blocks cannot split one theme. NOTE:
// identity is computed per export format until the diffEditor.diagonalFill drift
// between the exporters (spec §5.3) is resolved.
export async function propsHash(theme: string | object): Promise<string> {
  const parsed: unknown = typeof theme === 'string' ? JSON.parse(theme) : theme
  const { type, colors } = parsed as { type: unknown; colors: unknown }
  return digest(canonicalString({ type, colors }))
}
