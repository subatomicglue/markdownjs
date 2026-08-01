# "markdown.js"

A custom markdown to HTML parser in a single file "markdown.js", the main utility function feature of this library will be markdownToHtml(...).

There's a JavaScript object describing the Schema Rules for the parser, which describes the markdown document structure.

## Packaging and browser usage

There are **seven supported ways** to include this project. You can inline a
generated bundle, inline the source files, load either form with external
`<script src>` elements, use ES-module imports, or use CommonJS.

Run the build before packaging or using files from `dist/`:

```sh
npm run build
```

The build produces three self-contained classic JavaScript files:

- `dist/markdown.js` contains the default rules, parser, AST renderer, and HTML renderer.
- `dist/markdown-editor.js` also contains and registers `<markdown-wysiwyg-editor>`.
- `dist/htmlToMarkdown.js` is the optional, browser-oriented HTML-to-Markdown converter.

`dist/` is generated and committed so browser and template consumers can use
the repository directly. Run the build and commit updated bundles whenever
their source files change. The `prepack` script also rebuilds them before npm
creates a package.

Include `style.css` for the default code-overflow, permalink-icon, and invisible-quote presentation.

HTML-to-Markdown conversion is not part of either core bundle and is not loaded
by the main package entry. Include it only when the application needs it. Its
Node dependency is optional as well.

### 1. Inline the complete editor bundle in a template

This is the simplest template-system integration when the WYSIWYG editor is
needed. The included file contains the rules, Markdown engine, and editor:

```html
<script>
<%include "dist/markdown-editor.js"%>
</script>

<markdown-wysiwyg-editor id="editor"></markdown-wysiwyg-editor>
```

### 2. Inline only the Markdown bundle in a template

Use this when parsing and rendering are needed without the editor:

```html
<script>
<%include "dist/markdown.js"%>
</script>

<script>
  const html = MarkdownJS.markdownToHtml('# Hello');
</script>
```

### 3. Inline the separate source files in a template

Some applications may want to include the readable source files directly.
These three files are required for the editor, and their order is important:

```html
<script>
<%include "default_rules.js"%>
<%include "markdown.js"%>
<%include "markdown_wysiwyg_editor.js"%>
</script>
```

`markdown.js` depends on `default_rules.js`, and
`markdown_wysiwyg_editor.js` depends on both earlier files.

To additionally support HTML-to-Markdown conversion, insert the optional source
file before `markdown.js`:

```html
<script>
<%include "default_rules.js"%>
<%include "htmlToMarkdown.js"%>
<%include "markdown.js"%>
<%include "markdown_wysiwyg_editor.js"%>
</script>
```

### 4. Load a generated bundle as an external script

Parser and renderer only:

```html
<script src="/path/to/dist/markdown.js"></script>
<script>
  const html = MarkdownJS.markdownToHtml('# Hello');
</script>
```

Complete editor:

```html
<script src="/path/to/dist/markdown-editor.js"></script>
<markdown-wysiwyg-editor id="editor"></markdown-wysiwyg-editor>
```

### 5. Load the separate source files as external scripts

```html
<script src="/path/to/default_rules.js"></script>
<script src="/path/to/markdown.js"></script>
<script src="/path/to/markdown_wysiwyg_editor.js"></script>
<markdown-wysiwyg-editor id="editor"></markdown-wysiwyg-editor>
```

The same dependency order required for template inclusion applies here.
Add `<script src="/path/to/htmlToMarkdown.js"></script>` before `markdown.js`
when the optional converter is needed.

### 6. Import the package as ES modules

```js
import { markdownToAST, astToHTML, markdownToHtml } from 'markdownjs';
import { MarkdownWysiwygEditor } from 'markdownjs/editor';
```

Importing `markdownjs/editor` registers the custom element as a side effect and
also exports its class.

### 7. Require the package with CommonJS

```js
const { markdownToAST, astToHTML, markdownToHtml } = require('markdownjs');
```

### Optional HTML-to-Markdown converter

`htmlToMarkdown.js` converts browser HTML into the Markdown dialect understood
by this project. It is primarily intended for rich clipboard content, but it
accepts any HTML string and does not contain application- or website-specific
detection.

The converter is deliberately separate from the Markdown parser and editor.
Applications that do not convert HTML do not need to load it.

#### Browser global

Load the standalone source or generated bundle. It exposes
`globalThis.HTMLToMarkdownJS`:

```html
<script src="/path/to/dist/htmlToMarkdown.js"></script>
<script>
  const markdown = HTMLToMarkdownJS.htmlToMarkdown(
    '<p>Hello <strong>world</strong>.</p>'
  );
  // "\nHello **world**.\n"
</script>
```

It may also be loaded directly with
`<script src="/path/to/htmlToMarkdown.js"></script>` or inlined by a template
system:

```html
<script>
<%include "htmlToMarkdown.js"%>
</script>
```

#### ES modules and CommonJS

```js
import {
  htmlToMarkdown,
  splitTopicQueryHash,
  extractFirstImage
} from 'markdownjs/htmlToMarkdown';
```

CommonJS is also supported:

```js
const {
  htmlToMarkdown,
  splitTopicQueryHash,
  extractFirstImage
} = require('markdownjs/htmlToMarkdown');
```

Browser conversion uses native DOM APIs and adds no dependency. Node.js use is
optional and requires the optional `jsdom` package to supply those DOM APIs.
The Markdown parser, renderer, and editor do not require `jsdom`, and an
installation made with `npm install --omit=optional` works unless
`htmlToMarkdown()` is called from Node.

```sh
npm install jsdom
```

#### `htmlToMarkdown(html)`

Accepts an HTML string and returns a Markdown string. Conversion includes:

- headings, paragraphs, line breaks, and horizontal rules;
- strong, emphasis, underline, inline code, and fenced code;
- links and images, including URL escaping;
- visible and invisible blockquotes;
- tables;
- ordered, unordered, mixed, and nested lists;
- meaningful text colors as semantic `<span style="color:…">` Markdown HTML;
- removal of common neutral/default text colors while preserving their text.

List conversion works with ordinary semantic HTML from any website, such as a
`<ul>` nested inside an `<li>`. Rich editors sometimes provide visually nested
items without conventional nesting, so list depth uses this general precedence:

1. a positive `aria-level` on the `<li>`;
2. CSS `margin-left`, `padding-left`, or `padding-inline-start` indentation;
3. the actual `<ul>`/`<ol>` DOM nesting depth.

Adjacent list fragments are joined only when they are structurally part of the
same list. Intervening paragraph or other block content keeps lists separate.
This supports conventional website HTML as well as clipboard HTML produced by
document editors.

The converter interprets markup; it is not an HTML sanitizer. Sanitize
untrusted HTML separately when the surrounding application requires it.

#### Clipboard conversion

Use the `text/html` clipboard representation when present, with plain text as
the fallback:

```js
editableElement.addEventListener('paste', event => {
  const clipboard = event.clipboardData;
  const html = clipboard.getData('text/html');
  const markdown = html
    ? HTMLToMarkdownJS.htmlToMarkdown(html)
    : clipboard.getData('text/plain');

  event.preventDefault();
  insertMarkdownAtCursor(markdown);
});
```

The WYSIWYG component exposes `registerPasteHandler(callback)`. Its callback
receives `html`, `text`, `files`, the current Markdown string, and the translated
Markdown selection so an application can perform the same conversion and place
the result at the correct source position. See `editor.html` for a working
example.

#### `splitTopicQueryHash(url)`

Splits a wiki-style URL into `[topic, query, fragment]` without the `?` and `#`
separators:

```js
splitTopicQueryHash('Topic?searchterm=bok#Section');
// ['Topic', 'searchterm=bok', 'Section']
```

Missing components are returned as empty strings.

#### `extractFirstImage(markdown, maxLines)`

Finds an early root-relative image URL in Markdown or inline HTML and returns
the URL, or `undefined` when no eligible image exists. `maxLines` limits the
search window. Absolute `http://` and `https://` image URLs are intentionally
excluded.

### Browser globals and HTML syntax

The core public browser globals are `MarkdownDefaultRules`, `MarkdownJS`, and
`MarkdownWysiwygEditor`. The optional converter exposes `HTMLToMarkdownJS`.

External JavaScript uses `<script src="...">`. A `<link src="...">` element
does not load or execute JavaScript.

## Rule-driven editor scope

> **Important:** parser rules are not editor plug-ins. Adding a Markdown type
> to `default_rules.js` does **not** automatically give that type construction,
> editing, keyboard, selection, conversion, or serialization behavior in the
> WYSIWYG editor. A new rule changes the parser and renderer; it does not add or
> modify the editor's JavaScript implementation.

The Markdown parser and HTML renderer are data-driven by the supplied rules.
The WYSIWYG editor also reads substantial UI metadata from each rule's `editor`
object, including labels, variants, toolbar order, keyboard shortcuts, fence
markers, CSS classes, block tags, Enter behavior, and broad behavior type.

The editor is not an automatic editor generator for an arbitrary grammar. It
implements a fixed behavior vocabulary: containers, text blocks, code blocks,
quotes, lists, tables, inline formats, and inline objects. Commands such as
link/image dialogs, color application, list indentation, table mutation, and
block conversion have JavaScript implementations in
`markdown_wysiwyg_editor.js`. Serialization also understands the corresponding
DOM structures.

Consequently, making a new Markdown type fully editable currently requires two
separate changes:

1. defining its grammar, AST captures, and renderer in the rules;
2. separately changing `markdown_wysiwyg_editor.js` to support that type, unless
   the rule can use an editor behavior that is already implemented.

That editor change may need AST-to-DOM construction, DOM-to-Markdown
serialization, block conversion, Enter behavior, selection behavior, toolbar
commands, and regression tests. Merely adding `editor` metadata to a new rule
cannot create those implementations.

For existing types:

- changing labels, variants, markers, tags, shortcuts, ordering, templates, or
  other metadata within an existing behavior generally updates the editor;
- adding a new rule can reuse an already implemented editor behavior when its
  editing semantics and DOM representation genuinely match that behavior;
- adding a genuinely new block/inline interaction or DOM representation
  requires a new editor behavior or command implementation;
- a parser rule without compatible `editor` metadata remains parseable and
  renderable but is not necessarily directly authorable through a toolbar.

The browser interaction code cannot be inferred from a regular expression or
an HTML rendering template. However, the present boundary is still a real
extension limitation: the rules are the parser's source of truth, but they are
not yet a complete editor extension API. Developers should treat this as a
customizable Markdown engine with an editor for its supported behavior
vocabulary, not as an editor that automatically supports arbitrary new rules.

A future goal is to turn the rule `editor` data into a real extension API, so a
new type can provide its editing hooks alongside its grammar instead of
requiring hardcoded changes throughout `markdown_wysiwyg_editor.js`. That API
does not exist yet.

## CommonMark compatibility

This project is **not CommonMark-conformant** and should not be presented as a
drop-in CommonMark or GitHub Flavored Markdown implementation. It implements a
custom Markdown dialect with intentional extensions and different parsing
semantics.

As a diagnostic baseline, the renderer passed 125 of the 652 CommonMark 0.31.2
examples after lenient normalization of superficial HTML differences. That is
about 19%, not a conformance claim. Important differences include indented and
fenced code behavior, Setext headings, reference links, delimiter/escape rules,
HTML blocks, list continuation and nesting, thematic breaks, and soft line
breaks.

See the [CommonMark 0.31.2 specification](https://spec.commonmark.org/0.31.2/)
and its [official JSON examples](https://spec.commonmark.org/0.31.2/spec.json).

## Renderer configuration

`markdownToHtml` accepts a renderer-options object. Heading IDs and clickable
permalinks are enabled by default; their icon HTML and accessible title can be
changed or disabled:

```js
MarkdownJS.markdownToHtml(markdown, {
  baseUrl: '/wiki',
  headingIds: true,
  headingPermalinks: true,
  headingPermalinkIcon: '<span class="my-link-icon"></span>',
  headingPermalinkTitle: 'Link to this section',
  userdata: {
    alice: { id: 'user-123' }
  }
});
```

This resolves `{{ user:user-123 }}` to `alice`. The legacy call shape
`markdownToHtml(markdown, '/wiki', options)` remains supported. Relative and
absolute URL behavior may be customized with `linkRelativeCallback` and
`linkAbsoluteCallback`.

Rules may contain `html.template` strings. Templates support values such as
`${children}`, `${content}`, `${escapedContent}`, and `${captures.name}`. The
default fenced-code wrapper is defined this way in `default_rules.js`, so an
application can replace it without changing the renderer.

`<!-- toc -->` generates links for headings after the directive, while
`<!-- toc-all -->` includes headings across the whole document.

Inline HTML tags are represented as `inlineHtml` AST nodes and emitted verbatim,
so markup such as `<span style="color:#ff0000">word</span>` is preserved. This
default is intended for trusted Markdown. Render untrusted input with
`{ allowInlineHtml: false }` to escape inline HTML instead.

Color spans are handled more specifically as semantic `inlineColor` nodes:
`<span style="color:#ff0000">word</span>`. The WYSIWYG color control removes
existing color spans from the selected range before applying the new color, and
its “No Color” action removes color without disturbing other inline formatting.

Starts with Rule "document" which simply have children, like heading, blank lines, fencetypes...., list types...., blockquotetypes...., paragraph,

Each of those children rules have a parse type, and data for that part (like line regex, or fence characters)

## Markdown to AST Engine

- instead of line splitting, which ruins block matching across lines, which we want to do in some rules, we will use the whole buffer. We need to run matches starting at a character in the buffer (an inefficient way would be to use split()), and as blocks are identified, we can split the buffer or just keep an index into the big document markdown buffer, and next matches can use that index to begin from. We will use sticky regex for efficiency!
- When parsing markdown, there is a recursive engine that applies rules recursively, starting with the rule "document" a container rule (technically a block rule without a regex, so we skip right to the children and assume "all" characters match), starting at the first character and seeing what of "document"'s child rules matches, starting at the first child, until the last, if we find a match, we extract the inner content defined by that rule, and basically recurse (run the next level child rules on that inner content).
- For that rule match, for block rules (non inline) we get the size matched, and advance into the document by that much, and repeat, until we get to the end of the document or we find that no rules match.
- This is what breaks the document into blocks, and the each block is recursively processed with the child rules of that block type.... until we get to inline rules... such as bold, italics, links, images, underscore, inline code, etc... those are run in order....
- normal blocks are matching line by line as long as the same type, they'll be collected together as a single block of that type, so a block rule has a regex which matches a line, or lines, but the regex must be written so that it matches always from start of a line to the end of some line later.
- fence blocks are funny, when the special sequence is detected, using a single line regex that matches for example (?<=(^|\n))(---(\n|$)) and once matched the engine then pulls the rest of that block text up to another match of the same regex.

## Default rules object

`default_rules.js` defines the document grammar, block and inline child order,
capture mappings, renderer templates, and editor metadata. Its block rules
cover headings, blank lines, TOC directives, fenced boxes and code, horizontal
rules, ordered and unordered lists, visible and invisible blockquotes, tables,
and paragraphs. Inline rules cover text, strong/emphasis/underline, code,
colors, HTML, links, images, variables, automatic links, and line breaks.

Applications can clone or replace this schema rather than modifying the parser
engine for every Markdown dialect change.

## Parse Types in the rules

- **single line blocks** (headings and list items)
- **block of like items** (list or paragraph or block quotes)
- **fence blocks** (start with 3 letter sequence such as ''', ```, --- (others also possible), End with same sequence)
- **inline types** (bold, italic, underscore, link, image)

## ast = markdownToAST( markdown, rules )
- Convert markdown to ast tree using the above engine described. Each ast node has its type, has the extracted match, and the raw match, and ast children.

## html = astToHTML( ast )
- Convert ast tree into html, respect indentation as recurse into the ast tree, too.

## html = markdownToHtml( markdown, rules )
By chaining the markdownToAST and astToHTML functions

## markdown_tests.js
- Write auto tests on the parse to ast side.
- Write auto tests on the ast to html side.
- Markdown to ast Tests should start simple and test fundamentals, like

a document test with custom rules where documents only have blocks and no children under those blocks... easy top level test to see if the document is splitting correctly.

Recursion block tests, taking document splits to child blocks within the parent block - check ast.
Inline tests on simple text to test formatting combinations and gotchas and correctness.

## Design requirements and constraints

The parser and renderer were developed around the following requirements.

### Unified block model

- The grammar has two parsing categories: block and inline.
- A block may consume one line or many lines. A separate line-node type and a
  single-line flag are unnecessary.
- Headings, paragraphs, blank-line runs, lists, blockquotes, tables, code
  fences, and custom fenced boxes are all block rules.
- The amount of source consumed by a block is defined by that rule's regular
  expression rather than by special behavior in the parser engine.

### Cursor-based parsing

- Parse the original source buffer directly; do not split it into lines before
  matching because doing so would prevent rules from recognizing multiline
  structures.
- At each cursor position, try the current container rule's children in their
  declared order.
- A successful rule consumes its complete match, advances the cursor by that
  length, and recursively parses its captured content with its child rules.
- Sticky matching keeps every rule anchored at the current cursor and avoids
  accidental matches later in the source.
- If no permitted rule matches at the cursor, parsing must fail clearly rather
  than silently skipping source text.

### Complete block boundaries

- Block rules must consume complete source lines or complete multiline regions,
  normally bounded by the beginning/end of the document or a newline.
- Rules must not accept a partial prefix of a line and leave unexplained text
  behind.
- Paragraph fallback rules are responsible for ordinary text that does not
  match a more specific block rule.

### Fenced blocks and nesting

- Fenced constructs use the same block engine; they are not a separate parser
  category.
- An opening marker consumes through the next matching closing marker.
- A fenced block cannot contain another fence using the same marker because the
  first matching marker closes the outer block.
- Different fence markers may nest because their opening and closing markers
  remain unambiguous.
- The editor prevents selecting a fence marker already used by an ancestor.

### Data-driven grammar and AST

- Grammar behavior belongs in the rules schema wherever practical instead of
  being hardcoded into the engine.
- Rule order, regular expressions, child rules, capture mappings, HTML
  templates, and editor metadata are defined by rule data.
- A rule's capture map copies regular-expression groups into named AST capture
  fields. Renderers and editors consume those named values without reparsing
  the original source.
- AST nodes retain their type, parse category, raw match, content, captures,
  and recursively parsed children.

### Rendering and editor separation

- Markdown is the source of truth.
- `markdownToAST`, `astToHTML`, and `markdownToHtml` remain independently usable
  pipeline stages.
- Renderer-only presentation, such as heading permalinks, is configurable and
  is not exposed as editable content in the WYSIWYG editor.
- The editor creates structurally valid Markdown and uses the same grammar data
  for supported block and inline controls.
- HTML-to-Markdown conversion remains an optional companion feature rather than
  a dependency of the parser or renderer.

### Verification requirements

- Every default rule requires focused tests for successful matches, boundary
  behavior, recursion, AST captures, and rendered output.
- Block-rule tests must verify that complete lines or regions are consumed and
  that partial-line matches are rejected.
- Nested blocks, mixed block transitions, inline delimiter boundaries, Unicode,
  URLs, clipboard HTML, and round-trip-sensitive editor behavior require
  regression coverage.
- Generated convenience pipelines must agree with their explicit equivalents;
  for example, `markdownToHtml(source)` must match
  `astToHTML(markdownToAST(source))`.

## License

MIT. See `LICENSE`.
