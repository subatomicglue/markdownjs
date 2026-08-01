'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  markdownToAST,
  astToHTML,
  markdownToHtml
} = require('./markdown');
const {
  htmlToMarkdown,
  splitTopicQueryHash,
  extractFirstImage
} = require('./htmlToMarkdown');

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function stripIndent(text) {
  if (typeof text !== 'string') {
    text = String(text ?? '');
  }
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  while (lines.length && lines[0].trim() === '') {
    lines.shift();
  }
  while (lines.length && lines[lines.length - 1].trim() === '') {
    lines.pop();
  }
  let indent = null;
  lines.forEach(line => {
    if (!line.trim()) {
      return;
    }
    const leading = line.match(/^\s*/)[0].length;
    indent = indent === null ? leading : Math.min(indent, leading);
  });
  if (indent && indent > 0) {
    for (let i = 0; i < lines.length; i += 1) {
      lines[i] = lines[i].slice(indent);
    }
  }
  return lines.join('\n');
}

function childTypes(node) {
  return (node.children || []).map(child => child.type);
}

function assertChildTypes(node, expectedTypes, message) {
  assert.deepStrictEqual(childTypes(node), expectedTypes, message);
}

function formatPath(path) {
  if (!path.length) {
    return 'root';
  }
  return ['root']
    .concat(path.map(index => `children[${index}]`))
    .join(' -> ');
}

function getNodeAtPath(root, path) {
  let node = root;
  path.forEach((index, depth) => {
    assert.ok(
      node && Array.isArray(node.children),
      `Node at ${formatPath(path.slice(0, depth))} has no children`
    );
    assert.ok(
      node.children[index] !== undefined,
      `Node at ${formatPath(path.slice(0, depth))} missing child index ${index}`
    );
    node = node.children[index];
  });
  return node;
}

function assertNodeTypeAtPath(root, path, expectedType, message) {
  const node = getNodeAtPath(root, path);
  assert.strictEqual(
    node.type,
    expectedType,
    message || `Expected ${expectedType} at ${formatPath(path)}, found ${node.type}`
  );
  return node;
}

function assertNodeContentAtPath(root, path, expectedContent, message) {
  const node = getNodeAtPath(root, path);
  assert.strictEqual(
    (node.content || '').trim(),
    expectedContent,
    message || `Expected content "${expectedContent}" at ${formatPath(path)}, found "${node.content}"`
  );
  return node;
}

function assertHtmlBlockIncludes(html, block, message) {
  const expected = stripIndent(block);
  assert.ok(
    html.includes(expected),
    message || `Expected HTML to include block:\n${expected}`
  );
}

function assertHtmlBlockExact(html, expected, message) {
  if (html !== expected && process.env.SHOW_HTML_MISMATCH !== '0') {
    console.error('Actual HTML output:\n', html);
    console.error('Expected HTML output:\n', expected);
  }
  assert.strictEqual(html, expected, message || 'HTML output did not match exactly.');
}


function findNode(root, predicate) {
  if (!root) {
    return null;
  }
  if (Array.isArray(root)) {
    for (const node of root) {
      const found = findNode(node, predicate);
      if (found) {
        return found;
      }
    }
    return null;
  }
  if (predicate(root)) {
    return root;
  }
  for (const child of root.children || []) {
    const found = findNode(child, predicate);
    if (found) {
      return found;
    }
  }
  return null;
}

test('document splits according to simple custom block rules', () => {
  const basicRules = {
    document: { parse: 'block', regex: null, children: ['letters', 'digits'] },
    letters: { parse: 'block', regex: /[a-z]+/, children: [] },
    digits: { parse: 'block', regex: /\d+/, children: [] }
  };
  const ast = markdownToAST('abc123', basicRules);
  assert.strictEqual(ast.children.length, 2, 'expected two top-level children');
  assert.deepStrictEqual(
    ast.children.map(node => node.type),
    ['letters', 'digits']
  );
  assert.strictEqual(ast.children[0].raw, 'abc');
  assert.strictEqual(ast.children[1].raw, '123');
});

test('parser recurses through nested block hierarchies', () => {
  const nestedRules = {
    document: { parse: 'block', regex: null, children: ['section'] },
    section: {
      parse: 'block',
      regex: /\{([^}]+)\}/,
      contentGroup: 1,
      children: ['word']
    },
    word: {
      parse: 'block',
      regex: /([A-Za-z]+);/,
      contentGroup: 1,
      children: []
    }
  };
  const ast = markdownToAST('{alpha;beta;}{gamma;}', nestedRules);
  assert.strictEqual(ast.children.length, 2, 'expected two sections');
  const [firstSection, secondSection] = ast.children;
  assert.strictEqual(firstSection.children.length, 2, 'first section should have two words');
  assert.deepStrictEqual(
    firstSection.children.map(child => child.content),
    ['alpha', 'beta']
  );
  assertChildTypes(firstSection, ['word', 'word'], 'section should only contain word nodes');
  assertChildTypes(secondSection, ['word'], 'second section should contain a single word node');
  assert.strictEqual(secondSection.children.length, 1);
  assert.strictEqual(secondSection.children[0].content, 'gamma');
});

test('inline parsing handles emphasis, code, links, and nesting', () => {
  const source =
    'Intro **bold *nested italic*** text with `code` and a [link](https://example.com).';
  const ast = markdownToAST(source);
  const paragraph = ast.children.find(child => child.type === 'paragraph');
  assert.ok(paragraph, 'expected a paragraph node');
  const childTypes = paragraph.children.map(child => child.type);
  assert.ok(childTypes.includes('inlineStrong'), 'missing strong node');
  assert.ok(childTypes.includes('inlineCode'), 'missing code node');
  assert.ok(childTypes.includes('inlineLink'), 'missing link node');
  const link = paragraph.children.find(child => child.type === 'inlineLink');
  assert.strictEqual(link.captures.title, 'link', 'missing link title should default to link text');
  const strong = paragraph.children.find(child => child.type === 'inlineStrong');
  assert.ok(
    strong.children.some(child => child.type === 'inlineEmphasis'),
    'expected nested emphasis inside strong text'
  );
});

test('all heading levels render correct HTML', () => {
  const source = stripIndent(`
# Heading1
## Heading2
### Heading3
#### Heading4
##### Heading5
###### Heading6
`);
  const html = markdownToHtml(source);
  for (let level = 1; level <= 6; level += 1) {
    assert.ok(html.includes(`<h${level} id="Heading${level}">Heading${level}<a title="Permalink to this heading" href="#Heading${level}"><span class="copy-icon" role="button" aria-label="Link Icon"></span></a></h${level}>`), `missing h${level}`);
  }
});

test('TOC directives are grammar blocks and select headings by scope', () => {
  const source = '# Before\n<!-- toc -->\n## After\n### Child\n';
  const ast = markdownToAST(source);
  assertChildTypes(ast, ['heading', 'tocDirective', 'heading', 'heading']);
  assert.strictEqual(ast.children[1].content, 'toc');
  const local = markdownToHtml(source);
  assert.ok(!local.includes('<a href="#Before">Before</a></li></ul>'));
  assert.ok(local.includes('<ul><li><a href="#After">After</a><ul><li><a href="#Child">Child</a></li></ul></li></ul>'));
  const all = markdownToHtml(source.replace('<!-- toc -->', '<!-- toc-all -->'));
  assert.ok(all.includes('<ul><li><a href="#Before">Before</a><ul><li><a href="#After">After</a>'));
});

test('user variables resolve from renderer userdata', () => {
  const source = '{{ user:12345 }} and {{ user:missing }}';
  const ast = markdownToAST(source);
  assert.strictEqual(ast.children[0].children[0].type, 'inlineVariable');
  assert.strictEqual(
    markdownToHtml(source, '/base', { userdata: { testuser: { id: '12345' } } }),
    '<p>testuser and {{ user:missing }}</p>'
  );
});

test('renderer API supports rules, options, legacy base URL, and custom templates', () => {
  assert.strictEqual(markdownToHtml('[x](topic)', '/base'), '<p><a href="/base/topic" title="x">x</a></p>');
  assert.strictEqual(
    markdownToHtml('# Heading', { headingPermalinks: false, headingIds: false }),
    '<h1>Heading</h1>'
  );
  const rules = Object.fromEntries(Object.entries(require('./default_rules').defaultRules)
    .map(([name, rule]) => [name, { ...rule }]));
  rules.paragraph.html = { template: '<article>${children}</article>' };
  assert.strictEqual(markdownToHtml('body', { rules }), '<article>body</article>');
});

test('heading slugs and TOC targets agree for punctuation and Unicode', () => {
  const html = markdownToHtml('<!-- toc-all -->\n# A colon: comma, and Büoenn\n');
  const id = html.match(/<h1 id="([^"]+)"/)[1];
  const href = html.match(/<a href="#([^"]+)">A colon/)[1];
  assert.strictEqual(href, id);
});

test('horizontal rules have an explicit six-character boundary', () => {
  assert.strictEqual(markdownToAST('------\n').children[0].type, 'horizontalRule');
  ['---\nbody\n---\n', '----\n', '-----\n'].forEach(source => {
    assert.notStrictEqual(markdownToAST(source).children[0].type, 'horizontalRule');
  });
});

test('blockquotes recursively contain multiple ordinary block types', () => {
  const source = '> First\n>\n> - one\n> - two\n>\n> ## Heading\n';
  const ast = markdownToAST(source);
  const quote = assertNodeTypeAtPath(ast, [0], 'blockquote');
  assertChildTypes(quote, ['paragraph', 'blankLines', 'unorderedList', 'blankLines', 'heading']);
  assertNodeTypeAtPath(quote, [2, 0], 'listItem');
});

test('mixed quote marker runs remain literal paragraph text', () => {
  for (const source of ['>} mixed marker', '}> mixed marker']) {
    const ast = markdownToAST(source);
    assertChildTypes(ast, ['paragraph']);
    assert.strictEqual(ast.children[0].content, source);
    const escaped = source.replace(/>/g, '&gt;');
    assert.strictEqual(markdownToHtml(source), `<p>${escaped}</p>`);
  }
});

test('lists nest structurally inside fences', () => {
  const ast = markdownToAST('---\n- outer\n  - inner\n---\n');
  assertNodeTypeAtPath(ast, [0, 0], 'unorderedList');
  assertNodeTypeAtPath(ast, [0, 0, 0, 1], 'unorderedList');
});

test('unordered lists handle indentation across nested levels', () => {
  const source = stripIndent(`
- level 1
  - level 2
    - level 3
`);
  const ast = markdownToAST(source);
  const list = ast.children.find(child => child.type === 'unorderedList');
  assert.ok(list, 'expected unordered list node');
  assertNodeContentAtPath(ast, [0, 0, 0], 'level 1');
  assertNodeTypeAtPath(ast, [0, 0, 1], 'unorderedList');
  assertNodeContentAtPath(ast, [0, 0, 1, 0, 0], 'level 2');
  assertNodeTypeAtPath(ast, [0, 0, 1, 0, 1], 'unorderedList');
  assertNodeContentAtPath(ast, [0, 0, 1, 0, 1, 0, 0], 'level 3');
});

test('unordered list AST path verification', () => {
  const source = stripIndent(`
- alpha
- beta
- gamma
`);
  const ast = markdownToAST(source);
  assert.strictEqual(ast.children.length, 1, 'expected a single unordered list block');
  assertNodeTypeAtPath(ast, [0], 'unorderedList', 'expected first block to be an unordered list');
  ['alpha', 'beta', 'gamma'].forEach((text, index) => {
    assertNodeTypeAtPath(ast, [0, index], 'listItem', `list item ${index} should be a listItem node`);
    assertNodeTypeAtPath(
      ast,
      [0, index, 0],
      'inlineText',
      `list item ${index} should begin with inline text`
    );
    assertNodeContentAtPath(ast, [0, index, 0], text, `list item ${index} text mismatch`);
  });
});

test('inline formatting variations render expected HTML output', () => {
  const source = stripIndent(`
**bold**
*italics*
__underscore__
[link title](http://example.com/resource name)
![image title](http://example.com/image file.png "caption")
`);
  const html = markdownToHtml(source);
  const ast = markdownToAST(source);
  assert.ok(ast.children[0].children.some(child => child.type === 'inlineUnderline'));
  const expectedHtml = stripIndent(`
<p><strong>bold</strong><br /><em>italics</em><br /><u>underscore</u><br /><a href="http://example.com/resource name" title="link title">link title</a><br /><img src="http://example.com/image file.png" alt="image title" title="caption" /></p>
`);
  assert.strictEqual(html, expectedHtml);
});

test('inline HTML is represented by inline AST nodes and can be escaped', () => {
  const source = '<span data-kind="example">word</span> after <br />';
  const ast = markdownToAST(source);
  assertChildTypes(ast.children[0], [
    'inlineHtml', 'inlineText', 'inlineHtml', 'inlineText', 'inlineHtml'
  ]);
  assert.strictEqual(markdownToHtml(source), `<p>${source}</p>`);
  assert.strictEqual(
    markdownToHtml(source, { allowInlineHtml: false }),
    '<p>&lt;span data-kind=&quot;example&quot;&gt;word&lt;/span&gt; after &lt;br /&gt;</p>'
  );
});

test('color spans are semantic inline formatting rather than generic HTML', () => {
  const source = '<span style="color:#ff0000">red **bold**</span>';
  const ast = markdownToAST(source);
  const color = assertNodeTypeAtPath(ast, [0, 0], 'inlineColor');
  assert.strictEqual(color.captures.color, '#ff0000');
  assertChildTypes(color, ['inlineText', 'inlineStrong']);
  assert.strictEqual(
    markdownToHtml(source),
    '<p><span style="color:#ff0000">red <strong>bold</strong></span></p>'
  );
  assert.strictEqual(
    markdownToHtml(source, { allowInlineHtml: false }),
    '<p><span style="color:#ff0000">red <strong>bold</strong></span></p>'
  );
});

test('semantic color spans require non-whitespace content boundaries', () => {
  const valid = markdownToAST('<span style="color:#fff">white space inside</span>');
  assert.strictEqual(valid.children[0].children[0].type, 'inlineColor');
  for (const source of [
    '<span style="color:#fff"> leading</span>',
    '<span style="color:#fff">trailing </span>'
  ]) {
    const ast = markdownToAST(source);
    assert.ok(!ast.children[0].children.some(child => child.type === 'inlineColor'));
  }
});

test('strong and underline delimiters require non-whitespace content edges', () => {
  const source = '**valid** **two words** ** invalid** **invalid ** __also valid__ __ invalid__ __invalid __';
  const html = markdownToHtml(source);
  assert.strictEqual(
    html,
    '<p><strong>valid</strong> <strong>two words</strong> ** invalid** **invalid ** <u>also valid</u> __ invalid__ __invalid __</p>'
  );
});

test('strong can be immediately followed by emphasis', () => {
  const source = '**A.***one who cries*';
  const ast = markdownToAST(source);
  assertChildTypes(ast.children[0], ['inlineStrong', 'inlineEmphasis']);
  assert.strictEqual(markdownToHtml(source), '<p><strong>A.</strong><em>one who cries</em></p>');

  const afterEarlierStrong = '**[word](https://example.com)**,\n**A.***one who cries*';
  const paragraph = markdownToAST(afterEarlierStrong).children[0];
  assertChildTypes(paragraph, [
    'inlineStrong', 'inlineText', 'inlineLineBreak', 'inlineStrong', 'inlineEmphasis'
  ]);
  assert.strictEqual(paragraph.children[0].raw, '**[word](https://example.com)**');
  assert.strictEqual(paragraph.children[3].raw, '**A.**');
});

test('links and images default missing titles to their visible names', () => {
  const ast = markdownToAST('[name](/page) ![description](/image.png)');
  const paragraph = ast.children[0];
  const link = paragraph.children.find(child => child.type === 'inlineLink');
  const image = paragraph.children.find(child => child.type === 'inlineImage');
  assert.strictEqual(link.captures.title, 'name');
  assert.strictEqual(image.captures.title, 'description');
  assert.strictEqual(
    markdownToHtml('[name](/page) ![description](/image.png)'),
    '<p><a href="/page" title="name">name</a> <img src="/image.png" alt="description" title="description" /></p>'
  );
});

test('blockquote markers capture and render nested quote depth', () => {
  const source = '> one\n>> two\n>>> three\n> one again\n';
  const ast = markdownToAST(source);
  const quote = assertNodeTypeAtPath(ast, [0], 'blockquote');
  assertChildTypes(quote, ['paragraph', 'blockquote', 'paragraph']);
  assertNodeTypeAtPath(quote, [1, 1], 'blockquote');
  assert.strictEqual(
    markdownToHtml(source),
    '<blockquote>\n  <p>one</p>\n  <blockquote>\n    <p>two</p>\n    <blockquote>\n      <p>three</p>\n    </blockquote>\n  </blockquote>\n  <p>one again</p>\n</blockquote>'
  );

  const fenced = markdownToAST('>>>\n> typing in here\n>>>\n');
  assertNodeTypeAtPath(fenced, [0], 'fencedBox', '>>> pair should remain a fence');
  const nestedQuote = assertNodeTypeAtPath(fenced, [0, 0], 'blockquote', 'fence should contain a line quote');
  assertNodeTypeAtPath(nestedQuote, [0], 'paragraph');
});

test('invisible quote lines terminate an adjacent paragraph', () => {
  const source = 'ordinary first\nordinary second\n}} nested\n} base\n';
  const ast = markdownToAST(source);
  assertChildTypes(ast, ['paragraph', 'invisibleBlockquote']);
  const quote = assertNodeTypeAtPath(ast, [1], 'invisibleBlockquote');
  assertChildTypes(quote, ['invisibleBlockquote', 'paragraph']);
  assert.strictEqual(
    markdownToHtml(source),
    '<p>ordinary first<br />ordinary second</p>\n' +
      '<blockquote class="invisible-quote">\n' +
      '  <blockquote class="invisible-quote">\n' +
      '    <p>nested</p>\n' +
      '  </blockquote>\n' +
      '  <p>base</p>\n' +
      '</blockquote>'
  );
});

test('table AST path verification', () => {
  const source = stripIndent(`
| H1 | H2 |
| C1 | C2 |
`);
  const ast = markdownToAST(source);
  assert.strictEqual(ast.children.length, 1, 'expected only a table block');
  assertNodeTypeAtPath(ast, [0], 'table', 'expected table at root position 0');
  assertNodeTypeAtPath(ast, [0, 0], 'tableRow', 'expected first row node');
  assertNodeTypeAtPath(ast, [0, 1], 'tableRow', 'expected second row node');
  assertNodeTypeAtPath(ast, [0, 0, 1], 'tableCell', 'expected first row first cell');
  assertNodeTypeAtPath(ast, [0, 0, 3], 'tableCell', 'expected first row second cell');
  assertNodeContentAtPath(ast, [0, 0, 1], 'H1', 'first header cell mismatch');
  assertNodeContentAtPath(ast, [0, 0, 3], 'H2', 'second header cell mismatch');
  assertNodeContentAtPath(ast, [0, 1, 1], 'C1', 'first body cell mismatch');
  assertNodeContentAtPath(ast, [0, 1, 3], 'C2', 'second body cell mismatch');
});

test('fenced blocks AST path verification', () => {
  const source = stripIndent(`
---
**boxed** line
---
\`\`\`js
console.log(1);
\`\`\`
`);
  const ast = markdownToAST(source);
  assertNodeTypeAtPath(ast, [0], 'fencedBox', 'expected first block to be fenced box');
  const fence = assertNodeTypeAtPath(ast, [1], 'fencedCode', 'expected second block to be fenced code');
  assertNodeTypeAtPath(ast, [0, 0], 'paragraph', 'boxed content should start with a paragraph');
  assertNodeTypeAtPath(
    ast,
    [0, 0, 0],
    'inlineStrong',
    'boxed paragraph should start with strong inline content'
  );
  assertChildTypes(fence, ['inlineText'], 'fenced code should expose inline children');
  assert.strictEqual(
    (fence.children[0].content || '').trim(),
    'console.log(1);',
    'fenced code inline text mismatch'
  );
  assertNodeContentAtPath(ast, [1], 'console.log(1);', 'code block content mismatch');
});

test('fenced code allows inline strong/emphasis children', () => {
  const source = stripIndent(`
\`\`\`
**NOTE:** format inside *code*
\`\`\`
`);
  const ast = markdownToAST(source);
  const code = assertNodeTypeAtPath(ast, [0], 'fencedCode', 'expected fenced code at root');
  assertChildTypes(
    code,
    ['inlineStrong', 'inlineText', 'inlineEmphasis'],
    'code block should parse inline formatting nodes'
  );
  const strong = code.children[0];
  assert.strictEqual(strong.type, 'inlineStrong');
  assert.strictEqual(
    (strong.children[0].content || '').trim(),
    'NOTE:',
    'strong child content mismatch in code block'
  );
  const emphasis = code.children[2];
  assert.strictEqual(emphasis.type, 'inlineEmphasis');
  assert.strictEqual(
    (emphasis.children[0].content || '').trim(),
    'code',
    'emphasis child content mismatch in code block'
  );
});

test('parser recurses through nested block hierarchies for real markdown blocks', () => {
  const source = stripIndent(`
# Heading 1

Paragraph body text spanning only one line.

\`\`\`js
console.log("code");
\`\`\`

| Col A | Col B |
| Value A | Value B |
`);
  const ast = markdownToAST(source);
  const types = ast.children.map(node => node.type);
  assert.deepStrictEqual(types, [
    'heading',
    'blankLines',
    'paragraph',
    'blankLines',
    'fencedCode',
    'blankLines',
    'table'
  ]);
  const heading = ast.children[0];
  assertChildTypes(heading, ['inlineText'], 'heading should only have inline text child');
  assert.strictEqual(heading.children[0].content, 'Heading 1');
  const paragraph = ast.children[2];
  assertChildTypes(paragraph, ['inlineText'], 'paragraph should only contain inline text');
  assert.strictEqual(paragraph.children.length, 1);
  const fence = ast.children[4];
  assertChildTypes(fence, ['inlineText'], 'code fence should expose inline children');
  assert.strictEqual(
    (fence.children[0].content || '').trim(),
    'console.log("code");',
    'unexpected inline text content in code fence'
  );
  assert.strictEqual(fence.captures.language.trim(), 'js');
  const table = ast.children[6];
  assertChildTypes(table, ['tableRow', 'tableRow'], 'table should contain two rows');
  const firstRow = table.children[0];
  assertChildTypes(
    firstRow,
    ['tableDivider', 'tableCell', 'tableDivider', 'tableCell', 'tableDivider'],
    'table rows should alternate divider and cells'
  );
  assertChildTypes(firstRow.children[1], ['inlineText'], 'table cell should contain inline text only');
  assert.strictEqual(table.children.length, 2, 'table should have two data rows');
});

test('astToHTML renders manual AST tree reliably', () => {
  const manualAst = {
    type: 'document',
    raw: '',
    content: '',
    captures: {},
    children: [
      {
        type: 'heading',
        raw: '',
        content: 'Manual Heading',
        captures: { depth: '##' },
        children: [{ type: 'inlineText', raw: '', content: 'Manual Heading', captures: {}, children: [] }]
      },
      {
        type: 'paragraph',
        raw: '',
        content: 'Manual paragraph body.',
        captures: {},
        children: [{ type: 'inlineText', raw: '', content: 'Manual paragraph body.', captures: {}, children: [] }]
      },
      {
        type: 'unorderedList',
        raw: '',
        content: '',
        captures: {},
        children: [
          {
            type: 'listItem',
            raw: '',
            content: '',
            captures: {},
            children: [{ type: 'inlineText', raw: '', content: 'Item One', captures: {}, children: [] }]
          }
        ]
      }
    ]
  };
  const html = astToHTML(manualAst, undefined, { headingPermalinks: false, headingIds: false });
  const expectedHtml = stripIndent(`
<h2>Manual Heading</h2>
<p>Manual paragraph body.</p>
<ul>
  <li>Item One</li>
</ul>
`);
  assert.strictEqual(html, expectedHtml);
});

test('markdownToHtml produces combined html for common blocks', () => {
  const source = stripIndent(`
# Title

Paragraph with **bold** and *italic*.

- Item one
- Item two

> Quoted line

\`\`\`
code block
\`\`\`
`);
  const html = markdownToHtml(source, undefined, undefined, { headingPermalinks: false, headingIds: false });
  const expectedHtml = stripIndent(`
<h1>Title</h1>
<p>Paragraph with <strong>bold</strong> and <em>italic</em>.</p>
<ul>
  <li>Item one</li>
  <li>Item two</li>
</ul>
<blockquote>
  <p>Quoted line</p>
</blockquote>
<div class="pre-container pre-coloring"><div class="pre-container-scroll-wrapper"><pre><code>code block</code></pre></div></div>
`);
  assert.strictEqual(html, expectedHtml);
});

const migratedHtmlToMarkdownCases = [
  {
    "html": "<meta charset='utf-8'><h3>What it does:</h3>\n<ol>\n<li>\n<p><strong>Sorts clipboard types</strong> so all <code>text/*</code> come first.</p>\n</li>\n<li>\n<p><strong>Filters out</strong> any types that are image-based.</p>\n</li>\n<li>\n<p><strong>Gets clipboard data</strong>, filters to ensure it’s a non-empty string.</p>\n</li>\n<li>\n<p><strong>Returns</strong> the first matching string, or an empty string if nothing is found.</p>\n</li>\n</ol>\n<p>Let me know if you'd like it to also log the types for debugging, or preserve the original type name with the data.</p>",
    "expected": "### What it does:\n\n 1. **Sorts clipboard types** so all `text/*` come first.\n 2. **Filters out** any types that are image-based.\n 3. **Gets clipboard data**, filters to ensure it’s a non-empty string.\n 4. **Returns** the first matching string, or an empty string if nothing is found.\n\nLet me know if you'd like it to also log the types for debugging, or preserve the original type name with the data.\n"
  },
  {
    "html": "<meta charset='utf-8'><meta charset=\"utf-8\"><b style=\"font-weight:normal;\" id=\"docs-internal-guid-8149a452-7fff-8a08-3ee4-bdad800da9b1\"><h1 dir=\"ltr\" style=\"line-height:1.38;margin-top:20pt;margin-bottom:6pt;\"><span style=\"font-size:20pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;\">Books</span></h1><ul style=\"margin-top:0;margin-bottom:0;padding-inline-start:48px;\"><li dir=\"ltr\" style=\"list-style-type:disc;font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;\" aria-level=\"1\"><p dir=\"ltr\" style=\"line-height:1.38;margin-top:0pt;margin-bottom:0pt;\" role=\"presentation\"><span style=\"font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;\">My Book 1</span></p></li><li dir=\"ltr\" style=\"list-style-type:disc;font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;\" aria-level=\"1\"><p dir=\"ltr\" style=\"line-height:1.38;margin-top:0pt;margin-bottom:0pt;\" role=\"presentation\"><span style=\"font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;\">My Book 2</span></p></li><li dir=\"ltr\" style=\"list-style-type:disc;font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;\" aria-level=\"1\"><p dir=\"ltr\" style=\"line-height:1.38;margin-top:0pt;margin-bottom:0pt;\" role=\"presentation\"><span style=\"font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;\">My Book 3</span></p></li></ul></b>",
    "expected": "# Books\n\n - My Book 1\n - My Book 2\n - My Book 3\n"
  },
  {
    "html": "<meta charset='utf-8'><h3>heading 1</h3>\n<div class=\"_tableContainer_16hzy_1\"><div tabindex=\"-1\" class=\"_tableWrapper_16hzy_14 group flex w-fit flex-col-reverse\"><table class=\"w-fit min-w-(--thread-content-width)\"><thead><tr><th data-col-size=\"sm\">Feature</th><th data-col-size=\"sm\">Bacteria</th><th data-col-size=\"md\">Mycelium</th></tr></thead><tbody><tr><td data-col-size=\"sm\">Needs</td><td data-col-size=\"sm\">Yes</td><td data-col-size=\"md\">No</td></tr><tr><td data-col-size=\"sm\">Maybe</td><td data-col-size=\"sm\">Not</td><td data-col-size=\"md\">Yes</td></tr><tr><td data-col-size=\"sm\">Moist</td><td data-col-size=\"sm\">Critical</td><td data-col-size=\"md\">Important</td></tr><tr><td data-col-size=\"sm\">Survival</td><td data-col-size=\"sm\">Very poor</td><td data-col-size=\"md\">Often succeeds</td></tr></tbody></table><div class=\"sticky end-(--thread-content-margin) h-0 self-end select-none\"><div class=\"absolute end-0 flex items-end\"><span data-state=\"closed\"><button class=\"bg-token-bg-primary hover:bg-token-bg-tertiary text-token-text-secondary my-1 rounded-sm p-1 transition-opacity group-[:not(:hover):not(:focus-within)]:pointer-events-none group-[:not(:hover):not(:focus-within)]:opacity-0\"><svg width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\" class=\"icon-md-heavy\"><path fill-rule=\"evenodd\" clip-rule=\"evenodd\" d=\"M7 5C7 3.34315 8.34315 2 10 2H19C20.6569 2 22 3.34315 22 5V14C22 15.6569 20.6569 17 19 17H17V19C17 20.6569 15.6569 22 14 22H5C3.34315 22 2 20.6569 2 19V10C2 8.34315 3.34315 7 5 7H7V5ZM9 7H14C15.6569 7 17 8.34315 17 10V15H19C19.5523 15 20 14.5523 20 14V5C20 4.44772 19.5523 4 19 4H10C9.44772 4 9 4.44772 9 5V7ZM5 9C4.44772 9 4 9.44772 4 10V19C4 19.5523 4.44772 20 5 20H14C14.5523 20 15 19.5523 15 19V10C15 9.44772 14.5523 9 14 9H5Z\" fill=\"currentColor\"></path></svg></button></span></div></div></div></div>\n<hr>\n<h3>heading 2</h3>",
    "expected": "### heading 1\n\n| Feature | Bacteria | Mycelium |\n|---|---|---|\n| Needs | Yes | No |\n| Maybe | Not | Yes |\n| Moist | Critical | Important |\n| Survival | Very poor | Often succeeds |\n\n---------\n### heading 2\n"
  },
  {
    "html": "<meta charset='utf-8'><h3>Heading 1</h3>\n<ul>\n<li>\n<p>The name <strong>Aelius Gallus</strong> appears in both <strong>Dioscorides</strong> and <strong>Galen</strong>, but the <strong>style</strong> of the Greek and the presence of phrases like <strong>\"Caesar agreed\" (Καῖσαρ συμφώνως)</strong> and specific mention of <strong>Charmis</strong> suggest this comes from <strong>Galen</strong>, not from <strong>Dioscorides' De Materia Medica</strong>.</p>\n</li>\n<li>\n<p>Galen frequently:</p>\n<ul>\n<li>\n<p>Mentions antidotes (<strong>ἀντίδοτα</strong>) by name and attribution.</p>\n</li>\n<li>\n<p>References earlier physicians like <strong>Charmis</strong>, <strong>Andromachus</strong>, and <strong>Aelius Gallus</strong>.</p>\n</li>\n<li>\n<p>Cites <strong>imperial approval</strong> of certain compounds, especially those used by <strong>Caesar Augustus</strong>, <strong>Tiberius</strong>, or <strong>Marcus Aurelius</strong>.</p></li></ul></li></ul>",
    "expected": "### Heading 1\n\n - The name **Aelius Gallus** appears in both **Dioscorides** and **Galen**, but the **style** of the Greek and the presence of phrases like **\"Caesar agreed\" (Καῖσαρ συμφώνως)** and specific mention of **Charmis** suggest this comes from **Galen**, not from **Dioscorides' De Materia Medica**.\n - Galen frequently:\n   - Mentions antidotes (**ἀντίδοτα**) by name and attribution.\n   - References earlier physicians like **Charmis**, **Andromachus**, and **Aelius Gallus**.\n   - Cites **imperial approval** of certain compounds, especially those used by **Caesar Augustus**, **Tiberius**, or **Marcus Aurelius**.\n"
  },
  {
    "html": "<div style=\"margin-left: 50px; \"><b>II.</b>---.</div><div class=\"lex_sense lex_sense3\" style=\"margin-left: 100px;\"><b>2.</b>---.</div>",
    "expected": "\n} **II.**---.\n}} **2.**---."
  },
  {
    "html": "<blockquote>hi<blockquote>hi</blockquote></blockquote>",
    "expected": "\n> hi\n>> hi\n"
  },
  {
    "html": "<a href=\"https://www.google.com\" style=\"text-decoration: none; color: rgb(51, 102, 204); background: none; border-radius: 2px; overflow-wrap: break-word;\">[25]</a>",
    "expected": "[&lbrack;25&rbrack;](https://www.google.com)"
  },
  {
    "html": "<a href=\"https://mylink.com/thing?param=*&param2=*\" title=\"*\" alt=\"*\">*</a>",
    "expected": "[&ast;](https://mylink.com/thing?param=%2A&param2=%2A)"
  },
  {
    "html": "<meta charset='utf-8'><meta charset=\"utf-8\"><b style=\"font-weight:normal;\" id=\"docs-internal-guid-53028a7e-7fff-b49d-b75a-b28cb5b9afa5\"><p dir=\"ltr\" style=\"line-height:1.38;margin-top:12pt;margin-bottom:12pt;\"><a href=\"https://www.perseus.tufts.edu/hopper/morph?l=*%29elwi%2F&amp;la=greek&amp;can=*%29elwi%2F0&amp;prior=le/gwn\" style=\"text-decoration:none;\"><span style=\"font-size:17pt;font-family:Arial,sans-serif;color:#ffffff;background-color:transparent;font-weight:400;font-style:italic;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;\">Ἐλωί</span></a></p>",
    "expected": "\n[*Ἐλωί*](https://www.perseus.tufts.edu/hopper/morph?l=%2A%29elwi%2F&la=greek&can=%2A%29elwi%2F0&prior=le/gwn)\n"
  },
  {
    "html": "<a href=\"www.website.com\">*hello* **bold** __underscore__ * _ ** random *thing * is **things ** yeah</a>",
    "expected": "[*hello* **bold** __underscore__ &ast; &#95; &ast;&ast; random &ast;thing &ast; is &ast;&ast;things &ast;&ast; yeah](www.website.com)"
  },
  {
    "html": "<span style=\"color:#ffffff\">words</span>",
    "expected": "words"
  },
  {
    "html": "<span style=\"color:#000000\">words</span>",
    "expected": "words"
  },
  {
    "html": "<span style=\"color:#555555\">words</span>",
    "expected": "words"
  }
];

const migratedHtmlToMarkdownCaseNames = [
  'converts headings, strong text, code, and ordered lists from HTML',
  'converts Google Docs headings and bullet lists from HTML',
  'converts wrapped HTML tables and horizontal rules',
  'converts nested HTML lists with inline strong text',
  'converts margin-based indentation to invisible blockquotes',
  'converts nested HTML blockquotes to nested quote markers',
  'escapes square brackets in HTML link text',
  'encodes literal asterisks in HTML link destinations and text',
  'preserves italic Unicode text inside converted links',
  'escapes unmatched Markdown delimiters inside converted links',
  'removes white text color while preserving its content',
  'removes black text color while preserving its content',
  'removes gray text color while preserving its content'
];

migratedHtmlToMarkdownCases.forEach(({ html, expected }, index) => {
  test(`htmlToMarkdown ${migratedHtmlToMarkdownCaseNames[index]}`, () => {
    assert.strictEqual(htmlToMarkdown(html), expected);
  });
});

test('htmlToMarkdown preserves Google Docs list nesting from aria-level', () => {
  const html = '<b style="font-weight:normal"><ul>' +
    '<li aria-level="1">one</li><ul>' +
    '<li aria-level="2">two</li>' +
    '<ul><li aria-level="3">three</li></ul>' +
    '<li aria-level="2">four</li></ul>' +
    '<li aria-level="1">five</li>' +
    '</ul></b>';
  const markdown = htmlToMarkdown(html);
  assert.strictEqual(markdown, '\n - one\n   - two\n     - three\n   - four\n - five\n');
  const ast = markdownToAST(markdown);
  const listIndex = ast.children.findIndex(node => node.type === 'unorderedList');
  const list = assertNodeTypeAtPath(ast, [listIndex], 'unorderedList');
  assert.strictEqual(list.children.length, 2, 'level-1 items should share one list');
  const nested = assertNodeTypeAtPath(ast, [listIndex, 0, 1], 'unorderedList');
  assert.strictEqual(nested.children.length, 2, 'level-2 items should nest under the first item');
  assertNodeTypeAtPath(ast, [listIndex, 0, 1, 0, 1], 'unorderedList');
});

test('htmlToMarkdown infers flat list nesting from indentation styles', () => {
  const html = '<ul>' +
    '<li>one</li>' +
    '<li style="margin-left:36pt">two</li>' +
    '<li style="margin-left:72pt">three</li>' +
    '<li style="margin-left:50px">four</li>' +
    '</ul>';
  assert.strictEqual(htmlToMarkdown(html), '\n - one\n   - two\n     - three\n   - four\n');
});

test('htmlToMarkdown preserves conventional semantic nested lists', () => {
  const html = '<ul><li>parent<ul><li>child</li></ul></li><li>sibling</li></ul>';
  assert.strictEqual(htmlToMarkdown(html), '\n - parent\n   - child\n - sibling\n');
});

test('htmlToMarkdown preserves conventional nested ordered lists', () => {
  const html = '<ol><li style="list-style-type:decimal">one' +
    '<ol><li style="list-style-type:lower-alpha">two</li></ol>' +
    '</li></ol>';
  assert.strictEqual(htmlToMarkdown(html), '\n 1. one\n   a. two\n');
});

test('htmlToMarkdown restores the parent list type after a nested list', () => {
  const html = '<ul><li>parent<ol><li>numbered</li></ol></li><li>sibling</li></ul>';
  assert.strictEqual(htmlToMarkdown(html), '\n - parent\n   1. numbered\n - sibling\n');
});

test('htmlToMarkdown gives aria-level precedence over indentation styles', () => {
  const html = '<ul><li aria-level="2" style="margin-left:0pt">aria wins</li></ul>';
  assert.strictEqual(htmlToMarkdown(html), '\n   - aria wins\n');
});

test('htmlToMarkdown keeps lists separate when block content intervenes', () => {
  const html = '<ul><li>first</li></ul><p>between</p><ul><li>second</li></ul>';
  assert.strictEqual(htmlToMarkdown(html), '\n - first\n\nbetween\n\n - second\n');
});

const migratedSplitTopicQueryHashCases = [
  {
    "url": "Topic#Hash",
    "expected": [
      "Topic",
      "",
      "Hash"
    ]
  },
  {
    "url": "Topic",
    "expected": [
      "Topic",
      "",
      ""
    ]
  },
  {
    "url": "#Hash",
    "expected": [
      "",
      "",
      "Hash"
    ]
  },
  {
    "url": "Topic?searchterm=bok#Hash",
    "expected": [
      "Topic",
      "searchterm=bok",
      "Hash"
    ]
  },
  {
    "url": "Topic?searchterm=bok",
    "expected": [
      "Topic",
      "searchterm=bok",
      ""
    ]
  },
  {
    "url": "?searchterm=bok#Hash",
    "expected": [
      "",
      "searchterm=bok",
      "Hash"
    ]
  }
];

const migratedSplitTopicQueryHashCaseNames = [
  'splits a topic and fragment',
  'returns an unadorned topic',
  'splits a fragment-only URL',
  'splits a topic, query, and fragment',
  'splits a topic and query',
  'splits a query and fragment without a topic'
];

migratedSplitTopicQueryHashCases.forEach(({ url, expected }, index) => {
  test(`splitTopicQueryHash ${migratedSplitTopicQueryHashCaseNames[index]}`, () => {
    assert.deepStrictEqual(splitTopicQueryHash(url), expected);
  });
});

const migratedExtractFirstImageCases = [
  {
    "markdown": "",
    "maxLines": 10,
    "expectsImage": false
  },
  {
    "markdown": "hello world",
    "maxLines": 10,
    "expectsImage": false
  },
  {
    "markdown": "![image](http://example.com/hello.png)",
    "maxLines": 10,
    "expectsImage": false
  },
  {
    "markdown": "![image](/hello.png)",
    "maxLines": 10,
    "expectsImage": true
  },
  {
    "markdown": "\nhi\nhi blah\nhi asdl\n![image](/hello.png)\n\nblah\nbha\n",
    "maxLines": 10,
    "expectsImage": true
  },
  {
    "markdown": "# heading\n![image](/hello.png)",
    "maxLines": 10,
    "expectsImage": true
  },
  {
    "markdown": "# heading\n![image](/hello.png)\n",
    "maxLines": 10,
    "expectsImage": true
  },
  {
    "markdown": "# heading\n![image](/hello.png)\n\n# heading 2\n",
    "maxLines": 10,
    "expectsImage": true
  },
  {
    "markdown": "# heading\n# heading 2\n![image](/hello.png)\n",
    "maxLines": 10,
    "expectsImage": false
  },
  {
    "markdown": "# heading\n# heading 2\n\n![image](/hello.png)\n",
    "maxLines": 10,
    "expectsImage": false
  },
  {
    "markdown": "# heading\nblah, blah blah\n\n# heading 2\nblah, blah blah\n![image](/hello.png)\n\n# heading 3\nblah, blah blah\n",
    "maxLines": 10,
    "expectsImage": false
  },
  {
    "markdown": "[< back](BokBok)\n\n# bokbokbok\n\n=+=\n![image](/wiki/uploads/1756586904553.jpeg)\n=+=\n\nasdejlkjasd\nasdjklfl\nasdjkl\nasdj\nlasdjk\nloadDataJSONfjl\nkasj\nasdfklj\n\n",
    "maxLines": 10,
    "expectsImage": true
  }
];

const migratedExtractFirstImageCaseNames = [
  'returns no image for empty Markdown',
  'returns no image when Markdown contains only text',
  'rejects an absolute image URL',
  'extracts a root-relative image URL',
  'extracts an image following introductory text',
  'extracts an image directly below one heading',
  'extracts an image below one heading with a trailing newline',
  'extracts an image before a subsequent heading',
  'rejects an image directly below two consecutive headings',
  'rejects an image separated from two consecutive headings',
  'rejects an image buried in a multi-section document',
  'extracts an image from an early fenced box'
];

migratedExtractFirstImageCases.forEach(({ markdown, maxLines, expectsImage }, index) => {
  test(`extractFirstImage ${migratedExtractFirstImageCaseNames[index]}`, () => {
    assert.strictEqual(Boolean(extractFirstImage(markdown, maxLines)), expectsImage);
  });
});


test('megatest markdown document renders without crashing', () => {
  const megaSource = stripIndent(`
# Markdown Test Page

Headings:
# Heading1
## Heading2
### Heading3
#### Heading4
##### Heading5
###### Heading6

special characters you'll need to escape: < > &

---
**NOTE:** this is a box
it's a great box
---

\`\`\`
**NOTE:** this is a code box
i love code.   new lines are preserved
but you can also use *formatting* in here **too** _also_
\`\`\`

>>>
**NOTE:** this is a blockquote box
you can have multiple lines in it.
>>>

}}}
**NOTE:** this is an invisible blockquote
can be used for indentation.
}}}

---
you can nest different box types...
\`\`\`
...a code block
\`\`\`
>>>
...a blockquote block.
>>>
\`\`\`
...a really really really really really really really really really wide code block will side-scroll in narrow browsers (e.g. on mobile).
\`\`\`
Unfortunately, we can't nest the same type of --- box inside itself (because it's hard to know what is meant!)
---

-+-
centered box
-+-

=+=
centered box (borderless)
=+=



> blockquote
>> blockquote2
>>> blockquote2
>>> blockquote44
>>> blockquote3
> blockquote
>> blockquote2    

} invisible blockquote
}} invisible blockquote2
}}} invisible blockquote2
}}} invisible blockquote44
}}} invisible blockquote3
} invisible blockquote
}} invisible blockquote2 (basically an indent)  

nested lists
 * my bullet.  BULLETS start with a (optional) <space> then a "*"
   0. each sub level needs 2 spaces indentation added...
   1. you can change the bullet type when you indent, also.
   2. my arabic (aka hindu) numbered bullets
     i. my roman numbered bullets i
     ii. my roman numbered bullets ii
     iii. my roman numbered bullets iii
       a. my english alphabet lowercase bullets a
       b. my english alphabet lowercase bullets b
       c. my english alphabet lowercase bullets c
         A. my english alphabet uppercase bullets A
         B. my english alphabet uppercase bullets B
           8. can begin at any 'number' in whatever numeric alphabet (except 'i') 8
           3. but, subsequent ones will auto-number (ignores your typed number on the 2-n ones) 3
             i. beginning with 'i' starts a roman numbered list, rather than "starting at 'i'" english alphabet list, sad but necessary. i
     iv. continuing from iii above iv
   3. continuing from 2 above, this one should be "3"
     i. new roman list i 
       * sub bullet *

---
 - box of bullets
   - box of bullets
 - box of bullets
   - box of bullets
. . . .
- a new grouping of bullets, now without leading space...
  - box of bullets
- box of bullets
  - box of bullets
---

## table

| Row 1, Col 1 | Row 1, Col 2 | Row 1, Col 3 |
| Row 2, Col 1 | Row 2, Col 2 | Row 2, Col 3 |


table with headings

| Header 1 | Header 2 | Header 3 |
|:---------|:--------:|---------:|
| Row 1, Col 1 | Row 1, Col 2 | Row 1, Col 3 |
| Row 2, Col 1 | Row 2, Col 2 | Row 2, Col 3 |


really wide tables should side-scroll in narrow browsers (e.g. mobile) 

| Header 1 | Header 2 | Header 3 | Header 4 | Header 5 | Header 6 | Header 1 | Header 2 | Header 3 | Header 4 | Header 5 | Header 6 |
|:---------|:--------:|---------:|:---------|:--------:|---------:|:---------|:--------:|---------:|:---------|:--------:|---------:|
| Row 1, Col 1 | Row 1, Col 2 | Row 1, Col 3 | Row 1, Col 4 | Row 1, Col 5 | Row 1, Col 6 | Row 1, Col 1 | Row 1, Col 2 | Row 1, Col 3 | Row 1, Col 4 | Row 1, Col 5 | Row 1, Col 6 |
| Row 2, Col 1 | Row 2, Col 2 | Row 2, Col 3 | Row 2, Col 4 | Row 2, Col 5 | Row 2, Col 6 | Row 2, Col 1 | Row 2, Col 2 | Row 2, Col 3 | Row 2, Col 4 | Row 2, Col 5 | Row 2, Col 6 |


links
 * Naked Link: https://example.com
 * [Link to wiki topic](Pharmakon)
 * [Link to wiki topic: search](Pharmakon?searchterm=frank)
 * [Link to wiki topic: heading](Pharmakon#Recipes)
 * [Link to wiki topic: search + heading](Pharmakon?searchterm=Kykeon#Recipes)
 * [Link to local page: heading](#table)
 * [Link to local page: search](?searchterm=Header)
 * [Link to local page: search + heading](?searchterm=Header#table)
 * [Link to URL](https://example.com)
 * [Link to absolute path](/wiki/view/markdown test) 
 * [Link to absolute path: heading](/wiki/view/markdown test#table)
 * [Link to absolute path: search](/wiki/view/markdown test?searchterm=Header)
 * [Link to absolute path: search + heading](/wiki/view/markdown test?searchterm=Header#table)
 * Raw https Links to youtube will get embedded: https://www.youtube.com/watch?v=ebw3umBx1i0
 * Links to youtube will get embedded: [wiki markdown link](https://www.youtube.com/watch?v=ebw3umBx1i0)
 * Links to youtube basic timestamps (e.g. t=20) will get embedded: [timestamp link](https://www.youtube.com/watch?v=ebw3umBx1i0&t=100)
 * Links to youtube h:m:s formatted (e.g. t=1m20s) timestamps will NOT get embedded: [hms formatted timestamp link](https://www.youtube.com/watch?v=ebw3umBx1i0&t=1m20s)
 * Link with invalid characters [colon link](Topic with : in the name?)

**bold** *italic* __underscore__
---
check out this validity: **8** and not ** 8 **
so, the ** must wrap non-whitespace characters (there can be **whitespaces inside** of course)
---

Some inline code: \`this text is inline code\`.
More Text for this Block

code block
\`\`\`
big block of code....
big block of code....
big block of code....
big block of code....   
\`\`\`

\`\`\`
code example
\`\`\`

example of a
horizontal line vvv
---------
horizontal line ^^^
example....
`);

  const ast = markdownToAST(megaSource);

  const expectedTopLevelSequence = [
    'heading',
    'blankLines',
    'paragraph',
    'heading',
    'heading',
    'heading',
    'heading',
    'heading',
    'heading',
    'blankLines',
    'paragraph',
    'blankLines',
    'fencedBox',
    'blankLines',
    'fencedCode',
    'blankLines',
    'fencedBox',
    'blankLines',
    'fencedBox',
    'blankLines',
    'fencedBox',
    'blankLines',
    'fencedBox',
    'blankLines',
    'fencedBox',
    'blankLines',
    'blockquote',
    'blankLines',
    'invisibleBlockquote',
    'blankLines',
    'paragraph',
    'unorderedList',
    'orderedList',
    'unorderedList',
    'blankLines',
    'fencedBox',
    'blankLines',
    'heading',
    'blankLines',
    'table',
    'blankLines',
    'paragraph',
    'blankLines',
    'table',
    'blankLines',
    'paragraph',
    'blankLines',
    'table',
    'blankLines',
    'paragraph',
    'unorderedList',
    'blankLines',
    'paragraph',
    'fencedBox',
    'blankLines',
    'paragraph',
    'blankLines',
    'paragraph',
    'fencedCode',
    'blankLines',
    'fencedCode',
    'blankLines',
    'paragraph',
    'horizontalRule',
    'paragraph'
  ];
  expectedTopLevelSequence.forEach((type, index) => {
    assertNodeTypeAtPath(ast, [index], type, `expected node ${index} to be ${type}`);
  });

  assertNodeContentAtPath(ast, [0, 0], 'Markdown Test Page', 'incorrect top heading text');
  for (let index = 3; index <= 8; index += 1) {
    assertNodeTypeAtPath(ast, [index], 'heading', `expected heading at index ${index}`);
  }
  const escapedParagraph = assertNodeTypeAtPath(ast, [10], 'paragraph', 'expected escaped characters paragraph');
  assert.strictEqual(
    escapedParagraph.children.map(child => child.content).join(''),
    "special characters you'll need to escape: < > &",
    'escaped characters paragraph mismatch'
  );

  assertNodeTypeAtPath(ast, [12], 'fencedBox', 'expected fenced box at index 12');
  assertNodeTypeAtPath(ast, [12, 0], 'paragraph', 'fenced box should start with paragraph content');
  assertNodeTypeAtPath(ast, [12, 0, 0], 'inlineStrong', 'fenced box should begin with strong inline text');
  assertNodeContentAtPath(ast, [12, 0, 0], 'NOTE:', 'boxed strong text mismatch');
  assertNodeTypeAtPath(ast, [14], 'fencedCode', 'expected fenced code after first box');

  const stylizedQuote = assertNodeTypeAtPath(ast, [16], 'fencedBox', 'expected stylized blockquote fence');
  assert.strictEqual(
    stylizedQuote.captures.marker,
    '>>>',
    'expected >>> marker for styled blockquote fence'
  );
  assertNodeTypeAtPath(ast, [16, 0], 'paragraph', 'styled blockquote should render paragraphs');

  assertNodeTypeAtPath(ast, [22], 'fencedBox', 'expected nested fenced box at index 22');
  assertNodeTypeAtPath(ast, [22, 0], 'paragraph', 'nested fence should include paragraph content');
  assertNodeTypeAtPath(ast, [23], 'blankLines');
  const centeredPlainBox = assertNodeTypeAtPath(ast, [24], 'fencedBox', 'expected centered borderless box');
  assert.strictEqual(
    centeredPlainBox.captures.marker,
    '=+=',
    'expected centered borderless box to use =+= fence'
  );
  assertNodeTypeAtPath(ast, [25], 'blankLines');
  assertNodeTypeAtPath(ast, [26], 'blockquote', 'expected blockquote cluster around index 26');
  assertNodeTypeAtPath(ast, [28], 'invisibleBlockquote', 'expected invisible quote cluster around index 28');

  assertNodeTypeAtPath(ast, [31], 'unorderedList', 'expected nested bullet list at index 31');
  assertNodeTypeAtPath(ast, [31, 0], 'listItem', 'first nested bullet item missing');
  const nestedBulletFirstText = getNodeAtPath(ast, [31, 0, 0]).content || '';
  assert.ok(
    nestedBulletFirstText.includes('BULLETS'),
    'expected nested bullet text to mention BULLETS'
  );

  assertNodeTypeAtPath(ast, [33], 'unorderedList', 'expected sub bullet list at index 33');
  assertNodeTypeAtPath(ast, [33, 0, 0], 'inlineText', 'sub bullet should contain inline text');
  assertNodeTypeAtPath(ast, [50], 'unorderedList', 'expected link list at index 50');
  assertNodeTypeAtPath(ast, [50, 1], 'listItem', 'second link list entry missing');
  assertNodeTypeAtPath(ast, [50, 1, 0], 'inlineLink', 'second link list entry should be a link');
  assertNodeContentAtPath(ast, [50, 1, 0], 'Link to wiki topic', 'link text mismatch');

  assertNodeTypeAtPath(ast, [39], 'table', 'expected first table at index 39');
  assertNodeTypeAtPath(ast, [39, 0], 'tableRow', 'table should contain header row');
  assertNodeContentAtPath(ast, [39, 0, 1], 'Row 1, Col 1', 'table header content mismatch');
  assertNodeContentAtPath(ast, [39, 1, 1], 'Row 2, Col 1', 'table body content mismatch');
  assertNodeTypeAtPath(ast, [43], 'table', 'expected second table with headings');
  assertNodeTypeAtPath(ast, [47], 'table', 'expected wide table at index 47');

  assertNodeTypeAtPath(ast, [53], 'fencedBox', 'expected validity fenced box');
  assertNodeTypeAtPath(ast, [53, 0], 'paragraph', 'validity fenced box should have a paragraph');
  assertNodeTypeAtPath(ast, [58], 'fencedCode', 'expected large code block at index 58');
  assertNodeTypeAtPath(ast, [60], 'fencedCode', 'expected code example fence at index 60');

  const html = markdownToHtml(megaSource, undefined, undefined, { headingPermalinks: false, headingIds: false });
  const expectedMegaHtml = `<h1>Markdown Test Page</h1>
<p>Headings:</p>
<h1>Heading1</h1>
<h2>Heading2</h2>
<h3>Heading3</h3>
<h4>Heading4</h4>
<h5>Heading5</h5>
<h6>Heading6</h6>
<p>special characters you&#39;ll need to escape: &lt; &gt; &amp;</p>
<div class="fence-box fence-box--bordered">
  <p><strong>NOTE:</strong> this is a box<br />it&#39;s a great box</p>
</div>
<pre><code>**NOTE:** this is a code box
i love code.   new lines are preserved
but you can also use *formatting* in here **too** _also_</code></pre>
<blockquote class="fence-quote">
  <p><strong>NOTE:</strong> this is a blockquote box<br />you can have multiple lines in it.</p>
</blockquote>
<blockquote class="fence-quote fence-quote--invisible">
  <p><strong>NOTE:</strong> this is an invisible blockquote<br />can be used for indentation.</p>
</blockquote>
<div class="fence-box fence-box--bordered">
  <p>you can nest different box types...</p>
  <pre><code>...a code block</code></pre>
  <blockquote class="fence-quote">
    <p>...a blockquote block.</p>
  </blockquote>
  <pre><code>...a really really really really really really really really really wide code block will side-scroll in narrow browsers (e.g. on mobile).</code></pre>
  <p>Unfortunately, we can&#39;t nest the same type of --- box inside itself (because it&#39;s hard to know what is meant!)</p>
</div>
<div class="fence-box fence-box--center">
  <p>centered box</p>
</div>
<div class="fence-box fence-box--plain-center">
  <p>centered box (borderless)</p>
</div>
<blockquote>
  <p>blockquote</p>
  <blockquote>
    <p>blockquote2</p>
    <blockquote>
      <p>blockquote2</p>
      <p>blockquote44</p>
      <p>blockquote3</p>
    </blockquote>
  </blockquote>
  <p>blockquote</p>
  <blockquote>
    <p>blockquote2</p>
  </blockquote>
</blockquote>
<blockquote class="invisible-quote">
  <p>invisible blockquote</p>
  <blockquote class="invisible-quote">
    <p>invisible blockquote2</p>
    <blockquote class="invisible-quote">
      <p>invisible blockquote2</p>
      <p>invisible blockquote44</p>
      <p>invisible blockquote3</p>
    </blockquote>
  </blockquote>
  <p>invisible blockquote</p>
  <blockquote class="invisible-quote">
    <p>invisible blockquote2 (basically an indent)</p>
  </blockquote>
</blockquote>
<p>nested lists</p>
<ul>
  <li>my bullet.  BULLETS start with a (optional) &lt;space&gt; then a &quot;*&quot;</li>
</ul>
<p>0. each sub level needs 2 spaces indentation added...<br />   1. you can change the bullet type when you indent, also.<br />   2. my arabic (aka hindu) numbered bullets<br />     i. my roman numbered bullets i<br />     ii. my roman numbered bullets ii<br />     iii. my roman numbered bullets iii<br />       a. my english alphabet lowercase bullets a<br />       b. my english alphabet lowercase bullets b<br />       c. my english alphabet lowercase bullets c<br />         A. my english alphabet uppercase bullets A<br />         B. my english alphabet uppercase bullets B<br />           8. can begin at any &#39;number&#39; in whatever numeric alphabet (except &#39;i&#39;) 8<br />           3. but, subsequent ones will auto-number (ignores your typed number on the 2-n ones) 3<br />             i. beginning with &#39;i&#39; starts a roman numbered list, rather than &quot;starting at &#39;i&#39;&quot; english alphabet list, sad but necessary. i<br />     iv. continuing from iii above iv<br />   3. continuing from 2 above, this one should be &quot;3&quot;<br />     i. new roman list i</p>
<ul>
  <li>sub bullet *</li>
</ul>
<div class="fence-box fence-box--bordered">
  <ul>
    <li>box of bullets</li>
    <li>box of bullets</li>
    <li>box of bullets</li>
    <li>box of bullets</li>
  </ul>
  <p>. . . .</p>
  <ul>
    <li>a new grouping of bullets, now without leading space...</li>
    <li>box of bullets</li>
    <li>box of bullets</li>
    <li>box of bullets</li>
  </ul>
</div>
<h2>table</h2>
<table>
  <tr>
    <td>Row 1, Col 1</td>
    <td>Row 1, Col 2</td>
    <td>Row 1, Col 3</td>
  </tr>
  <tr>
    <td>Row 2, Col 1</td>
    <td>Row 2, Col 2</td>
    <td>Row 2, Col 3</td>
  </tr>
</table>
<p>table with headings</p>
<table>
  <tr>
    <td>Header 1</td>
    <td>Header 2</td>
    <td>Header 3</td>
  </tr>
  <tr>
    <td>:---------</td>
    <td>:--------:</td>
    <td>---------:</td>
  </tr>
  <tr>
    <td>Row 1, Col 1</td>
    <td>Row 1, Col 2</td>
    <td>Row 1, Col 3</td>
  </tr>
  <tr>
    <td>Row 2, Col 1</td>
    <td>Row 2, Col 2</td>
    <td>Row 2, Col 3</td>
  </tr>
</table>
<p>really wide tables should side-scroll in narrow browsers (e.g. mobile)</p>
<table>
  <tr>
    <td>Header 1</td>
    <td>Header 2</td>
    <td>Header 3</td>
    <td>Header 4</td>
    <td>Header 5</td>
    <td>Header 6</td>
    <td>Header 1</td>
    <td>Header 2</td>
    <td>Header 3</td>
    <td>Header 4</td>
    <td>Header 5</td>
    <td>Header 6</td>
  </tr>
  <tr>
    <td>:---------</td>
    <td>:--------:</td>
    <td>---------:</td>
    <td>:---------</td>
    <td>:--------:</td>
    <td>---------:</td>
    <td>:---------</td>
    <td>:--------:</td>
    <td>---------:</td>
    <td>:---------</td>
    <td>:--------:</td>
    <td>---------:</td>
  </tr>
  <tr>
    <td>Row 1, Col 1</td>
    <td>Row 1, Col 2</td>
    <td>Row 1, Col 3</td>
    <td>Row 1, Col 4</td>
    <td>Row 1, Col 5</td>
    <td>Row 1, Col 6</td>
    <td>Row 1, Col 1</td>
    <td>Row 1, Col 2</td>
    <td>Row 1, Col 3</td>
    <td>Row 1, Col 4</td>
    <td>Row 1, Col 5</td>
    <td>Row 1, Col 6</td>
  </tr>
  <tr>
    <td>Row 2, Col 1</td>
    <td>Row 2, Col 2</td>
    <td>Row 2, Col 3</td>
    <td>Row 2, Col 4</td>
    <td>Row 2, Col 5</td>
    <td>Row 2, Col 6</td>
    <td>Row 2, Col 1</td>
    <td>Row 2, Col 2</td>
    <td>Row 2, Col 3</td>
    <td>Row 2, Col 4</td>
    <td>Row 2, Col 5</td>
    <td>Row 2, Col 6</td>
  </tr>
</table>
<p>links</p>
<ul>
  <li>Naked Link: <a href="https://example.com">https://example.com</a></li>
  <li><a href="Pharmakon" title="Link to wiki topic">Link to wiki topic</a></li>
  <li><a href="Pharmakon?searchterm=frank" title="Link to wiki topic: search">Link to wiki topic: search</a></li>
  <li><a href="Pharmakon#Recipes" title="Link to wiki topic: heading">Link to wiki topic: heading</a></li>
  <li><a href="Pharmakon?searchterm=Kykeon#Recipes" title="Link to wiki topic: search + heading">Link to wiki topic: search + heading</a></li>
  <li><a href="#table" title="Link to local page: heading">Link to local page: heading</a></li>
  <li><a href="?searchterm=Header" title="Link to local page: search">Link to local page: search</a></li>
  <li><a href="?searchterm=Header#table" title="Link to local page: search + heading">Link to local page: search + heading</a></li>
  <li><a href="https://example.com" title="Link to URL">Link to URL</a></li>
  <li><a href="/wiki/view/markdown test" title="Link to absolute path">Link to absolute path</a></li>
  <li><a href="/wiki/view/markdown test#table" title="Link to absolute path: heading">Link to absolute path: heading</a></li>
  <li><a href="/wiki/view/markdown test?searchterm=Header" title="Link to absolute path: search">Link to absolute path: search</a></li>
  <li><a href="/wiki/view/markdown test?searchterm=Header#table" title="Link to absolute path: search + heading">Link to absolute path: search + heading</a></li>
  <li>Raw https Links to youtube will get embedded: https://www.youtube.com/watch?v=ebw3umBx1i0</li>
  <li>Links to youtube will get embedded: <a href="https://www.youtube.com/watch?v=ebw3umBx1i0" title="wiki markdown link">wiki markdown link</a></li>
  <li>Links to youtube basic timestamps (e.g. t=20) will get embedded: <a href="https://www.youtube.com/watch?v=ebw3umBx1i0&amp;t=100" title="timestamp link">timestamp link</a></li>
  <li>Links to youtube h:m:s formatted (e.g. t=1m20s) timestamps will NOT get embedded: <a href="https://www.youtube.com/watch?v=ebw3umBx1i0&amp;t=1m20s" title="hms formatted timestamp link">hms formatted timestamp link</a></li>
  <li>Link with invalid characters <a href="Topic with : in the name?" title="colon link">colon link</a></li>
</ul>
<p><strong>bold</strong> <em>italic</em> <u>underscore</u></p>
<div class="fence-box fence-box--bordered">
  <p>check out this validity: <strong>8</strong> and not ** 8 **<br />so, the ** must wrap non-whitespace characters (there can be <strong>whitespaces inside</strong> of course)</p>
</div>
<p>Some inline code: <code>this text is inline code</code>.<br />More Text for this Block</p>
<p>code block</p>
<pre><code>big block of code....
big block of code....
big block of code....
big block of code....   </code></pre>
<pre><code>code example</code></pre>
<p>example of a<br />horizontal line vvv</p>
<p>---------<br />horizontal line ^^^<br />example....</p>`;
  assertHtmlBlockIncludes(
    html,
    `
<h1>Markdown Test Page</h1>
<p>Headings:</p>
<h1>Heading1</h1>
<h2>Heading2</h2>
<h3>Heading3</h3>
<h4>Heading4</h4>
<h5>Heading5</h5>
<h6>Heading6</h6>
<p>special characters you&#39;ll need to escape: &lt; &gt; &amp;</p>
<div class="fence-box fence-box--bordered">
  <p><strong>NOTE:</strong> this is a box<br />it&#39;s a great box</p>
</div>
`,
    'html should include heading intro block'
  );
  assertHtmlBlockIncludes(
    html,
    `
<ul>
  <li>Naked Link: <a href="https://example.com">https://example.com</a></li>
  <li><a href="Pharmakon" title="Link to wiki topic">Link to wiki topic</a></li>
  <li><a href="Pharmakon?searchterm=frank" title="Link to wiki topic: search">Link to wiki topic: search</a></li>
`,
    'html should include link list block'
  );

  assert.ok(html.includes('<ol type="1" start="0">'), 'ordered lists should render structurally');
  assert.ok(html.includes('<hr>'), 'horizontal rules should render');
  assert.ok(html.includes('class="pre-container pre-coloring"'), 'configured code wrapper should render');

  // write latest megatest HTML to disk for manual inspection
  const outputPath = path.join(__dirname, 'megatest.html');
  const document = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Markdown Megatest</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      margin: 2rem;
      line-height: 1.5;
    }
    pre {
      background: #111;
      color: #f8f8f2;
      padding: 1rem;
      overflow-x: auto;
    }
    code {
      font-family: SFMono-Regular, Consolas, "Liberation Mono", Menlo, monospace;
    }
    .fence-box {
      border: 1px solid #ddd;
      padding: 1rem;
      margin-bottom: 1rem;
    }
    blockquote {
      border-left: 4px solid #ccc;
      padding-left: 1rem;
      color: #555;
    }
    blockquote.invisible-quote,
    blockquote.fence-quote--invisible {
      border-left: 0;
      padding-left: 1rem;
      color: inherit;
    }
    table {
      border-collapse: collapse;
      width: 100%;
      margin-bottom: 1rem;
    }
    td {
      border: 1px solid #ccc;
      padding: 0.25rem 0.5rem;
    }
  </style>
</head>
<body>
${html}
</body>
</html>`;
  try {
    fs.writeFileSync(outputPath, document);
  } catch (error) {
    console.error('Failed to write megatest HTML snapshot:', error);
  }
});

const migratedLegacyMarkdownToHtmlCases = [
  {
    "markdown": "# Heading",
    "expected": "<h1 id=\"Heading\">Heading<a title=\"Permalink to this heading\" href=\"#Heading\"><span class=\"copy-icon\" role=\"button\" aria-label=\"Link Icon\"></span></a></h1>"
  },
  {
    "markdown": "**word**",
    "expected": "<p><strong>word</strong></p>"
  },
  {
    "markdown": "*word*",
    "expected": "<p><em>word</em></p>"
  },
  {
    "markdown": "__word__",
    "expected": "<p><u>word</u></p>"
  },
  {
    "markdown": "---\nword\n---",
    "expected": "<div class=\"fence-box fence-box--bordered\">\n  <p>word</p>\n</div>"
  },
  {
    "markdown": "===\nword\n===",
    "expected": "<div class=\"fence-box fence-box--plain\">\n  <p>word</p>\n</div>"
  },
  {
    "markdown": "### Lorem Ipsum,\" lorem ipsum [ [Lorem Ipsum](https://www.bok.com/reader/urn:cts:hiMan:abc0656.zyx001.1st1K-ghj1:2) ]",
    "expected": "<h3 id=\"Lorem-Ipsum---lorem-ipsum---Lorem-Ipsum--\">Lorem Ipsum,&quot; lorem ipsum <a href=\"https://www.bok.com/reader/urn:cts:hiMan:abc0656.zyx001.1st1K-ghj1:2\" title=\"[Lorem Ipsum\"> [Lorem Ipsum</a> ]<a title=\"Permalink to this heading\" href=\"#Lorem-Ipsum---lorem-ipsum---Lorem-Ipsum--\"><span class=\"copy-icon\" role=\"button\" aria-label=\"Link Icon\"></span></a></h3>"
  },
  {
    "markdown": "[< back](LoremIpsum)",
    "expected": "<p><a href=\"/base/LoremIpsum\" title=\"&lt; back\">&lt; back</a></p>"
  },
  {
    "markdown": "------\n",
    "expected": "<hr>"
  },
  {
    "markdown": "# Heading\ntext\n<!-- toc-all -->\n\n## Heading 2 [is Heading 2](some link crap)\n\n### Heading 2.1\n\n#### Heading 2.1.1\n\n## Heading 3\n",
    "expected": "<h1 id=\"Heading\">Heading<a title=\"Permalink to this heading\" href=\"#Heading\"><span class=\"copy-icon\" role=\"button\" aria-label=\"Link Icon\"></span></a></h1>\n<p>text</p>\n<ul><li><a href=\"#Heading\">Heading</a><ul><li><a href=\"#Heading-2-is-Heading-2\">Heading 2 is Heading 2</a><ul><li><a href=\"#Heading-2.1\">Heading 2.1</a><ul><li><a href=\"#Heading-2.1.1\">Heading 2.1.1</a></li></ul></li></ul></li><li><a href=\"#Heading-3\">Heading 3</a></li></ul></li></ul>\n<h2 id=\"Heading-2-is-Heading-2\">Heading 2 <a href=\"/base/some%20link%20crap\" title=\"is Heading 2\">is Heading 2</a><a title=\"Permalink to this heading\" href=\"#Heading-2-is-Heading-2\"><span class=\"copy-icon\" role=\"button\" aria-label=\"Link Icon\"></span></a></h2>\n<h3 id=\"Heading-2.1\">Heading 2.1<a title=\"Permalink to this heading\" href=\"#Heading-2.1\"><span class=\"copy-icon\" role=\"button\" aria-label=\"Link Icon\"></span></a></h3>\n<h4 id=\"Heading-2.1.1\">Heading 2.1.1<a title=\"Permalink to this heading\" href=\"#Heading-2.1.1\"><span class=\"copy-icon\" role=\"button\" aria-label=\"Link Icon\"></span></a></h4>\n<h2 id=\"Heading-3\">Heading 3<a title=\"Permalink to this heading\" href=\"#Heading-3\"><span class=\"copy-icon\" role=\"button\" aria-label=\"Link Icon\"></span></a></h2>"
  },
  {
    "markdown": "# Heading\ntext\n<!-- toc -->\n\n## Heading 2 [is Heading 2](some link crap)\n\n### Heading 2.1\n\n#### Heading 2.1.1\n\n## Heading 3\n",
    "expected": "<h1 id=\"Heading\">Heading<a title=\"Permalink to this heading\" href=\"#Heading\"><span class=\"copy-icon\" role=\"button\" aria-label=\"Link Icon\"></span></a></h1>\n<p>text</p>\n<ul><li><a href=\"#Heading-2-is-Heading-2\">Heading 2 is Heading 2</a><ul><li><a href=\"#Heading-2.1\">Heading 2.1</a><ul><li><a href=\"#Heading-2.1.1\">Heading 2.1.1</a></li></ul></li></ul></li><li><a href=\"#Heading-3\">Heading 3</a></li></ul>\n<h2 id=\"Heading-2-is-Heading-2\">Heading 2 <a href=\"/base/some%20link%20crap\" title=\"is Heading 2\">is Heading 2</a><a title=\"Permalink to this heading\" href=\"#Heading-2-is-Heading-2\"><span class=\"copy-icon\" role=\"button\" aria-label=\"Link Icon\"></span></a></h2>\n<h3 id=\"Heading-2.1\">Heading 2.1<a title=\"Permalink to this heading\" href=\"#Heading-2.1\"><span class=\"copy-icon\" role=\"button\" aria-label=\"Link Icon\"></span></a></h3>\n<h4 id=\"Heading-2.1.1\">Heading 2.1.1<a title=\"Permalink to this heading\" href=\"#Heading-2.1.1\"><span class=\"copy-icon\" role=\"button\" aria-label=\"Link Icon\"></span></a></h4>\n<h2 id=\"Heading-3\">Heading 3<a title=\"Permalink to this heading\" href=\"#Heading-3\"><span class=\"copy-icon\" role=\"button\" aria-label=\"Link Icon\"></span></a></h2>"
  },
  {
    "markdown": " - bullet [[link](mytopic?searchterm=bokbok)]\n  ",
    "expected": "<ul>\n  <li>bullet <a href=\"/base/mytopic?searchterm=bokbok\" title=\"[link\">[link</a>]</li>\n</ul>\n<p></p>"
  },
  {
    "markdown": " - bullet [[link](mytopic#bokbok)]\n  ",
    "expected": "<ul>\n  <li>bullet <a href=\"/base/mytopic#bokbok\" title=\"[link\">[link</a>]</li>\n</ul>\n<p></p>"
  },
  {
    "markdown": " - bullet\n - bullet2\n   - bullet3\n   - bullet4\n  ",
    "expected": "<ul>\n  <li>bullet</li>\n  <li>bullet2\n    <ul>\n      <li>bullet3</li>\n      <li>bullet4</li>\n    </ul>\n  </li>\n</ul>\n<p></p>"
  },
  {
    "markdown": " 1. bullet\n 2. bullet2\n   a. bullet3\n   b. bullet4\n  ",
    "expected": "<ol type=\"1\" start=\"1\">\n  <li>bullet</li>\n  <li>bullet2\n    <ol type=\"a\" start=\"a\">\n      <li>bullet3</li>\n      <li>bullet4</li>\n    </ol>\n  </li>\n</ol>\n<p></p>"
  },
  {
    "markdown": "- bullet\n- bullet2\n  - bullet3\n  - bullet4\n  ",
    "expected": "<ul>\n  <li>bullet</li>\n  <li>bullet2\n    <ul>\n      <li>bullet3</li>\n      <li>bullet4</li>\n    </ul>\n  </li>\n</ul>\n<p></p>"
  },
  {
    "markdown": "1. bullet\n2. bullet2\n  a. bullet3\n  b. bullet4\n  ",
    "expected": "<ol type=\"1\" start=\"1\">\n  <li>bullet</li>\n  <li>bullet2\n    <ol type=\"a\" start=\"a\">\n      <li>bullet3</li>\n      <li>bullet4</li>\n    </ol>\n  </li>\n</ol>\n<p></p>"
  },
  {
    "markdown": "[title](https://www.google.com/path/to/my thing is amazing?key=value#hash)",
    "expected": "<p><a href=\"https://www.google.com/path/to/my thing is amazing?key=value#hash\" title=\"title\">title</a></p>"
  },
  {
    "markdown": "https://www.google.com/path/to/thing?key=value#hash",
    "expected": "<p><a href=\"https://www.google.com/path/to/thing?key=value#hash\">https://www.google.com/path/to/thing?key=value#hash</a></p>"
  },
  {
    "markdown": "[title](/path/to/my thing is amazing)",
    "expected": "<p><a href=\"/path/to/my%20thing%20is%20amazing\" title=\"title\">title</a></p>"
  },
  {
    "markdown": "[title](/path/to/my thing is amazing#test)",
    "expected": "<p><a href=\"/path/to/my%20thing%20is%20amazing#test\" title=\"title\">title</a></p>"
  },
  {
    "markdown": "[title](/path/to/my thing is amazing?searchterm=bok#test)",
    "expected": "<p><a href=\"/path/to/my%20thing%20is%20amazing?searchterm=bok#test\" title=\"title\">title</a></p>"
  },
  {
    "markdown": "[title](my crazy wiki topic)",
    "expected": "<p><a href=\"/base/my%20crazy%20wiki%20topic\" title=\"title\">title</a></p>"
  },
  {
    "markdown": "[title](my crazy wiki topic#my bookmark is also crazy)",
    "expected": "<p><a href=\"/base/my%20crazy%20wiki%20topic#my-bookmark-is-also-crazy\" title=\"title\">title</a></p>"
  },
  {
    "markdown": "[title](my crazy wiki topic?searchterm=bok#my bookmark is also crazy)",
    "expected": "<p><a href=\"/base/my%20crazy%20wiki%20topic?searchterm=bok#my-bookmark-is-also-crazy\" title=\"title\">title</a></p>"
  },
  {
    "markdown": "[title](#my bookmark is crazy)",
    "expected": "<p><a href=\"#my-bookmark-is-crazy\" title=\"title\">title</a></p>"
  },
  {
    "markdown": "[title](?searchterm=bok#my bookmark is crazy)",
    "expected": "<p><a href=\"?searchterm=bok#my-bookmark-is-crazy\" title=\"title\">title</a></p>"
  },
  {
    "markdown": "[title](#ref with parens and umlat (Büoenn%29)",
    "expected": "<p><a href=\"#ref-with-parens-and-umlat-(Büoenn%29\" title=\"title\">title</a></p>"
  },
  {
    "markdown": "<!-- toc-all -->\n# Heading with a paren (Büoenn)\n",
    "expected": "<ul><li><a href=\"#Heading-with-a-paren--B-oenn-\">Heading with a paren (Büoenn)</a></li></ul>\n<h1 id=\"Heading-with-a-paren--B-oenn-\">Heading with a paren (Büoenn)<a title=\"Permalink to this heading\" href=\"#Heading-with-a-paren--B-oenn-\"><span class=\"copy-icon\" role=\"button\" aria-label=\"Link Icon\"></span></a></h1>"
  },
  {
    "markdown": "<!-- toc-all -->\n# Heading with 1:1 a colon\n",
    "expected": "<ul><li><a href=\"#Heading-with-1:1-a-colon\">Heading with 1:1 a colon</a></li></ul>\n<h1 id=\"Heading-with-1:1-a-colon\">Heading with 1:1 a colon<a title=\"Permalink to this heading\" href=\"#Heading-with-1:1-a-colon\"><span class=\"copy-icon\" role=\"button\" aria-label=\"Link Icon\"></span></a></h1>"
  },
  {
    "markdown": "<!-- toc-all -->\n# Heading with , a comma\n",
    "expected": "<ul><li><a href=\"#Heading-with---a-comma\">Heading with , a comma</a></li></ul>\n<h1 id=\"Heading-with---a-comma\">Heading with , a comma<a title=\"Permalink to this heading\" href=\"#Heading-with---a-comma\"><span class=\"copy-icon\" role=\"button\" aria-label=\"Link Icon\"></span></a></h1>"
  },
  {
    "markdown": "{{ user:12345 }}",
    "expected": "<p>testuser</p>"
  },
  {
    "markdown": "---\n} **III.** some text *is here* \n---\n",
    "expected": "<div class=\"fence-box fence-box--bordered\">\n  <blockquote class=\"invisible-quote\">\n    <p><strong>III.</strong> some text <em>is here</em></p>\n  </blockquote>\n</div>"
  },
  {
    "markdown": "---\n} **III.** some text *is here* \n} **III.** some text *is here* \n} **III.** some text *is here* \n---\n",
    "expected": "<div class=\"fence-box fence-box--bordered\">\n  <blockquote class=\"invisible-quote\">\n    <p><strong>III.</strong> some text <em>is here</em> <br /><strong>III.</strong> some text <em>is here</em> <br /><strong>III.</strong> some text <em>is here</em></p>\n  </blockquote>\n</div>"
  },
  {
    "markdown": "---\n} **III.** some text *is here* \n}} **III.** some text *is here* \n}}} **III.** some text *is here* \n---\n",
    "expected": "<div class=\"fence-box fence-box--bordered\">\n  <blockquote class=\"invisible-quote\">\n    <p><strong>III.</strong> some text <em>is here</em></p>\n    <blockquote class=\"invisible-quote\">\n      <p><strong>III.</strong> some text <em>is here</em></p>\n      <blockquote class=\"invisible-quote\">\n        <p><strong>III.</strong> some text <em>is here</em></p>\n      </blockquote>\n    </blockquote>\n  </blockquote>\n</div>"
  },
  {
    "markdown": "---\ntext\n}}} **III.** some text *is here* \ntext\n---\n",
    "expected": "<div class=\"fence-box fence-box--bordered\">\n  <p>text</p>\n  <blockquote class=\"invisible-quote\">\n    <blockquote class=\"invisible-quote\">\n      <blockquote class=\"invisible-quote\">\n        <p><strong>III.</strong> some text <em>is here</em></p>\n      </blockquote>\n    </blockquote>\n  </blockquote>\n  <p>text</p>\n</div>"
  },
  {
    "markdown": "---\n**NOTE:** this is a box\nit's a great box\n---\n",
    "expected": "<div class=\"fence-box fence-box--bordered\">\n  <p><strong>NOTE:</strong> this is a box<br />it&#39;s a great box</p>\n</div>"
  },
  {
    "markdown": "---\n**NOTE:** this is a box\n\nit's a great box\n---\n",
    "expected": "<div class=\"fence-box fence-box--bordered\">\n  <p><strong>NOTE:</strong> this is a box</p>\n  <p>it&#39;s a great box</p>\n</div>"
  },
  {
    "markdown": "---\n- a bullet\n---\n",
    "expected": "<div class=\"fence-box fence-box--bordered\">\n  <ul>\n    <li>a bullet</li>\n  </ul>\n</div>"
  },
  {
    "markdown": "---\n- a bullet\n- another bullet\n---\n",
    "expected": "<div class=\"fence-box fence-box--bordered\">\n  <ul>\n    <li>a bullet</li>\n    <li>another bullet</li>\n  </ul>\n</div>"
  },
  {
    "markdown": "other words\n\n> words.\n",
    "expected": "<p>other words</p>\n<blockquote>\n  <p>words.</p>\n</blockquote>"
  },
  {
    "markdown": "other words\n> words.\n",
    "expected": "<p>other words</p>\n<blockquote>\n  <p>words.</p>\n</blockquote>"
  },
  {
    "markdown": "> words\n> more words\n",
    "expected": "<blockquote>\n  <p>words<br />more words</p>\n</blockquote>"
  },
  {
    "markdown": "---\nwords words words words\n\n... words are words\n---\n",
    "expected": "<div class=\"fence-box fence-box--bordered\">\n  <p>words words words words</p>\n  <p>... words are words</p>\n</div>"
  },
  {
    "markdown": "```\n...a really really really really really really really really really wide code block will side-scroll in narrow browsers (e.g. on mobile).\n```",
    "expected": "<div class=\"pre-container pre-coloring\"><div class=\"pre-container-scroll-wrapper\"><pre><code>...a really really really really really really really really really wide code block will side-scroll in narrow browsers (e.g. on mobile).</code></pre></div></div>"
  }
];

const migratedLegacyMarkdownToHtmlCaseNames = [
  'renders heading IDs and permalink controls',
  'renders strong text with semantic HTML',
  'renders emphasized text with semantic HTML',
  'renders underlined text',
  'renders bordered fenced boxes',
  'renders borderless fenced boxes',
  'builds heading slugs from linked punctuation-heavy text',
  'resolves relative links against the configured base path',
  'recognizes six-hyphen horizontal rules',
  'builds a full-document nested table of contents',
  'builds a following-headings nested table of contents',
  'renders bracketed links with queries inside indented bullet lists',
  'renders bracketed links with fragments inside indented bullet lists',
  'renders nested indented unordered lists',
  'renders nested indented numeric and alphabetic ordered lists',
  'renders nested unindented-marker unordered lists',
  'renders nested unindented-marker ordered lists',
  'preserves absolute link destinations containing spaces',
  'autolinks absolute URLs with queries and fragments',
  'encodes spaces in root-relative link paths',
  'encodes root-relative paths while preserving fragments',
  'encodes root-relative paths while preserving queries and fragments',
  'resolves and encodes wiki-topic links',
  'resolves wiki-topic links and normalizes fragment spaces',
  'resolves wiki-topic links with queries and normalized fragments',
  'normalizes spaces in fragment-only links',
  'preserves query-only links while normalizing fragment spaces',
  'preserves parentheses, Unicode, and percent escapes in fragments',
  'uses matching Unicode heading slugs in TOCs and permalinks',
  'preserves colons in matching TOC and heading slugs',
  'normalizes commas consistently in TOC and heading slugs',
  'substitutes user-data placeholders',
  'renders inline formatting inside invisible quotes in fences',
  'groups consecutive invisible quote lines inside fences',
  'renders nested invisible quote depths inside fences',
  'keeps text around deeply nested invisible quotes in fences',
  'uses line breaks for adjacent text inside fenced boxes',
  'uses paragraphs for blank-line-separated text inside fenced boxes',
  'renders a single-item unordered list inside a fenced box',
  'renders a multi-item unordered list inside a fenced box',
  'transitions from a paragraph to a blockquote across a blank line',
  'transitions from a paragraph directly to a blockquote',
  'groups consecutive visible quote lines with line breaks',
  'keeps ellipsis-prefixed text as a paragraph inside fences',
  'renders fenced code with the configurable scrolling wrapper'
];

migratedLegacyMarkdownToHtmlCases.forEach(({ markdown, expected }, index) => {
  test(`markdownToHtml ${migratedLegacyMarkdownToHtmlCaseNames[index]}`, () => {
    assert.strictEqual(
      markdownToHtml(markdown, '/base', { userdata: { testuser: { id: '12345' } } }),
      expected
    );
  });
});


function run() {
  let failures = 0;
  tests.forEach(({ name, fn }) => {
    try {
      fn();
      console.log(`✓ ${name}`);
    } catch (error) {
      failures += 1;
      console.error(`✗ ${name}`);
      console.error(error.stack);
    }
  });
  if (failures > 0) {
    console.error(`\n${failures} test(s) failed.`);
    process.exitCode = 1;
  } else {
    console.log(`\nAll ${tests.length} tests passed.`);
  }
}

run();
