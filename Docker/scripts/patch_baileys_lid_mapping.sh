#!/bin/sh
set -eu

TARGET="${BAILEYS_LID_MAPPING_FILE:-/evolution/node_modules/baileys/lib/Signal/lid-mapping.js}"

if [ ! -f "$TARGET" ]; then
  echo "Baileys LID mapping file not found: $TARGET" >&2
  exit 1
fi

node - "$TARGET" <<'NODE'
const fs = require('fs');

const file = process.argv[2];
const source = fs.readFileSync(file, 'utf8');
const old = '            else {\n                return null;\n            }';
const replacement = '            else {\n                // Preserve mappings resolved from cache when no new USync pairs are returned.\n                return Object.values(successfulPairs);\n            }';

if (source.includes(replacement)) {
  process.stdout.write(`Baileys LID mapping patch already applied: ${file}\n`);
  process.exit(0);
}

const occurrences = source.split(old).length - 1;
if (occurrences !== 1) {
  throw new Error(`Unexpected Baileys lid-mapping.js shape: found ${occurrences} target block(s)`);
}

fs.writeFileSync(file, source.replace(old, replacement));
process.stdout.write(`Applied Weagles Baileys LID mapping patch: ${file}\n`);
NODE
