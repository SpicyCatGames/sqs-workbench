/**
 * Minimal ZIP writer for the browser.
 *
 * Builds a valid ZIP archive using the STORE (uncompressed) method — exactly
 * what AWS Lambda needs for a deployment package and small enough to generate
 * inline in the browser for "author from scratch" functions.
 */

/** CRC-32 (IEEE 802.3), the checksum used by ZIP. */
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c ^= bytes[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** Create a ZIP archive from a list of text files. */
export function makeZip(files: Array<{ path: string; content: string }>): Uint8Array {
  const encoder = new TextEncoder();
  const localChunks: Uint8Array[] = [];
  const centralChunks: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const name = encoder.encode(file.path);
    const data = encoder.encode(file.content);
    const crc = crc32(data);

    // --- local file header (30 bytes) ---
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); // signature
    local.setUint16(4, 20, true); // version needed to extract
    local.setUint16(6, 0, true); // general purpose flags
    local.setUint16(8, 0, true); // compression method: store
    local.setUint16(10, 0, true); // mod time
    local.setUint16(12, 0x21, true); // mod date (1980-01-01)
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true); // compressed size
    local.setUint32(22, data.length, true); // uncompressed size
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true); // extra field length
    localChunks.push(new Uint8Array(local.buffer), name, data);

    // --- central directory header (46 bytes) ---
    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true); // signature
    central.setUint16(4, 0x031e, true); // version made by
    central.setUint16(6, 20, true); // version needed
    central.setUint16(8, 0, true); // flags
    central.setUint16(10, 0, true); // method
    central.setUint16(12, 0, true); // mod time
    central.setUint16(14, 0x21, true); // mod date
    central.setUint32(16, crc, true);
    central.setUint32(20, data.length, true);
    central.setUint32(24, data.length, true);
    central.setUint16(28, name.length, true);
    central.setUint16(30, 0, true); // extra length
    central.setUint16(32, 0, true); // comment length
    central.setUint16(34, 0, true); // disk number
    central.setUint16(36, 0, true); // internal attrs
    central.setUint32(38, 0, true); // external attrs
    central.setUint32(42, offset, true); // local header offset
    centralChunks.push(new Uint8Array(central.buffer), name);

    offset += 30 + name.length + data.length;
  }

  const centralSize = centralChunks.reduce((sum, c) => sum + c.length, 0);

  // --- end of central directory record (22 bytes) ---
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true); // signature
  eocd.setUint16(4, 0, true); // disk number
  eocd.setUint16(6, 0, true); // central dir disk
  eocd.setUint16(8, files.length, true); // entries on this disk
  eocd.setUint16(10, files.length, true); // total entries
  eocd.setUint32(12, centralSize, true);
  eocd.setUint32(16, offset, true); // central dir offset
  eocd.setUint16(20, 0, true); // comment length

  const all = [...localChunks, ...centralChunks, new Uint8Array(eocd.buffer)];
  const total = all.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const chunk of all) {
    out.set(chunk, pos);
    pos += chunk.length;
  }
  return out;
}
