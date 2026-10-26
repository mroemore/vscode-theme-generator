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
    // Only plain objects get sorted; anything with a different prototype
    // (Date, Map, …) passes through untouched.
    const proto: unknown = Object.getPrototypeOf(value)
    if (proto !== Object.prototype && proto !== null) return value
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(value).sort()) {
      // `defineProperty`, not `sorted[key] = …`: a `colors.__proto__` own-property (which
      // `JSON.parse` produces) would otherwise invoke the prototype setter and vanish,
      // making two different files hash the same. The insertion order is the sorted key
      // order exactly as before.
      Object.defineProperty(sorted, key, {
        value: canonicalise((value as Record<string, unknown>)[key]),
        enumerable: true,
        configurable: true,
        writable: true,
      })
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

// fnv1a64 in every context, deliberately: a digest that switches algorithm by
// browsing context produces two incompatible value spaces for the same theme, so
// a duplicate saved over plain http (spec §5.1) would not be recognised over
// https. Consistency beats 256 bits for a local catalogue of human-named themes.
export function digest(input: string): string {
  return fnv1a64(input)
}

// Identity is { type, colors } only — name and x-themegen never affect the hash,
// so the two exporters' differing token blocks cannot split one theme. NOTE:
// identity is computed per export format until the diffEditor.diagonalFill drift
// between the exporters (spec §5.3) is resolved.
export function propsHash(theme: string | object): string {
  const parsed: unknown = typeof theme === 'string' ? JSON.parse(theme) : theme
  const { type, colors } = parsed as { type: unknown; colors: unknown }
  return digest(canonicalString({ type, colors }))
}
