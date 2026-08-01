'use strict';

// See README.md for architectural details.
const { defaultRules } = typeof require === 'function'
  ? require('./default_rules')
  : globalThis.MarkdownDefaultRules;

const FENCE_RENDER_MAP = Object.fromEntries(
  defaultRules.fencedBox.editor.variants.map(({ marker, tag, className }) => [
    marker,
    { tag: tag || 'div', className: className || '' }
  ])
);

function makeStickyRegex(rx) {
  if (!rx) {
    return null;
  }
  if (typeof rx === 'string') {
    return new RegExp(rx, 'y');
  }
  const flags = rx.flags.includes('y') ? rx.flags : `${rx.flags}y`;
  const uniqueFlags = Array.from(new Set(flags.split(''))).join('');
  return new RegExp(rx.source, uniqueFlags);
}

function cloneRule(rule) {
  return {
    ...rule,
    children: Array.isArray(rule.children) ? [...rule.children] : undefined
  };
}

function normalizeRules(ruleMap) {
  const normalized = {};
  const entries = Object.entries(ruleMap || {});
  entries.forEach(([name, rule]) => {
    const copy = cloneRule(rule);
    copy.name = name;
    if (!copy.parse) {
      throw new Error(`Rule "${name}" is missing a parse type.`);
    }
    copy._regex = makeStickyRegex(copy.regex);
    normalized[name] = copy;
  });
  return normalized;
}

class MarkdownParser {
  constructor(ruleMap) {
    this.rules = normalizeRules(ruleMap || defaultRules);
  }

  parse(markdown, rootRule = 'document') {
    const root = this.rules[rootRule];
    if (!root) {
      throw new Error(`Unknown root rule "${rootRule}".`);
    }
    if (root.regex !== null) {
      throw new Error('Root rule must be a container without a regex.');
    }
    const node = {
      type: rootRule,
      parseType: root.parse,
      raw: markdown,
      content: markdown,
      captures: {},
      children: this.parseSequence(root.children || [], markdown, rootRule)
    };
    return node;
  }

  parseSequence(childNames, text, parentName) {
    if (!childNames || !childNames.length) {
      if (text.length > 0) {
        throw new Error(`Parent "${parentName}" has content but no child rules to parse it.`);
      }
      return [];
    }
    const nodes = [];
    let cursor = 0;
    while (cursor < text.length) {
      let matched = false;
      for (const childName of childNames) {
        const result = this.matchRule(childName, text, cursor);
        if (result) {
          nodes.push(result.node);
          cursor = result.next;
          matched = true;
          break;
        }
      }
      if (!matched) {
        const preview = text.slice(cursor, cursor + 40).replace(/\n/g, '\\n');
        throw new Error(`No rule matched inside "${parentName}" at offset ${cursor}: "${preview}"`);
      }
    }
    return nodes;
  }

  matchBalancedDelimiter(rule, text, cursor) {
    const delimiter = rule.balancedDelimiter;
    const marker = delimiter && delimiter[0];
    const width = delimiter ? delimiter.length : 0;
    if (!marker || width < 2 || delimiter !== marker.repeat(width)) return null;
    if (!text.startsWith(delimiter, cursor) || text[cursor + width] === marker) return null;
    const contentStart = cursor + width;
    if (!text[contentStart] || /\s/.test(text[contentStart])) return null;

    let nested = false;
    let index = contentStart;
    while (index < text.length) {
      if (text[index] !== marker) {
        index += 1;
        continue;
      }
      let backslashes = 0;
      for (let before = index - 1; before >= 0 && text[before] === '\\'; before -= 1) backslashes += 1;
      if (backslashes % 2) {
        index += 1;
        continue;
      }
      let runLength = 1;
      while (text[index + runLength] === marker) runLength += 1;

      if (nested && index > contentStart && !/\s/.test(text[index - 1])) {
        nested = false;
        index += 1;
        runLength -= 1;
        if (runLength >= width) {
          const content = text.slice(contentStart, index);
          const raw = text.slice(cursor, index + width);
          const match = [raw, content];
          match.index = cursor;
          match.input = text;
          return match;
        }
        continue;
      }

      if (!nested && runLength >= width) {
        const content = text.slice(contentStart, index);
        if (!content || /\s$/.test(content)) return null;
        const raw = text.slice(cursor, index + width);
        const match = [raw, content];
        match.index = cursor;
        match.input = text;
        return match;
      }

      if (!nested && runLength === 1 && text[index + 1] && !/\s/.test(text[index + 1])) nested = true;
      index += runLength;
    }
    return null;
  }

  matchRule(ruleName, text, cursor) {
    const rule = this.rules[ruleName];
    if (!rule) {
      throw new Error(`Unknown rule "${ruleName}".`);
    }
    const regex = rule._regex;
    if (!regex) {
      if (rule.parse !== 'block') {
        throw new Error(`Rule "${ruleName}" requires a regex.`);
      }
      const remaining = text.slice(cursor);
      const children = this.parseSequence(rule.children || [], remaining, ruleName);
      return {
        node: {
          type: ruleName,
          parseType: rule.parse,
          raw: remaining,
          content: remaining,
          captures: {},
          children
        },
        next: text.length
      };
    }
    regex.lastIndex = cursor;
    const match = rule.balancedDelimiter
      ? this.matchBalancedDelimiter(rule, text, cursor)
      : regex.exec(text);
    if (!match || match.index !== cursor) {
      return null;
    }
    const raw = match[0];
    if (!raw.length && !rule.allowEmpty) {
      return null;
    }
    const node = {
      type: ruleName,
      parseType: rule.parse,
      raw,
      content: selectContent(match, rule.contentGroup, rule.trimContent),
      captures: extractCaptures(match, rule.captures),
      children: []
    };
    if (typeof rule.transformContent === 'function') {
      node.content = rule.transformContent(node.content, node.captures, raw);
    }
    applyCaptureDefaults(node.captures, rule.captureDefaults);
    let childSource =
      rule.childContentGroup !== undefined
        ? selectContent(match, rule.childContentGroup, rule.childTrim)
        : node.content;
    if (typeof rule.transformChildContent === 'function') {
      childSource = rule.transformChildContent(childSource, node.captures, raw);
    } else if (typeof rule.transformContent === 'function' && rule.childContentGroup !== undefined) {
      childSource = rule.transformContent(childSource, node.captures, raw);
    }
    if (rule.children && rule.children.length) {
      const innerText = childSource || '';
      node.children =
        innerText.length === 0 && rule.allowEmptyChildren
          ? []
          : this.parseSequence(rule.children, innerText, ruleName);
    }
    if (rule.nestByIndent) this.nestListChildren(node);
    return {
      node,
      next: cursor + raw.length
    };
  }

  nestListChildren(node) {
    const flat = node.children || [];
    if (!flat.length) return;
    const width = value => String(value || '').replace(/\t/g, '  ').length;
    const rootIndent = width(flat[0].captures.indent);
    node.children = [];
    const stack = [{ list: node, indent: rootIndent, lastItem: null }];
    flat.forEach(item => {
      const indent = width(item.captures.indent);
      while (stack.length > 1 && indent < stack[stack.length - 1].indent) stack.pop();
      if (indent > stack[stack.length - 1].indent && stack[stack.length - 1].lastItem) {
        const parentItem = stack[stack.length - 1].lastItem;
        const listType = item.type === 'orderedListItem' ? 'orderedList' : 'unorderedList';
        const nested = {
          type: listType,
          parseType: 'block',
          raw: '',
          content: '',
          captures: { marker: item.captures.marker || '' },
          children: []
        };
        parentItem.children.push(nested);
        stack.push({ list: nested, indent, lastItem: null });
      } else if (indent !== stack[stack.length - 1].indent) {
        while (stack.length > 1 && indent !== stack[stack.length - 1].indent) stack.pop();
      }
      const target = stack[stack.length - 1];
      target.list.children.push(item);
      target.lastItem = item;
    });
  }
}

function applyCaptureDefaults(captures, defaults) {
  Object.entries(defaults || {}).forEach(([target, source]) => {
    if (!captures[target]) captures[target] = captures[source] || '';
  });
}

function selectContent(match, groupIndex, trim) {
  let value;
  if (Array.isArray(groupIndex)) {
    for (const index of groupIndex) {
      const candidate = match[index];
      if (typeof candidate === 'string') {
        value = candidate;
        break;
      }
    }
    if (value === undefined) {
      value = '';
    }
  } else if (groupIndex === undefined || groupIndex === null) {
    value = match[0];
  } else {
    value = match[groupIndex] || '';
  }
  if (typeof value !== 'string') {
    value = '';
  }
  return trim ? value.trim() : value;
}

function extractCaptures(match, captureMap) {
  if (!captureMap) {
    return {};
  }
  const output = {};
  Object.entries(captureMap).forEach(([key, index]) => {
    output[key] = match[index] || '';
  });
  return output;
}

function markdownToAST(markdown, ruleOverrides) {
  const rules = ruleOverrides ? ruleOverrides : defaultRules;
  const parser = new MarkdownParser(rules);
  return parser.parse(markdown || '');
}

function escapeHtml(value) {
  return (value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function nodeText(node) {
  if (!node) return '';
  if (!node.children || !node.children.length) return node.content || '';
  return node.children.map(nodeText).join('');
}

function headingSlug(value) {
  return String(value || '')
    .trim()
    .replace(/\s/g, '-')
    .replace(/[^a-zA-Z0-9\-_:.]/g, '-');
}

function normalizeFragment(fragment) {
  return String(fragment || '').replace(/\s+/g, '-');
}

function resolveLinkHref(rawHref, options) {
  const href = String(rawHref || '').trim();
  const match = href.match(/^([^?#]*)(\?[^#]*)?(#.*)?$/);
  const path = match ? match[1] : href;
  const query = match && match[2] ? match[2] : '';
  const hash = match && match[3] ? `#${normalizeFragment(match[3].slice(1))}` : '';
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) {
    return options.linkAbsoluteCallback
      ? options.linkAbsoluteCallback(options.baseUrl || '', href)
      : href;
  }
  if (!path) return `${query}${hash}`;
  const encodedPath = path.split('/').map(segment => encodeURIComponent(segment).replace(/%3A/gi, ':')).join('/');
  if (path.startsWith('/')) return `${encodedPath}${query}${hash}`;
  const relative = `${encodedPath}${query}${hash}`;
  if (options.linkRelativeCallback) return options.linkRelativeCallback(options.baseUrl || '', relative);
  const base = String(options.baseUrl || '').replace(/\/$/, '');
  return base ? `${base}/${relative}` : relative;
}

function renderTocList(headings) {
  if (!headings.length) return '';
  const root = { level: 0, children: [] };
  const stack = [root];
  headings.forEach(heading => {
    while (stack.length > 1 && stack[stack.length - 1].level >= heading.level) stack.pop();
    const item = { ...heading, children: [] };
    stack[stack.length - 1].children.push(item);
    stack.push(item);
  });
  const renderItems = items => `<ul>${items.map(item =>
    `<li><a href="#${escapeHtml(item.slug)}">${escapeHtml(item.text)}</a>${item.children.length ? renderItems(item.children) : ''}</li>`
  ).join('')}</ul>`;
  return renderItems(root.children);
}

function renderFenceNode(context) {
  const { node, indent, renderBlockChildren } = context;
  const marker = node.captures.marker || '---';
  const label = (node.captures.label || '').trim();
  const config = FENCE_RENDER_MAP[marker] || FENCE_RENDER_MAP['---'];
  const inner = renderBlockChildren();
  const classAttr = config.className ? ` class="${config.className}"` : '';
  const labelAttr = label ? ` data-label="${escapeHtml(label)}"` : '';
  const openTag = `${indent}<${config.tag}${classAttr}${labelAttr}>`;
  if (!inner) {
    return `${openTag}</${config.tag}>`;
  }
  return `${openTag}\n${inner}\n${indent}</${config.tag}>`;
}

function renderQuoteNode({ indent, renderBlockChildren }, className = '') {
  const classAttr = className ? ` class="${className}"` : '';
  const inner = renderBlockChildren();
  return `${indent}<blockquote${classAttr}>\n${inner}\n${indent}</blockquote>`;
}

function orderedListType(marker) {
  if (/^\d+$/.test(marker)) return '1';
  if (/^[ivxlcdm]+$/.test(marker)) return 'i';
  if (/^[IVXLCDM]+$/.test(marker)) return 'I';
  if (/^[a-z]+$/.test(marker)) return 'a';
  if (/^[A-Z]+$/.test(marker)) return 'A';
  return '1';
}

function renderListItem({ node, depth, indent, renderChild }) {
  const isInline = child => child.parseType === 'inline' || /^inline/.test(child.type || '');
  const inline = (node.children || [])
    .filter(isInline)
    .map(child => renderChild(child, depth, true)).join('');
  const blocks = (node.children || [])
    .filter(child => !isInline(child))
    .map(child => renderChild(child, depth + 1, false)).join('\n');
  return `${indent}<li>${inline}${blocks ? `\n${blocks}\n${indent}` : ''}</li>`;
}

const defaultRenderers = {
  document: ({ renderBlockChildren }) => renderBlockChildren({ depthOffset: 0 }),
  blankLines: () => '',
  tocDirective: ({ renderer, node }) => renderTocList(renderer.tocHeadings.get(node) || []),
  paragraph: ({ indent, renderInlineChildren }) => `${indent}<p>${renderInlineChildren()}</p>`,
  heading: ({ indent, node, renderInlineChildren, options }) => {
    const depthCapture = node.captures.depth || '';
    const derivedLevel = depthCapture.length ? depthCapture.length : Number(depthCapture) || 1;
    const level = Math.min(6, Math.max(1, derivedLevel));
    const text = nodeText(node);
    const slug = headingSlug(text);
    const idAttribute = options.headingIds === false ? '' : ` id="${escapeHtml(slug)}"`;
    const permalink = options.headingPermalinks === false ? '' :
      `<a title="${escapeHtml(options.headingPermalinkTitle)}" href="#${escapeHtml(slug)}">${options.headingPermalinkIcon}</a>`;
    return `${indent}<h${level}${idAttribute}>${renderInlineChildren()}${permalink}</h${level}>`;
  },
  fencedCode: ({ indent, node }) => {
    const language = node.captures.language
      ? ` class="language-${escapeHtml(node.captures.language.trim())}"`
      : '';
    return `${indent}<pre><code${language}>${escapeHtml(node.content)}</code></pre>`;
  },
  horizontalRule: ({ indent }) => `${indent}<hr>`,
  fencedBox: context => renderFenceNode(context),
  unorderedList: ({ indent, renderBlockChildren }) => {
    const inner = renderBlockChildren();
    return `${indent}<ul>\n${inner}\n${indent}</ul>`;
  },
  listItem: context => renderListItem(context),
  orderedList: ({ indent, node, renderBlockChildren }) => {
    const first = (node.children || []).find(child => child.type === 'orderedListItem');
    const marker = (node.captures && node.captures.marker) || (first && first.captures.marker) || '1';
    const inner = renderBlockChildren();
    return `${indent}<ol type="${orderedListType(marker)}" start="${escapeHtml(marker)}">\n${inner}\n${indent}</ol>`;
  },
  orderedListItem: context => renderListItem(context),
  blockquote: context => renderQuoteNode(context),
  blockquoteLine: ({ indent, renderInlineChildren }) => `${indent}<p>${renderInlineChildren()}</p>`,
  invisibleBlockquote: context => renderQuoteNode(
    context,
    defaultRules.invisibleBlockquote.editor.className || ''
  ),
  invisibleBlockquoteLine: ({ indent, renderInlineChildren }) => `${indent}<p>${renderInlineChildren()}</p>`,
  table: ({ indent, renderBlockChildren }) => {
    const rows = renderBlockChildren();
    return `${indent}<table>\n${rows}\n${indent}</table>`;
  },
  tableRow: ({ indent, renderBlockChildren }) => {
    const cells = renderBlockChildren();
    return `${indent}<tr>\n${cells}\n${indent}</tr>`;
  },
  tableCell: ({ indent, renderInlineChildren }) => `${indent}<td>${renderInlineChildren()}</td>`,
  tableDivider: () => '',
  inlineText: ({ node }) => escapeHtml(node.content),
  inlineColor: ({ node, renderInlineChildren }) =>
    `<span style="color:${escapeHtml((node.captures.color || '').trim())}">${renderInlineChildren()}</span>`,
  inlineHtml: ({ node, options }) => options.allowInlineHtml === false
    ? escapeHtml(node.raw || node.content)
    : (node.raw || node.content),
  inlineStrong: ({ renderInlineChildren }) => `<strong>${renderInlineChildren()}</strong>`,
  inlineUnderline: ({ renderInlineChildren }) => `<u>${renderInlineChildren()}</u>`,
  inlineEmphasis: ({ renderInlineChildren }) => `<em>${renderInlineChildren()}</em>`,
  inlineCode: ({ node }) => `<code>${escapeHtml(node.content)}</code>`,
  inlineVariable: ({ node, options }) => {
    const namespace = node.captures.namespace || '';
    const id = node.captures.id || '';
    const values = options.variables && options.variables[namespace];
    if (values && Object.prototype.hasOwnProperty.call(values, id)) return escapeHtml(values[id]);
    return escapeHtml(node.raw || node.content);
  },
  inlineAutoLink: ({ node }) => `<a href="${escapeHtml(node.content)}">${escapeHtml(node.content)}</a>`,
  inlineLink: ({ node, renderInlineChildren, options }) => {
    const href = resolveLinkHref(node.captures.href || '', options);
    const title = node.captures.title ? node.captures.title.trim() : '';
    const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
    return `<a href="${escapeHtml(href)}"${titleAttr}>${renderInlineChildren()}</a>`;
  },
  inlineImage: ({ node }) => {
    const src = (node.captures.src || '').trim();
    const alt = (node.captures.alt || '').trim();
    const title = node.captures.title ? node.captures.title.trim() : '';
    const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
    return `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}"${titleAttr} />`;
  },
  inlineLineBreak: () => '<br />',
  __default: ({ renderInlineChildren }) => renderInlineChildren()
};

function resolveTemplateValue(context, path) {
  if (!path) {
    return '';
  }
  return path.split('.').reduce((acc, key) => {
    if (acc === undefined || acc === null) {
      return undefined;
    }
    return acc[key];
  }, context);
}

function renderTemplate(template, context) {
  if (typeof template !== 'string' || !template.length) {
    return '';
  }
  return template.replace(/\$\{([^}]+)\}/g, (_, expression) => {
    const value = resolveTemplateValue(context, expression.trim());
    return value === undefined || value === null ? '' : String(value);
  });
}

function createTemplateRenderer(template) {
  return ({ node, depth, indent, renderInlineChildren, renderBlockChildren }) => {
    const context = {
      content: node.content || '',
      raw: node.raw || '',
      captures: node.captures || {},
      escapedContent: escapeHtml(node.content || ''),
      depth,
      indent
    };

    Object.defineProperties(context, {
      children: {
        configurable: true,
        enumerable: true,
        get() {
          const value =
            node.parseType === 'inline'
              ? renderInlineChildren()
              : renderBlockChildren();
          Object.defineProperty(this, 'children', {
            value,
            writable: false,
            enumerable: true
          });
          return value;
        }
      },
      inlineChildren: {
        configurable: true,
        enumerable: true,
        get() {
          const value = renderInlineChildren();
          Object.defineProperty(this, 'inlineChildren', {
            value,
            writable: false,
            enumerable: true
          });
          return value;
        }
      },
      blockChildren: {
        configurable: true,
        enumerable: true,
        get() {
          const value = renderBlockChildren();
          Object.defineProperty(this, 'blockChildren', {
            value,
            writable: false,
            enumerable: true
          });
          return value;
        }
      }
    });

    return renderTemplate(template, context);
  };
}

function normalizeRendererEntry(entry) {
  if (typeof entry === 'function') {
    return entry;
  }
  if (typeof entry === 'string') {
    return createTemplateRenderer(entry);
  }
  if (entry && typeof entry === 'object') {
    if (typeof entry.render === 'function') {
      return entry.render.bind(entry);
    }
    if (typeof entry.template === 'string') {
      return createTemplateRenderer(entry.template);
    }
  }
  throw new Error('Renderer must be a function, template string, or an object with a render/template property.');
}

function normalizeRendererMap(overrides, rules) {
  const map = {};
  Object.entries(defaultRenderers).forEach(([type, renderer]) => {
    map[type] = normalizeRendererEntry(renderer);
  });
  Object.entries(rules || {}).forEach(([type, rule]) => {
    if (rule && rule.html && typeof rule.html.template === 'string') {
      map[type] = createTemplateRenderer(rule.html.template);
    }
  });
  Object.entries(overrides || {}).forEach(([type, renderer]) => {
    map[type] = normalizeRendererEntry(renderer);
  });
  if (!map.__default) {
    map.__default = ({ renderInlineChildren }) => renderInlineChildren();
  }
  return map;
}

class MarkdownRenderer {
  constructor(rendererMap, options = {}) {
    this.renderers = normalizeRendererMap(rendererMap, options.rules || defaultRules);
    this.options = {
      headingPermalinks: true,
      headingIds: true,
      headingPermalinkTitle: 'Permalink to this heading',
      headingPermalinkIcon: '<span class="copy-icon" role="button" aria-label="Link Icon"></span>',
      variables: {},
      baseUrl: '',
      allowInlineHtml: true,
      ...options
    };
    this.tocHeadings = new WeakMap();
  }

  overrideRenderer(type, renderer) {
    this.renderers[type] = normalizeRendererEntry(renderer);
    return this;
  }

  render(ast) {
    if (!ast) {
      return '';
    }
    this.prepareDocument(ast);
    return this.renderNode(ast, 0);
  }

  prepareDocument(ast) {
    const ordered = [];
    const visit = node => {
      ordered.push(node);
      (node.children || []).filter(child => child.parseType !== 'inline').forEach(visit);
    };
    visit(ast);
    const headings = ordered
      .map((node, index) => ({ node, index }))
      .filter(item => item.node.type === 'heading')
      .map(({ node, index }) => ({
        index,
        level: Math.max(1, Math.min(6, (node.captures.depth || '#').length)),
        text: nodeText(node),
        slug: headingSlug(nodeText(node))
      }));
    ordered.forEach((node, index) => {
      if (node.type !== 'tocDirective') return;
      const command = node.captures.command || node.content;
      this.tocHeadings.set(node, command === 'toc-all' ? headings : headings.filter(heading => heading.index > index));
    });
  }

  renderNode(node, depth, forceInline) {
    if (!node) {
      return '';
    }
    const renderer = this.renderers[node.type] || this.renderers.__default;
    const parseType = node.parseType || 'block';
    const isInline = typeof forceInline === 'boolean' ? forceInline : parseType === 'inline';
    const indent = isInline ? '' : '  '.repeat(depth);
    const renderInlineChildren = () => this.renderChildren(node.children, depth, { inline: true });
    const renderBlockChildren = (options = {}) => {
      const offset = options.depthOffset === undefined ? 1 : options.depthOffset;
      return this.renderChildren(node.children, depth + offset, { inline: false });
    };
    const context = {
      node,
      depth,
      indent,
      isInline,
      renderInlineChildren,
      renderBlockChildren,
      renderChild: (child, childDepth = depth + 1, childInline) =>
        this.renderNode(child, childDepth, childInline),
      escapeHtml,
      options: this.options,
      renderer: this
    };
    const html = renderer ? renderer(context) : '';
    return html || '';
  }

  renderChildren(children, depth, options = {}) {
    const list = Array.isArray(children) ? children : [];
    if (!list.length) {
      return '';
    }
    if (options.inline) {
      return list.map(child => this.renderNode(child, depth, true)).join('');
    }
    return list
      .map(child => this.renderNode(child, depth))
      .filter(html => html !== null && html !== undefined && html !== '')
      .join('\n');
  }
}

const sharedRenderer = new MarkdownRenderer();

function astToHTML(ast, rendererOverrides, options) {
  if (!ast) {
    return '';
  }
  if (rendererOverrides instanceof MarkdownRenderer) {
    return rendererOverrides.render(ast);
  }
  if (rendererOverrides && typeof rendererOverrides === 'object' && !Array.isArray(rendererOverrides)) {
    return new MarkdownRenderer(rendererOverrides, options).render(ast);
  }
  if (options) return new MarkdownRenderer(undefined, options).render(ast);
  return sharedRenderer.render(ast);
}

function overrideRenderer(nodeType, renderer) {
  sharedRenderer.overrideRenderer(nodeType, renderer);
  return sharedRenderer;
}

function variablesFromUserdata(userdata) {
  if (!userdata) return {};
  return {
    user: Object.fromEntries(Object.entries(userdata)
      .filter(([, record]) => record && record.id !== undefined)
      .map(([name, record]) => [String(record.id), name]))
  };
}

function markdownToHtml(markdown, rules, rendererOverrides, renderOptions) {
  let actualRules = rules;
  let actualRenderers = rendererOverrides;
  let options = renderOptions || {};
  if (typeof rules === 'string') {
    actualRules = undefined;
    options = { ...(rendererOverrides || {}), baseUrl: rules };
    actualRenderers = options.renderers;
  } else if (rules && typeof rules === 'object' && !rules.document) {
    options = rules;
    actualRules = rules.rules;
    actualRenderers = rules.renderers;
  }
  options = {
    ...options,
    rules: actualRules || defaultRules,
    variables: { ...variablesFromUserdata(options.userdata), ...(options.variables || {}) }
  };
  options.linkRelativeCallback = options.linkRelativeCallback || options.link_relative_callback;
  options.linkAbsoluteCallback = options.linkAbsoluteCallback || options.link_absolute_callback;
  const ast = markdownToAST(markdown, actualRules);
  return astToHTML(ast, actualRenderers, options);
}

const markdownApi = {
  markdownToAST,
  astToHTML,
  markdownToHtml
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = markdownApi;
}
if (typeof globalThis !== 'undefined') {
  globalThis.MarkdownJS = markdownApi;
}
