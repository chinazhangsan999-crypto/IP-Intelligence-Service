export class ReloadableLookupService {
  constructor(service) {
    if (!service?.lookupBatch) throw new Error('A lookup service is required');
    this.service = service;
  }

  lookupBatch(...args) {
    const snapshot = this.service;
    return snapshot.lookupBatch(...args);
  }

  swap(service) {
    if (!service?.lookupBatch) throw new Error('A lookup service is required');
    const previous = this.service;
    this.service = service;
    return previous;
  }
}
