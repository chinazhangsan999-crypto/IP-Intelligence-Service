import assert from 'node:assert/strict';
import test from 'node:test';
import { ReloadableLookupService } from '../src/services/ReloadableLookupService.js';

test('reloadable lookup swaps the whole service for subsequent batches', () => {
  const service = new ReloadableLookupService({ lookupBatch: () => ({ version: 'old' }) });
  const previous = service.swap({ lookupBatch: () => ({ version: 'new' }) });

  assert.equal(previous.lookupBatch().version, 'old');
  assert.equal(service.lookupBatch().version, 'new');
});
