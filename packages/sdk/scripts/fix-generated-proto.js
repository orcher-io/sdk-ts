#!/usr/bin/env node

/**
 * Post-processes the generated protobuf TypeScript files so they compile under
 * strict mode. The fixes are minimal and do not change behavior:
 * - adds `override` modifiers to methods that override base class methods
 * - adds non-null assertions where the value is guaranteed to be non-null
 */

const fs = require('fs');
const path = require('path');

const GENERATED_DIR = path.join(__dirname, '../src/core/generated');

// Methods that override base class methods in protobuf-ts.
const OVERRIDE_METHODS = [
  'create',
  'internalBinaryRead',
  'internalBinaryWrite',
  'internalJsonRead',
  'internalJsonWrite',
  'toJson',
  'fromJson',
];

function fixGeneratedFile(filePath) {
  console.log(`Processing: ${path.relative(GENERATED_DIR, filePath)}`);

  let content = fs.readFileSync(filePath, 'utf8');
  let changes = [];

  // Add the override modifier to methods that override base class methods.
  OVERRIDE_METHODS.forEach((method) => {
    const regex = new RegExp(`^(\\s{4})${method}\\(`, 'gm');
    const before = content;
    content = content.replace(regex, `$1override ${method}(`);
    if (content !== before) {
      changes.push(`Added override to ${method}()`);
    }
  });

  // Add a non-null assertion to reflectionMergePartial calls. Safe because the
  // generated code checks value !== undefined before the call.
  const before2 = content;
  content = content.replace(
    /reflectionMergePartial<([^>]+)>\(this, message, value\)/g,
    'reflectionMergePartial<$1>(this, message, value!)'
  );
  if (content !== before2) {
    changes.push('Added non-null assertions for reflectionMergePartial');
  }

  // Add a non-null assertion to this.methods array access. The array is
  // initialized in the constructor, so the entry always exists.
  const before3 = content;
  content = content.replace(/this\.methods\[(\d+)\](?!\!)/g, 'this.methods[$1]!');
  if (content !== before3) {
    changes.push('Added non-null assertions for methods array access');
  }

  // In duration.ts, `sign` and `secs` are typed as possibly undefined but are
  // always assigned before this return.
  const before4 = content;
  content = content.replace(/return sign \* secs;/g, 'return sign! * secs!;');
  if (content !== before4) {
    changes.push('Fixed duration sign * secs');
  }

  if (changes.length > 0) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`  ✓ Applied ${changes.length} fix types`);
  } else {
    console.log(`  - No changes needed`);
  }

  return changes.length;
}

function processDirectory(dir) {
  if (!fs.existsSync(dir)) {
    console.error(`Generated directory not found: ${dir}`);
    console.log('Run "npm run proto:generate" first to generate protobuf files.');
    process.exit(1);
  }

  let totalFiles = 0;
  let totalChanges = 0;

  function processRecursive(currentDir) {
    const items = fs.readdirSync(currentDir);

    items.forEach((item) => {
      const itemPath = path.join(currentDir, item);
      const stat = fs.statSync(itemPath);

      if (stat.isDirectory()) {
        processRecursive(itemPath);
      } else if (stat.isFile() && item.endsWith('.ts')) {
        const changeCount = fixGeneratedFile(itemPath);
        totalFiles++;
        totalChanges += changeCount;
      }
    });
  }

  processRecursive(dir);
  console.log(`\n✓ Processed ${totalFiles} files with ${totalChanges} changes`);
}

console.log('Fixing generated protobuf files...\n');
processDirectory(GENERATED_DIR);
