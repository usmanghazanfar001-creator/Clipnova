import fs from "node:fs";
import { Readable } from "node:stream";
import zlib from "node:zlib";

export type ZipEntry = { name: string; path: string };

const MAX_ZIP32 = 0xffffffff;

/** Safe ASCII file-name fragment: "Héllo, World! 100%" -> "hello-world-100". */
export function slugify(text: string, fallback = "clip"): string {
  const s = text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/[\s-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return s || fallback;
}

function dosDateTime(d: Date) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

async function crcOf(path: string): Promise<number> {
  let crc = 0;
  for await (const chunk of fs.createReadStream(path)) crc = zlib.crc32(chunk as Buffer, crc);
  return crc >>> 0;
}

/**
 * Streams a "stored" (uncompressed) ZIP as a Node Readable. MP4s are already compressed, so
 * storing is fastest and nothing is buffered beyond one chunk. Each file is read twice (CRC,
 * then data) so sizes are known up front, which keeps the archive readable by every unzip tool.
 * Files of 4 GB or more are rejected (no ZIP64).
 */
export function createZipStream(entries: ZipEntry[]): Readable {
  for (const e of entries) {
    if (!e.name || /[\\/]/.test(e.name) || e.name.includes("..")) throw new Error(`Unsafe ZIP entry name: ${e.name}`);
  }
  const { time, date } = dosDateTime(new Date());

  async function* generate() {
    let offset = 0;
    const central: Buffer[] = [];
    for (const e of entries) {
      const size = (await fs.promises.stat(e.path)).size;
      if (size >= MAX_ZIP32) throw new Error("File too large for ZIP");
      const crc = await crcOf(e.path);
      const nameBuf = Buffer.from(e.name, "utf8");

      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(20, 4);
      local.writeUInt16LE(0x0800, 6); // UTF-8 names
      local.writeUInt16LE(0, 8); // stored
      local.writeUInt16LE(time, 10);
      local.writeUInt16LE(date, 12);
      local.writeUInt32LE(crc, 14);
      local.writeUInt32LE(size, 18);
      local.writeUInt32LE(size, 22);
      local.writeUInt16LE(nameBuf.length, 26);

      const c = Buffer.alloc(46);
      c.writeUInt32LE(0x02014b50, 0);
      c.writeUInt16LE(20, 4);
      c.writeUInt16LE(20, 6);
      c.writeUInt16LE(0x0800, 8);
      c.writeUInt16LE(time, 12);
      c.writeUInt16LE(date, 14);
      c.writeUInt32LE(crc, 16);
      c.writeUInt32LE(size, 20);
      c.writeUInt32LE(size, 24);
      c.writeUInt16LE(nameBuf.length, 28);
      c.writeUInt32LE(offset, 42);
      central.push(c, nameBuf);

      yield local;
      yield nameBuf;
      yield* fs.createReadStream(e.path) as AsyncIterable<Buffer>;
      offset += 30 + nameBuf.length + size;
    }
    const centralBuf = Buffer.concat(central);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(centralBuf.length, 12);
    end.writeUInt32LE(offset, 16);
    yield centralBuf;
    yield end;
  }

  return Readable.from(generate(), { objectMode: false });
}
