import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createFromRoot } from 'codama';
import { rootNodeFromAnchor } from '@codama/nodes-from-anchor';
import { renderVisitor } from '@codama/renderers-js';

const temporary = await mkdtemp(join(tmpdir(), 'volaryn-generated-'));
async function compare(actual, expected) {
  const names = (await readdir(actual)).sort();
  assert.deepEqual(names, (await readdir(expected)).sort(), `Generated files differ: ${expected}`);
  for (const name of names) {
    const entry = (await readdir(actual, { withFileTypes: true })).find(
      (item) => item.name === name,
    );
    if (entry.isDirectory()) await compare(join(actual, name), join(expected, name));
    else
      assert.deepEqual(
        await readFile(join(actual, name)),
        await readFile(join(expected, name)),
        `Generated interface drift: ${join(expected, name)}`,
      );
  }
}
try {
  const idl = JSON.parse(await readFile('packages/protocol/idl/volaryn.json', 'utf8'));
  assert.equal(idl.metadata.spec, '0.1.0');
  await createFromRoot(rootNodeFromAnchor(idl)).accept(
    renderVisitor(temporary, {
      syncPackageJson: false,
      erasableSyntax: true,
      prettierOptions: { singleQuote: false, printWidth: 80, trailingComma: 'all' },
    }),
  );
  await compare(join(temporary, 'src/generated'), resolve('packages/protocol/src/generated'));
  const schema = join(temporary, 'schema.ts');
  const result = spawnSync(
    'node_modules/.bin/openapi-typescript',
    ['packages/api/openapi.json', '-o', schema],
    { stdio: 'inherit' },
  );
  assert.equal(result.status, 0, 'OpenAPI generation failed');
  assert.deepEqual(
    await readFile(schema),
    await readFile('frontend/src/lib/api/schema.ts'),
    'HTTP client schema drift',
  );
  console.log('Program and HTTP clients match their published interfaces.');
} finally {
  await rm(temporary, { recursive: true, force: true });
}
