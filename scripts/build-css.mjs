import {readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';

const directory = process.argv[2];
if (!['intel', 'pay', 'launchpad'].includes(directory)) {
    throw new Error('Usage: node scripts/build-css.mjs <intel|pay|launchpad>');
}
const from = resolve(directory, 'tailwind.input.css');
const to = resolve(directory, 'tailwind.css');
// One-shot builds do not need the CLI's file watcher dependency tree.
const result = await postcss([tailwind({optimize: {minify: true}})])
    .process(await readFile(from, 'utf8'), {from, to, map: false});
for (const warning of result.warnings()) console.warn(warning.toString());
await writeFile(to, result.css);
