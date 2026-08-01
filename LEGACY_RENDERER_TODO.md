# Legacy renderer compatibility TODO

The 45 migrated `markdownToHtml` inputs in `markdown_tests.js` are active modern
renderer regression tests. Useful legacy features were brought into the new
system; obsolete or malformed legacy HTML expectations were updated.

## Completion criterion

- [x] Remove `{ pending: true }` from all 45 migrated renderer tests.
- [x] Make all 45 inputs pass against reviewed modern HTML expectations.
- [x] Keep the current parser, HTML-to-Markdown, editor, and packaging tests passing.

## 1. Restore the public renderer options contract

The old calls used:

```js
markdownToHtml(markdown, '/base', {
  userdata: {
    testuser: { id: '12345' }
  }
})
```

- [x] Support a base-path string as the second argument without confusing it with a rules schema.
- [x] Support renderer options as the third argument.
- [x] Preserve the current custom-rules and renderer-overrides APIs with an unambiguous overload or options object.
- [x] Add direct API tests for every supported call signature.

## 2. Match basic inline HTML output (cases 2–4)

- [x] Render `**text**` as semantic `<strong>text</strong>`.
- [x] Render `*text*` as semantic `<em>text</em>`.
- [x] Continue rendering `__text__` as `<u>text</u>`.
- [x] Keep semantic HTML as the only default; developers can override renderer templates.

DECISION:  INSTEAD, SIMPLY UPDATE THE _TESTS_ TO USE THE NEW bold / italics (e.g. <strong>), dont change the renderer.

## 3. Restore heading anchors and permalinks (cases 1 and 7)

- [x] Generate deterministic heading IDs matching the legacy normalization rules.
- [x] Strip inline link markup from heading ID text correctly.
- [x] Append the exact permalink anchor, title, icon span, role, and ARIA label.  DECISION:  let's create a config option to turn these on, and default to on.   There is also a heading-link cliackable icon (do you see it?):  Do we need to allow customization of the ICON for the heading-link cliackable icon?
- [x] Preserve the expected trailing newline. DECISION:  perhaps update the test instead?  analyzie what to do here...
- [x] Add focused slug tests for punctuation, Unicode, brackets, and inline formatting.  DECISION:  what is this for?  analyze this

## 4. Restore link and URL resolution (cases 8 and 12–28)

- [x] Prefix relative topic links with the configured base path.
- [x] Do not prefix absolute URLs, root-relative URLs, query-only URLs, or hash-only URLs.
- [x] Percent-encode spaces in paths while preserving query strings and hashes.
- [x] Normalize spaces in bookmark fragments to hyphens.
- [x] Preserve the legacy handling of parentheses, percent escapes, and Unicode in fragments.
- [x] Autolink plain absolute URLs.
- [x] Preserve literal brackets surrounding a nested Markdown link.
- [x] Test every URL form independently before enabling the migrated cases.

## 5. Restore horizontal-rule recognition (case 9)

- [x] Distinguish a six-hyphen horizontal rule from a three-hyphen fenced box.
- [x] Render the exact `<hr>\n` output.
- [x] Add boundary tests for three, four, five, and six or more hyphens.

## 6. Implement TOC directives (cases 10–11 and 29–31)

- [x] Parse `<!-- toc -->` and `<!-- toc-all -->` as directives rather than ordinary comments.
- [x] Collect headings and their inline display text.
- [x] For `toc`, omit headings preceding the directive.
- [x] For `toc-all`, include headings across the whole document.
- [x] Build nested `<ul><li>` output from heading levels.
- [x] Use exactly the same slug generator as heading permalinks.
- [x] Match legacy punctuation and Unicode slug behavior for parentheses, colons, and commas.
- [x] Match the exact newline and paragraph transitions around generated TOCs.

## 7. Implement user-data substitution (case 32)

- [x] Parse `{{ user:ID }}` placeholders.
- [x] Resolve the ID against `options.userdata`.
- [x] Render the matching user key/name (`testuser` in the migrated case).
- [x] Preserve unknown or malformed placeholders as literal text.
- [x] Escape substituted text safely.

## 8. Match fenced-box rendering (cases 5–6, 33–40, and 44)

DECISION:   legacy might be off by some subtle character, if so, it's ok to simply adjust the legacy test to the tighter standards of the newer markdownToHtml().   Got it?   Dont corrupt the parser to AST or AST to markdown, when it's better to adjust the legacy test to the upgraded/newer/modern standards.  reevaluate the todo items here, you may not need some...

- [x] Render `---` fences with configurable classes defined by the rule data.
- [x] Render `===` fences as the configurable invisible-box variant.
- [x] Preserve expected newlines inside and after boxes.
- [x] Render adjacent text lines with `<br>` where required.
- [x] Render blank-line-separated content with the expected paragraph transition.
- [x] Render unordered lists correctly inside fences.
- [x] Render blockquotes and invisible blockquotes recursively inside fences.
- [x] Ensure ordinary text beginning with `...` remains paragraph content.

## 9. Match list rendering (cases 12–17 and 38–39)

DECISION:   legacy might be off by some subtle character, if so, it's ok to simply adjust the legacy test to the tighter standards of the newer markdownToHtml().   Got it?   Dont corrupt the parser to AST or AST to markdown, when it's better to adjust the legacy test to the upgraded/newer/modern standards.  reevaluate the todo items here, you may not need some...

- [x] Render flat and nested unordered lists with exact `<ul>/<li>` structure.
- [x] Render numeric ordered lists with `type="1"` and `start="1"`.
- [x] Render alphabetic nested lists with the expected `type` and `start` attributes.
- [x] Support both one-space and zero-space top-level marker indentation used by the fixtures.
- [x] Preserve trailing whitespace after the list where the expected output requires it.
- [x] Verify lists nested inside fenced boxes use the same renderer. DECISION: yes, testing fenced box with lists inside is important to work.

## 10. Match visible and invisible blockquotes (cases 33–36 and 41–43)

DECISION: so those line level  blockquotes like > or } or >> >>> or }} }}}, are treated as a multiline block.    That's the trick.   Detect the group of lines all with the *same* leading marker (from the list of >,>>,>>>,},}},}}}, and treat all lines as what gets parsed to detect the nested blocktype(s) under that blockquote! right?: paragraph, list, whatever is in that group of same prefixed lines.   We should expect any of the blocktypes under each group of same prefixed lines (not only paragraph, but any blocktype, and it could be multiple!).   right?

- [x] Render consecutive `>` lines as one blockquote with `<br>` separators. DECISION, what do we do now, and is it better now, or with this idea here?   help me decide, and I will give you my final decision - illustrate the 2 examples of output so I can see the difference.
- [x] Correctly transition from a paragraph to a blockquote with and without a blank line.
- [x] Render `>`, `>>`, and `>>>` as one, two, and three nested blockquotes.
- [x] Render `}`, `}}`, and `}}}` as one, two, and three nested invisible blockquotes.
- [x] Use the `invisible-quote` class and `style.css`; do not emit legacy inline styling or maintain a compatibility mode.
- [x] Keep adjacent ordinary text outside the quote hierarchy.
- [x] Preserve inline bold and italic formatting inside quotes.   DECISION:  we already support inline text inside blockquotes, so.   this should exist already.   you may need to port to the new <strong> instead of <b>, right?  same for italic...

## 11. Restore exact paragraph and line-break semantics (cases 10–11 and 33–44)

DECISION:   legacy might be off by some subtle character, if so, it's ok to simply adjust the legacy test to the tighter standards of the newer markdownToHtml().   Got it?   Dont corrupt the parser to AST or AST to markdown, when it's better to adjust the legacy test to the upgraded/newer/modern standards.  reevaluate the todo items here, you may not need some...

- [x] Specify when a source newline becomes `<br>`, a literal newline, or a paragraph boundary.
- [x] Emit properly closed `<p>...</p>` elements and update malformed legacy expectations.
- [x] Avoid globally normalizing whitespace until block-specific output has been produced. DECISION: analyze what the heck this means before doing anything to this.
- [x] Add focused tests for text-to-heading, text-to-quote, text-to-list, and text-to-fence transitions.

## 12. Restore the specialized code-block renderer (case 45)

DECISION: developers may choose a simple `<code>` block, `<pre>`, or the default scrolling wrapper. The HTML template belongs in `default_rules.js` so applications can override it.

- [x] Render triple-backtick blocks with the exact `pre-container pre-coloring` wrapper.
- [x] Add the `pre-container-scroll-wrapper` element.
- [x] Render the exact `<pre><code >…</code></pre>` structure.
- [x] Escape code content without interpreting Markdown inside it.
- [x] Use CSS overflow behavior rather than injecting executable resize scripts.
- [x] Expose the code wrapper through `default_rules.js` HTML template data.

## 13. Compatibility architecture

DECISION:   discuss any changes with me first.   my assumption is there is no compatibility mode.  however, we will extend the markdownjs API to be configurable!   like base URL, or user variables, or the default_rules.js will specify html templates to allow the devs to customize what is rendered...  discuss!

- [x] Implement selected features through rule data and renderer options without a compatibility mode.
- [x] Keep parsing, slug generation, URL resolution, TOC collection, and rendering as separate testable units.
- [x] Avoid hardcoding fixture strings solely to satisfy tests.
- [x] Keep one modern default renderer; allow rules/templates/options to customize it.
- [x] Replace broad pending status incrementally: enable each migrated case as its feature lands.

## Suggested implementation order

1. Public API overload and configurable renderer options.
2. Inline tags, heading slugs/permalinks, and URL resolution.
3. Lists, paragraph/line-break rules, and visible blockquotes.
4. Fenced boxes and invisible nested blockquotes.
5. TOC directives and user-data substitution.
6. Specialized code-block wrapper.
7. Enable all migrated cases and remove pending-test support if no longer needed.
