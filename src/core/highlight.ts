import path from 'node:path';
import {common, createLowlight} from 'lowlight';

export type Kind =
  | 'keyword'
  | 'string'
  | 'number'
  | 'comment'
  | 'title'
  | 'meta'
  | 'section'
  | 'bullet'
  | 'code'
  | 'strong'
  | 'emphasis'
  | 'link';

export type Segment = {text: string; kind: Kind | null};

const lowlight = createLowlight(common);

const LANGUAGE: Record<string, string> = {
  '.ts': 'typescript', '.tsx': 'typescript', '.mts': 'typescript', '.cts': 'typescript',
  '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
  '.json': 'json', '.css': 'css', '.scss': 'scss', '.less': 'less',
  '.html': 'xml', '.xml': 'xml', '.svg': 'xml', '.vue': 'xml',
  '.md': 'markdown', '.markdown': 'markdown',
  '.sh': 'bash', '.bash': 'bash', '.zsh': 'bash',
  '.yml': 'yaml', '.yaml': 'yaml', '.toml': 'ini', '.ini': 'ini',
  '.py': 'python', '.go': 'go', '.rs': 'rust', '.java': 'java', '.kt': 'kotlin',
  '.c': 'c', '.h': 'c', '.cpp': 'cpp', '.hpp': 'cpp', '.cs': 'csharp',
  '.php': 'php', '.rb': 'ruby', '.swift': 'swift', '.sql': 'sql', '.lua': 'lua',
  '.diff': 'diff', '.patch': 'diff',
};

// highlight.js class (without the "hljs-" prefix) to the few kinds the pane styles.
const KIND: Record<string, Kind> = {
  keyword: 'keyword', 'selector-tag': 'keyword', doctag: 'keyword',
  string: 'string', regexp: 'string', symbol: 'string', addition: 'string',
  number: 'number', literal: 'number',
  comment: 'comment', quote: 'comment', deletion: 'comment',
  title: 'title', type: 'title', built_in: 'title', name: 'title', 'selector-class': 'title', 'selector-id': 'title',
  meta: 'meta', tag: 'meta', punctuation: 'meta',
  section: 'section', bullet: 'bullet', code: 'code',
  strong: 'strong', emphasis: 'emphasis', link: 'link',
};

const MAX_LINES = 4000;

type HastNode = {
  type: string;
  value?: string;
  properties?: {className?: unknown};
  children?: HastNode[];
};

function kindOf(node: HastNode, inherited: Kind | null): Kind | null {
  const classes = node.properties?.className;
  if (!Array.isArray(classes)) return inherited;
  for (const name of classes) {
    const kind = KIND[String(name).replace(/^hljs-/, '')];
    if (kind) return kind;
  }

  return inherited;
}

// One array of coloured segments per line, or null when the file type is
// unknown or the file is too long to be worth colouring.
export function highlightLines(filePath: string, lines: string[]): Segment[][] | null {
  const language = LANGUAGE[path.extname(filePath).toLowerCase()];
  if (!language || !lowlight.registered(language) || lines.length > MAX_LINES) return null;

  let tree: HastNode;
  try {
    tree = lowlight.highlight(language, lines.join('\n')) as HastNode;
  } catch {
    return null;
  }

  const out: Segment[][] = [[]];
  const walk = (node: HastNode, kind: Kind | null) => {
    if (node.type === 'text') {
      // A token can span lines (block comments, template strings).
      (node.value ?? '').split('\n').forEach((part, i) => {
        if (i > 0) out.push([]);
        if (part) out[out.length - 1]!.push({text: part, kind});
      });
      return;
    }

    const next = kindOf(node, kind);
    for (const child of node.children ?? []) walk(child, next);
  };

  walk(tree, null);
  return out;
}

export type Piece = {text: string; kind: Kind | null; marked: boolean};

// One line of a diff, cut to the visible column window and split wherever the
// syntax colour or the word-level mark changes. `spans` are character ranges
// that differ from the line this one replaced.
export function layoutLine(
  text: string,
  segments: Segment[] | null,
  spans: readonly {start: number; end: number}[] | undefined,
  from: number,
  width: number,
): Piece[] {
  if (width <= 0) return [];
  const chars = [...text];
  const to = Math.min(chars.length, from + width);
  if (from >= chars.length) return [];

  // Character index -> syntax kind, so segments and spans can be applied in
  // one pass without worrying about which boundaries fall where.
  const kinds: (Kind | null)[] = new Array(chars.length).fill(null);
  if (segments) {
    let at = 0;
    for (const segment of segments) {
      for (const _ of segment.text) {
        if (at < kinds.length) kinds[at] = segment.kind;
        at++;
      }
    }
  }

  const marked: boolean[] = new Array(chars.length).fill(false);
  for (const span of spans ?? []) {
    for (let i = Math.max(0, span.start); i < Math.min(chars.length, span.end); i++) marked[i] = true;
  }

  const out: Piece[] = [];
  for (let i = from; i < to; i++) {
    const last = out[out.length - 1];
    if (last && kinds[i] === last.kind && marked[i] === last.marked) last.text += chars[i]!;
    else out.push({text: chars[i]!, kind: kinds[i] ?? null, marked: marked[i] ?? false});
  }

  return out;
}
