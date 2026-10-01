// Standalone document generator for Jarvis 2.0 PC Edition.
// Produces valid PDF, DOCX, XLSX, PPTX, CSV, MD and TXT files without any backend.

import { hostBridge } from '../core/hostBridge.js';
import {
  buildCsv,
  buildDocxBytes,
  buildPdfBytes,
  buildPptxBytes,
  buildXlsxBytes,
  uint8ToBase64,
} from './officeFormats.js';

export const DOCUMENT_TYPES = ['pdf', 'docx', 'xlsx', 'pptx', 'csv', 'md', 'txt'];

const MIME_TYPES = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

export function buildDocumentBytes({ type = 'md', title = 'Document Jarvis', content = '', subtitle = '', theme = '', slides = null, sheets = null } = {}) {
  const ext = String(type || 'md').toLowerCase().replace(/^\./, '');
  if (ext === 'pdf') return buildPdfBytes(title, content, { subtitle });
  if (ext === 'docx') return buildDocxBytes(title, content);
  if (ext === 'xlsx') return buildXlsxBytes(title, content, { sheets });
  if (ext === 'pptx') return buildPptxBytes(title, content, { subtitle, theme, slides });
  return null;
}

export async function createAndSaveDocument({
  type = 'md',
  title = 'Document Jarvis',
  content = '',
  filename = '',
  subtitle = '',
  theme = '',
  slides = null,
  sheets = null,
}) {
  const ext = String(type || 'md').toLowerCase().replace(/^\./, '');
  if (!DOCUMENT_TYPES.includes(ext)) {
    return { ok: false, error: `Format non pris en charge : ${ext}. Formats disponibles : ${DOCUMENT_TYPES.join(', ')}.` };
  }
  const safeBase =
    String(filename || title || 'document')
      .replace(/\.[a-z0-9]{2,4}$/i, '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9_\-\s]/g, '')
      .trim()
      .replace(/\s+/g, '_')
      .slice(0, 60) || 'document_jarvis';
  const finalName = `${safeBase}.${ext}`;

  try {
    const bytes = buildDocumentBytes({ type: ext, title, content, subtitle, theme, slides, sheets });
    if (bytes) {
      return await hostBridge.saveDocument({
        filename: finalName,
        contentBase64: uint8ToBase64(bytes),
        mimeType: MIME_TYPES[ext],
      });
    }
    if (ext === 'csv') {
      return await hostBridge.saveDocument({ filename: finalName, text: buildCsv(content), mimeType: 'text/csv;charset=utf-8' });
    }
    const fullText = title && !String(content).startsWith('#') ? `# ${title}\n\n${content}` : String(content);
    return await hostBridge.saveDocument({ filename: finalName, text: fullText, mimeType: 'text/plain;charset=utf-8' });
  } catch (error) {
    return { ok: false, error: error.message || String(error) };
  }
}
