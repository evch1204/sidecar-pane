import fs from 'node:fs'; import path from 'node:path';
import {files, text, OUT} from './boards.mjs';
import {kit} from './kit.mjs';
import {dump} from './lib.mjs';
files['Kit.dc.html'] = kit;
// Version 3 reads the theme Version 1 set, so it is built before Version 2 changes it.
const {files3} = await import('./v3.mjs');
Object.assign(files, files3);
const {files2, text2} = await import('./v2.mjs');
Object.assign(files, files2); Object.assign(text, text2);
fs.mkdirSync(OUT, {recursive: true});
for (const [name, html] of Object.entries(files)) fs.writeFileSync(path.join(OUT, name), html);
// canvas.json (where each board sits, the pages, the notes) is kept by hand
// beside the boards: the canvas itself edits it, so it is never regenerated.
if (process.argv.includes('--text')) for (const [name, rows] of Object.entries(text)) { console.log('\n=== ' + name); console.log(dump(rows).join('\n')); }
for (const [name, html] of Object.entries(files)) console.log(name, (html.length / 1024).toFixed(0) + ' KB');
