// ================== ความสอดคล้องของผู้ประเมิน 2 คน (Cohen's kappa) + คะแนนเฉลี่ยรายหมวด ==================
// วิธีรัน (จาก BACKEND/): node scripts/ai-eval/kappa.js scripts/ai-eval/results/ai-eval-xxxx.csv
// ไฟล์ต้องกรอกช่อง rater1_correctness, rater2_correctness, rater1_appropriateness, rater2_appropriateness (คะแนน 0/1/2) แล้ว

const fs = require("fs");
const { parseCsv } = require("./csv");

const CATEGORIES = [0, 1, 2];

// Cohen's kappa แบบไม่ถ่วงน้ำหนัก + แบบถ่วงน้ำหนักกำลังสอง (เหมาะกับคะแนนเรียงลำดับ 0/1/2)
function kappa(pairs) {
  const n = pairs.length;
  if (!n) return null;
  const count = (fn) => pairs.filter(fn).length;
  const po = count(([a, b]) => a === b) / n;
  const pa = Object.fromEntries(CATEGORIES.map((k) => [k, count(([a]) => a === k) / n]));
  const pb = Object.fromEntries(CATEGORIES.map((k) => [k, count(([, b]) => b === k) / n]));
  const pe = CATEGORIES.reduce((s, k) => s + pa[k] * pb[k], 0);
  const unweighted = pe === 1 ? 1 : (po - pe) / (1 - pe);

  const maxD = (CATEGORIES.length - 1) ** 2;
  const w = (i, j) => 1 - (i - j) ** 2 / maxD;
  const obsW = pairs.reduce((s, [a, b]) => s + w(a, b), 0) / n;
  let expW = 0;
  for (const i of CATEGORIES) for (const j of CATEGORIES) expW += pa[i] * pb[j] * w(i, j);
  const weighted = expW === 1 ? 1 : (obsW - expW) / (1 - expW);

  const round = (x) => Math.round(x * 1000) / 1000;
  return { n, percentAgreement: round(po * 100), kappa: round(unweighted), weightedKappa: round(weighted) };
}

// เกณฑ์ตีความของ Landis & Koch (1977)
function interpret(k) {
  if (k === null) return "-";
  if (k < 0) return "ต่ำกว่าความบังเอิญ";
  if (k <= 0.2) return "เล็กน้อย";
  if (k <= 0.4) return "พอใช้";
  if (k <= 0.6) return "ปานกลาง";
  if (k <= 0.8) return "มาก";
  return "เกือบสมบูรณ์";
}

function score(v) {
  const n = Number(v);
  return v !== "" && CATEGORIES.includes(n) ? n : null;
}

function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("ใส่ path ไฟล์ CSV ที่ให้คะแนนแล้ว เช่น node scripts/ai-eval/kappa.js scripts/ai-eval/results/ai-eval-xxxx.csv");
    process.exit(1);
  }
  const rows = parseCsv(fs.readFileSync(file, "utf8"));

  for (const criterion of ["correctness", "appropriateness"]) {
    const pairs = rows
      .map((r) => [score(r[`rater1_${criterion}`]), score(r[`rater2_${criterion}`])])
      .filter(([a, b]) => a !== null && b !== null);
    const k = kappa(pairs);
    const label = criterion === "correctness" ? "ความถูกต้อง" : "ความเหมาะสม";
    if (!k) {
      console.log(`${label}: ยังไม่มีคะแนนจากผู้ประเมินทั้งสองคน`);
      continue;
    }
    console.log(
      `${label}: ${k.n} ข้อ | ตรงกัน ${k.percentAgreement}% | kappa ${k.kappa} (${interpret(k.kappa)}) | weighted kappa ${k.weightedKappa} (${interpret(k.weightedKappa)})`
    );

    // คะแนนเฉลี่ยรายหมวด (เฉลี่ยของผู้ประเมิน 2 คน เต็ม 2)
    const byCat = {};
    for (const r of rows) {
      const a = score(r[`rater1_${criterion}`]);
      const b = score(r[`rater2_${criterion}`]);
      if (a === null || b === null) continue;
      (byCat[r.category] ||= []).push((a + b) / 2);
    }
    for (const [cat, list] of Object.entries(byCat)) {
      const mean = list.reduce((s, x) => s + x, 0) / list.length;
      console.log(`   ${cat}: เฉลี่ย ${mean.toFixed(2)} / 2 (${list.length} ข้อ)`);
    }
  }
}

if (require.main === module) main();

module.exports = { kappa, interpret };
