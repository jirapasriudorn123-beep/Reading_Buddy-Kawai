// ================== วิเคราะห์ข้อมูลวิจัยสำหรับบทที่ 5 ==================
// วิธีรัน (จาก BACKEND/):  node scripts/analysis/analyze.js <โฟลเดอร์ที่มี CSV> [--out <โฟลเดอร์ผลลัพธ์>]
// อ่านไฟล์ที่ดาวน์โหลดจากหน้าแอดมิน: reading-buddy-{users,days,sessions,reviews}-YYYYMMDD.csv (ถ้ามีหลายวันใช้ไฟล์ล่าสุด)
// ได้ report.html (ตาราง + กราฟ + ประโยคสรุป), tables/*.csv และ figures/*.svg — รายละเอียดดู README.md

const fs = require("fs");
const path = require("path");
const { parseCsv } = require("../ai-eval/csv");
const S = require("./stats");
const { barChart, lineChart, scatterChart } = require("./charts");

const KINDS = ["users", "days", "sessions", "reviews"];
const TEXT_COLUMNS = new Set(["user_code", "registered_at", "first_active_date", "last_active_date", "date", "started_at", "answered_at", "source"]);
const RETENTION_MAX_DAY = 30;
const RETENTION_MIN_ELIGIBLE = 3; // จุดที่มีคนสมัครมานานพอน้อยกว่านี้ไม่วาด (เปอร์เซ็นต์แกว่งเกินไป)
const SMALL_N = 10;
const WEEKDAYS = ["", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์", "อาทิตย์"];

// ---------- อ่านไฟล์ ----------
function findFile(dir, kind) {
  const files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".csv"));
  const dated = files
    .map((f) => ({ f, m: f.match(new RegExp(`^reading-buddy-${kind}-(\\d{8})`)) }))
    .filter((x) => x.m)
    .sort((a, b) => a.m[1].localeCompare(b.m[1]) || a.f.localeCompare(b.f));
  if (dated.length) return path.join(dir, dated[dated.length - 1].f);
  return files.includes(`${kind}.csv`) ? path.join(dir, `${kind}.csv`) : null;
}

function load(file) {
  return parseCsv(fs.readFileSync(file, "utf8")).map((row) => {
    const out = {};
    for (const [k, v] of Object.entries(row)) out[k] = TEXT_COLUMNS.has(k) ? v : v === "" ? NaN : Number(v);
    return out;
  });
}

// ---------- จัดรูปตัวเลข ----------
const fx = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : "-");
const fp = (p) => (!Number.isFinite(p) ? "-" : p < 0.001 ? "< .001" : p.toFixed(3).replace(/^0/, ""));
const stars = (p) => (!Number.isFinite(p) ? "" : p < 0.01 ? "**" : p < 0.05 ? "*" : "");
const pText = (p) => (p < 0.001 ? "p < .001" : `p = ${fp(p)}`);
const ratio = (num, den) => (den > 0 ? num / den : NaN);

function strength(rho) {
  const a = Math.abs(rho);
  if (!Number.isFinite(a)) return "-";
  if (a < 0.1) return "แทบไม่มีความสัมพันธ์";
  if (a < 0.3) return "ความสัมพันธ์ระดับต่ำ";
  if (a < 0.5) return "ความสัมพันธ์ระดับปานกลาง";
  return "ความสัมพันธ์ระดับสูง";
}

function effectSize(r) {
  const a = Math.abs(r);
  if (!Number.isFinite(a)) return "-";
  if (a < 0.1) return "เล็กมาก";
  if (a < 0.3) return "เล็ก";
  if (a < 0.5) return "ปานกลาง";
  return "ใหญ่";
}

function hakeLevel(g) {
  if (!Number.isFinite(g)) return "-";
  return g < 0.3 ? "ต่ำ" : g < 0.7 ? "ปานกลาง" : "สูง";
}

function groupBy(rows, key) {
  const map = new Map();
  for (const row of rows) {
    const k = typeof key === "function" ? key(row) : row[key];
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(row);
  }
  return map;
}

// ---------- ตัวเก็บผล ----------
class Report {
  constructor() {
    this.sections = [];
    this.tableNo = 0;
    this.figureNo = 0;
    this.tables = [];
    this.figures = [];
  }
  section(title) {
    const s = { title, blocks: [] };
    this.sections.push(s);
    return {
      text: (t) => s.blocks.push({ type: "text", t }),
      note: (t) => s.blocks.push({ type: "note", t }),
      table: (slug, title, columns, rows, note) => {
        const no = ++this.tableNo;
        const t = { no, slug, title, columns, rows, note };
        this.tables.push(t);
        s.blocks.push({ type: "table", ...t });
      },
      figure: (slug, title, svg, note) => {
        const no = ++this.figureNo;
        const f = { no, slug, title, svg, note };
        this.figures.push(f);
        s.blocks.push({ type: "figure", ...f });
      },
    };
  }
}

// ---------- 1. ข้อมูลทั่วไป ----------
const DESCRIPTIVE_VARS = [
  ["active_days", "จำนวนวันที่เข้าใช้ (วัน)"],
  ["reading_days", "จำนวนวันที่อ่าน (วัน)"],
  ["longest_reading_streak", "วันอ่านติดกันสูงสุด (วัน)"],
  ["reading_rounds", "รอบอ่านที่อ่านจบ (รอบ)"],
  ["reading_minutes", "เวลาอ่านรวม (นาที)"],
  ["reading_minutes_per_active_day", "เวลาอ่านต่อวันที่เข้าใช้ (นาที)"],
  ["chapters_posttested", "บทที่ทำแบบทดสอบหลังอ่าน (บท)"],
  ["chapters_passed", "บทที่ผ่านเกณฑ์ 60% (บท)"],
  ["pet_visits", "เข้าหน้าน้องหมา (ครั้ง)"],
  ["pet_care_free", "ลูบน้องหมา (ครั้ง)"],
  ["pet_care_item", "ใช้ไอเทมดูแลน้องหมา (ครั้ง)"],
  ["ai_questions", "ถาม AI (ครั้ง)"],
  ["game_battles", "เล่นเกมทบทวน (ครั้ง)"],
  ["review_mastered", "คำถามที่ทบทวนจนจำได้ (ข้อ)"],
  ["coupons_redeemed", "แลกคูปอง (ใบ)"],
];

function descriptiveRow(label, values) {
  const d = S.describe(values);
  return [label, d.n, fx(d.mean), fx(d.sd), fx(d.median, 1), `${fx(d.q1, 1)}–${fx(d.q3, 1)}`, fx(d.min, 1), fx(d.max, 1)];
}
const DESCRIPTIVE_COLUMNS = ["ตัวแปร", "n", "Mean", "SD", "Median", "Q1–Q3", "Min", "Max"];

function sectionOverview(report, data) {
  const sec = report.section("ข้อมูลทั่วไปและการใช้งานของผู้ร่วมวิจัย");
  const { users, days } = data;
  const n = users.length;
  const readers = users.filter((u) => u.reading_rounds > 0).length;
  const dates = days.map((d) => d.date).sort();
  sec.text(
    `ผู้ร่วมวิจัยที่ยินยอมให้ใช้ข้อมูลมีทั้งหมด ${n} คน` +
      (dates.length ? ` ข้อมูลการใช้งานอยู่ระหว่างวันที่ ${dates[0]} ถึง ${dates[dates.length - 1]}` : "") +
      ` มีผู้ที่อ่านจบอย่างน้อย 1 รอบ ${readers} คน (ร้อยละ ${fx(ratio(readers, n) * 100, 1)})`
  );
  sec.table(
    "descriptive",
    "ค่าสถิติพื้นฐานของการใช้งานต่อผู้ร่วมวิจัย 1 คน",
    DESCRIPTIVE_COLUMNS,
    DESCRIPTIVE_VARS.filter(([key]) => key in (users[0] || {})).map(([key, label]) => descriptiveRow(label, users.map((u) => u[key])))
  );
  const rm = S.describe(users.map((u) => u.reading_minutes));
  sec.text(
    `ผู้ร่วมวิจัยอ่านรวมเฉลี่ย ${fx(rm.mean, 1)} นาที (SD = ${fx(rm.sd, 1)}) มัธยฐาน ${fx(rm.median, 1)} นาที ` +
      `ค่าเฉลี่ยกับมัธยฐานที่ต่างกันมากแสดงว่าการกระจายเบ้ จึงใช้สถิติแบบไม่อิงพารามิเตอร์ (non-parametric) ในการทดสอบหลัก`
  );

  // การกลับมาใช้งาน (retention) — เทียบเฉพาะคนที่สมัครมานานพอจะถึงวันที่ d แล้ว
  if (!days.length) return;
  const lastDate = dates[dates.length - 1];
  const regDate = new Map(users.map((u) => [u.user_code, u.registered_at.slice(0, 10)]));
  const activeOn = new Set(days.map((d) => `${d.user_code}|${d.day_index}`));
  const dayDiff = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
  const xs = [];
  const pcts = [];
  const rows = [];
  for (let d = 0; d <= RETENTION_MAX_DAY; d++) {
    const eligible = users.filter((u) => regDate.get(u.user_code) && dayDiff(regDate.get(u.user_code), lastDate) >= d);
    if (eligible.length < RETENTION_MIN_ELIGIBLE) break;
    const active = eligible.filter((u) => activeOn.has(`${u.user_code}|${d}`)).length;
    xs.push(d);
    pcts.push(ratio(active, eligible.length) * 100);
    if ([1, 3, 7, 14, 30].includes(d)) rows.push([`วันที่ ${d}`, eligible.length, active, fx(ratio(active, eligible.length) * 100, 1)]);
  }
  if (rows.length) {
    sec.table(
      "retention",
      "อัตราการกลับมาใช้งานหลังสมัคร (วันที่ 0 = วันสมัคร)",
      ["วันหลังสมัคร", "ผู้ที่สมัครมาถึงวันนั้นแล้ว (คน)", "เข้าใช้วันนั้น (คน)", "ร้อยละ"],
      rows,
      "นับเฉพาะผู้ที่สมัครมาแล้วอย่างน้อย d วันเมื่อถึงวันสุดท้ายของข้อมูล"
    );
  }
  if (xs.length > 1) {
    sec.figure(
      "retention",
      "ร้อยละของผู้ร่วมวิจัยที่เข้าใช้งานในแต่ละวันหลังสมัคร",
      lineChart({ xs, series: [{ name: "เข้าใช้", values: pcts }], xLabel: "วันหลังสมัคร", yLabel: "ร้อยละของผู้ร่วมวิจัย", yMax: 100 })
    );
  }
}

// ---------- 2. คะแนนก่อน/หลังอ่าน ----------
function chapterTestPairs(sessions) {
  const seen = new Map();
  for (const s of sessions) {
    if (s.chapter_attempt !== 1 || !(s.chapter_total > 0)) continue;
    if (!Number.isFinite(s.chapter_pre_score) || !Number.isFinite(s.chapter_post_score)) continue;
    const key = `${s.user_code}|${s.chapter_number}`;
    if (seen.has(key)) continue;
    seen.set(key, {
      user_code: s.user_code,
      chapter: s.chapter_number,
      pre: (s.chapter_pre_score / s.chapter_total) * 100,
      post: (s.chapter_post_score / s.chapter_total) * 100,
    });
  }
  return [...seen.values()];
}

function prePostRow(label, pairs) {
  const pre = pairs.map((p) => p.pre);
  const post = pairs.map((p) => p.post);
  const mPre = S.mean(pre);
  const mPost = S.mean(post);
  const g = mPre < 100 ? (mPost - mPre) / (100 - mPre) : NaN;
  const w = S.wilcoxonSignedRank(pre, post);
  return {
    w,
    g,
    row: [
      label,
      pairs.length,
      `${fx(mPre, 1)} (${fx(S.sd(pre), 1)})`,
      `${fx(mPost, 1)} (${fx(S.sd(post), 1)})`,
      fx(mPost - mPre, 1),
      `${fx(g)} (${hakeLevel(g)})`,
      fx(w.z),
      fp(w.p) + stars(w.p),
      fx(w.r),
    ],
  };
}

function sectionPrePost(report, data) {
  const sec = report.section("ผลการทดสอบก่อนอ่านและหลังอ่าน");
  const pairs = chapterTestPairs(data.sessions);
  if (!pairs.length) {
    sec.note("ยังไม่มีผู้ที่ทำทั้งแบบทดสอบก่อนอ่านและหลังอ่านในบทเดียวกัน");
    return;
  }
  sec.text(
    "ใช้แบบทดสอบชุดแรกของแต่ละบท (ครั้งแรกที่อ่านบทนั้น ซึ่งมีทั้งก่อนอ่านและหลังอ่าน 5 ข้อชุดเดียวกัน) คิดคะแนนเป็นร้อยละ " +
      "ทดสอบความต่างด้วย Wilcoxon signed-rank test เพราะคะแนนมีค่าได้ไม่กี่ระดับ (0–100 ทีละ 20) และไม่แจกแจงแบบปกติ"
  );

  const byChapter = groupBy(pairs, "chapter");
  const chapters = [...byChapter.keys()].sort((a, b) => a - b);
  const rows = chapters.map((c) => prePostRow(`บทที่ ${c}`, byChapter.get(c)).row);

  // ภาพรวม: เฉลี่ยรายคนก่อน เพื่อให้แต่ละคนนับ 1 ครั้ง (ข้อมูลแต่ละบทของคนเดียวกันไม่อิสระต่อกัน)
  const perUser = [...groupBy(pairs, "user_code").values()].map((list) => ({
    pre: S.mean(list.map((p) => p.pre)),
    post: S.mean(list.map((p) => p.post)),
  }));
  const overall = prePostRow("ภาพรวม (เฉลี่ยรายคน)", perUser);
  rows.push(overall.row);
  sec.table(
    "pre-post",
    "คะแนนเฉลี่ยร้อยละก่อนอ่านและหลังอ่าน แยกรายบท",
    ["บท", "n (คน)", "ก่อนอ่าน M (SD)", "หลังอ่าน M (SD)", "ผลต่าง", "<g>", "Z", "p", "r"],
    rows,
    "<g> = normalized gain ของ Hake = (หลัง − ก่อน)/(100 − ก่อน) ต่ำ < .30 ≤ ปานกลาง < .70 ≤ สูง | Z จากการประมาณด้วยโค้งปกติ, " +
      "p จากการแจกแจงแบบแม่นตรง (exact) เมื่อ n ≤ 300 | r = rank-biserial correlation (บวก = หลังอ่านสูงกว่า) | * p < .05, ** p < .01"
  );

  const t = S.pairedT(perUser.map((u) => u.pre), perUser.map((u) => u.post));
  const up = perUser.filter((u) => u.post > u.pre).length;
  const same = perUser.filter((u) => u.post === u.pre).length;
  const down = perUser.length - up - same;
  const w = overall.w;
  const preM = S.mean(perUser.map((u) => u.pre));
  const postM = S.mean(perUser.map((u) => u.post));
  sec.text(
    `เมื่อเฉลี่ยรายคน (n = ${perUser.length}) คะแนนหลังอ่านเฉลี่ยร้อยละ ${fx(postM, 1)} ` +
      (Number.isFinite(w.p) && w.p < 0.05
        ? `${postM > preM ? "สูงกว่า" : "ต่ำกว่า"}ก่อนอ่าน (ร้อยละ ${fx(preM, 1)}) อย่างมีนัยสำคัญทางสถิติที่ระดับ .05 `
        : `ไม่แตกต่างจากก่อนอ่าน (ร้อยละ ${fx(preM, 1)}) อย่างมีนัยสำคัญทางสถิติ `) +
      `(Wilcoxon signed-rank, Z = ${fx(w.z)}, ${pText(w.p)}, r = ${fx(w.r)} ขนาดอิทธิพล${effectSize(w.r)}) ` +
      `normalized gain = ${fx(overall.g)} อยู่ในระดับ${hakeLevel(overall.g)} ` +
      `ผู้ที่คะแนนเพิ่มขึ้น ${up} คน เท่าเดิม ${same} คน ลดลง ${down} คน`
  );
  if (Number.isFinite(t.p)) {
    const agree = t.p < 0.05 === w.p < 0.05;
    sec.text(
      `ผลจาก paired t-test ${agree ? "สอดคล้องกัน" : "ให้ข้อสรุปต่างจาก Wilcoxon จึงควรยึดผล Wilcoxon เป็นหลัก"}: ` +
        `t(${t.df}) = ${fx(t.t)}, ${pText(t.p)}, Cohen's d = ${fx(t.dz)} (รายงานไว้เทียบกับงานวิจัยอื่นที่ใช้ t-test)`
    );
  }
  if (perUser.length < SMALL_N) sec.note(`กลุ่มตัวอย่างมีน้อยกว่า ${SMALL_N} คน ผลการทดสอบอาจไม่เสถียร ควรรายงานเชิงพรรณนาควบคู่`);

  sec.figure(
    "pre-post",
    "คะแนนเฉลี่ยร้อยละก่อนอ่านและหลังอ่าน แยกรายบท",
    barChart({
      categories: chapters.map((c) => `บทที่ ${c}`),
      series: [
        { name: "ก่อนอ่าน", values: chapters.map((c) => S.mean(byChapter.get(c).map((p) => p.pre))) },
        { name: "หลังอ่าน", values: chapters.map((c) => S.mean(byChapter.get(c).map((p) => p.post))) },
      ],
      yLabel: "คะแนนเฉลี่ย (ร้อยละ)",
      yMax: 100,
    })
  );
}

// ---------- สหสัมพันธ์หลายคู่ ----------
function correlationTable(users, xs, ys) {
  return xs.map(([xLabel, xOf]) => [
    xLabel,
    ...ys.map(([, yOf]) => {
      const r = S.spearman(users.map(xOf), users.map(yOf));
      return Number.isFinite(r.rho) ? `${fx(r.rho)}${stars(r.p)} (${fp(r.p)}, n=${r.n})` : "-";
    }),
  ]);
}

function correlationSentences(users, xs, ys) {
  const out = [];
  for (const [xLabel, xOf] of xs) {
    for (const [yLabel, yOf] of ys) {
      const r = S.spearman(users.map(xOf), users.map(yOf));
      if (!Number.isFinite(r.p) || r.p >= 0.05) continue;
      out.push(
        `${xLabel}มี${strength(r.rho)}เชิง${r.rho > 0 ? "บวก" : "ลบ"}กับ${yLabel}อย่างมีนัยสำคัญทางสถิติ (rs = ${fx(r.rho)}, ${pText(r.p)}, n = ${r.n})`
      );
    }
  }
  return out;
}

const perActiveDay = (key) => (u) => ratio(u[key], u.active_days);

// เทียบวันที่ทำกิจกรรม vs วันที่ไม่ได้ทำ ภายในคนเดียวกัน
function withinPersonDays(days, flag, valueKey) {
  const pairs = [];
  for (const list of groupBy(days, "user_code").values()) {
    const yes = list.filter(flag).map((d) => d[valueKey]);
    const no = list.filter((d) => !flag(d)).map((d) => d[valueKey]);
    if (yes.length && no.length) pairs.push({ no: S.mean(no), yes: S.mean(yes) });
  }
  return pairs;
}

function withinRow(label, pairs) {
  const w = S.wilcoxonSignedRank(pairs.map((p) => p.no), pairs.map((p) => p.yes));
  return {
    w,
    row: [
      label,
      pairs.length,
      fx(S.quantile(pairs.map((p) => p.no), 0.5), 1),
      fx(S.quantile(pairs.map((p) => p.yes), 0.5), 1),
      fx(w.z),
      fp(w.p) + stars(w.p),
      fx(w.r),
    ],
  };
}

// ---------- 3. ดูแลน้องหมา ↔ การอ่าน ----------
function sectionPet(report, data) {
  const sec = report.section("ความสัมพันธ์ระหว่างการดูแลน้องหมากับการอ่าน");
  const users = data.users.filter((u) => u.active_days > 0);
  const xs = [
    ["การลูบน้องหมาต่อวันที่เข้าใช้", perActiveDay("pet_care_free")],
    ["การใช้ไอเทมดูแลต่อวันที่เข้าใช้", perActiveDay("pet_care_item")],
    ["การเข้าหน้าน้องหมาต่อวันที่เข้าใช้", perActiveDay("pet_visits")],
    ["เลเวลน้องหมา", (u) => u.pet_level],
  ];
  const ys = [
    ["เวลาอ่านต่อวันที่เข้าใช้", (u) => u.reading_minutes_per_active_day],
    ["จำนวนวันที่อ่าน", (u) => u.reading_days],
    ["วันอ่านติดกันสูงสุด", (u) => u.longest_reading_streak],
  ];
  sec.text(
    "วิเคราะห์ 2 ระดับ (1) ระหว่างบุคคล: คนที่ดูแลน้องหมาบ่อยกว่าอ่านมากกว่าหรือไม่ ใช้สหสัมพันธ์แบบสเปียร์แมน " +
      "โดยหารด้วยจำนวนวันที่เข้าใช้ เพื่อไม่ให้คนที่ใช้งานนานได้เปรียบทั้งสองตัวแปร " +
      "(2) ภายในบุคคล: ในคนเดียวกัน วันที่ลูบ/ดูแลน้องหมาอ่านนานกว่าวันที่ไม่ได้ดูแลหรือไม่ ใช้ Wilcoxon signed-rank test"
  );
  sec.table(
    "pet-correlation",
    "สัมประสิทธิ์สหสัมพันธ์แบบสเปียร์แมน (rs) ระหว่างการดูแลน้องหมากับพฤติกรรมการอ่าน",
    ["การดูแลน้องหมา", ...ys.map(([label]) => label)],
    correlationTable(users, xs, ys),
    "ค่าในตาราง: rs (p, n) | * p < .05, ** p < .01"
  );
  const sentences = correlationSentences(users, xs, ys);
  sec.text(sentences.length ? sentences.join(" ") : "ไม่พบความสัมพันธ์ระหว่างการดูแลน้องหมากับพฤติกรรมการอ่านที่มีนัยสำคัญทางสถิติที่ระดับ .05");

  if (data.days.length) {
    const cases = [
      ["วันที่ลูบน้องหมา vs วันที่ไม่ได้ลูบ", (d) => d.pet_care_free > 0],
      ["วันที่ใช้ไอเทมดูแล vs วันที่ไม่ได้ใช้", (d) => d.pet_care_item > 0],
      ["วันที่เข้าหน้าน้องหมา vs วันที่ไม่ได้เข้า", (d) => d.pet_visits > 0],
    ].map(([label, flag]) => ({ label, ...withinRow(label, withinPersonDays(data.days, flag, "reading_minutes")) }));
    sec.table(
      "pet-within",
      "เวลาอ่าน (นาที) ในวันที่ดูแลและไม่ได้ดูแลน้องหมา ภายในผู้ร่วมวิจัยคนเดียวกัน",
      ["การเปรียบเทียบ", "n (คน)", "Mdn วันที่ไม่ได้ทำ", "Mdn วันที่ทำ", "Z", "p", "r"],
      cases.map((c) => c.row),
      "n = ผู้ที่มีทั้งวันที่ทำและไม่ได้ทำ แต่ละคนใช้ค่าเฉลี่ยเวลาอ่านของแต่ละแบบ | r บวก = วันที่ทำอ่านนานกว่า"
    );
    const sig = cases.filter((c) => c.w.p < 0.05);
    sec.text(
      sig.length
        ? sig
            .map(
              (c) =>
                `${c.label}: วันที่ทำอ่าน${c.w.r > 0 ? "นานกว่า" : "สั้นกว่า"}วันที่ไม่ได้ทำอย่างมีนัยสำคัญทางสถิติ ` +
                `(Z = ${fx(c.w.z)}, ${pText(c.w.p)}, r = ${fx(c.w.r)})`
            )
            .join(" ")
        : "ภายในคนเดียวกัน เวลาอ่านในวันที่ดูแลกับไม่ได้ดูแลน้องหมาไม่แตกต่างกันอย่างมีนัยสำคัญทางสถิติ"
    );
    sec.note(
      "ข้อควรระวังในการตีความ: อ่านจบรอบแล้วน้องหมาได้ความสุข +25 ผู้ใช้จึงอาจเข้าไปดูน้องหมาหลังอ่าน " +
        "ความสัมพันธ์ที่พบจึงบอกได้ว่าเกิดร่วมกัน แต่ยังสรุปไม่ได้ว่าการดูแลน้องหมาเป็นสาเหตุให้อ่านมากขึ้น"
    );
  }

  const points = users
    .map((u) => [perActiveDay("pet_care_free")(u), u.reading_minutes_per_active_day])
    .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  if (points.length >= 3) {
    sec.figure(
      "pet-scatter",
      "การลูบน้องหมาต่อวันกับเวลาอ่านต่อวันของผู้ร่วมวิจัยแต่ละคน",
      scatterChart({ points, xLabel: "ลูบน้องหมาต่อวันที่เข้าใช้ (ครั้ง)", yLabel: "เวลาอ่านต่อวันที่เข้าใช้ (นาที)" }),
      "1 จุด = ผู้ร่วมวิจัย 1 คน"
    );
  }
}

// ---------- 4. ถาม AI ↔ การอ่าน ----------
function sectionAi(report, data) {
  const sec = report.section("ความสัมพันธ์ระหว่างการถาม AI กับการอ่าน");
  const sessions = data.sessions.filter((s) => Number.isFinite(s.read_minutes));
  if (!sessions.length) {
    sec.note("ยังไม่มีรอบอ่านที่อ่านจบ");
    return;
  }
  const asked = (s) => s.ai_questions_during > 0;
  const withAi = sessions.filter(asked);
  const without = sessions.filter((s) => !asked(s));
  sec.text(
    `รอบอ่านที่อ่านจบมีทั้งหมด ${sessions.length} รอบ ถาม AI ระหว่างอ่าน ${withAi.length} รอบ (ร้อยละ ${fx(ratio(withAi.length, sessions.length) * 100, 1)}) ` +
      "เทียบรอบที่ถามกับไม่ถาม AI ด้วย Mann-Whitney U test และทดสอบสัดส่วนการเลิกอ่านก่อนหมดเวลาด้วย Fisher's exact test"
  );

  const metrics = [
    ["เวลาอ่าน (นาที)", "read_minutes"],
    ["เวลาที่สลับไปหน้าอื่น (นาที)", "away_minutes"],
    ["จำนวนหน้าที่เปิดอ่าน", "pages_viewed"],
  ];
  const rows = metrics.map(([label, key]) => {
    const a = without.map((s) => s[key]);
    const b = withAi.map((s) => s[key]);
    const mw = S.mannWhitney(a, b);
    return [
      label,
      `${fx(S.quantile(S.finite(a), 0.5), 1)} / ${fx(S.mean(S.finite(a)), 1)}`,
      `${fx(S.quantile(S.finite(b), 0.5), 1)} / ${fx(S.mean(S.finite(b)), 1)}`,
      Number.isFinite(mw.u) ? fx(mw.u, 1) : "-",
      fx(mw.z),
      fp(mw.p) + stars(mw.p),
      fx(mw.r),
    ];
  });
  const early = (list) => list.filter((s) => s.stopped_early === 1).length;
  const f = S.fisherExact(early(withAi), withAi.length - early(withAi), early(without), without.length - early(without));
  rows.push([
    "เลิกอ่านก่อนหมดเวลา (ร้อยละของรอบ)",
    fx(ratio(early(without), without.length) * 100, 1),
    fx(ratio(early(withAi), withAi.length) * 100, 1),
    "-",
    "-",
    fp(f.p) + stars(f.p),
    `OR = ${fx(f.oddsRatio)}`,
  ]);
  sec.table(
    "ai-sessions",
    `เปรียบเทียบรอบอ่านที่ไม่ถาม AI (n = ${without.length}) กับรอบที่ถาม AI (n = ${withAi.length})`,
    ["ตัวแปร", "ไม่ถาม AI Mdn / M", "ถาม AI Mdn / M", "U", "Z", "p", "r"],
    rows,
    "r = rank-biserial correlation (บวก = รอบที่ถาม AI มีค่ามากกว่า) | แถวสุดท้ายใช้ Fisher's exact test, OR = odds ratio ของการเลิกก่อนในรอบที่ถาม AI | * p < .05, ** p < .01"
  );
  sec.note(
    "รอบอ่านหลายรอบมาจากคนเดียวกัน (ไม่อิสระต่อกัน) และเวลาอ่านถูกจำกัดที่ 25 นาทีต่อรอบ " +
      "จึงควรใช้ผลภายในบุคคลในตารางถัดไปเป็นผลหลัก"
  );

  const within = [
    ["เวลาอ่าน (นาที)", "read_minutes"],
    ["เวลาที่สลับไปหน้าอื่น (นาที)", "away_minutes"],
  ].map(([label, key]) => {
    const pairs = [];
    for (const list of groupBy(sessions, "user_code").values()) {
      const yes = S.finite(list.filter(asked).map((s) => s[key]));
      const no = S.finite(list.filter((s) => !asked(s)).map((s) => s[key]));
      if (yes.length && no.length) pairs.push({ no: S.mean(no), yes: S.mean(yes) });
    }
    return { label, ...withinRow(label, pairs) };
  });
  sec.table(
    "ai-within",
    "เปรียบเทียบรอบที่ไม่ถามและถาม AI ภายในผู้ร่วมวิจัยคนเดียวกัน",
    ["ตัวแปร", "n (คน)", "Mdn รอบที่ไม่ถาม", "Mdn รอบที่ถาม", "Z", "p", "r"],
    within.map((w) => w.row),
    "n = ผู้ที่มีทั้งรอบที่ถามและไม่ถาม AI แต่ละคนใช้ค่าเฉลี่ยของแต่ละแบบ | r บวก = รอบที่ถาม AI มีค่ามากกว่า"
  );
  const main = within[0];
  sec.text(
    Number.isFinite(main.w.p)
      ? `ภายในคนเดียวกัน (n = ${main.w.nPairs}) เวลาอ่านในรอบที่ถาม AI ` +
          (main.w.p < 0.05
            ? `${main.w.r > 0 ? "มากกว่า" : "น้อยกว่า"}รอบที่ไม่ถามอย่างมีนัยสำคัญทางสถิติ`
            : "ไม่แตกต่างจากรอบที่ไม่ถามอย่างมีนัยสำคัญทางสถิติ") +
          ` (Z = ${fx(main.w.z)}, ${pText(main.w.p)}, r = ${fx(main.w.r)})`
      : "ยังไม่มีผู้ที่มีทั้งรอบที่ถามและไม่ถาม AI จึงเทียบภายในบุคคลไม่ได้"
  );
}

// ---------- 5. ปัจจัยที่สัมพันธ์กับผลการเรียน ----------
function sectionLearningFactors(report, data) {
  const sec = report.section("ปัจจัยการใช้งานที่สัมพันธ์กับผลการเรียน");
  const users = data.users.filter((u) => u.chapters_posttested > 0);
  const xs = [
    ["เวลาอ่านรวม", (u) => u.reading_minutes],
    ["การถาม AI ต่อวันที่เข้าใช้", perActiveDay("ai_questions")],
    ["จำนวนครั้งที่เล่นเกมทบทวน", (u) => u.game_battles],
    ["ร้อยละที่ตอบถูกในเกม", (u) => u.game_subject_correct_pct],
    ["การลูบน้องหมาต่อวันที่เข้าใช้", perActiveDay("pet_care_free")],
  ];
  const ys = [
    ["คะแนนหลังอ่านเฉลี่ย", (u) => u.avg_post_score_pct],
    ["คะแนนที่เพิ่มขึ้นเฉลี่ย", (u) => u.avg_gain_pct],
    ["จำนวนบทที่ผ่านเกณฑ์", (u) => u.chapters_passed],
  ];
  sec.text(`ใช้ผู้ร่วมวิจัยที่ทำแบบทดสอบหลังอ่านอย่างน้อย 1 บท (${users.length} คน)`);
  sec.table(
    "learning-correlation",
    "สัมประสิทธิ์สหสัมพันธ์แบบสเปียร์แมน (rs) ระหว่างการใช้งานกับผลการเรียน",
    ["การใช้งาน", ...ys.map(([label]) => label)],
    correlationTable(users, xs, ys),
    "ค่าในตาราง: rs (p, n) | * p < .05, ** p < .01 | ทดสอบหลายคู่พร้อมกัน ค่า p ที่ใกล้ .05 ควรตีความอย่างระมัดระวัง"
  );
  const sentences = correlationSentences(users, xs, ys);
  sec.text(sentences.length ? sentences.join(" ") : "ไม่พบปัจจัยการใช้งานที่สัมพันธ์กับผลการเรียนอย่างมีนัยสำคัญทางสถิติที่ระดับ .05");
}

// ---------- 6. การทบทวนแบบเว้นระยะ ----------
function sectionReview(report, data) {
  const sec = report.section("การจำเนื้อหาในการทบทวนแบบเว้นระยะ");
  const due = data.reviews.filter((r) => r.was_due === 1 && Number.isFinite(r.interval_days));
  if (!due.length) {
    sec.note("ยังไม่มีคำตอบที่ตอบตอนถึงรอบทบทวน (ต้องตอบถูกครั้งแรกแล้วกลับมาตอบอีกครั้งหลัง 1 วันขึ้นไป)");
    return;
  }
  sec.text(
    "คำถามที่ตอบถูกจะถูกนัดทบทวนอีกครั้งหลัง 1, 3, 7 และ 14 วันตามลำดับ ตารางนี้ใช้เฉพาะคำตอบที่ตอบตอนถึงรอบนัดแล้ว " +
      "ร้อยละที่ตอบถูกจึงบอกได้ว่าผู้เรียนยังจำได้เท่าไรเมื่อเว้นไปเป็นระยะเวลาต่างๆ"
  );
  const intervals = [...new Set(due.map((r) => r.interval_days))].sort((a, b) => a - b);
  const rows = intervals.map((d) => {
    const list = due.filter((r) => r.interval_days === d);
    const correct = list.filter((r) => r.correct === 1).length;
    return { d, n: list.length, users: new Set(list.map((r) => r.user_code)).size, pct: ratio(correct, list.length) * 100 };
  });
  sec.table(
    "review-interval",
    "ร้อยละที่ตอบถูกเมื่อทบทวนตามระยะห่างที่นัด",
    ["ระยะห่าง (วัน)", "จำนวนคำตอบ", "จำนวนผู้ตอบ (คน)", "ตอบถูก (ร้อยละ)"],
    rows.map((r) => [r.d, r.n, r.users, fx(r.pct, 1)]),
    "1 คนตอบได้หลายข้อ ค่าร้อยละเป็นสัดส่วนของคำตอบทั้งหมดในระยะนั้น"
  );
  sec.text(
    rows.map((r) => `เว้น ${r.d} วันตอบถูกร้อยละ ${fx(r.pct, 1)}`).join(" ") +
      " (ระยะที่ยาวขึ้นมีเฉพาะข้อที่ผ่านระยะก่อนหน้ามาแล้ว จึงไม่ใช่กลุ่มคำถามเดียวกันทุกระยะ)"
  );
  sec.figure(
    "review-interval",
    "ร้อยละที่ตอบถูกเมื่อทบทวนตามระยะห่างที่นัด",
    barChart({
      categories: rows.map((r) => `${r.d} วัน`),
      series: [{ name: "ตอบถูก", values: rows.map((r) => r.pct) }],
      xLabel: "ระยะห่างจากครั้งที่ตอบถูกครั้งก่อน",
      yLabel: "ตอบถูก (ร้อยละ)",
      yMax: 100,
    })
  );
}

// ---------- 7. ช่วงเวลาและรูปแบบการอ่าน ----------
function sectionReadingPattern(report, data) {
  const sec = report.section("ช่วงเวลาและรูปแบบการอ่าน");
  const sessions = data.sessions;
  if (!sessions.length) {
    sec.note("ยังไม่มีรอบอ่านที่อ่านจบ");
    return;
  }
  const hours = Array.from({ length: 24 }, (_, h) => sessions.filter((s) => s.hour === h).length);
  sec.figure(
    "reading-hours",
    "จำนวนรอบอ่านแยกตามช่วงเวลาที่เริ่มอ่าน",
    barChart({
      categories: hours.map((_, h) => (h % 3 === 0 ? String(h) : "")),
      series: [{ name: "รอบอ่าน", values: hours }],
      xLabel: "ชั่วโมงที่เริ่มอ่าน (เวลาไทย)",
      yLabel: "จำนวนรอบ",
      showValues: false,
    })
  );
  const peak = hours.indexOf(Math.max(...hours));
  const weekdayRows = [1, 2, 3, 4, 5, 6, 7].map((w) => {
    const n = sessions.filter((s) => s.weekday === w).length;
    return [WEEKDAYS[w], n, fx(ratio(n, sessions.length) * 100, 1)];
  });
  sec.table("reading-weekday", "จำนวนรอบอ่านแยกตามวันในสัปดาห์", ["วัน", "จำนวนรอบ", "ร้อยละ"], weekdayRows);

  const early = sessions.filter((s) => s.stopped_early === 1).length;
  const pdf = sessions.filter((s) => s.pdf_total_pages > 0 && Number.isFinite(s.pages_viewed));
  sec.text(
    `ช่วงเวลาที่เริ่มอ่านมากที่สุดคือ ${peak}.00–${peak}.59 น. (${hours[peak]} รอบ) ` +
      `รอบที่เลิกอ่านก่อนหมดเวลามี ${early} รอบ (ร้อยละ ${fx(ratio(early, sessions.length) * 100, 1)})` +
      (pdf.length
        ? ` ในรอบที่อ่านจาก PDF เปิดอ่านเฉลี่ย ${fx(S.mean(pdf.map((s) => s.pages_viewed)), 1)} หน้าต่อรอบ จากทั้งหมดเฉลี่ย ${fx(S.mean(pdf.map((s) => s.pdf_total_pages)), 1)} หน้า`
        : "")
  );
}

// ---------- เขียนผลลัพธ์ ----------
function csvCell(v) {
  const s = String(v ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const html = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function renderHtml(report, meta) {
  const body = report.sections
    .map((s, i) => {
      const blocks = s.blocks
        .map((b) => {
          if (b.type === "text") return `<p>${html(b.t)}</p>`;
          if (b.type === "note") return `<p class="note">หมายเหตุ: ${html(b.t)}</p>`;
          if (b.type === "table") {
            return `<p class="caption"><b>ตารางที่ ${b.no}</b> ${html(b.title)}</p>
<table><thead><tr>${b.columns.map((c) => `<th>${html(c)}</th>`).join("")}</tr></thead>
<tbody>${b.rows.map((r) => `<tr>${r.map((c, j) => `<td${j ? "" : ' class="label"'}>${html(c)}</td>`).join("")}</tr>`).join("\n")}</tbody></table>
${b.note ? `<p class="table-note">${html(b.note)}</p>` : ""}`;
          }
          return `<figure>${b.svg}<figcaption><b>ภาพที่ ${b.no}</b> ${html(b.title)}${b.note ? `<br><span class="table-note">${html(b.note)}</span>` : ""}</figcaption></figure>`;
        })
        .join("\n");
      return `<h2>${i + 1}. ${html(s.title)}</h2>\n${blocks}`;
    })
    .join("\n");
  return `<!doctype html>
<html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>ผลการวิเคราะห์ข้อมูล</title>
<style>
  body { font-family: 'TH SarabunPSK', 'TH Sarabun New', Sarabun, sans-serif; font-size: 16pt; line-height: 1.35; color: #000; background: #fff; max-width: 900px; margin: 24px auto; padding: 0 16px; }
  h1 { font-size: 22pt; } h2 { font-size: 18pt; margin-top: 32px; }
  p { text-align: justify; }
  table { border-collapse: collapse; width: 100%; font-size: 14pt; margin: 4px 0; }
  th, td { border-top: 1px solid #000; border-bottom: 1px solid #000; padding: 2px 6px; text-align: center; }
  td.label { text-align: left; }
  thead th { border-bottom: 1px solid #000; }
  .caption { margin-bottom: 2px; }
  .table-note { font-size: 13pt; color: #333; margin-top: 2px; }
  .note { font-size: 14pt; background: #F2F2F2; padding: 6px 10px; }
  figure { margin: 16px 0; text-align: center; }
  figure svg { max-width: 100%; height: auto; }
  .meta { font-size: 14pt; color: #333; }
</style></head><body>
<h1>ผลการวิเคราะห์ข้อมูล (บทที่ 5)</h1>
<p class="meta">สร้างเมื่อ ${html(meta.createdAt)} จากไฟล์: ${meta.files.map(html).join(", ")}<br>
เลขตารางและภาพในหน้านี้เรียง 1, 2, 3… ให้เปลี่ยนเป็นเลขตามเล่มตอนนำไปใส่</p>
${body}
</body></html>
`;
}

function main() {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf("--out");
  const outArg = outIdx >= 0 ? args[outIdx + 1] : null;
  const inputDir = args.find((a, i) => !a.startsWith("--") && i !== outIdx + 1);
  if (!inputDir || !fs.existsSync(inputDir)) {
    console.error("ใส่โฟลเดอร์ที่มีไฟล์ CSV เช่น node scripts/analysis/analyze.js ~/Downloads/research-data");
    process.exit(1);
  }

  const data = {};
  const used = [];
  for (const kind of KINDS) {
    const file = findFile(inputDir, kind);
    data[kind] = file ? load(file) : [];
    if (file) used.push(path.basename(file));
    else console.warn(`ไม่พบไฟล์ ${kind} — ข้ามส่วนที่ใช้ไฟล์นี้`);
  }
  if (!data.users.length) {
    console.error("ไม่พบข้อมูลผู้ใช้ (reading-buddy-users-*.csv) หรือไฟล์ว่าง");
    process.exit(1);
  }

  const report = new Report();
  sectionOverview(report, data);
  sectionPrePost(report, data);
  sectionPet(report, data);
  sectionAi(report, data);
  sectionLearningFactors(report, data);
  if (data.reviews.length) sectionReview(report, data);
  sectionReadingPattern(report, data);

  const stamp = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 16).replace(/[-:]/g, "").replace("T", "-");
  const outDir = outArg || path.join(inputDir, `analysis-${stamp}`);
  fs.mkdirSync(path.join(outDir, "tables"), { recursive: true });
  fs.mkdirSync(path.join(outDir, "figures"), { recursive: true });
  for (const t of report.tables) {
    const lines = [t.columns, ...t.rows].map((r) => r.map(csvCell).join(","));
    fs.writeFileSync(path.join(outDir, "tables", `${String(t.no).padStart(2, "0")}-${t.slug}.csv`), "﻿" + lines.join("\r\n") + "\r\n");
  }
  for (const f of report.figures) {
    fs.writeFileSync(path.join(outDir, "figures", `${String(f.no).padStart(2, "0")}-${f.slug}.svg`), f.svg);
  }
  const createdAt = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 16).replace("T", " ");
  fs.writeFileSync(path.join(outDir, "report.html"), renderHtml(report, { createdAt, files: used }));

  console.log(`ผู้ร่วมวิจัย ${data.users.length} คน, รอบอ่าน ${data.sessions.length} รอบ`);
  console.log(`ได้ตาราง ${report.tables.length} ตาราง ภาพ ${report.figures.length} ภาพ`);
  console.log(`เปิดดู: ${path.join(outDir, "report.html")}`);
}

main();
