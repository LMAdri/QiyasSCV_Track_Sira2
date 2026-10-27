'use strict';
const express = require('express');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const { db } = require('../db');
const { REPORTS, runReport, getStats, getBreakdown } = require('../lib/queries');
const { allow } = require('../middleware');
const { today } = require('../lib/util');

const router = express.Router();

// Dashboard numbers: admin + project manager (officers get their own scoped numbers).
router.get('/stats', (req, res) => res.json(getStats(req.query, req.user)));

router.get('/stats/breakdown', (req, res) => {
  const rows = getBreakdown(String(req.query.group || ''), req.query, req.user);
  if (!rows) return res.status(400).json({ error: 'group must be track, campus or officer' });
  res.json({ rows });
});

router.get('/reports', allow('admin', 'pm'), (req, res) =>
  res.json({ reports: Object.entries(REPORTS).map(([key, d]) => ({ key, title: d.title })) }));

router.get('/reports/:key', allow('admin', 'pm'), (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(req.query.page_size) || 25));
  const out = runReport(req.params.key, req.query, req.user, { page, pageSize });
  if (!out) return res.status(404).json({ error: 'Unknown report' });
  res.json({ ...out, page, pages: Math.max(1, Math.ceil(out.total / pageSize)) });
});

// ---------- exports (admin only) ----------
function describeFilters(q) {
  const parts = [];
  if (q.officer_name) parts.push(`Officer: ${q.officer_name}`);
  if (q.track) parts.push(`Track: ${q.track}`);
  if (q.campus) parts.push(`Campus: ${q.campus}`);
  if (q.city) parts.push(`Company city: ${q.city}`);
  if (q.q) parts.push(`Search: ${q.q}`);
  if (q.date_from || q.date_to) parts.push(`Reported ${q.date_from || '...'} to ${q.date_to || '...'}`);
  return parts.join('  |  ');
}

const cellValue = (row, c) => {
  const v = row[c.key];
  return v === null || v === undefined ? '' : v;
};

router.get('/reports/:key/export', allow('admin'), async (req, res, next) => {
  try {
    const out = runReport(req.params.key, req.query, req.user, { all: true });
    if (!out) return res.status(404).json({ error: 'Unknown report' });
    const format = req.query.format === 'pdf' ? 'pdf' : 'xlsx';
    const base = `${req.params.key}-${today()}`;

    if (format === 'xlsx') {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet(out.title.slice(0, 31).replace(/[\\/*?:[\]]/g, ' '));
      ws.columns = out.columns.map((c) => ({ header: c.label, key: c.key + '|' + c.label, width: Math.round(c.w * 16) }));
      out.rows.forEach((r) => {
        const row = {};
        out.columns.forEach((c) => { row[c.key + '|' + c.label] = cellValue(r, c); });
        ws.addRow(row);
      });
      ws.getRow(1).font = { bold: true };
      ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDDEBF7' } };
      ws.views = [{ state: 'frozen', ySplit: 1 }];
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: out.columns.length } };
      out.columns.forEach((c, i) => { if (c.key === 'salary') ws.getColumn(i + 1).numFmt = '#,##0'; });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${base}.xlsx"`);
      await wb.xlsx.write(res);
      return res.end();
    }

    // ---- PDF ----
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 28, bufferPages: true });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${base}.pdf"`);
    doc.pipe(res);

    // Helvetica cannot draw Amharic/Ge'ez. Point ETHIOPIC_FONT at a .ttf (e.g. Noto Sans Ethiopic) to render it.
    const ethFont = process.env.ETHIOPIC_FONT && fs.existsSync(process.env.ETHIOPIC_FONT) ? process.env.ETHIOPIC_FONT : null;
    if (ethFont) doc.registerFont('eth', ethFont);
    const fontFor = (t) => (ethFont && /[ሀ-᎟]/.test(t) ? 'eth' : 'Helvetica');

    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;
    const bottom = doc.page.height - doc.page.margins.bottom - 14;
    const totalW = out.columns.reduce((a, c) => a + c.w, 0);
    const widths = out.columns.map((c) => (c.w / totalW) * width);
    const pad = 3; const fs_ = 7;

    doc.font('Helvetica-Bold').fontSize(14).text(out.title, left, doc.y);
    doc.font('Helvetica').fontSize(8).fillColor('#444')
      .text(`Qiyas SCV Intermediate Digital Skills - graduate employment report | Generated ${today()} | ${out.total} record(s)`);
    const officerRow = Number(req.query.officer_id)
      ? db.prepare('SELECT full_name FROM users WHERE id = ?').get(Number(req.query.officer_id)) : null;
    const fdesc = describeFilters({ ...req.query, officer_name: officerRow?.full_name });
    if (fdesc) doc.text(`Filters: ${fdesc}`);
    doc.fillColor('#000').moveDown(0.5);

    const drawRow = (cells, y, header) => {
      doc.fontSize(fs_);
      const heights = cells.map((t, i) => {
        doc.font(header ? 'Helvetica-Bold' : fontFor(t));
        return doc.heightOfString(t, { width: widths[i] - pad * 2 });
      });
      const h = Math.max(...heights) + pad * 2;
      if (y + h > bottom) { doc.addPage(); y = doc.page.margins.top; drawHeader(y); y += headerH; }
      let x = left;
      if (header) doc.rect(left, y, width, h).fill('#DDEBF7').fillColor('#000');
      cells.forEach((t, i) => {
        doc.font(header ? 'Helvetica-Bold' : fontFor(t)).fontSize(fs_).fillColor('#000')
          .text(t, x + pad, y + pad, { width: widths[i] - pad * 2 });
        x += widths[i];
      });
      doc.moveTo(left, y + h).lineTo(left + width, y + h).lineWidth(0.3).strokeColor('#BBB').stroke();
      return { y: y + h, h };
    };

    let headerH = 0;
    const drawHeader = (y) => { headerH = drawRow(out.columns.map((c) => c.label), y, true).h; };
    let y = doc.y;
    headerH = 0;
    const hdr = drawRow(out.columns.map((c) => c.label), y, true);
    headerH = hdr.h; y = hdr.y;

    out.rows.forEach((r) => {
      const cells = out.columns.map((c) => {
        const v = cellValue(r, c);
        const s = c.key === 'salary' && v !== '' ? Number(v).toLocaleString('en-US') : String(v);
        return s.length > 300 ? s.slice(0, 297) + '...' : s;
      });
      const res_ = drawRow(cells, y, false);
      y = res_.y;
    });
    if (!out.rows.length) doc.font('Helvetica').fontSize(9).text('No records match the selected filters.', left, y + 8);

    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      doc.page.margins.bottom = 0; // otherwise writing in the footer area makes PDFKit add a blank page
      doc.font('Helvetica').fontSize(7).fillColor('#666')
        .text(`Page ${i + 1} of ${range.count}`, left, doc.page.height - 22, { width, align: 'right', lineBreak: false });
    }
    doc.end();
  } catch (e) { next(e); }
});

module.exports = router;
