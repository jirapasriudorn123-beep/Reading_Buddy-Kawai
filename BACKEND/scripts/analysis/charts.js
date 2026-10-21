// ================== กราฟ SVG สำหรับแทรกในเล่ม (Word แทรกไฟล์ .svg ได้ตรงๆ) ==================
// ใช้ฟอนต์ TH SarabunPSK ตามเล่ม สีเข้ม/อ่อนพอแยกได้เมื่อพิมพ์ขาวดำ

const FONT = "'TH SarabunPSK', 'TH Sarabun New', Sarabun, sans-serif";
const COLORS = ["#2F5597", "#ED7D31", "#7F7F7F", "#70AD47"];
const W = 640;
const H = 400;
const M = { top: 30, right: 20, bottom: 70, left: 70 };

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const fmt = (v) => (Math.abs(v) >= 100 || Number.isInteger(v) ? String(Math.round(v)) : v.toFixed(1));

// เส้นแบ่งแกน y สวยๆ (1, 2, 5 × 10^k)
function niceTicks(max, count = 5) {
  if (!(max > 0)) return [0, 1];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  const ticks = [];
  for (let v = 0; v <= max + step * 1e-9; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

function frame(body, { xLabel, yLabel, legend }) {
  const legendSvg = (legend || [])
    .map((name, i) => {
      const x = M.left + i * 170;
      return `<rect x="${x}" y="8" width="14" height="14" fill="${COLORS[i]}"/><text x="${x + 20}" y="20" font-size="18">${esc(name)}</text>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="${FONT}" font-size="18" fill="#000">
<rect width="${W}" height="${H}" fill="#fff"/>
${legendSvg}
${body}
<text x="${M.left + (W - M.left - M.right) / 2}" y="${H - 12}" text-anchor="middle" font-size="20">${esc(xLabel || "")}</text>
<text transform="translate(18 ${M.top + (H - M.top - M.bottom) / 2}) rotate(-90)" text-anchor="middle" font-size="20">${esc(yLabel || "")}</text>
</svg>
`;
}

function yAxis(ticks, yOf) {
  return ticks
    .map((t) => {
      const y = yOf(t);
      return `<line x1="${M.left}" x2="${W - M.right}" y1="${y}" y2="${y}" stroke="#D9D9D9"/><text x="${M.left - 8}" y="${y + 6}" text-anchor="end">${fmt(t)}</text>`;
    })
    .join("");
}

// แท่งแบบกลุ่ม: categories = ป้ายแกน x, series = [{ name, values }]
function barChart({ categories, series, xLabel, yLabel, yMax, showValues = true }) {
  const plotW = W - M.left - M.right;
  const plotH = H - M.top - M.bottom;
  const top = yMax ?? Math.max(...series.flatMap((s) => s.values.filter(Number.isFinite)), 0);
  const ticks = niceTicks(top);
  const max = ticks[ticks.length - 1];
  const yOf = (v) => M.top + plotH - (v / max) * plotH;
  const group = plotW / categories.length;
  const barW = Math.min(48, (group * 0.75) / series.length);
  let bars = "";
  categories.forEach((cat, ci) => {
    const x0 = M.left + ci * group + (group - barW * series.length) / 2;
    series.forEach((s, si) => {
      const v = s.values[ci];
      if (!Number.isFinite(v)) return;
      const x = x0 + si * barW;
      bars += `<rect x="${x}" y="${yOf(v)}" width="${barW - 2}" height="${yOf(0) - yOf(v)}" fill="${COLORS[si]}"/>`;
      if (showValues) bars += `<text x="${x + barW / 2 - 1}" y="${yOf(v) - 4}" text-anchor="middle" font-size="16">${fmt(v)}</text>`;
    });
    bars += `<text x="${M.left + ci * group + group / 2}" y="${M.top + plotH + 22}" text-anchor="middle">${esc(cat)}</text>`;
  });
  const axis = `<line x1="${M.left}" x2="${W - M.right}" y1="${yOf(0)}" y2="${yOf(0)}" stroke="#000"/>`;
  return frame(yAxis(ticks, yOf) + bars + axis, { xLabel, yLabel, legend: series.length > 1 ? series.map((s) => s.name) : [] });
}

// เส้น: xs เป็นตัวเลข, series = [{ name, values }]
function lineChart({ xs, series, xLabel, yLabel, yMax }) {
  const plotW = W - M.left - M.right;
  const plotH = H - M.top - M.bottom;
  const ticks = niceTicks(yMax ?? Math.max(...series.flatMap((s) => s.values.filter(Number.isFinite)), 0));
  const max = ticks[ticks.length - 1];
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const xOf = (x) => M.left + (xMax === xMin ? plotW / 2 : ((x - xMin) / (xMax - xMin)) * plotW);
  const yOf = (v) => M.top + plotH - (v / max) * plotH;
  const xTicks = niceTicks(xMax - xMin, 8).map((t) => t + xMin).filter((t) => t <= xMax);
  let body = yAxis(ticks, yOf);
  body += xTicks.map((t) => `<text x="${xOf(t)}" y="${M.top + plotH + 22}" text-anchor="middle">${fmt(t)}</text>`).join("");
  series.forEach((s, si) => {
    const pts = xs.map((x, i) => [x, s.values[i]]).filter(([, v]) => Number.isFinite(v));
    body += `<polyline fill="none" stroke="${COLORS[si]}" stroke-width="2.5" points="${pts.map(([x, v]) => `${xOf(x)},${yOf(v)}`).join(" ")}"/>`;
    body += pts.map(([x, v]) => `<circle cx="${xOf(x)}" cy="${yOf(v)}" r="3" fill="${COLORS[si]}"/>`).join("");
  });
  body += `<line x1="${M.left}" x2="${W - M.right}" y1="${yOf(0)}" y2="${yOf(0)}" stroke="#000"/>`;
  return frame(body, { xLabel, yLabel, legend: series.length > 1 ? series.map((s) => s.name) : [] });
}

// กระจาย: points = [[x, y]] (จุดซ้อนกันจะเข้มขึ้น)
function scatterChart({ points, xLabel, yLabel }) {
  const plotW = W - M.left - M.right;
  const plotH = H - M.top - M.bottom;
  const yTicks = niceTicks(Math.max(...points.map((p) => p[1]), 0));
  const xTicks = niceTicks(Math.max(...points.map((p) => p[0]), 0), 8);
  const yMax = yTicks[yTicks.length - 1];
  const xMax = xTicks[xTicks.length - 1];
  const xOf = (x) => M.left + (x / xMax) * plotW;
  const yOf = (v) => M.top + plotH - (v / yMax) * plotH;
  let body = yAxis(yTicks, yOf);
  body += xTicks.map((t) => `<text x="${xOf(t)}" y="${M.top + plotH + 22}" text-anchor="middle">${fmt(t)}</text>`).join("");
  body += points
    .map(([x, y]) => `<circle cx="${xOf(x)}" cy="${yOf(y)}" r="5" fill="${COLORS[0]}" fill-opacity="0.55" stroke="${COLORS[0]}"/>`)
    .join("");
  body += `<line x1="${M.left}" x2="${W - M.right}" y1="${yOf(0)}" y2="${yOf(0)}" stroke="#000"/><line x1="${M.left}" x2="${M.left}" y1="${M.top}" y2="${yOf(0)}" stroke="#000"/>`;
  return frame(body, { xLabel, yLabel });
}

module.exports = { barChart, lineChart, scatterChart };
