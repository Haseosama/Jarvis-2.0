// Dependency-free generators for PDF, DOCX, XLSX and PPTX documents.
// Everything here is pure (no host access) so it can be unit-tested under Node.

const enc = new TextEncoder();

// ── ZIP (stored) ─────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function buildZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const entry of entries) {
    const nameBytes = enc.encode(entry.name);
    const dataBytes = typeof entry.data === 'string' ? enc.encode(entry.data) : entry.data;
    const crc = crc32(dataBytes);
    const size = dataBytes.length;

    const local = new Uint8Array(30 + nameBytes.length + size);
    const ldv = new DataView(local.buffer);
    ldv.setUint32(0, 0x04034b50, true);
    ldv.setUint16(4, 20, true);
    ldv.setUint16(6, 0x0800, true); // UTF-8 names
    ldv.setUint32(14, crc, true);
    ldv.setUint32(18, size, true);
    ldv.setUint32(22, size, true);
    ldv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    local.set(dataBytes, 30 + nameBytes.length);
    localParts.push(local);

    const central = new Uint8Array(46 + nameBytes.length);
    const cdv = new DataView(central.buffer);
    cdv.setUint32(0, 0x02014b50, true);
    cdv.setUint16(4, 20, true);
    cdv.setUint16(6, 20, true);
    cdv.setUint16(8, 0x0800, true);
    cdv.setUint32(16, crc, true);
    cdv.setUint32(20, size, true);
    cdv.setUint32(24, size, true);
    cdv.setUint16(28, nameBytes.length, true);
    cdv.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centralParts.push(central);
    offset += local.length;
  }
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const eocd = new Uint8Array(22);
  const edv = new DataView(eocd.buffer);
  edv.setUint32(0, 0x06054b50, true);
  edv.setUint16(8, entries.length, true);
  edv.setUint16(10, entries.length, true);
  edv.setUint32(12, centralSize, true);
  edv.setUint32(16, offset, true);
  const out = new Uint8Array(offset + centralSize + eocd.length);
  let pos = 0;
  for (const part of [...localParts, ...centralParts, eocd]) {
    out.set(part, pos);
    pos += part.length;
  }
  return out;
}

export function escapeXml(value) {
  return String(value ?? '')
    // XML 1.0 forbids most control characters.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function uint8ToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

// ── Markdown → blocks ────────────────────────────────────────────────────────

export function stripInlineMarkdown(text) {
  return String(text ?? '')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|[^*])\*(?!\s)([^*]+?)\*(?!\*)/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .trim();
}

function splitTableRow(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => stripInlineMarkdown(cell));
}

export function parseMarkdownBlocks(content) {
  const lines = String(content ?? '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i];
    const line = raw.trim();
    if (!line) { i++; continue; }

    if (line.startsWith('```')) {
      const code = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) code.push(lines[i++]);
      i++;
      blocks.push({ kind: 'code', text: code.join('\n') });
      continue;
    }
    if (line.startsWith('|') && line.endsWith('|')) {
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith('|') && lines[i].trim().endsWith('|')) {
        if (!/^\|[\s\-:|]+\|$/.test(lines[i].trim())) rows.push(splitTableRow(lines[i]));
        i++;
      }
      if (rows.length) blocks.push({ kind: 'table', rows });
      continue;
    }
    const heading = /^(#{1,4})\s*(.*)$/.exec(line);
    if (heading) { blocks.push({ kind: 'heading', level: heading[1].length, text: stripInlineMarkdown(heading[2]) }); i++; continue; }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) { blocks.push({ kind: 'divider' }); i++; continue; }
    const bullet = /^[*\-+•]\s+(.*)$/.exec(line);
    if (bullet) { blocks.push({ kind: 'bullet', text: stripInlineMarkdown(bullet[1]) }); i++; continue; }
    const numbered = /^(\d+)[.)]\s+(.*)$/.exec(line);
    if (numbered) { blocks.push({ kind: 'numbered', number: Number(numbered[1]), text: stripInlineMarkdown(numbered[2]) }); i++; continue; }

    const paragraph = [line];
    i++;
    while (i < lines.length) {
      const next = lines[i].trim();
      if (!next || /^(#|\||```|[*\-+•]\s|\d+[.)]\s)/.test(next) || /^(-{3,}|\*{3,}|_{3,})$/.test(next)) break;
      paragraph.push(next);
      i++;
    }
    blocks.push({ kind: 'body', text: stripInlineMarkdown(paragraph.join(' ')) });
  }
  return blocks;
}

// ── PDF ──────────────────────────────────────────────────────────────────────

const HELVETICA_WIDTHS = {
  ' ': 278, '!': 278, '"': 355, '#': 556, $: 556, '%': 889, '&': 667, "'": 191, '(': 333, ')': 333, '*': 389, '+': 584, ',': 278,
  '-': 333, '.': 278, '/': 278, ':': 278, ';': 278, '<': 584, '=': 584, '>': 584, '?': 556, '@': 1015,
  A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 500, K: 667, L: 556, M: 833, N: 722, O: 778, P: 667, Q: 778,
  R: 722, S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611, '[': 278, '\\': 278, ']': 278, '^': 469, _: 556, '`': 333,
  a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222, j: 222, k: 500, l: 222, m: 833, n: 556, o: 556, p: 556, q: 556,
  r: 333, s: 500, t: 278, u: 556, v: 500, w: 722, x: 500, y: 500, z: 500, '{': 334, '|': 260, '}': 334, '~': 584,
};
for (let d = 0; d <= 9; d++) HELVETICA_WIDTHS[String(d)] = 556;

const CP1252_EXTRAS = new Map([
  ['€', 0x80], ['‚', 0x82], ['ƒ', 0x83], ['„', 0x84], ['…', 0x85], ['†', 0x86], ['‡', 0x87], ['ˆ', 0x88], ['‰', 0x89], ['Š', 0x8a],
  ['‹', 0x8b], ['Œ', 0x8c], ['Ž', 0x8e], ['‘', 0x91], ['’', 0x92], ['“', 0x93], ['”', 0x94], ['•', 0x95], ['–', 0x96], ['—', 0x97],
  ['˜', 0x98], ['™', 0x99], ['š', 0x9a], ['›', 0x9b], ['œ', 0x9c], ['ž', 0x9e], ['Ÿ', 0x9f], ['\u202f', 0x20], ['\u00a0', 0x20],
]);

function toWinAnsiByte(char) {
  const code = char.codePointAt(0);
  if (CP1252_EXTRAS.has(char)) return CP1252_EXTRAS.get(char);
  if (code >= 0x20 && code <= 0x7e) return code;
  if (code >= 0xa1 && code <= 0xff) return code;
  return 0x3f;
}

function pdfHex(text) {
  let out = '<';
  for (const char of text) out += toWinAnsiByte(char).toString(16).padStart(2, '0');
  return `${out}>`;
}

function charWidth(char, bold, mono) {
  if (mono) return 600;
  const width = HELVETICA_WIDTHS[char] ?? (char.codePointAt(0) > 0x7e ? 556 : 556);
  return bold ? width * 1.07 : width;
}

function textWidth(text, size, bold = false, mono = false) {
  let total = 0;
  for (const char of text) total += charWidth(char, bold, mono);
  return (total * size) / 1000;
}

function wrapText(text, maxWidth, size, bold = false, mono = false) {
  const lines = [];
  for (const paragraph of String(text ?? '').split('\n')) {
    const words = mono ? [paragraph] : paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) { lines.push(''); continue; }
    let current = '';
    const flush = () => { lines.push(current); current = ''; };
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (textWidth(candidate, size, bold, mono) <= maxWidth) { current = candidate; continue; }
      if (current) flush();
      if (textWidth(word, size, bold, mono) <= maxWidth) { current = word; continue; }
      let piece = '';
      for (const char of word) {
        if (textWidth(piece + char, size, bold, mono) > maxWidth && piece) { lines.push(piece); piece = ''; }
        piece += char;
      }
      current = piece;
    }
    lines.push(current);
  }
  return lines;
}

const PAGE = { width: 595.28, height: 841.89, margin: 56, top: 62, bottom: 62 };
const num = (value) => Number(value.toFixed(2));

export function buildPdfBytes(title, content, { subtitle = '', author = 'Jarvis 2.0' } = {}) {
  const pages = [];
  let ops = [];
  let y = PAGE.height - PAGE.top;
  const contentWidth = PAGE.width - PAGE.margin * 2;

  const newPage = () => {
    ops = [];
    pages.push(ops);
    y = PAGE.height - PAGE.top;
  };
  const ensure = (height) => { if (y - height < PAGE.bottom) newPage(); };
  const color = (hex) => {
    const value = hex.replace('#', '');
    return [0, 2, 4].map((offset) => num(parseInt(value.slice(offset, offset + 2), 16) / 255)).join(' ');
  };
  const text = (value, x, baseline, size, { font = 'F1', fill = '#1f2937' } = {}) => {
    ops.push(`BT /${font} ${size} Tf ${color(fill)} rg ${num(x)} ${num(baseline)} Td ${pdfHex(value)} Tj ET`);
  };
  const rect = (x, bottom, width, height, { fill = null, stroke = null, line = 0.6 } = {}) => {
    if (fill) ops.push(`${color(fill)} rg ${num(x)} ${num(bottom)} ${num(width)} ${num(height)} re f`);
    if (stroke) ops.push(`${color(stroke)} RG ${line} w ${num(x)} ${num(bottom)} ${num(width)} ${num(height)} re S`);
  };
  const hline = (x1, x2, yy, stroke = '#cbd5e1', line = 0.8) => {
    ops.push(`${color(stroke)} RG ${line} w ${num(x1)} ${num(yy)} m ${num(x2)} ${num(yy)} l S`);
  };

  newPage();
  const docTitle = stripInlineMarkdown(title || '');
  if (docTitle) {
    for (const line of wrapText(docTitle, contentWidth, 22, true)) {
      y -= 26;
      text(line, PAGE.margin, y, 22, { font: 'F2', fill: '#0f3d63' });
    }
    if (subtitle) {
      for (const line of wrapText(subtitle, contentWidth, 12)) {
        y -= 16;
        text(line, PAGE.margin, y, 12, { fill: '#64748b' });
      }
    }
    y -= 9;
    hline(PAGE.margin, PAGE.width - PAGE.margin, y, '#00a6c8', 1.4);
    y -= 12;
  }

  const sizes = { 1: 17, 2: 14, 3: 12, 4: 11 };
  let numberedCounter = 0;
  for (const block of parseMarkdownBlocks(content)) {
    if (block.kind !== 'numbered') numberedCounter = 0;
    if (block.kind === 'heading') {
      // A first heading identical to the title would only repeat it.
      if (block.level === 1 && stripInlineMarkdown(block.text) === docTitle && pages.length === 1 && y > PAGE.height - 160) continue;
      const size = sizes[block.level] || 11;
      const lines = wrapText(block.text, contentWidth, size, true);
      ensure(14 + lines.length * (size + 4) + 36);
      y -= block.level === 1 ? 14 : 9;
      for (const line of lines) {
        y -= size + 4;
        text(line, PAGE.margin, y, size, { font: 'F2', fill: block.level <= 2 ? '#0f3d63' : '#1f2937' });
      }
      if (block.level === 1) { y -= 4; hline(PAGE.margin, PAGE.width - PAGE.margin, y); }
      y -= 4;
    } else if (block.kind === 'body') {
      const lines = wrapText(block.text, contentWidth, 11);
      for (const line of lines) { ensure(15); y -= 15; text(line, PAGE.margin, y, 11); }
      y -= 6;
    } else if (block.kind === 'bullet' || block.kind === 'numbered') {
      numberedCounter = block.kind === 'numbered' ? (numberedCounter || block.number || 1) + (numberedCounter ? 1 : 0) : 0;
      const marker = block.kind === 'bullet' ? '•' : `${numberedCounter}.`;
      const indent = 20;
      const lines = wrapText(block.text, contentWidth - indent, 11);
      lines.forEach((line, index) => {
        ensure(15);
        y -= 15;
        if (index === 0) text(marker, PAGE.margin + 4, y, 11, { fill: '#00809c' });
        text(line, PAGE.margin + indent, y, 11);
      });
      y -= 3;
    } else if (block.kind === 'code') {
      const maxChars = Math.floor(contentWidth / (9 * 0.6)) - 2;
      const lines = block.text.split('\n').flatMap((line) => {
        const out = [];
        for (let start = 0; start < Math.max(line.length, 1); start += maxChars) out.push(line.slice(start, start + maxChars));
        return out;
      });
      for (const line of lines) {
        ensure(13);
        y -= 12.5;
        rect(PAGE.margin, y - 3, contentWidth, 12.5, { fill: '#f1f5f9' });
        text(line, PAGE.margin + 6, y, 9, { font: 'F3', fill: '#0f172a' });
      }
      y -= 8;
    } else if (block.kind === 'divider') {
      ensure(16);
      y -= 8;
      hline(PAGE.margin, PAGE.width - PAGE.margin, y);
      y -= 8;
    } else if (block.kind === 'table') {
      const columns = Math.max(...block.rows.map((row) => row.length), 1);
      const colWidth = contentWidth / columns;
      block.rows.forEach((row, rowIndex) => {
        const header = rowIndex === 0 && block.rows.length > 1;
        const cellLines = Array.from({ length: columns }, (_, col) => wrapText(row[col] ?? '', colWidth - 10, 9.5, header).slice(0, 12));
        const rowHeight = Math.max(...cellLines.map((lines) => lines.length), 1) * 12 + 8;
        ensure(rowHeight);
        const top = y;
        cellLines.forEach((lines, col) => {
          const x = PAGE.margin + col * colWidth;
          rect(x, top - rowHeight, colWidth, rowHeight, { fill: header ? '#dbeafe' : rowIndex % 2 ? '#f8fafc' : null, stroke: '#94a3b8', line: 0.5 });
          lines.forEach((line, lineIndex) => text(line, x + 5, top - 13 - lineIndex * 12, 9.5, { font: header ? 'F2' : 'F1' }));
        });
        y -= rowHeight;
      });
      y -= 10;
    }
  }

  // Footer with page numbers once the total is known.
  const footerTitle = docTitle.slice(0, 70);
  pages.forEach((pageOps, index) => {
    ops = pageOps;
    const label = `${footerTitle}${footerTitle ? '  ·  ' : ''}page ${index + 1} / ${pages.length}`;
    text(label, PAGE.width / 2 - textWidth(label, 8) / 2, 30, 8, { fill: '#94a3b8' });
  });

  // Object layout: 1 catalog, 2 pages, 3-5 fonts, 6 info, then page/content pairs.
  const objects = [];
  const pageIds = pages.map((_, index) => 7 + index * 2);
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
  objects[5] = '<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>';
  const utf16 = (value) => `<FEFF${[...String(value)].map((ch) => {
    const code = ch.codePointAt(0);
    if (code > 0xffff) {
      const v = code - 0x10000;
      return (0xd800 + (v >> 10)).toString(16).padStart(4, '0') + (0xdc00 + (v & 0x3ff)).toString(16).padStart(4, '0');
    }
    return code.toString(16).padStart(4, '0');
  }).join('')}>`;
  const now = new Date();
  const stamp = `D:${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(now.getUTCDate()).padStart(2, '0')}${String(now.getUTCHours()).padStart(2, '0')}${String(now.getUTCMinutes()).padStart(2, '0')}${String(now.getUTCSeconds()).padStart(2, '0')}Z`;
  objects[6] = `<< /Title ${utf16(docTitle || 'Document')} /Author ${utf16(author)} /Creator ${utf16('Jarvis 2.0 PC')} /CreationDate (${stamp}) >>`;
  pages.forEach((pageOps, index) => {
    const pageId = pageIds[index];
    const contentId = pageId + 1;
    const stream = pageOps.join('\n');
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE.width} ${PAGE.height}] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] = `<< /Length ${enc.encode(stream).length} >>\nstream\n${stream}\nendstream`;
  });

  const chunks = [enc.encode('%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n')];
  const offsets = [];
  let position = chunks[0].length;
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = position;
    const chunk = enc.encode(`${id} 0 obj\n${objects[id]}\nendobj\n`);
    chunks.push(chunk);
    position += chunk.length;
  }
  const xrefStart = position;
  let xref = `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) xref += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  xref += `trailer\n<< /Size ${objects.length} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  chunks.push(enc.encode(xref));
  const out = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let cursor = 0;
  for (const chunk of chunks) { out.set(chunk, cursor); cursor += chunk.length; }
  return out;
}

// ── DOCX ─────────────────────────────────────────────────────────────────────

const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

function docxRun(text, props = '') {
  return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
}

export function buildDocxBytes(title, content) {
  const paragraphs = [];
  const docTitle = stripInlineMarkdown(title || '');
  if (docTitle) paragraphs.push(`<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr>${docxRun(docTitle)}</w:p>`);
  let counter = 0;
  for (const block of parseMarkdownBlocks(content)) {
    if (block.kind !== 'numbered') counter = 0;
    if (block.kind === 'heading') {
      if (block.level === 1 && block.text === docTitle && paragraphs.length === 1) continue;
      paragraphs.push(`<w:p><w:pPr><w:pStyle w:val="Heading${Math.min(block.level, 3)}"/></w:pPr>${docxRun(block.text)}</w:p>`);
    } else if (block.kind === 'body') {
      paragraphs.push(`<w:p>${docxRun(block.text)}</w:p>`);
    } else if (block.kind === 'bullet' || block.kind === 'numbered') {
      counter = block.kind === 'numbered' ? (counter || block.number || 1) + (counter ? 1 : 0) : 0;
      const marker = block.kind === 'bullet' ? '•' : `${counter}.`;
      paragraphs.push(`<w:p><w:pPr><w:ind w:left="567" w:hanging="283"/></w:pPr>${docxRun(`${marker}\t`)}${docxRun(block.text)}</w:p>`);
    } else if (block.kind === 'code') {
      for (const line of block.text.split('\n')) {
        paragraphs.push(`<w:p><w:pPr><w:shd w:val="clear" w:color="auto" w:fill="F1F5F9"/><w:spacing w:after="0"/></w:pPr>${docxRun(line || ' ', '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:sz w:val="19"/>')}</w:p>`);
      }
    } else if (block.kind === 'divider') {
      paragraphs.push('<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="CBD5E1"/></w:pBdr></w:pPr></w:p>');
    } else if (block.kind === 'table') {
      const columns = Math.max(...block.rows.map((row) => row.length), 1);
      const width = Math.floor(9000 / columns);
      const rows = block.rows.map((row, rowIndex) => {
        const header = rowIndex === 0 && block.rows.length > 1;
        const cells = Array.from({ length: columns }, (_, col) => `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${header ? '<w:shd w:val="clear" w:color="auto" w:fill="DBEAFE"/>' : ''}</w:tcPr><w:p>${docxRun(row[col] ?? '', header ? '<w:b/>' : '')}</w:p></w:tc>`).join('');
        return `<w:tr>${header ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}${cells}</w:tr>`;
      }).join('');
      paragraphs.push(`<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid>${Array.from({ length: columns }, () => `<w:gridCol w:w="${width}"/>`).join('')}</w:tblGrid>${rows}</w:tbl><w:p/>`);
    }
  }
  if (!paragraphs.length) paragraphs.push('<w:p/>');

  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles ${W_NS}>
  <w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:lang w:val="fr-FR"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
  <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:b/><w:color w:val="0F3D63"/><w:sz w:val="48"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="320" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:color w:val="0F3D63"/><w:sz w:val="34"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="100"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:color w:val="0F3D63"/><w:sz w:val="28"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="80"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:sz w:val="24"/></w:rPr></w:style>
  <w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:color="94A3B8"/><w:left w:val="single" w:sz="4" w:color="94A3B8"/><w:bottom w:val="single" w:sz="4" w:color="94A3B8"/><w:right w:val="single" w:sz="4" w:color="94A3B8"/><w:insideH w:val="single" w:sz="4" w:color="94A3B8"/><w:insideV w:val="single" w:sz="4" w:color="94A3B8"/></w:tblBorders><w:tblCellMar><w:left w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>
</w:styles>`;

  return buildZip([
    { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>` },
    { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>` },
    { name: 'docProps/core.xml', data: corePropsXml(docTitle) },
    { name: 'word/_rels/document.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: 'word/styles.xml', data: styles },
    { name: 'word/document.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${W_NS}><w:body>${paragraphs.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>` },
  ]);
}

function corePropsXml(title) {
  const iso = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${escapeXml(title)}</dc:title><dc:creator>Jarvis 2.0 PC</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${iso}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${iso}</dcterms:modified></cp:coreProperties>`;
}

// ── XLSX ─────────────────────────────────────────────────────────────────────

export function columnLetters(index) {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

const UNSAFE_FORMULA = /HYPERLINK|WEBSERVICE|FILTERXML|IMPORTDATA|IMPORTXML|\bEXEC\b|\bCALL\s*\(|REGISTER|RTD\s*\(|DDE|\[|\||@|'!|\bfile:|https?:/i;

export function isSafeFormula(formula) {
  return formula.length <= 1000 && !UNSAFE_FORMULA.test(formula);
}

export function sanitizeSheetName(name, fallback = 'Feuille1') {
  const clean = String(name ?? '').replace(/[\[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^'+|'+$/g, '').slice(0, 31);
  return clean || fallback;
}

function parseCellRows(text) {
  return String(text ?? '').trim().split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !/^\|?[-:\s|]+\|?$/.test(line))
    .map((line) => {
      const separator = line.includes('|') ? '|' : line.includes(';') ? ';' : line.includes('\t') ? '\t' : ',';
      return line.replace(/^\|/, '').replace(/\|$/, '').split(separator).map((cell) => stripInlineMarkdown(cell));
    });
}

export function parseRows(content) {
  const trimmed = String(content ?? '').trim();
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.map((row) => (Array.isArray(row) ? row.map(String) : [String(row)]));
    } catch { /* fall through */ }
  }
  return parseCellRows(trimmed);
}

/** Accepts explicit sheets, JSON {sheets:[…]}, or Markdown with `## Sheet` sections. */
export function resolveSheets({ title = '', content = '', sheets = null } = {}) {
  let spec = sheets;
  if (typeof spec === 'string') { try { spec = JSON.parse(spec); } catch { spec = null; } }
  const trimmed = String(content ?? '').trim();
  if (!spec && trimmed.startsWith('{')) {
    try { const parsed = JSON.parse(trimmed); spec = parsed.sheets || parsed.worksheets || null; } catch { /* ignore */ }
  }
  if (Array.isArray(spec) && spec.length) {
    return spec.slice(0, 20).map((sheet, index) => {
      const headers = Array.isArray(sheet.headers) ? sheet.headers.map(String) : [];
      const rows = (Array.isArray(sheet.rows) ? sheet.rows : []).slice(0, 5000).map((row) => (Array.isArray(row) ? row : [row]));
      return { name: sanitizeSheetName(sheet.name || sheet.title, `Feuille${index + 1}`), rows: headers.length ? [headers, ...rows] : rows, header: headers.length > 0 };
    });
  }
  if (/^#{1,3}\s/m.test(trimmed)) {
    const parsedSheets = [];
    let current = null;
    for (const line of trimmed.split(/\r?\n/)) {
      const heading = /^#{1,3}\s+(.*)$/.exec(line.trim());
      if (heading) { current = { name: sanitizeSheetName(stripInlineMarkdown(heading[1]), `Feuille${parsedSheets.length + 1}`), lines: [] }; parsedSheets.push(current); } else if (current) current.lines.push(line);
    }
    const resolved = parsedSheets.map((sheet) => ({ name: sheet.name, rows: parseCellRows(sheet.lines.join('\n')), header: true })).filter((sheet) => sheet.rows.length);
    if (resolved.length) return resolved;
  }
  const rows = parseRows(trimmed);
  return [{ name: sanitizeSheetName(title), rows, header: rows.length > 1 }];
}

function xlsxCell(value, ref, styleId = 0) {
  const style = styleId ? ` s="${styleId}"` : '';
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'number' && Number.isFinite(value)) return `<c r="${ref}"${style}><v>${value}</v></c>`;
  if (typeof value === 'boolean') return `<c r="${ref}"${style} t="b"><v>${value ? 1 : 0}</v></c>`;
  const text = String(value);
  if (text.startsWith('=') && text.length > 1) {
    const formula = text.slice(1);
    if (isSafeFormula(formula)) return `<c r="${ref}"${style}><f>${escapeXml(formula)}</f></c>`;
    return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${escapeXml(text)}</t></is></c>`;
  }
  const trimmed = text.trim();
  if (styleId === 0 && /^-?\d+(?:[.,]\d+)?$/.test(trimmed) && !/^0\d/.test(trimmed)) {
    return `<c r="${ref}"><v>${Number(trimmed.replace(',', '.'))}</v></c>`;
  }
  if (styleId === 0 && /^(true|false|vrai|faux)$/i.test(trimmed)) return `<c r="${ref}" t="b"><v>${/^(true|vrai)$/i.test(trimmed) ? 1 : 0}</v></c>`;
  return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${escapeXml(text)}</t></is></c>`;
}

export function buildXlsxBytes(title, content, options = {}) {
  const sheets = resolveSheets({ title, content, sheets: options.sheets });
  const sheetXml = sheets.map((sheet) => {
    const columns = Math.max(1, ...sheet.rows.map((row) => row.length));
    const widths = Array.from({ length: columns }, (_, col) => Math.min(60, Math.max(10, ...sheet.rows.slice(0, 200).map((row) => String(row[col] ?? '').replace(/^=/, '').length + 2))));
    const rowsXml = sheet.rows.map((row, rowIndex) => {
      const header = sheet.header && rowIndex === 0;
      const cells = row.map((value, col) => xlsxCell(value, `${columnLetters(col)}${rowIndex + 1}`, header ? 1 : 0)).join('');
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    }).join('');
    const lastRef = `${columnLetters(columns - 1)}${Math.max(1, sheet.rows.length)}`;
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${lastRef}"/><sheetViews><sheetView workbookViewId="0"${sheet.header ? '><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView>' : '/>'}</sheetViews><sheetFormatPr defaultRowHeight="15"/><cols>${widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join('')}</cols><sheetData>${rowsXml}</sheetData>${sheet.header && sheet.rows.length > 1 ? `<autoFilter ref="A1:${lastRef}"/>` : ''}</worksheet>`;
  });

  const names = sheets.map((sheet, index) => {
    const lower = sheets.slice(0, index).map((item) => item.name.toLowerCase());
    let name = sheet.name;
    let suffix = 2;
    while (lower.includes(name.toLowerCase())) name = `${sheet.name.slice(0, 28)} ${suffix++}`;
    return name;
  });

  return buildZip([
    { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>` },
    { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>` },
    { name: 'docProps/core.xml', data: corePropsXml(stripInlineMarkdown(title || '')) },
    { name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((name, index) => `<sheet name="${escapeXml(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('')}</sheets><calcPr fullCalcOnLoad="1"/></workbook>` },
    { name: 'xl/styles.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0F3D63"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>` },
    ...sheetXml.map((data, index) => ({ name: `xl/worksheets/sheet${index + 1}.xml`, data })),
  ]);
}

// ── CSV ──────────────────────────────────────────────────────────────────────

/** Neutralizes spreadsheet formula injection (cells starting with = + - @) in exported CSV. */
export function csvCell(value) {
  let text = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(text) && !/^-?\d+(?:[.,]\d+)?$/.test(text.trim())) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function buildCsv(content) {
  return `\uFEFF${parseRows(content).map((row) => row.map(csvCell).join(';')).join('\n')}`;
}

// ── PPTX ─────────────────────────────────────────────────────────────────────

export const PPTX_THEMES = {
  auto: { bg: '07131C', panel: '0E2230', accent: '00D4FF', accent2: 'FF8A3D', text: 'F1FAFF', muted: '8DB7C8' },
  neon: { bg: '05070C', panel: '111827', accent: '21E6C1', accent2: '7C5CFF', text: 'F6FAFF', muted: '98A9C0' },
  corporate: { bg: '081018', panel: '102130', accent: 'F97316', accent2: '22C55E', text: 'F8FAFC', muted: '94A3B8' },
  luxury: { bg: '0A0910', panel: '161320', accent: 'D4AF37', accent2: 'A855F7', text: 'FFFDF7', muted: 'C9C1B2' },
  academic: { bg: '0D1117', panel: '141A22', accent: '60A5FA', accent2: 'F59E0B', text: 'F8FAFC', muted: '94A3B8' },
  sunset: { bg: '1A0F14', panel: '25141A', accent: 'FB7185', accent2: 'FDBA74', text: 'FFF7F8', muted: 'E5B7C0' },
  clean: { bg: 'FFFFFF', panel: 'F1F5F9', accent: '0F6CBD', accent2: 'E4572E', text: '1F2937', muted: '64748B' },
};

export function resolvePptxTheme(themeText = '', title = '') {
  const requested = String(themeText || '').toLowerCase().trim();
  if (PPTX_THEMES[requested]) return { name: requested, ...PPTX_THEMES[requested] };
  const text = `${requested} ${title}`.toLowerCase();
  const pick = /clair|light|blanc|white|impression|print|clean/.test(text) ? 'clean'
    : /neon|futur|tech|cyber|startup|saas|\bia\b|\bai\b/.test(text) ? 'neon'
    : /luxe|luxury|premium|gold|mode|fashion|marque|brand/.test(text) ? 'luxury'
    : /financ|corp|board|entreprise|enterprise|business/.test(text) ? 'corporate'
    : /acad|recherche|research|science|education|étude|etude/.test(text) ? 'academic'
    : /sunset|cr[ée]atif|creative|marketing|campagne|portfolio/.test(text) ? 'sunset'
    : 'auto';
  return { name: pick, ...PPTX_THEMES[pick] };
}

const EMU = 12700; // points → EMU
const SLIDE_W = 12192000;
const SLIDE_H = 6858000;

export function slidesFromOutline(content, title = '') {
  const blocks = parseMarkdownBlocks(content);
  const slides = [];
  let current = null;
  let deckTitle = stripInlineMarkdown(title);
  let subtitle = '';
  const open = (slideTitle) => { current = { title: slideTitle, bullets: [], table: null }; slides.push(current); };

  const hasHeadings = blocks.some((block) => block.kind === 'heading');
  if (hasHeadings) {
    for (const block of blocks) {
      if (block.kind === 'heading') {
        if (block.level === 1 && !slides.length && !deckTitle) { deckTitle = block.text; continue; }
        if (block.level === 1 && block.text === deckTitle && !slides.length) continue;
        open(block.text);
      } else {
        if (!current) {
          if (block.kind === 'body' && !subtitle) { subtitle = block.text; continue; }
          open('Introduction');
        }
        if (block.kind === 'bullet' || block.kind === 'numbered' || block.kind === 'body') current.bullets.push(block.text);
        else if (block.kind === 'table') current.table = block.rows;
        else if (block.kind === 'code') current.bullets.push(...block.text.split('\n').filter(Boolean).slice(0, 8));
      }
    }
  } else {
    const paragraphs = String(content ?? '').trim().split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
    for (const paragraph of paragraphs) {
      const lines = paragraph.split('\n').map((line) => line.trim()).filter(Boolean);
      open(stripInlineMarkdown(lines[0]));
      for (const line of lines.slice(1)) current.bullets.push(stripInlineMarkdown(line.replace(/^[-*•\d.)\s]+/, '')));
    }
  }
  return { deckTitle: deckTitle || slides[0]?.title || 'Présentation', subtitle, slides };
}

function normalizeSlides(input) {
  let list = input;
  if (typeof list === 'string') { try { list = JSON.parse(list); } catch { list = null; } }
  if (!Array.isArray(list)) return null;
  return list.slice(0, 80).map((slide, index) => ({
    title: stripInlineMarkdown(slide?.title || `Diapositive ${index + 1}`),
    kicker: slide?.kicker ? stripInlineMarkdown(slide.kicker) : '',
    bullets: (Array.isArray(slide?.bullets) ? slide.bullets : slide?.text ? [slide.text] : []).map((bullet) => stripInlineMarkdown(bullet)).filter(Boolean),
    table: Array.isArray(slide?.table) ? slide.table.map((row) => (Array.isArray(row) ? row.map(String) : [String(row)])) : null,
  }));
}

const solid = (hex) => `<a:solidFill><a:srgbClr val="${hex}"/></a:solidFill>`;

function pptxRun(text, { size, bold = false, color, font = 'Calibri' }) {
  return `<a:r><a:rPr lang="fr-FR" sz="${Math.round(size * 100)}"${bold ? ' b="1"' : ''} dirty="0">${solid(color)}<a:latin typeface="${font}"/><a:cs typeface="${font}"/></a:rPr><a:t>${escapeXml(text)}</a:t></a:r>`;
}

function rectShape(id, name, x, y, w, h, fill) {
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${escapeXml(name)}"/><p:cNvSpPr/><p:nvPr userDrawn="1"/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${Math.round(x)}" y="${Math.round(y)}"/><a:ext cx="${Math.round(w)}" cy="${Math.round(h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${solid(fill)}<a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="fr-FR"/></a:p></p:txBody></p:sp>`;
}

function textShape(id, name, x, y, w, h, paragraphs, { placeholder = '', anchor = 't', autofit = true } = {}) {
  const nv = placeholder
    ? `<p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr>${placeholder}</p:nvPr>`
    : '<p:cNvSpPr txBox="1"/><p:nvPr/>';
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${escapeXml(name)}"/>${nv}</p:nvSpPr><p:spPr><a:xfrm><a:off x="${Math.round(x)}" y="${Math.round(y)}"/><a:ext cx="${Math.round(w)}" cy="${Math.round(h)}"/></a:xfrm>${placeholder ? '' : '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/>'}</p:spPr><p:txBody><a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" anchor="${anchor}">${autofit ? '<a:normAutofit/>' : '<a:noAutofit/>'}</a:bodyPr><a:lstStyle/>${paragraphs}</p:txBody></p:sp>`;
}

function bulletParagraphs(items, { size, color, accent }) {
  return items.map((item) => `<a:p><a:pPr marL="342900" indent="-342900"><a:spcBef><a:spcPts val="${Math.round(size * 45)}"/></a:spcBef><a:buClr><a:srgbClr val="${accent}"/></a:buClr><a:buFont typeface="Arial"/><a:buChar char="•"/></a:pPr>${pptxRun(item, { size, color })}</a:p>`).join('');
}

function estimateLines(items, size, widthPt) {
  const charsPerLine = Math.max(8, Math.floor(widthPt / (size * 0.5)) - 3);
  return items.reduce((sum, item) => sum + Math.max(1, Math.ceil(item.length / charsPerLine)), 0);
}

function fitBullets(items, widthPt, heightPt) {
  for (let size = 24; size >= 14; size -= 2) {
    const lines = estimateLines(items, size, widthPt);
    if (lines * size * 1.2 + items.length * size * 0.45 <= heightPt) return size;
  }
  return 14;
}

function tableFrame(id, rows, x, y, w, theme) {
  const columns = Math.max(...rows.map((row) => row.length), 1);
  const colW = Math.floor(w / columns);
  const rowH = 420000;
  const cell = (text, header, banded) => `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p>${pptxRun(text, { size: 14, bold: header, color: header ? theme.bg : theme.text })}</a:p></a:txBody><a:tcPr marL="91440" marR="91440" marT="45720" marB="45720" anchor="ctr">${solid(header ? theme.accent : banded ? theme.panel : theme.bg)}</a:tcPr></a:tc>`;
  const trs = rows.slice(0, 12).map((row, rowIndex) => `<a:tr h="${rowH}">${Array.from({ length: columns }, (_, col) => cell(String(row[col] ?? ''), rowIndex === 0, rowIndex % 2 === 0)).join('')}</a:tr>`).join('');
  return `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="Tableau"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="${Math.round(x)}" y="${Math.round(y)}"/><a:ext cx="${colW * columns}" cy="${rowH * Math.min(rows.length, 12)}"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1" bandRow="1"/><a:tblGrid>${Array.from({ length: columns }, () => `<a:gridCol w="${colW}"/>`).join('')}</a:tblGrid>${trs}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
}

function slideXml(slide, index, total, theme, kind) {
  const bg = `<p:bg><p:bgPr>${solid(theme.bg)}<a:effectLst/></p:bgPr></p:bg>`;
  const shapes = [];
  let id = 2;
  const marginX = 700000;
  const contentW = SLIDE_W - marginX * 2;

  if (kind === 'cover') {
    shapes.push(rectShape(id++, 'Bandeau', 0, 0, 260000, SLIDE_H, theme.accent));
    shapes.push(rectShape(id++, 'Accent', 900000, 3650000, 1800000, 60000, theme.accent2));
    shapes.push(textShape(id++, 'Titre', 900000, 1250000, SLIDE_W - 1800000, 2250000,
      `<a:p><a:pPr algn="l"/>${pptxRun(slide.title, { size: slide.title.length > 60 ? 34 : 44, bold: true, color: theme.text })}</a:p>`, { placeholder: '<p:ph type="title"/>', anchor: 'b' }));
    if (slide.subtitle) {
      shapes.push(textShape(id++, 'Sous-titre', 900000, 3850000, SLIDE_W - 1800000, 1200000,
        `<a:p><a:pPr algn="l"/>${pptxRun(slide.subtitle, { size: 20, color: theme.muted })}</a:p>`));
    }
  } else {
    shapes.push(rectShape(id++, 'Bandeau', 0, 0, 120000, SLIDE_H, theme.accent));
    if (slide.kicker) {
      shapes.push(textShape(id++, 'Rubrique', marginX, 330000, contentW, 260000,
        `<a:p>${pptxRun(slide.kicker.toUpperCase(), { size: 12, bold: true, color: theme.accent })}</a:p>`, { autofit: false }));
    }
    shapes.push(textShape(id++, 'Titre', marginX, 600000, contentW, 900000,
      `<a:p><a:pPr algn="l"/>${pptxRun(slide.title, { size: slide.title.length > 55 ? 26 : 32, bold: true, color: theme.text })}</a:p>`, { placeholder: '<p:ph type="title"/>', anchor: 'ctr' }));
    shapes.push(rectShape(id++, 'Filet', marginX, 1560000, 1100000, 40000, theme.accent2));

    const bodyTop = 1800000;
    const bodyH = SLIDE_H - bodyTop - 700000;
    if (slide.table?.length) {
      shapes.push(tableFrame(id++, slide.table, marginX, bodyTop, contentW, theme));
    } else if (slide.bullets.length > 7) {
      const half = Math.ceil(slide.bullets.length / 2);
      const colW = (contentW - 400000) / 2;
      const left = slide.bullets.slice(0, half);
      const right = slide.bullets.slice(half);
      const size = Math.min(fitBullets(left, colW / EMU, bodyH / EMU), fitBullets(right, colW / EMU, bodyH / EMU));
      shapes.push(textShape(id++, 'Contenu', marginX, bodyTop, colW, bodyH, bulletParagraphs(left, { size, color: theme.text, accent: theme.accent }), { placeholder: '<p:ph idx="1"/>' }));
      shapes.push(textShape(id++, 'Contenu (suite)', marginX + colW + 400000, bodyTop, colW, bodyH, bulletParagraphs(right, { size, color: theme.text, accent: theme.accent })));
    } else if (slide.bullets.length) {
      const size = fitBullets(slide.bullets, contentW / EMU, bodyH / EMU);
      shapes.push(textShape(id++, 'Contenu', marginX, bodyTop, contentW, bodyH, bulletParagraphs(slide.bullets, { size, color: theme.text, accent: theme.accent }), { placeholder: '<p:ph idx="1"/>' }));
    }
    shapes.push(textShape(id++, 'Numéro', SLIDE_W - 1300000, SLIDE_H - 480000, 700000, 260000,
      `<a:p><a:pPr algn="r"/><a:fld id="{B6F15528-21DE-4FAA-801E-634DDDAF4B2B}" type="slidenum"><a:rPr lang="fr-FR" sz="1100">${solid(theme.muted)}</a:rPr><a:t>${index + 1}</a:t></a:fld></a:p>`, { autofit: false }));
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld>${bg}<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${shapes.join('')}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}

const NS_DECL = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const GROUP_PROPS = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';

function placeholderMasterShape(id, name, phXml, x, y, w, h, text) {
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr>${phXml}</p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="fr-FR"/><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>`;
}

function themeXml(theme) {
  const dk = theme.bg === 'FFFFFF' ? theme.text : '000000';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Jarvis ${theme.name}"><a:themeElements><a:clrScheme name="Jarvis"><a:dk1><a:srgbClr val="${dk}"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="${theme.panel}"/></a:dk2><a:lt2><a:srgbClr val="${theme.text}"/></a:lt2><a:accent1><a:srgbClr val="${theme.accent}"/></a:accent1><a:accent2><a:srgbClr val="${theme.accent2}"/></a:accent2><a:accent3><a:srgbClr val="${theme.muted}"/></a:accent3><a:accent4><a:srgbClr val="${theme.accent}"/></a:accent4><a:accent5><a:srgbClr val="${theme.accent2}"/></a:accent5><a:accent6><a:srgbClr val="${theme.muted}"/></a:accent6><a:hlink><a:srgbClr val="${theme.accent}"/></a:hlink><a:folHlink><a:srgbClr val="${theme.muted}"/></a:folHlink></a:clrScheme><a:fontScheme name="Jarvis"><a:majorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Jarvis"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;
}

export function buildPptxBytes(title, content, options = {}) {
  const theme = resolvePptxTheme(options.theme, title);
  const provided = normalizeSlides(options.slides);
  const outline = provided ? null : slidesFromOutline(content, title);
  const deckTitle = stripInlineMarkdown(title || outline?.deckTitle || 'Présentation');
  const subtitle = stripInlineMarkdown(options.subtitle || outline?.subtitle || '');

  const bodySlides = [];
  for (const slide of provided || outline.slides) {
    const bullets = slide.bullets || [];
    // Long lists continue on following slides instead of shrinking into unreadable text.
    if (bullets.length > 12 && !slide.table) {
      for (let start = 0; start < bullets.length; start += 12) {
        bodySlides.push({ ...slide, bullets: bullets.slice(start, start + 12), title: start ? `${slide.title} (suite)` : slide.title });
      }
    } else bodySlides.push({ ...slide, bullets });
  }
  if (!bodySlides.length) bodySlides.push({ title: 'Aperçu', bullets: ['Ajoutez un plan ou des diapositives structurées.'], table: null });

  const slides = [{ title: deckTitle, subtitle, kind: 'cover' }, ...bodySlides.map((slide) => ({ ...slide, kind: 'content' }))];
  const slideCount = slides.length;

  const entries = [
    { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>${slides.map((_, index) => `<Override PartName="/ppt/slides/slide${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('')}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>` },
    { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>` },
    { name: 'docProps/core.xml', data: corePropsXml(deckTitle) },
    { name: 'docProps/app.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Jarvis 2.0 PC</Application><Slides>${slideCount}</Slides></Properties>` },
    { name: 'ppt/presentation.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation ${NS_DECL} saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${slides.map((_, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 3}"/>`).join('')}</p:sldIdLst><p:sldSz cx="${SLIDE_W}" cy="${SLIDE_H}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>` },
    { name: 'ppt/_rels/presentation.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>${slides.map((_, index) => `<Relationship Id="rId${index + 3}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${index + 1}.xml"/>`).join('')}</Relationships>` },
    { name: 'ppt/theme/theme1.xml', data: themeXml(theme) },
    { name: 'ppt/slideMasters/slideMaster1.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster ${NS_DECL}><p:cSld><p:bg><p:bgPr>${solid(theme.bg)}<a:effectLst/></p:bgPr></p:bg><p:spTree>${GROUP_PROPS}${placeholderMasterShape(2, 'Titre', '<p:ph type="title"/>', 700000, 600000, SLIDE_W - 1400000, 900000, 'Titre')}${placeholderMasterShape(3, 'Contenu', '<p:ph type="body" idx="1"/>', 700000, 1800000, SLIDE_W - 1400000, 4300000, 'Contenu')}</p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle><a:lvl1pPr algn="l"><a:defRPr sz="3200" b="1">${solid(theme.text)}<a:latin typeface="Calibri"/></a:defRPr></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr marL="342900" indent="-342900"><a:buFont typeface="Arial"/><a:buChar char="•"/><a:defRPr sz="2000">${solid(theme.text)}<a:latin typeface="Calibri"/></a:defRPr></a:lvl1pPr></p:bodyStyle><p:otherStyle><a:lvl1pPr><a:defRPr sz="1800">${solid(theme.text)}<a:latin typeface="Calibri"/></a:defRPr></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>` },
    { name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>` },
    { name: 'ppt/slideLayouts/slideLayout1.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout ${NS_DECL} type="obj" preserve="1"><p:cSld name="Titre et contenu"><p:spTree>${GROUP_PROPS}${placeholderMasterShape(2, 'Titre', '<p:ph type="title"/>', 700000, 600000, SLIDE_W - 1400000, 900000, 'Titre')}${placeholderMasterShape(3, 'Contenu', '<p:ph idx="1"/>', 700000, 1800000, SLIDE_W - 1400000, 4300000, 'Contenu')}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>` },
    { name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>` },
  ];
  slides.forEach((slide, index) => {
    entries.push({ name: `ppt/slides/slide${index + 1}.xml`, data: slideXml(slide, index, slideCount, theme, slide.kind) });
    entries.push({ name: `ppt/slides/_rels/slide${index + 1}.xml.rels`, data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>` });
  });
  return buildZip(entries);
}
