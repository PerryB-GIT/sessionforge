const pptxgen = require('pptxgenjs');
const path = require('path');

const SCRIPT_DIR = 'C:\\Users\\Jakeb\\.claude\\plugins\\cache\\anthropic-agent-skills\\document-skills\\00756142ab04\\skills\\pptx\\scripts';
const html2pptx = require(path.join(SCRIPT_DIR, 'html2pptx.js'));

const SLIDES_DIR = path.join(__dirname, 'slides');
const OUTPUT = path.join(__dirname, 'SessionForge-Battle-Cards.pptx');

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

async function build() {
  const pptx = new pptxgen();
  // 720pt × 405pt = 10" × 5.625" — define custom layout to match slide dimensions
  pptx.defineLayout({ name: 'LAYOUT_720x405', width: 10, height: 5.625 });
  pptx.layout = 'LAYOUT_720x405';

  for (const filename of SLIDES) {
    const htmlPath = path.join(SLIDES_DIR, filename);
    console.log(`Processing ${filename}...`);
    try {
      await html2pptx(htmlPath, pptx);
    } catch (err) {
      console.error(`  ERROR in ${filename}:`, err.message);
    }
  }

  await pptx.writeFile({ fileName: OUTPUT });
  console.log(`\nDone! Saved to: ${OUTPUT}`);
}

build().catch(err => {
  console.error('Build failed:', err);
  process.exit(1);
});
