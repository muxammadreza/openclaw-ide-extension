import * as vscode from 'vscode';

export type ParseResult =
  | { ok: true; value: Record<string, any> }
  | { ok: false; error: string };

/**
 * Parse JSON5-flavoured config text into a plain object.
 *
 * Supports:
 * - Line comments (//)
 * - Block comments (/* *\/)
 * - Trailing commas
 * - Unquoted keys (identifier-only; not full JSON5 key grammar)
 *
 * Returns a ParseResult so callers can decide how to handle errors without
 * throwing.
 */
export function parseConfig(text: string): ParseResult {
  try {
    const json = toJson(text);
    const value = JSON.parse(json) as Record<string, any>;
    return { ok: true, value };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

/**
 * Convert JSON5-ish text to valid JSON by stripping comments,
 * trailing commas, and quoting bare identifier keys.
 */
function toJson(src: string): string {
  // 1. Remove single-line comments (// …)
  // 2. Remove block comments (/* … */)
  // 3. Remove trailing commas before } or ]
  // 4. Quote unquoted identifier keys

  let out = '';
  let i = 0;
  const len = src.length;

  while (i < len) {
    const ch = src[i];

    // Block comment
    if (ch === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      if (end === -1) {
        // Unclosed block comment — consume rest
        break;
      }
      // Preserve newlines so line numbers stay accurate
      const span = src.slice(i, end + 2);
      out += span.replace(/[^\n]/g, ' ');
      i = end + 2;
      continue;
    }

    // Line comment
    if (ch === '/' && src[i + 1] === '/') {
      const nl = src.indexOf('\n', i);
      if (nl === -1) {
        break;
      }
      i = nl; // keep the newline
      continue;
    }

    // String — copy verbatim (don't process comments or commas inside strings)
    if (ch === '"' || ch === "'") {
      const quote = ch;
      let str = '"';
      i++;
      while (i < len && src[i] !== quote) {
        if (src[i] === '\\') {
          str += src[i] + src[i + 1];
          i += 2;
        } else {
          const c = src[i];
          // Ensure single-quoted strings are valid JSON strings
          if (quote === "'" && c === '"') {
            str += '\\"';
          } else {
            str += c;
          }
          i++;
        }
      }
      str += '"';
      out += str;
      i++; // closing quote
      continue;
    }

    out += ch;
    i++;
  }

  // Strip trailing commas before } or ]
  out = out.replace(/,(\s*[}\]])/g, '$1');

  // Quote bare identifier keys: word chars followed by whitespace then colon
  // e.g.  agents: → "agents":
  out = out.replace(/([{,]\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)(\s*:)/g, '$1"$2"$3');

  return out;
}

/**
 * Return the JSON path at the given cursor position, e.g. "channels.telegram.botToken".
 * Returns undefined if the position is not on or after a key.
 */
export function getJsonPath(doc: vscode.TextDocument, position: vscode.Position): string | undefined {
  // Walk backwards from the cursor collecting ancestor keys
  const text = doc.getText();
  const offset = doc.offsetAt(position);

  const keys: string[] = [];
  let depth = 0;
  let i = offset;

  // Find the key at the current depth by scanning backwards
  while (i >= 0) {
    const ch = text[i];

    if (ch === '}' || ch === ']') {
      depth++;
    } else if (ch === '{' || ch === '[') {
      if (depth > 0) {
        depth--;
      } else {
        // We've popped up a level — look for the key before this opening brace
        const keyBefore = extractKeyBefore(text, i);
        if (keyBefore) {
          keys.unshift(keyBefore);
        }
      }
    }
    i--;
  }

  // Add the immediate key at the cursor
  const currentKey = extractCurrentKey(doc, position);
  if (currentKey) {
    keys.push(currentKey);
  }

  return keys.length > 0 ? keys.join('.') : undefined;
}

/**
 * Extract the key name that appears just before position `pos` in the source.
 */
function extractKeyBefore(text: string, pos: number): string | undefined {
  // Go back past whitespace
  let i = pos - 1;
  while (i >= 0 && /\s/.test(text[i])) {
    i--;
  }
  // Expect a colon before the brace
  if (text[i] !== ':') {
    return undefined;
  }
  i--;
  while (i >= 0 && /\s/.test(text[i])) {
    i--;
  }
  // Read quoted or unquoted key
  return readKeyBackwards(text, i);
}

function readKeyBackwards(text: string, end: number): string | undefined {
  if (text[end] === '"' || text[end] === "'") {
    const quote = text[end];
    let i = end - 1;
    let key = '';
    while (i >= 0 && text[i] !== quote) {
      key = text[i] + key;
      i--;
    }
    return key || undefined;
  }
  // Unquoted identifier
  if (/[a-zA-Z0-9_$]/.test(text[end])) {
    let i = end;
    while (i >= 0 && /[a-zA-Z0-9_$]/.test(text[i])) {
      i--;
    }
    return text.slice(i + 1, end + 1) || undefined;
  }
  return undefined;
}

/**
 * Extract the key on the current line at the cursor position.
 */
function extractCurrentKey(doc: vscode.TextDocument, position: vscode.Position): string | undefined {
  const line = doc.lineAt(position).text;
  // Match: optional quote + identifier + optional quote + colon
  const m = /^\s*["']?([a-zA-Z_$][a-zA-Z0-9_$]*)["']?\s*:/.exec(line);
  return m ? m[1] : undefined;
}

/**
 * Return the identifier word at the given position.
 */
export function getWordAtPosition(
  doc: vscode.TextDocument,
  position: vscode.Position,
): string | undefined {
  const range = doc.getWordRangeAtPosition(position, /[a-zA-Z_$][a-zA-Z0-9_$.]*[a-zA-Z0-9_$]/);
  return range ? doc.getText(range) : undefined;
}
