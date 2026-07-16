/**
 * The bundled libsignal implementation prints noisy session bookkeeping via raw
 * console.log/console.error (unstructured, bypassing our pino logger) — big
 * SessionEntry dumps, "Bad MAC", prekey rotation, group decrypt misses. These
 * are benign and unactionable in normal operation. We filter exactly those
 * known lines and pass everything else through untouched.
 *
 * Our own logs go through pino (not console.*), so they're unaffected.
 */
const NOISE_PATTERNS: RegExp[] = [
  /^Closing session/,
  /^Closing open session in favor of incoming prekey bundle/,
  /^Failed to decrypt message with any known session/,
  /^Session error/,
  /Bad MAC/,
  /^SessionEntry /,
]

function isNoise(args: unknown[]): boolean {
  const first = args[0]
  return typeof first === 'string' && NOISE_PATTERNS.some((re) => re.test(first))
}

export function installConsoleFilter(): void {
  const wrap =
    (orig: (...a: unknown[]) => void) =>
    (...args: unknown[]) => {
      if (isNoise(args)) return
      orig(...args)
    }

  console.log = wrap(console.log.bind(console))
  console.info = wrap(console.info.bind(console))
  console.warn = wrap(console.warn.bind(console))
  console.error = wrap(console.error.bind(console))
}
