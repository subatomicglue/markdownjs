#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { markdownToAST, astToHTML, markdownToHtml } = require('./markdown');

const inputFilename = process.argv[2];
if (!inputFilename) {
  console.error('Usage: node markdown2html.js <input.md>');
  process.exit(1);
}

const inputPath = path.resolve(inputFilename);
const parsedPath = path.parse(inputPath);
const outputBase = path.join(parsedPath.dir, parsedPath.name);
const astPath = `${outputBase}_ast.json`;
const htmlPath = `${outputBase}.html`;

const markdown = fs.readFileSync(inputPath, 'utf8');
const ast = markdownToAST(markdown);
const html = astToHTML(ast);

// Exercise the convenience pipeline as a sanity check: it should render the
// same HTML as explicitly converting Markdown -> AST -> HTML above.
if (html !== markdownToHtml(markdown)) {
  throw new Error('astToHTML(ast) did not match markdownToHtml(markdown)');
}

const document = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${parsedPath.name}</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 2rem; line-height: 1.5; }
    pre { background: #111; color: #f8f8f2; padding: 1rem; overflow-x: auto; }
    code { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }
    .fence-box { border: 1px solid #ddd; padding: 1rem; margin-bottom: 1rem; }
    blockquote { border-left: 4px solid #ccc; padding-left: 1rem; color: #555; }
    table { border-collapse: collapse; width: 100%; margin-bottom: 1rem; }
    td { border: 1px solid #ccc; padding: 0.25rem 0.5rem; }
  </style>
</head>
<body>
${html}
</body>
</html>`;

fs.writeFileSync(astPath, `${JSON.stringify(ast, null, 2)}\n`);
fs.writeFileSync(htmlPath, document);

console.log(`Generated ${path.basename(htmlPath)}`);
console.log(`Debug AST: ${path.basename(astPath)}`);
