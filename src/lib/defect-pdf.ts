/**
 * Mängelplan als PDF: Seite 1 der Plan mit nummerierten Markierungen (als Bild gezeichnet, wie am Bildschirm),
 * danach die Liste je Nummer mit Art, Titel, Beschreibung und Fotos. Kopf mit Logo und Firmenangaben.
 */
import { rgb, type PDFImage, type PDFPage } from 'pdf-lib';
import type { CompanyLogo } from './company';
import { clean, fit, header, INK, LINE, M, MUTED, setup, type Ctx } from './crew-pdf';
import { kindInfo, markAnchor, markBox } from './defects';
import { loadImageBitmap } from './pdf';
import type { DefectMark, DefectPlan } from './types';

export interface DefectPdfOptions {
  company: string;
  lines: string;
  logo: CompanyLogo | null;
}

const hex = (h: string) => {
  const n = parseInt(h.replace('#', ''), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};

/** Plan mit Markierungen auf eine Leinwand zeichnen (Bildpixel) und als JPEG liefern */
export async function drawPlanWithMarks(marks: DefectMark[], image: ArrayBuffer): Promise<ArrayBuffer> {
  const bmp = await loadImageBitmap(image, 'image/jpeg');
  const canvas = document.createElement('canvas');
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bmp, 0, 0);
  const W = canvas.width;
  const H = canvas.height;
  const u = Math.max(W, H) / 900; // Einheit: Strichstärken relativ zur Bildgröße
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const m of marks) {
    const P = m.points.map((q) => ({ x: q.x * W, y: q.y * H }));
    ctx.strokeStyle = m.color;
    ctx.fillStyle = m.color;
    ctx.lineWidth = 3 * u;
    ctx.globalAlpha = 1;
    switch (m.shape) {
      case 'pin': {
        const s = 38 * u;
        const r = s * 0.36;
        const cy = P[0].y - s + r;
        ctx.beginPath();
        ctx.moveTo(P[0].x, P[0].y);
        ctx.bezierCurveTo(P[0].x - r * 0.9, P[0].y - s * 0.45, P[0].x - r, cy + r * 0.2, P[0].x - r, cy);
        ctx.arc(P[0].x, cy, r, Math.PI, 0, false);
        ctx.bezierCurveTo(P[0].x + r, cy + r * 0.2, P[0].x + r * 0.9, P[0].y - s * 0.45, P[0].x, P[0].y);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5 * u;
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(P[0].x, cy, 5 * u, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'rect': {
        const b = markBox(m);
        ctx.globalAlpha = 0.12;
        ctx.fillRect(b.x * W, b.y * H, b.w * W, b.h * H);
        ctx.globalAlpha = 1;
        ctx.strokeRect(b.x * W, b.y * H, b.w * W, b.h * H);
        break;
      }
      case 'ellipse': {
        const b = markBox(m);
        ctx.beginPath();
        ctx.ellipse((b.x + b.w / 2) * W, (b.y + b.h / 2) * H, Math.max(1, (b.w / 2) * W), Math.max(1, (b.h / 2) * H), 0, 0, Math.PI * 2);
        ctx.globalAlpha = 0.12;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.stroke();
        break;
      }
      case 'line':
      case 'freehand':
        ctx.beginPath();
        P.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
        ctx.stroke();
        break;
      case 'text': {
        const fs = 14 * u;
        ctx.font = `600 ${fs}px -apple-system, "Segoe UI", Inter, Arial, sans-serif`;
        const t = m.text || 'Text';
        const w = ctx.measureText(t).width + 12 * u;
        ctx.fillStyle = '#fff';
        ctx.fillRect(P[0].x - 6 * u, P[0].y - fs - 4 * u, w, fs + 10 * u);
        ctx.lineWidth = 2 * u;
        ctx.strokeRect(P[0].x - 6 * u, P[0].y - fs - 4 * u, w, fs + 10 * u);
        ctx.fillStyle = m.color;
        ctx.fillText(t, P[0].x, P[0].y);
        break;
      }
    }
    // Nummer
    const a = markAnchor(m);
    const dy = m.shape === 'pin' ? -44 * u : m.shape === 'text' ? -22 * u : -2 * u;
    const cx = a.x * W;
    const cy = a.y * H + dy;
    const r = 11 * u;
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.lineWidth = 2 * u;
    ctx.strokeStyle = m.color;
    ctx.stroke();
    ctx.fillStyle = m.color;
    ctx.font = `700 ${12 * u}px -apple-system, "Segoe UI", Inter, Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(m.no), cx, cy + 0.5 * u);
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
  }
  const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Bild konnte nicht erzeugt werden.'))), 'image/jpeg', 0.88));
  return blob.arrayBuffer();
}

function wrap(ctx: Ctx, text: string, size: number, max: number): string[] {
  const out: string[] = [];
  for (const para of clean(ctx, text).split(/\r?\n/)) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      const t = line ? `${line} ${word}` : word;
      if (ctx.font.widthOfTextAtSize(t, size) <= max || !line) line = t;
      else {
        out.push(line);
        line = word;
      }
    }
    out.push(line);
  }
  return out;
}

export async function defectPdf(plan: DefectPlan, marks: DefectMark[], image: ArrayBuffer, photos: Map<string, ArrayBuffer>, opts: DefectPdfOptions): Promise<Uint8Array> {
  const ctx = await setup({ logo: opts.logo });
  const title = `Mängelplan – ${plan.title}`;
  const sub = [plan.siteName, plan.siteNumber, plan.siteAddress].filter(Boolean).join(' · ');
  const landscape = plan.width >= plan.height;
  const size: [number, number] = landscape ? [841.89, 595.28] : [595.28, 841.89];

  // Seite 1: Plan
  const p1 = ctx.doc.addPage(size);
  const top = header(ctx, p1, title, sub, opts.company, true);
  const img = await ctx.doc.embedJpg(await drawPlanWithMarks(marks, image));
  const maxW = size[0] - 2 * M;
  const maxH = top - M - 14;
  const sc = Math.min(maxW / img.width, maxH / img.height);
  const w = img.width * sc;
  const h = img.height * sc;
  p1.drawImage(img, { x: (size[0] - w) / 2, y: top - 6 - h, width: w, height: h });
  footer(ctx, p1, plan, 1);

  // Liste
  const W = 595.28;
  const H = 841.89;
  let page: PDFPage | null = null;
  let y = 0;
  let pageNo = 1;
  const newPage = () => {
    page = ctx.doc.addPage([W, H]);
    pageNo++;
    y = header(ctx, page, `${title} – Liste`, sub, opts.company, true) - 8;
    footer(ctx, page, plan, pageNo);
  };
  newPage();
  const thumbs = new Map<string, PDFImage>();
  for (const [id, data] of photos) {
    try {
      thumbs.set(id, await ctx.doc.embedJpg(data));
    } catch {
      /* Foto überspringen */
    }
  }
  const PH = 84; // Fotohöhe
  for (const m of [...marks].sort((a, b) => a.no - b.no)) {
    const k = kindInfo(m.kind);
    const descLines = m.description ? wrap(ctx, m.description, 9.5, W - 2 * M - 40) : [];
    const photoRows = Math.ceil(m.photoIds.filter((id) => thumbs.has(id)).length / 4);
    const need = 30 + descLines.length * 12 + photoRows * (PH + 8) + 10;
    if (y - need < M + 20) newPage();
    const pg = page!;
    // Nummernkreis
    pg.drawCircle({ x: M + 11, y: y - 10, size: 10, borderColor: hex(m.color), borderWidth: 1.5, color: rgb(1, 1, 1) });
    const no = String(m.no);
    pg.drawText(no, { x: M + 11 - ctx.bold.widthOfTextAtSize(no, 9) / 2, y: y - 13, size: 9, font: ctx.bold, color: hex(m.color) });
    const t = fit(ctx.bold, clean(ctx, m.title || (m.shape === 'text' && m.text) || `Markierung ${m.no}`), 11, W - 2 * M - 140);
    pg.drawText(t, { x: M + 30, y: y - 14, size: 11, font: ctx.bold, color: INK });
    // Art-Kennzeichen rechts
    const kl = clean(ctx, k.label);
    const kw = ctx.bold.widthOfTextAtSize(kl, 8) + 12;
    pg.drawRectangle({ x: W - M - kw, y: y - 18, width: kw, height: 13, color: hex(k.color), borderWidth: 0 });
    pg.drawText(kl, { x: W - M - kw + 6, y: y - 14.5, size: 8, font: ctx.bold, color: rgb(1, 1, 1) });
    y -= 30;
    for (const l of descLines) {
      pg.drawText(l, { x: M + 30, y, size: 9.5, font: ctx.font, color: INK });
      y -= 12;
    }
    const ids = m.photoIds.filter((id) => thumbs.has(id));
    for (let i = 0; i < ids.length; i++) {
      const im = thumbs.get(ids[i])!;
      const col = i % 4;
      if (col === 0 && i > 0) y -= PH + 8;
      const s = Math.min(PH / im.height, 120 / im.width);
      const iw = im.width * s;
      const ih = im.height * s;
      pg.drawImage(im, { x: M + 30 + col * 128, y: y - PH + (PH - ih), width: iw, height: ih });
    }
    if (ids.length) y -= PH + 8;
    y -= 6;
    pg.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.5, color: LINE });
    y -= 10;
  }
  return ctx.doc.save();
}

function footer(ctx: Ctx, page: PDFPage, plan: DefectPlan, no: number) {
  const { width } = page.getSize();
  const txt = clean(ctx, `Mängelplan · ${plan.siteName} · ${plan.title} · erstellt am ${new Date().toLocaleDateString('de-DE')}`);
  page.drawText(txt, { x: M, y: M - 14, size: 7.5, font: ctx.font, color: MUTED });
  const pn = `Seite ${no}`;
  page.drawText(pn, { x: width - M - ctx.font.widthOfTextAtSize(pn, 7.5), y: M - 14, size: 7.5, font: ctx.font, color: MUTED });
}
