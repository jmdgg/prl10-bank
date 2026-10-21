import std/[sysrand, strutils, sequtils, tables, times]
import nimcrypto/[pbkdf2, sha2]

const
  Iterations = 100_000
  MaxFails = 5
  LockSeconds = 60

type Fails = tuple[count: int, until: Time]
var failures: Table[string, Fails] # in-memory throttle; resets on restart

proc toHexStr(b: openArray[byte]): string =
  for x in b: result.add toHex(x.int, 2).toLowerAscii

proc newToken*(bytes = 32): string = toHexStr(urandom(bytes))

proc hashPassword*(password, salt: string): string =
  toHexStr(pbkdf2(sha256, password, salt, Iterations, 32))

proc verifyPassword*(password, salt, expected: string): bool =
  let got = hashPassword(password, salt)
  if got.len != expected.len: return false
  var diff = 0
  for i in 0 ..< got.len: diff = diff or (ord(got[i]) xor ord(expected[i])) # constant time
  diff == 0

proc passwordProblem*(pw: string): string =
  ## Empty string when the password is acceptable.
  if pw.len < 8: "Password must be at least 8 characters."
  elif not pw.anyIt(it.isAlphaAscii) or not pw.anyIt(it in Digits):
    "Password must contain a letter and a number."
  else: ""

proc lockedSeconds*(user: string): int =
  ## Seconds left on the lock, or 0 when the user may try.
  let f = failures.getOrDefault(user.toLowerAscii, (0, Time()))
  if f.count >= MaxFails:
    let left = (f.until - getTime()).inSeconds.int
    if left > 0: return left
    failures.del user.toLowerAscii
  0

proc recordFailure*(user: string) =
  let k = user.toLowerAscii
  var f = failures.getOrDefault(k, (0, Time()))
  inc f.count
  if f.count >= MaxFails: f.until = getTime() + initDuration(seconds = LockSeconds)
  failures[k] = f

proc clearFailures*(user: string) = failures.del user.toLowerAscii
