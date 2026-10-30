import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { test, type Page } from '@playwright/test';
import { CHAPTERS } from './guide-content';
import { GUIDE_DIR, MARKETING_DIR, RAW_DIR } from './demo-env';

const BRAND = '#1b365d';
const ACCENT = '#2a6f97';
const edition = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' }).format(
  new Date(),
);

const GUIDE_CSS = `
@page { size: A4; margin: 18mm 16mm 20mm; }
* { box-sizing: border-box; }
body { font: 10.5pt/1.55 "Segoe UI", system-ui, -apple-system, sans-serif; color: #1e293b; margin: 0; }
h1, h2, h3 { color: ${BRAND}; line-height: 1.25; }
h2 { font-size: 22pt; margin: 0 0 4mm; padding-bottom: 2mm; border-bottom: 2px solid ${ACCENT}; }
h3 { font-size: 13pt; margin: 7mm 0 2mm; break-after: avoid; }
p, li, dd { orphans: 3; widows: 3; }
ol, ul { padding-left: 6mm; }
b { color: #0f172a; }
figure { margin: 3mm 0 5mm; break-inside: avoid; }
figure { text-align: center; }
figure img { max-width: 100%; max-height: 150mm; border: 1px solid #cbd5e1; border-radius: 6px; box-shadow: 0 1px 4px #0001; }
figcaption { text-align: left; }
figure.half img { max-width: 62%; }
figcaption { font-size: 9pt; color: #475569; margin-top: 1.5mm; }
.tip, .note { break-inside: avoid; border-left: 4px solid ${ACCENT}; background: #eef5fa; padding: 3mm 4mm; margin: 4mm 0; border-radius: 0 6px 6px 0; }
.tip strong, .note strong { display: block; color: ${BRAND}; }
.chapter { break-before: page; }
.audience { color: ${ACCENT}; font-weight: 600; text-transform: uppercase; letter-spacing: .08em; font-size: 9pt; margin: 0 0 1mm; }
.cover { height: 257mm; display: flex; flex-direction: column; justify-content: space-between; }
.cover .band { background: linear-gradient(135deg, ${BRAND}, ${ACCENT}); color: #fff; border-radius: 10px; padding: 22mm 14mm; }
.cover h1 { color: #fff; font-size: 34pt; margin: 0 0 4mm; }
.cover .sub { font-size: 14pt; opacity: .92; margin: 0; }
.cover img { width: 100%; border-radius: 8px; border: 1px solid #cbd5e1; box-shadow: 0 6px 24px #0002; }
.cover .meta { color: #475569; font-size: 9.5pt; }
.toc { break-before: page; }
.toc ol { list-style: none; padding: 0; font-size: 12pt; }
.toc li { display: flex; justify-content: space-between; border-bottom: 1px dotted #94a3b8; padding: 3mm 0; }
.toc .who { color: #64748b; font-size: 10pt; }
.faq dt { font-weight: 600; color: ${BRAND}; margin-top: 5mm; break-after: avoid; }
.faq dd { margin: 1mm 0 0; }
`;

function guideHtml(): string {
  const toc = CHAPTERS.map(
    (c, i) => `<li><span>${i + 1}. ${c.title}</span><span class="who">${c.audience}</span></li>`,
  ).join('');
  const chapters = CHAPTERS.map(
    (c, i) =>
      `<section class="chapter" id="${c.id}"><p class="audience">${c.audience}</p><h2>${i + 1}. ${c.title}</h2>${c.html}</section>`,
  ).join('\n');
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><title>Clinic Appointments — User guide</title><style>${GUIDE_CSS}</style></head><body>
<section class="cover">
  <div class="band"><h1>Clinic Appointments</h1><p class="sub">User guide for patients, doctors, reception and practice managers</p></div>
  <img src="images/30-doctor-schedule.png" alt="">
  <p class="meta">Edition: ${edition}. Screens show the fictional Maple Grove Clinic; your clinic's name, colours and settings will differ.</p>
</section>
<section class="toc"><h2>Contents</h2><ol>${toc}</ol>
  <p>Each chapter is written for one group of users. Everyone should read <b>Getting started</b>.</p></section>
${chapters}
</body></html>`;
}

test('user guide PDF', async ({ page }) => {
  const htmlPath = path.join(GUIDE_DIR, 'user-guide.html');
  writeFileSync(htmlPath, guideHtml());
  await page.goto(pathToFileURL(htmlPath).href);
  await page.waitForLoadState('networkidle');
  await page.pdf({
    path: path.join(GUIDE_DIR, 'user-guide.pdf'),
    format: 'A4',
    printBackground: true,
    preferCSSPageSize: true,
    displayHeaderFooter: true,
    headerTemplate: '<span></span>',
    footerTemplate: `<div style="font:8pt 'Segoe UI',sans-serif;color:#64748b;width:100%;padding:0 16mm;display:flex;justify-content:space-between"><span>Clinic Appointments · User guide</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
  });
});

// ------------------------------------------------------------------ marketing

const img = (name: string) =>
  `data:image/png;base64,${readFileSync(path.join(RAW_DIR, `${name}.png`)).toString('base64')}`;

const MARKETING_CSS = `
* { box-sizing: border-box; margin: 0; }
body { font-family: "Segoe UI", system-ui, sans-serif; }
.stage { position: relative; overflow: hidden; background: radial-gradient(120% 120% at 0% 0%, #2a6f97 0%, ${BRAND} 55%, #10223b 100%); color: #fff; }
.browser { background: #fff; border-radius: 14px; overflow: hidden; box-shadow: 0 30px 80px #0007; }
.browser .bar { height: 38px; background: #e8edf3; display: flex; align-items: center; gap: 8px; padding: 0 16px; }
.browser .bar i { width: 12px; height: 12px; border-radius: 50%; background: #cbd5e1; display: block; }
.browser .bar span { margin-left: 18px; flex: 1; height: 22px; border-radius: 11px; background: #fff; color: #64748b; font-size: 13px; line-height: 22px; padding-left: 12px; }
.browser img, .phone img { display: block; width: 100%; }
.phone { background: #0b1220; border-radius: 46px; padding: 14px; box-shadow: 0 30px 80px #0008; }
.phone img { border-radius: 34px; }
h1 { font-size: 64px; line-height: 1.08; font-weight: 700; letter-spacing: -.01em; }
p.lead { font-size: 26px; opacity: .9; margin-top: 18px; line-height: 1.4; }
ul.points { list-style: none; padding: 0; margin-top: 34px; font-size: 22px; }
ul.points li { margin: 12px 0; padding-left: 36px; position: relative; }
ul.points li::before { content: "✓"; position: absolute; left: 0; color: #7dd3fc; font-weight: 700; }
.caption { font-size: 22px; font-weight: 600; text-align: center; margin-top: 18px; }
`;

const browser = (shot: string, width: number, url = 'appointments.maplegrove.example') =>
  `<div class="browser" style="width:${width}px"><div class="bar"><i></i><i></i><i></i><span>${url}</span></div><img src="${img(shot)}"></div>`;
const phone = (shot: string, width: number) =>
  `<div class="phone" style="width:${width}px"><img src="${img(shot)}"></div>`;

async function render(page: Page, file: string, width: number, height: number, body: string) {
  await page.setViewportSize({ width, height });
  await page.setContent(
    `<!doctype html><html><head><style>${MARKETING_CSS}</style></head><body><div class="stage" style="width:${width}px;height:${height}px">${body}</div></body></html>`,
  );
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: path.join(MARKETING_DIR, file) });
}

test('marketing images', async ({ page }) => {
  // Hero: 16:9, desktop schedule with the patient's phone in front.
  await render(
    page,
    'hero.png',
    1920,
    1080,
    `
    <div style="position:absolute;left:110px;top:150px;width:640px">
      <h1>Appointments, made simple for patients and staff</h1>
      <p class="lead">Online booking, schedules and patient records in one secure system.</p>
      <ul class="points"><li>Patients book, move and cancel online</li><li>No double bookings, ever</li><li>Works on any phone, no app needed</li><li>Two-step verification for every staff account</li></ul>
    </div>
    <div style="position:absolute;left:820px;top:120px">${browser('desktop-schedule', 1000)}</div>
    <div style="position:absolute;left:1500px;top:330px">${phone('phone-book-time', 270)}</div>`,
  );

  // Social card, 1200×630.
  await render(
    page,
    'social-card.png',
    1200,
    630,
    `
    <div style="position:absolute;left:70px;top:90px;width:470px"><h1 style="font-size:50px">Online appointments for your clinic</h1>
      <p class="lead" style="font-size:22px">Booking, schedules and patient records, secure by design.</p></div>
    <div style="position:absolute;left:580px;top:70px">${browser('desktop-front-desk', 720)}</div>
    <div style="position:absolute;left:540px;top:250px">${phone('phone-dashboard', 190)}</div>`,
  );

  // Patients on their phones.
  await render(
    page,
    'patients-on-mobile.png',
    1920,
    1080,
    `
    <h1 style="position:absolute;left:0;right:0;top:70px;text-align:center;font-size:56px">Booking that fits in a patient's pocket</h1>
    <div style="position:absolute;top:200px;left:0;right:0;display:flex;justify-content:center;gap:70px">
      <div>${phone('phone-dashboard', 330)}<p class="caption">Next appointment at a glance</p></div>
      <div>${phone('phone-book-time', 330)}<p class="caption">Pick a time in seconds</p></div>
      <div>${phone('phone-appointments', 330)}<p class="caption">Move or cancel online</p></div>
    </div>`,
  );

  // Clinicians.
  await render(
    page,
    'for-doctors.png',
    1920,
    1080,
    `
    <div style="position:absolute;left:110px;top:200px;width:560px">
      <h1 style="font-size:54px">Everything for the consultation, beside the schedule</h1>
      <p class="lead">Allergies, medications and conditions at a glance. Clinical notes that can be amended but never lost.</p>
    </div>
    <div style="position:absolute;left:740px;top:110px">${browser('desktop-appointment', 1080)}</div>`,
  );

  // Reception.
  await render(
    page,
    'for-reception.png',
    1920,
    1080,
    `
    <div style="position:absolute;left:110px;top:200px;width:560px">
      <h1 style="font-size:54px">The whole day, every doctor, one screen</h1>
      <p class="lead">Check patients in with one click and book on their behalf in moments.</p>
    </div>
    <div style="position:absolute;left:740px;top:110px">${browser('desktop-front-desk', 1080)}</div>`,
  );

  // Themes.
  const themes = JSON.parse(readFileSync(path.join(RAW_DIR, 'themes.json'), 'utf8')) as {
    id: string;
    label: string;
  }[];
  await render(
    page,
    'themes.png',
    1920,
    1080,
    `
    <h1 style="position:absolute;left:0;right:0;top:70px;text-align:center;font-size:56px">Your clinic's look, in one setting</h1>
    <div style="position:absolute;top:210px;left:0;right:0;display:flex;justify-content:center;gap:40px">
      ${themes.map((t) => `<div>${phone(`theme-${t.id}`, 300)}<p class="caption" style="font-size:20px">${t.label}</p></div>`).join('')}
    </div>`,
  );

  // The plain high-resolution screens, for anyone building their own layouts.
  for (const name of [
    'desktop-schedule',
    'desktop-appointment',
    'desktop-front-desk',
    'phone-dashboard',
    'phone-book-time',
    'phone-appointments',
  ]) {
    copyFileSync(path.join(RAW_DIR, `${name}.png`), path.join(MARKETING_DIR, `screen-${name}.png`));
  }
});
