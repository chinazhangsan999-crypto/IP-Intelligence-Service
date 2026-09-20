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

test('leaves unknown organization translations empty so clients can show the raw name', () => {
  const result = localizeResult({
    status: 'resolved', country_code: 'US', country_name: 'United States', region: 'California', city: 'Los Angeles',
    asn: 30058, asn_org: 'FDCservers.net', canonical_org: 'FDCservers.net', canonical_org_country: 'US',
    isp: 'FDCservers.net', network_type: 'hosting', network_type_confidence: 'low',
    source_claims: [{ source: 'dbip-asn', field: 'asn_org', value: 'FDCservers.net', confidence: 'low' }],
    evidence: [{ source: 'caida-as2org', field: 'canonical_org', value: 'FDCservers.net', confidence: 'high' }],
    sources: ['dbip-asn', 'caida-as2org'],
  });

  assert.equal(result.asn_org, 'FDCservers.net');
  assert.equal(result.asn_org_zh, null);
  assert.equal(result.canonical_org_zh, null);
  assert.equal(result.isp_zh, null);
  assert.equal(result.region_zh, null);
  assert.equal(result.city_zh, null);
  assert.equal(result.special_purpose_zh, null);
  assert.equal(result.source_claims[0].source_zh, '自治系统数据库');
  assert.equal(result.source_claims[0].field_zh, '自治系统归属');
  assert.equal(Object.hasOwn(result.source_claims[0], 'value_zh'), false);
  assert.equal(result.evidence[0].confidence_zh, '高');
});
