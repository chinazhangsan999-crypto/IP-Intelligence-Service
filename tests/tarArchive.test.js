import assert from 'node:assert/strict';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
import { extractMmdbFromTarGz } from '../scripts/lib/tarArchive.js';

function tarEntry(name, content) {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, 'utf8');
  header.write('0000644\0', 100, 8, 'ascii');
  header.write('0000000\0', 108, 8, 'ascii');
  header.write('0000000\0', 116, 8, 'ascii');
  header.write(`${content.length.toString(8).padStart(11, '0')}\0`, 124, 12, 'ascii');
  header.write('00000000000\0', 136, 12, 'ascii');
  header.fill(32, 148, 156);
  header[156] = 48;
  header.write('ustar\0', 257, 6, 'ascii');
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
  const padding = Buffer.alloc(Math.ceil(content.length / 512) * 512 - content.length);
  return Buffer.concat([header, content, padding]);
}

test('extracts an MMDB file from a gzip-compressed tar archive', () => {
  const expected = Buffer.from('test-mmdb');
  const archive = Buffer.concat([
    tarEntry('GeoLite2-Country_20260912/COPYRIGHT.txt', Buffer.from('copyright')),
    tarEntry('GeoLite2-Country_20260912/GeoLite2-Country.mmdb', expected),
    Buffer.alloc(1024),
  ]);

  assert.deepEqual(extractMmdbFromTarGz(gzipSync(archive)), expected);
});

test('rejects a tar archive without an MMDB database', () => {
  const archive = Buffer.concat([tarEntry('README.txt', Buffer.from('readme')), Buffer.alloc(1024)]);
  assert.throws(() => extractMmdbFromTarGz(gzipSync(archive)), /contains no MMDB/);
});
