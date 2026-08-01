import './default_rules.js';
import './markdown.js';

const MarkdownJS = globalThis.MarkdownJS;

export const {
  markdownToAST,
  astToHTML,
  markdownToHtml
} = MarkdownJS;
export default MarkdownJS;
