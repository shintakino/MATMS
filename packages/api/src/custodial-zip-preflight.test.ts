import { describe, expect, test } from "bun:test";
import { Buffer } from "node:buffer";
import { deflateRawSync } from "node:zlib";
import { existsSync, readFileSync } from "node:fs";
import { preflightCustodialXlsx } from "./custodial-zip-preflight";
const asBytes = (buffer: Buffer) => new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);

function crc32(data: Buffer) {
  let crc = 0xffffffff;
  for (const byte of data) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return (crc ^ 0xffffffff) >>> 0;
}
function zip(entries: Array<[string, string]>): Uint8Array {
  const locals: Buffer[] = [], directories: Buffer[] = [];
  let offset = 0;
  for (const [name, value] of entries) {
    const file = Buffer.from(name), content = Buffer.from(value), compressed = deflateRawSync(asBytes(content));
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8); local.writeUInt32LE(crc32(content), 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(content.length, 22); local.writeUInt16LE(file.length, 26);
    const directory = Buffer.alloc(46); directory.writeUInt32LE(0x02014b50, 0); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6); directory.writeUInt16LE(8, 10); directory.writeUInt32LE(crc32(content), 16); directory.writeUInt32LE(compressed.length, 20); directory.writeUInt32LE(content.length, 24); directory.writeUInt16LE(file.length, 28); directory.writeUInt32LE(offset, 42);
    locals.push(local, file, compressed); directories.push(directory, file); offset += local.length + file.length + compressed.length;
  }
  const central = Buffer.concat(directories.map(asBytes)); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16);
  const result = Buffer.concat([...locals, central, end].map(asBytes));
  return new Uint8Array(result.buffer, result.byteOffset, result.byteLength);
}
const base: Array<[string, string]> = [["[Content_Types].xml", "<Types/>"], ["xl/workbook.xml", "<workbook/>"]];

describe("workbook ZIP preflight", () => {
  test("streams a valid archive and checks actual expanded size", async () => {
    expect(await preflightCustodialXlsx(zip(base))).toMatchObject({ entryCount: 2, expandedBytes: 19 });
    await expect(preflightCustodialXlsx(zip([...base, ["xl/worksheets/sheet1.xml", "a".repeat(4096)]]), { maxExpandedBytes: 1000 })).rejects.toThrow();
  });
  test("rejects macro, external links, declarations and duplicate paths", async () => {
    for (const entry of [["xl/vbaProject.bin", "binary"], ["xl/externalLinks/externalLink1.xml", "<x/>"], ["xl/_rels/workbook.xml.rels", '<x TargetMode="External"/>'], ["xl/worksheets/sheet1.xml", '<!DOCTYPE x [<!ENTITY a "x">]><x/>' ], ["XL/WORKBOOK.XML", "duplicate"]] as Array<[string, string]>) {
      await expect(preflightCustodialXlsx(zip([...base, entry]))).rejects.toThrow();
    }
    await expect(preflightCustodialXlsx(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).rejects.toThrow();
  }, 30000);
  test.skipIf(!existsSync("RPCSP 2025-ARAKAN WEST-MEOCAN HIGH SCHOOL.xlsx"))("accepts a supplied source workbook without reading its data into logs", async () => {
    const file = readFileSync("RPCSP 2025-ARAKAN WEST-MEOCAN HIGH SCHOOL.xlsx");
    const result = await preflightCustodialXlsx(new Uint8Array(file.buffer, file.byteOffset, file.byteLength));
    expect(result.entryCount).toBeGreaterThan(2);
    expect(result.expandedBytes).toBeGreaterThan(0);
  });
});
