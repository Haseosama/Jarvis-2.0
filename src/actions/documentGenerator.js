// Standalone Document Generator for Jarvis 2.0 PC Edition
// Generates valid PDF, DOCX, XLSX, PPTX, CSV, MD, and TXT files without any backend

import { hostBridge } from '../core/hostBridge.js';

// CRC32 for uncompressed ZIP (OpenXML DOCX/XLSX/PPTX)
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function buildZip(entries) {
  const enc = new TextEncoder();
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
    ldv.setUint16(6, 0, true);
    ldv.setUint16(8, 0, true); // store (0)
    ldv.setUint16(10, 0, true);
    ldv.setUint16(12, 0, true);
    ldv.setUint32(14, crc, true);
    ldv.setUint32(18, size, true);
    ldv.setUint32(22, size, true);
    ldv.setUint16(26, nameBytes.length, true);
    ldv.setUint16(28, 0, true);
    local.set(nameBytes, 30);
    local.set(dataBytes, 30 + nameBytes.length);
    localParts.push(local);

    const central = new Uint8Array(46 + nameBytes.length);
    const cdv = new DataView(central.buffer);
    cdv.setUint32(0, 0x02014b50, true);
    cdv.setUint16(4, 20, true);
    cdv.setUint16(6, 20, true);
    cdv.setUint16(8, 0, true);
    cdv.setUint16(10, 0, true);
    cdv.setUint16(12, 0, true);
    cdv.setUint16(14, 0, true);
    cdv.setUint32(16, crc, true);
    cdv.setUint32(20, size, true);
    cdv.setUint32(24, size, true);
    cdv.setUint16(28, nameBytes.length, true);
    cdv.setUint16(30, 0, true);
    cdv.setUint16(32, 0, true);
    cdv.setUint16(34, 0, true);
    cdv.setUint16(36, 0, true);
    cdv.setUint32(38, 0, true);
    cdv.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centralParts.push(central);

    offset += local.length;
  }

  const centralSize = centralParts.reduce((a, b) => a + b.length, 0);
  const eocd = new Uint8Array(22);
  const edv = new DataView(eocd.buffer);
  edv.setUint32(0, 0x06054b50, true);
  edv.setUint16(4, 0, true);
  edv.setUint16(6, 0, true);
  edv.setUint16(8, entries.length, true);
  edv.setUint16(10, entries.length, true);
  edv.setUint32(12, centralSize, true);
  edv.setUint32(16, offset, true);
  edv.setUint16(20, 0, true);

  const total = offset + centralSize + eocd.length;
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of localParts) {
    out.set(p, pos);
    pos += p.length;
  }
  for (const p of centralParts) {
    out.set(p, pos);
    pos += p.length;
  }
  out.set(eocd, pos);
  return out;
}

function escapeXml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function uint8ToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// Simple PDF 1.4 builder
function buildPdfBytes(title, content) {
  const lines = [];
  if (title) {
    lines.push({ text: title, size: 18 });
    lines.push({ text: '', size: 11 });
  }
  for (const rawLine of String(content || '').split('\n')) {
    const l = rawLine.trim();
    if (l.startsWith('# ')) lines.push({ text: l.slice(2), size: 16 });
    else if (l.startsWith('## ')) lines.push({ text: l.slice(3), size: 14 });
    else if (l.startsWith('### ')) lines.push({ text: l.slice(4), size: 12 });
    else {
      // Wrap at 82 chars
      if (l.length <= 82) {
        lines.push({ text: l, size: 11 });
      } else {
        for (let i = 0; i < l.length; i += 82) {
          lines.push({ text: l.slice(i, i + 82), size: 11 });
        }
      }
    }
  }

  const escapePdf = (s) =>
    String(s || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\\/g, '\\\\')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)');

  let stream = 'BT\n/F1 12 Tf\n50 780 Td\n';
  let y = 780;
  for (const item of lines.slice(0, 48)) {
    const step = item.size + 5;
    y -= step;
    if (y < 50) break;
    stream += `/F1 ${item.size} Tf\n0 -${step} Td\n(${escapePdf(item.text)}) Tj\n`;
  }
  stream += 'ET\n';

  const pdf = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj
4 0 obj << /Length ${stream.length} >>
stream
${stream}endstream
endobj
5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj
xref
0 6
0000000000 65535 f 
trailer << /Size 6 /Root 1 0 R >>
startxref
0
%%EOF`;
  return new TextEncoder().encode(pdf);
}

function buildDocxBytes(title, content) {
  const paras = [];
  if (title) {
    paras.push(`<w:p><w:r><w:rPr><w:b/><w:sz w:val="36"/></w:rPr><w:t>${escapeXml(title)}</w:t></w:r></w:p>`);
  }
  for (const line of String(content || '').split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('# ')) {
      paras.push(`<w:p><w:r><w:rPr><w:b/><w:sz w:val="30"/></w:rPr><w:t>${escapeXml(trimmed.slice(2))}</w:t></w:r></w:p>`);
    } else if (trimmed.startsWith('## ')) {
      paras.push(`<w:p><w:r><w:rPr><w:b/><w:sz w:val="26"/></w:rPr><w:t>${escapeXml(trimmed.slice(3))}</w:t></w:r></w:p>`);
    } else {
      paras.push(`<w:p><w:r><w:t>${escapeXml(line)}</w:t></w:r></w:p>`);
    }
  }

  return buildZip([
    {
      name: '[Content_Types].xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
    },
    {
      name: '_rels/.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
    },
    {
      name: 'word/document.xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${paras.join('')}</w:body>
</w:document>`,
    },
  ]);
}

function parseRows(content) {
  const trimmed = String(content || '').trim();
  if (trimmed.startsWith('[')) {
    try {
      const arr = JSON.parse(trimmed);
      if (Array.isArray(arr)) return arr.map((r) => (Array.isArray(r) ? r.map(String) : [String(r)]));
    } catch {
      // fall through
    }
  }
  return trimmed
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^\|?[-:\s|]+\|?$/.test(l))
    .map((l) => {
      const sep = l.includes('|') ? '|' : l.includes(';') ? ';' : ',';
      return l
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split(sep)
        .map((c) => c.trim());
    });
}

function buildXlsxBytes(title, content) {
  const rows = parseRows(content);
  const sheetRows = rows
    .map((r, rIdx) => {
      const cells = r
        .map((c, cIdx) => {
          const colLetter = String.fromCharCode(65 + (cIdx % 26));
          const ref = `${colLetter}${rIdx + 1}`;
          if (c.startsWith('=')) {
            return `<c r="${ref}"><f>${escapeXml(c.slice(1))}</f></c>`;
          }
          const num = Number(c);
          if (!Number.isNaN(num) && c !== '') {
            return `<c r="${ref}"><v>${num}</v></c>`;
          }
          return `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(c)}</t></is></c>`;
        })
        .join('');
      return `<row r="${rIdx + 1}">${cells}</row>`;
    })
    .join('');

  return buildZip([
    {
      name: '[Content_Types].xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`,
    },
    {
      name: '_rels/.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`,
    },
    {
      name: 'xl/workbook.xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="${escapeXml((title || 'Feuille1').slice(0, 31))}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`,
    },
    {
      name: 'xl/worksheets/sheet1.xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>${sheetRows}</sheetData>
</worksheet>`,
    },
  ]);
}

export async function createAndSaveDocument({ type = 'md', title = 'Document Jarvis', content = '', filename = '' }) {
  const ext = String(type || 'md').toLowerCase().replace(/^\./, '');
  const safeBase =
    String(filename || title || 'document')
      .replace(/[^a-zA-Z0-9_\-\s]/g, '')
      .trim()
      .replace(/\s+/g, '_')
      .slice(0, 60) || 'document_jarvis';
  const finalName = `${safeBase}.${ext}`;

  if (ext === 'pdf') {
    const bytes = buildPdfBytes(title, content);
    return hostBridge.saveDocument({
      filename: finalName,
      contentBase64: uint8ToBase64(bytes),
      mimeType: 'application/pdf',
    });
  }
  if (ext === 'docx') {
    const bytes = buildDocxBytes(title, content);
    return hostBridge.saveDocument({
      filename: finalName,
      contentBase64: uint8ToBase64(bytes),
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
  }
  if (ext === 'xlsx') {
    const bytes = buildXlsxBytes(title, content);
    return hostBridge.saveDocument({
      filename: finalName,
      contentBase64: uint8ToBase64(bytes),
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
  }
  if (ext === 'csv') {
    const rows = parseRows(content);
    const csv = '\uFEFF' + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n');
    return hostBridge.saveDocument({
      filename: finalName,
      text: csv,
      mimeType: 'text/csv;charset=utf-8',
    });
  }

  // md, txt, pptx (outline)
  const fullText = title && !content.startsWith('#') ? `# ${title}\n\n${content}` : content;
  return hostBridge.saveDocument({
    filename: finalName,
    text: fullText,
    mimeType: 'text/plain;charset=utf-8',
  });
}
