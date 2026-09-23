/** The user part of a JID: drops the server and any `:device` suffix. */
export const jidUser = (jid?: string | null): string =>
  jid ? jid.split('@')[0].split(':')[0] : ''

/** Is this 1:1 message from the owner? Matches remoteJid or senderPn (LID-safe). */
export function isFromOwner(
  key: { remoteJid?: string | null; senderPn?: string | null },
  ownerJid: string,
): boolean {
  const owner = jidUser(ownerJid)
  // An empty owner would equal the "" of a missing senderPn and match anyone.
  if (!owner) return false
  return jidUser(key.remoteJid) === owner || jidUser(key.senderPn) === owner
}
