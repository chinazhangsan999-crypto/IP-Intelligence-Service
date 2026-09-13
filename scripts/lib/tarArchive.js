import { gunzipSync } from 'node:zlib';

function tarString(buffer, start, length) {
  return buffer.subarray(start, start + length).toString('utf8').replace(/\0.*$/s, '').trim();
}

export function extractMmdbFromTarGz(content, maxOutputLength = 1024 * 1024 * 1024) {
  const archive = gunzipSync(content, { maxOutputLength });
  let offset = 0;

  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;

    const name = tarString(header, 0, 100);
    const prefix = tarString(header, 345, 155);
    const fileName = prefix ? `${prefix}/${name}` : name;
    const size = Number.parseInt(tarString(header, 124, 12), 8);
    if (!Number.isSafeInteger(size) || size < 0) throw new Error('Tar entry has an invalid size');

    const dataStart = offset + 512;
    const dataEnd = dataStart + size;
    if (dataEnd > archive.length) throw new Error('Tar archive is truncated');
    const type = header[156];
    if ((type === 0 || type === 48) && /\.mmdb$/i.test(fileName)) {
      return archive.subarray(dataStart, dataEnd);
    }
    offset = dataStart + Math.ceil(size / 512) * 512;
  }

  throw new Error('Tar archive contains no MMDB file');
}
