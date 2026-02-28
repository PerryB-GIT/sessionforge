const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const http = require('http');

const SLIDES_DIR = path.join(__dirname, 'slides');
const OUTPUT_DIR = __dirname;
const OUTPUT_PDF = path.join(OUTPUT_DIR, 'SessionForge-Battle-Cards.pdf');

const SLIDES = [
  'slide01-cover.html',
  'slide02-positioning.html',
  'slide03-landscape.html',
  'slide04-bc1-oss.html',
  'slide05-bc2-1code.html',
  'slide06-bc3-warp.html',
  'slide07-bc4-codespaces-coder.html',
  'slide08-bc5-agentops-devin.html',
  'slide09-bc6-primitives-rdp.html',
  'slide10-objections.html',
  'slide11-watchlist.html',
  'slide12-closing.html',
];

// Start a simple HTTP server to serve files
function startServer(port) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const filePath = path.join(SLIDES_DIR, req.url.replace(/^\//, ''));
      fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(data);
      });
    });
    server.listen(port, () => resolve(server));
  });
}

async function buildPdf() {
  const port = 7421;
  const server = await startServer(port);

  const browser = await chromium.launch();
  const page = await browser.newPage();

  const pdfBuffers = [];

  for (const slide of SLIDES) {
    const url = `http://localhost:${port}/${slide}`;
    console.log(`Printing ${slide}...`);
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.setViewportSize({ width: 960, height: 540 });

    // Print as PDF: 720pt x 405pt = 10in x 5.625in
    const pdf = await page.pdf({
      width: '10in',
      height: '5.625in',
      printBackground: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    });
    pdfBuffers.push(pdf);
  }

  await browser.close();
  server.close();

  // If only one slide, just write it; otherwise merge with pdf-lib
  if (pdfBuffers.length === 1) {
    fs.writeFileSync(OUTPUT_PDF, pdfBuffers[0]);
  } else {
    // Use pdf-lib to merge
    let pdfLib;
    try {
      pdfLib = require('pdf-lib');
    } catch (e) {
      // pdf-lib not available — save individual PDFs and note
      console.log('pdf-lib not found — saving individual slide PDFs...');
      SLIDES.forEach((slide, i) => {
        const outName = slide.replace('.html', '.pdf');
        fs.writeFileSync(path.join(OUTPUT_DIR, outName), pdfBuffers[i]);
        console.log(`  Saved ${outName}`);
      });
      console.log('To merge: install pdf-lib (npm install pdf-lib) and re-run.');
      return;
    }

    const { PDFDocument } = pdfLib;
    const mergedDoc = await PDFDocument.create();
    for (const buf of pdfBuffers) {
      const doc = await PDFDocument.load(buf);
      const pages = await mergedDoc.copyPages(doc, doc.getPageIndices());
      pages.forEach(p => mergedDoc.addPage(p));
    }
    const mergedBytes = await mergedDoc.save();
    fs.writeFileSync(OUTPUT_PDF, mergedBytes);
  }

  console.log(`\nPDF saved to: ${OUTPUT_PDF}`);
}

buildPdf().catch(err => { console.error(err); process.exit(1); });
