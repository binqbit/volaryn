import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createFromRoot } from 'codama';
import { rootNodeFromAnchor } from '@codama/nodes-from-anchor';
import { renderVisitor } from '@codama/renderers-js';

const idl = JSON.parse(
  await readFile(new URL('../packages/protocol/idl/volaryn.json', import.meta.url), 'utf8'),
);
if (idl.metadata.spec !== '0.1.0') {
  throw new Error(`Unsupported Anchor IDL specification: ${idl.metadata.spec}`);
}
const client = createFromRoot(rootNodeFromAnchor(idl));
await client.accept(
  renderVisitor(fileURLToPath(new URL('../packages/protocol', import.meta.url)), {
    syncPackageJson: false,
    erasableSyntax: true,
    // Keep generator formatting identical inside the repository and in temporary checks.
    prettierOptions: { singleQuote: false, printWidth: 80, trailingComma: 'all' },
  }),
);
