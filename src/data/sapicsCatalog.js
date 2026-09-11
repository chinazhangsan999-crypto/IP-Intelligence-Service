const releaseBase = 'https://github.com/sapics/ip-location-db/releases/download/latest';

// The reference mirror documents these upstream release assets.  Keep the
// catalogue explicit: only listed files are ever downloaded by the updater.
export const SAPICS_REFERENCE_REPOSITORY = 'chinazhangsan999-crypto/ip-location-db-cankao';

export const SAPICS_DATASETS = Object.freeze([
  { id: 'sapics-user-country', fileName: 'user-country.mmdb', kind: 'country', priority: 10, license: 'PDDL-1.0' },
  { id: 'sapics-server-country', fileName: 'server-country.mmdb', kind: 'country', priority: 40, license: 'PDDL-1.0' },
  { id: 'sapics-geolite2-country', fileName: 'geolite2-country.mmdb', kind: 'country', priority: 50, license: 'GeoLite2' },
  { id: 'sapics-dbip-country', fileName: 'dbip-country.mmdb', kind: 'country', priority: 60, license: 'CC-BY-4.0' },
  { id: 'sapics-iptoasn-country', fileName: 'iptoasn-country.mmdb', kind: 'country', priority: 70, license: 'PDDL-1.0' },
  { id: 'sapics-dbip-city-ipv4', fileName: 'dbip-city-ipv4.mmdb', kind: 'city', priority: 30, license: 'CC-BY-4.0' },
  { id: 'sapics-dbip-city-ipv6', fileName: 'dbip-city-ipv6.mmdb', kind: 'city', priority: 31, license: 'CC-BY-4.0' },
  { id: 'sapics-geolite2-city-ipv4', fileName: 'geolite2-city-ipv4.mmdb', kind: 'city', priority: 50, license: 'GeoLite2' },
  { id: 'sapics-geolite2-city-ipv6', fileName: 'geolite2-city-ipv6.mmdb', kind: 'city', priority: 51, license: 'GeoLite2' },
  { id: 'sapics-origin-asn', fileName: 'origin-asn.mmdb', kind: 'asn', priority: 10, license: 'PDDL-1.0' },
  { id: 'sapics-iptoasn-asn', fileName: 'iptoasn-asn.mmdb', kind: 'asn', priority: 20, license: 'PDDL-1.0' },
  { id: 'sapics-geolite2-asn', fileName: 'geolite2-asn.mmdb', kind: 'asn', priority: 50, license: 'GeoLite2' },
  { id: 'sapics-dbip-asn', fileName: 'dbip-asn.mmdb', kind: 'asn', priority: 60, license: 'CC-BY-4.0' },
].map((dataset) => Object.freeze({
  ...dataset,
  downloadUrl: `${releaseBase}/${dataset.fileName}`,
  checksumUrl: `${releaseBase.replace('/latest', '/checksum')}/${dataset.fileName}.sha256`,
})));
