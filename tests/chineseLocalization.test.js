import assert from 'node:assert/strict';
import test from 'node:test';
import { localizeResult } from '../src/services/ChineseLocalizationService.js';

test('adds Chinese display values while retaining raw database observations', () => {
  const result = localizeResult({
    country_code: 'CN', country_name: 'China', region: 'Henan', city: 'Zhengzhou',
    timezone: 'Asia/Shanghai', asn: 4837, canonical_org: 'CNCGROUP IP network of ShangHai IDC',
    peeringdb_network_type: 'NSP', source_claims: [
      { source: 'dbip-city', field: 'state1', value: 'Henan' },
      { source: 'maxmind-geolite2-city', field: 'timezone', value: 'Asia/Shanghai' },
    ], evidence: [],
  });

  assert.equal(result.region, 'Henan');
  assert.equal(result.region_zh, '河南省');
  assert.equal(result.city_zh, '郑州市');
  assert.equal(result.timezone_zh, '中国标准时间（UTC+08:00）');
  assert.equal(result.canonical_org_zh, '中国联通');
  assert.equal(result.peeringdb_network_type_zh, '网络服务提供商');
  assert.equal(result.source_claims[0].value, 'Henan');
  assert.equal(result.source_claims[0].value_zh, '河南省');
});
