import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const config = JSON.parse(await readFile(process.argv[2] ?? 'artifacts/compose.json', 'utf8'));
assert(config.name.startsWith('volaryn-test-'), 'Expected an isolated test project');
assert.equal(config.services.app.environment.VOLARYN_INDEX_POLL_INTERVAL_SECS, '1');
assert.equal(config.services.app.environment.VOLARYN_INDEX_DISCOVERY_INTERVAL_SECS, '2');
for (const service of Object.values(config.services)) {
  assert(!service.ports?.length, 'Test services must not publish host ports');
  assert(!service.env_file?.length, 'Test services must not inherit live configuration');
}
for (const volume of Object.values(config.volumes)) {
  assert(!volume.external, 'Test volumes must belong to this isolated run');
  assert(
    volume.name.startsWith(`${config.name}_`),
    'Test volumes must use the isolated project prefix',
  );
}
console.log('Test configuration has isolated volumes and no published ports.');
