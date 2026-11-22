/**
 * Whether `text` shows the bytes of `key` in any of the ways a key gets
 * printed: as base64, as hex (run together or spaced, as a `Buffer` prints),
 * or as a list of numbers (as a `Uint8Array` prints, on one line or many).
 *
 * The key under test must be one byte repeated, so that two of its bytes in
 * a row are enough to recognize it.
 */
export function showsKey(text: string, key: Uint8Array): boolean {
  const buffer = Buffer.from(key);
  const byte = String(key[0]);
  const hexByte = buffer.toString('hex', 0, 1);
  const flat = text.replace(/\s+/g, ' ');
  return (
    flat.includes(buffer.toString('base64')) ||
    flat.includes(buffer.toString('hex')) ||
    flat.includes(`${hexByte} ${hexByte}`) ||
    flat.includes(`${byte}, ${byte}`) ||
    flat.includes(`${byte},${byte}`)
  );
}
