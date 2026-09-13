const UNSUPPORTED_VALUES = new Set(['', '-', '?', 'NOT SUPPORTED', 'INVALID IP ADDRESS', 'MISSING FILE']);

function usable(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return UNSUPPORTED_VALUES.has(text.toUpperCase()) ? null : text;
}

function usageNetworkType(usageType) {
  return {
    ISP: 'residential',
    MOB: 'mobile',
    DCH: 'hosting',
    CDN: 'cdn',
    EDU: 'education',
    GOV: 'government',
    MIL: 'government',
    COM: 'business',
    ORG: 'business',
    LIB: 'education',
  }[usageType] || null;
}

export class IntelligenceEnricher {
  constructor({ cloudProvider, torProvider, proxyProvider, networkEvidenceProvider, ruleService }) {
    this.cloudProvider = cloudProvider;
    this.torProvider = torProvider;
    this.proxyProvider = proxyProvider;
    this.networkEvidenceProvider = networkEvidenceProvider;
    this.ruleService = ruleService;
  }

  providers() {
    return [this.cloudProvider, this.torProvider, this.proxyProvider, this.networkEvidenceProvider, this.ruleService].filter(Boolean);
  }

  lookupSupplementalEvidence({ ip, asn = null }) {
    return this.networkEvidenceProvider?.lookupSpecialPurpose(ip, asn) || null;
  }

  lookup({ ip, asn, asnOrg }) {
    const engine = new IpJudgmentEngine();
    const evidence = [];
    const sources = [];
    let isp = null;
    let details = {};

    const cloud = this.cloudProvider?.lookup(ip);
    if (cloud?.available) {
      sources.push(this.cloudProvider.id);
      if (cloud.matches.length > 0) {
        engine.add({ field: 'is_hosting', value: true, source: this.cloudProvider.id, confidence: 'high', priority: 700 });
        const networkType = cloud.matches.some((match) => match.network_type === 'cdn') ? 'cdn' : 'hosting';
        engine.add({
          field: 'network_type',
          value: networkType,
          source: this.cloudProvider.id,
          confidence: 'high',
          priority: networkType === 'cdn' ? 720 : 700,
        });
        for (const match of cloud.matches) {
          evidence.push({
            source: this.cloudProvider.id,
            field: 'cloud_provider',
            value: [match.provider, match.service].filter(Boolean).join(':'),
            confidence: 'high',
          });
        }
      }
    }

    const tor = this.torProvider?.lookup(ip);
    if (tor?.available) {
      sources.push(this.torProvider.id);
      engine.add({ field: 'is_tor', value: tor.matched, source: this.torProvider.id, confidence: 'high', priority: 900 });
      if (tor.matched) {
        engine.add({ field: 'is_proxy', value: true, source: this.torProvider.id, confidence: 'high', priority: 900 });
        evidence.push({ source: this.torProvider.id, field: 'is_tor', value: 'true', confidence: 'high' });
      }
    }

    const proxy = this.proxyProvider?.lookup(ip);
    if (proxy?.available) {
      sources.push(this.proxyProvider.id);
      const proxyType = usable(proxy.record?.proxyType)?.toUpperCase() || null;
      const usageType = usable(proxy.record?.usageType)?.toUpperCase() || null;
      isp = usable(proxy.record?.isp);
      if (proxy.record?.isProxy === 0 || proxy.record?.isProxy === 1) {
        engine.add({
          field: 'is_proxy',
          value: proxy.record.isProxy === 1,
          source: this.proxyProvider.id,
          confidence: 'medium',
          priority: 600,
        });
      }
      if (proxyType) {
        engine.add({ field: 'is_vpn', value: proxyType === 'VPN', source: this.proxyProvider.id, confidence: 'medium', priority: 620 });
        engine.add({ field: 'is_tor', value: proxyType === 'TOR', source: this.proxyProvider.id, confidence: 'medium', priority: 620 });
        if (proxyType === 'DCH') {
          engine.add({ field: 'is_hosting', value: true, source: this.proxyProvider.id, confidence: 'medium', priority: 620 });
        }
        evidence.push({ source: this.proxyProvider.id, field: 'proxy_type', value: proxyType, confidence: 'medium' });
      }
      const type = usageNetworkType(usageType) || (proxyType === 'DCH' ? 'hosting' : null);
      if (type) engine.add({ field: 'network_type', value: type, source: this.proxyProvider.id, confidence: 'medium', priority: 600 });
      if (usageType === 'MOB') {
        engine.add({ field: 'is_mobile', value: true, source: this.proxyProvider.id, confidence: 'medium', priority: 600 });
      }
      if (usageType && usageType !== 'ISP/MOB') {
        engine.add({ field: 'is_mobile', value: usageType === 'MOB', source: this.proxyProvider.id, confidence: 'medium', priority: 600 });
        if (type) {
          engine.add({
            field: 'is_hosting',
            value: type === 'hosting' || type === 'cdn',
            source: this.proxyProvider.id,
            confidence: 'medium',
            priority: 600,
          });
        }
        evidence.push({ source: this.proxyProvider.id, field: 'usage_type', value: usageType, confidence: 'medium' });
      }
    }

    const supplemental = this.networkEvidenceProvider?.lookup(ip, asn);
    if (supplemental) {
      details = supplemental.details || {};
      evidence.push(...(supplemental.evidence || []));
      sources.push(...(supplemental.sources || []));
      for (const assertion of supplemental.assertions || []) engine.add(assertion);
    }

    const rules = this.ruleService?.match({ ip, asn, asnOrg }) || [];
    if (this.ruleService) sources.push('classification-rules');
    for (const rule of rules) {
      const priority = 1_000 + rule.priority;
      engine.add({
        field: 'network_type',
        value: rule.networkType,
        source: `classification-rules:${rule.name}`,
        confidence: rule.confidence,
        priority,
      });
      for (const [field, value] of Object.entries(rule.flags)) {
        engine.add({ field, value, source: `classification-rules:${rule.name}`, confidence: rule.confidence, priority });
      }
      evidence.push({
        source: 'classification-rules',
        field: 'network_type',
        value: `${rule.networkType}:${rule.name}`,
        confidence: rule.confidence,
      });
    }

    const judgment = engine.resolve();
    if (judgment.conflicts.length > 0) sources.push('judgment-engine');
    for (const conflict of judgment.conflicts) {
      evidence.push({
        source: 'judgment-engine',
        field: 'judgment_conflict',
        value: `${conflict.field}:${conflict.assertions.map((item) => `${item.source}=${item.value}`).join('|')}`,
        confidence: 'low',
      });
    }
    return {
      networkType: judgment.networkType,
      confidence: judgment.confidence,
      flags: judgment.flags,
      isp,
      evidence,
      sources: [...new Set(sources)],
      conflicts: judgment.conflicts,
      decisions: judgment.decisions,
      details,
    };
  }
}
import { IpJudgmentEngine } from './IpJudgmentEngine.js';
