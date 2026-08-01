'use strict';

(function installMarkdownDefaultRules(global) {

const INLINE_CHILDREN = [
  'inlineColor',
  'inlineHtml',
  'inlineImage',
  'inlineLink',
  'inlineAutoLink',
  'inlineVariable',
  'inlineStrong',
  'inlineUnderline',
  'inlineEmphasis',
  'inlineCode',
  'inlineLineBreak',
  'inlineText'
];

const BLOCK_CHILDREN = [
  'blankLines',
  'tocDirective',
  'heading',
  'fencedBox',
  'fencedCode',
  'horizontalRule',
  'unorderedList',
  'orderedList',
  'blockquote',
  'invisibleBlockquote',
  'table',
  'paragraph'
];

const FENCE_VARIANTS = [
  { marker: '---', label: 'Box', tag: 'div', className: 'fence-box fence-box--bordered' },
  { marker: '+--', label: 'Box left', tag: 'div', className: 'fence-box fence-box--bordered' },
  { marker: '-+-', label: 'Box center', tag: 'div', className: 'fence-box fence-box--center' },
  { marker: '--+', label: 'Box right', tag: 'div', className: 'fence-box fence-box--right' },
  { marker: '===', label: 'Invisible box', tag: 'div', className: 'fence-box fence-box--plain' },
  { marker: '+==', label: 'Invisible box left', tag: 'div', className: 'fence-box fence-box--plain' },
  { marker: '=+=', label: 'Invisible box center', tag: 'div', className: 'fence-box fence-box--plain-center' },
  { marker: '==+', label: 'Invisible box right', tag: 'div', className: 'fence-box fence-box--plain-right' },
  { marker: '>>>', label: 'Quote', tag: 'blockquote', className: 'fence-quote' },
  { marker: '}}}', label: 'Invisible quote', tag: 'blockquote', className: 'fence-quote fence-quote--invisible' }
];
const FENCE_MARKER_PATTERN = FENCE_VARIANTS
  .map(({ marker }) => marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('|');

// Parsing starts at the document rule and follows its child rule names.
const defaultRules = {
  document: {
    parse: 'block',
    regex: null,
    children: BLOCK_CHILDREN
  },
  blankLines: {
    parse: 'block',
    regex: /(?:[ \t]*\n)+/,
    captures: {},
    children: [],
    trimContent: false
  },
  tocDirective: {
    parse: 'block',
    regex: /<!--[ \t]*(toc|toc-all)[ \t]*-->[ \t]*(?:\n|$)/,
    captures: { command: 1 },
    contentGroup: 1,
    trimContent: true,
    children: []
  },
  heading: {
    parse: 'block',
    regex: /(#{1,6})[ \t]+(.+?)(?:\n|$)/,
    captures: { depth: 1, text: 2 },
    contentGroup: 2,
    trimContent: true,
    children: INLINE_CHILDREN,
    editor: {
      label: 'Heading',
      behavior: 'text',
      enter: 'splitText',
      variants: [
        { label: 'Heading 1', tag: 'h1' }, { label: 'Heading 2', tag: 'h2' },
        { label: 'Heading 3', tag: 'h3' }, { label: 'Heading 4', tag: 'h4' },
        { label: 'Heading 5', tag: 'h5' }, { label: 'Heading 6', tag: 'h6' }
      ]
    }
  },
  fencedCode: {
    parse: 'block',
    regex: /```([^\n]*)\n([\s\S]*?)\n```[ \t]*(?:\n|$)/,
    captures: { language: 1 },
    contentGroup: 2,
    children: ['inlineStrong', 'inlineUnderline', 'inlineEmphasis', 'inlineLineBreak', 'inlineText'],
    html: {
      template: '<div class="pre-container pre-coloring"><div class="pre-container-scroll-wrapper"><pre><code>${escapedContent}</code></pre></div></div>'
    },
    editor: { label: 'Code block', tag: 'pre', behavior: 'code', enter: 'codeNewline' }
  },
  horizontalRule: {
    parse: 'block',
    regex: /-{6,}[ \t]*(?:\n|$)/,
    children: [],
    html: { template: '<hr>' }
  },
  fencedBox: {
    parse: 'block',
    regex: new RegExp(`^(${FENCE_MARKER_PATTERN})([A-Za-z]*)[ \\t]*\\n([\\s\\S]*?)\\n\\1[ \\t]*(?:\\n|$)`, 'm'),
    captures: { marker: 1, label: 2 },
    contentGroup: 3,
    childContentGroup: 3,
    children: BLOCK_CHILDREN,
    allowEmptyChildren: true,
    editor: {
      label: 'Fence box',
      behavior: 'container',
      variants: FENCE_VARIANTS
    }
  },
  unorderedList: {
    parse: 'block',
    regex: /(?:[ \t]*[-*+] [^\n]*(?:\n|$))+/, 
    children: ['listItem'],
    nestByIndent: true,
    editor: {
      label: 'Bulleted list', command: 'list', behavior: 'list', enter: 'splitList', shortcut: 'Mod+-'
    }
  },
  listItem: {
    parse: 'block',
    regex: /([ \t]*)[-*+] ([^\n]*)(?:\n|$)/,
    captures: { indent: 1, text: 2 },
    contentGroup: 2,
    trimContent: true,
    children: INLINE_CHILDREN
  },
  orderedList: {
    parse: 'block',
    regex: /(?:[ \t]*(?:[0-9]{1,2}|[A-Za-z]{1,2}|[IVXLCDMivxlcdm]+)\.[ \t]+[^\n]*(?:\n|$))+/,
    children: ['orderedListItem'],
    nestByIndent: true,
    editor: {
      label: 'Numbered list', behavior: 'list', enter: 'splitList'
    }
  },
  orderedListItem: {
    parse: 'block',
    regex: /([ \t]*)((?:[0-9]{1,2}|[A-Za-z]{1,2}|[IVXLCDMivxlcdm]+))\.[ \t]+([^\n]*)(?:\n|$)/,
    captures: { indent: 1, marker: 2, text: 3 },
    contentGroup: 3,
    trimContent: true,
    children: INLINE_CHILDREN
  },
  blockquote: {
    parse: 'block',
    regex: /(?:>+(?=[ \t]|\n|$)[^\n]*(?:\n|$))+/, 
    transformContent: content => content.replace(/^>[ \t]?/gm, ''),
    children: BLOCK_CHILDREN,
    editor: {
      label: 'Block quote',
      behavior: 'quote',
      enter: 'exitQuote',
      marker: '>',
      variants: [1].map(depth => ({
        label: 'Quote',
        tag: 'blockquote',
        value: `blockquote:${depth}`,
        depth
      }))
    }
  },
  invisibleBlockquote: {
    parse: 'block',
    regex: /(?:}+(?=[ \t]|\n|$)[^\n]*(?:\n|$))+/, 
    transformContent: content => content.replace(/^}[ \t]?/gm, ''),
    children: BLOCK_CHILDREN,
    editor: {
      label: 'Invisible quote',
      behavior: 'quote',
      enter: 'exitQuote',
      className: 'invisible-quote',
      marker: '}',
      variants: [{
        label: 'Invisible quote',
        tag: 'blockquote',
        value: 'invisiblequote:1',
        depth: 1
      }]
    }
  },
  table: {
    parse: 'block',
    regex: /(?:\|[^\n]*\|\n?){2,}/,
    children: ['tableRow'],
    editor: { label: 'Table', tag: 'table', behavior: 'table', enter: 'nextTableCell', lineBreak: false }
  },
  tableRow: {
    parse: 'block',
    regex: /\|[^\n]*\|[ \t]*(?:\n|$)/,
    trimContent: true,
    children: ['tableDivider', 'tableCell']
  },
  tableCell: {
    parse: 'block',
    regex: /([^|\n]+)/,
    contentGroup: 1,
    trimContent: true,
    children: INLINE_CHILDREN
  },
  tableDivider: {
    parse: 'block',
    regex: /[ \t]*\|[ \t]*/,
    children: []
  },
  paragraph: {
    parse: 'block',
    regex: /(?:[^\n]|(?:\n(?!\n|#{1,6}[ \t]|```|-{6,}[ \t]*(?:\n|$)|---|<!--[ \t]*toc(?:-all)?[ \t]*-->|[ \t]*[-*+] |[ \t]*(?:[0-9]{1,2}|[A-Za-z]{1,2}|[IVXLCDMivxlcdm]+)\. |>+(?:[ \t]|\n|$)|}+(?:[ \t]|\n|$)|\|))){1,}(?:\n|$)/,
    trimContent: true,
    children: INLINE_CHILDREN,
    editor: { label: 'Paragraph', tag: 'p', behavior: 'text', enter: 'splitText' }
  },
  inlineImage: {
    parse: 'inline',
    regex: /!\[([^\]]*)\]\(([^)]+?)(?:\s+"([^"]+)")?\)/,
    captures: { alt: 1, src: 2, title: 3 },
    captureDefaults: { title: 'alt' },
    children: [],
    editor: {
      label: 'Image', command: 'image', behavior: 'inlineObject', icon: 'Image', toolbarOrder: 60
    }
  },
  inlineHtml: {
    parse: 'inline',
    regex: /(?:<!--[\s\S]*?-->|<\/?[A-Za-z][A-Za-z0-9:-]*(?:\s+(?:[^"'<>]|"[^"]*"|'[^']*')*)?\s*\/?>)/,
    children: []
  },
  inlineColor: {
    parse: 'inline',
    regex: /<span\b[^>]*style\s*=\s*["'][^"']*color\s*:\s*([^;"']+)[^"']*["'][^>]*>(\S(?:[\s\S]*?\S)??)<\/span>/,
    captures: { color: 1, text: 2 },
    contentGroup: 2,
    trimContent: false,
    children: INLINE_CHILDREN,
    editor: {
      label: 'Text color', command: 'color', behavior: 'inlineFormat', control: 'color', toolbarOrder: 35
    }
  },
  inlineLink: {
    parse: 'inline',
    regex: /\[([^\]]+)\]\(([^)]+?)(?:\s+"([^"]+)")?\)/,
    captures: { text: 1, href: 2, title: 3 },
    captureDefaults: { title: 'text' },
    contentGroup: 1,
    children: ['inlineStrong', 'inlineUnderline', 'inlineEmphasis', 'inlineCode', 'inlineImage', 'inlineLineBreak', 'inlineText'],
    editor: {
      label: 'Link', command: 'link', behavior: 'inlineObject', icon: 'Link',
      shortcut: 'Mod+K', toolbarOrder: 50
    }
  },
  inlineVariable: {
    parse: 'inline',
    regex: /\{\{[ \t]*([A-Za-z][\w-]*):([^\s}]+)[ \t]*\}\}/,
    captures: { namespace: 1, id: 2 },
    children: []
  },
  inlineAutoLink: {
    parse: 'inline',
    regex: /https?:\/\/[^\s<]+/,
    children: []
  },
  inlineStrong: {
    parse: 'inline',
    regex: /\*\*(\S(?:[\s\S]*?\S)??)\*\*/,
    balancedDelimiter: '**',
    contentGroup: 1,
    children: ['inlineUnderline', 'inlineEmphasis', 'inlineCode', 'inlineLink', 'inlineImage', 'inlineLineBreak', 'inlineText'],
    editor: {
      label: 'Bold', command: 'bold', behavior: 'inlineFormat', icon: '<strong>B</strong>',
      shortcut: 'Mod+B', toolbarOrder: 10
    }
  },
  inlineUnderline: {
    parse: 'inline',
    regex: /__(\S(?:[\s\S]*?\S)??)(?=__)__(?!_)/,
    contentGroup: 1,
    children: ['inlineStrong', 'inlineEmphasis', 'inlineCode', 'inlineLink', 'inlineImage', 'inlineLineBreak', 'inlineText'],
    editor: {
      label: 'Underline', command: 'underline', behavior: 'inlineFormat', icon: '<u>U</u>',
      shortcut: 'Mod+U', toolbarOrder: 30
    }
  },
  inlineEmphasis: {
    parse: 'inline',
    regex: /(?:(?:(?<!\*)|(?<=\S\*\*))\*(?!\*)(\S(?:[\s\S]*?\S)??)(?=\*)\*(?!\*)|(?<!_)_(?!_)(\S(?:[\s\S]*?\S)??)(?=_)_(?!_))/,
    contentGroup: [1, 2],
    children: ['inlineStrong', 'inlineUnderline', 'inlineCode', 'inlineLink', 'inlineImage', 'inlineLineBreak', 'inlineText'],
    editor: {
      label: 'Italic', command: 'italic', behavior: 'inlineFormat', icon: '<em>I</em>',
      shortcut: 'Mod+I', toolbarOrder: 20
    }
  },
  inlineCode: {
    parse: 'inline',
    regex: /`([^`]+)`/,
    contentGroup: 1,
    children: [],
    editor: {
      label: 'Inline code', command: 'code', behavior: 'inlineFormat', icon: '&lt;/&gt;',
      shortcut: 'Mod+`', toolbarOrder: 40
    }
  },
  inlineLineBreak: {
    parse: 'inline',
    regex: /\n/,
    children: []
  },
  inlineText: {
    parse: 'inline',
    regex: /(?:(?!https?:\/\/)[^<![*_`{\\\n])+|./,
    children: []
  }
};

const markdownRuleSchema = {
  defaultRules,
  INLINE_CHILDREN,
  BLOCK_CHILDREN
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = markdownRuleSchema;
}
if (global) {
  global.MarkdownDefaultRules = markdownRuleSchema;
}
})(typeof globalThis !== 'undefined' ? globalThis : this);
