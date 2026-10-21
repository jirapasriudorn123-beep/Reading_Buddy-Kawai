// ================== สถิติที่ใช้ในบทที่ 5 (เขียนเองไม่ต้องลงไลบรารีเพิ่ม) ==================
// ค่าที่ได้ตรวจเทียบกับ scipy.stats แล้ว: spearmanr, wilcoxon, mannwhitneyu, fisher_exact, ttest_rel
// p-value ทั้งหมดเป็นแบบสองทาง (two-sided)

// ---------- ค่าสถิติเชิงพรรณนา ----------
function finite(list) {
  return list.filter((v) => typeof v === "number" && Number.isFinite(v));
}

function mean(list) {
  return list.length ? list.reduce((a, b) => a + b, 0) / list.length : NaN;
}

function sd(list) {
  if (list.length < 2) return NaN;
  const m = mean(list);
  return Math.sqrt(list.reduce((a, v) => a + (v - m) ** 2, 0) / (list.length - 1));
}

// ควอร์ไทล์แบบเดียวกับ Excel QUARTILE.INC / PERCENTILE.INC
function quantile(list, q) {
  if (!list.length) return NaN;
  const sorted = [...list].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function describe(values) {
  const list = finite(values);
  return {
    n: list.length,
    mean: mean(list),
    sd: sd(list),
    median: quantile(list, 0.5),
    q1: quantile(list, 0.25),
    q3: quantile(list, 0.75),
    min: list.length ? Math.min(...list) : NaN,
    max: list.length ? Math.max(...list) : NaN,
  };
}

// ---------- การแจกแจงความน่าจะเป็น ----------
function logGamma(x) {
  // Lanczos (g = 7, n = 9)
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  x -= 1;
  let a = c[0];
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

// regularized incomplete beta I_x(a, b) — continued fraction (Numerical Recipes)
function incompleteBeta(x, a, b) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  if (x > (a + 1) / (a + b + 2)) return 1 - incompleteBeta(1 - x, b, a);
  const TINY = 1e-300;
  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < TINY) d = TINY;
  d = 1 / d;
  let f = d;
  for (let m = 1; m <= 300; m++) {
    for (const step of [0, 1]) {
      const num = step === 0
        ? (m * (b - m) * x) / ((a + 2 * m - 1) * (a + 2 * m))
        : -((a + m) * (a + b + m) * x) / ((a + 2 * m) * (a + 2 * m + 1));
      d = 1 + num * d;
      if (Math.abs(d) < TINY) d = TINY;
      c = 1 + num / c;
      if (Math.abs(c) < TINY) c = TINY;
      d = 1 / d;
      f *= d * c;
    }
    if (Math.abs(d * c - 1) < 1e-12) break;
  }
  return (front * f) / a;
}

// p สองทางของ t ที่ df องศาอิสระ
function tTwoSidedP(t, df) {
  return incompleteBeta(df / (df + t * t), df / 2, 0.5);
}

// erfc แบบละเอียด (Numerical Recipes erfcc, ความคลาดเคลื่อน < 1.2e-7)
function erfc(x) {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const r =
    t *
    Math.exp(
      -z * z - 1.26551223 +
        t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 +
        t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277))))))))
    );
  return x >= 0 ? r : 2 - r;
}

function normalTwoSidedP(z) {
  return erfc(Math.abs(z) / Math.SQRT2);
}

// ---------- อันดับ (ค่าซ้ำได้อันดับเฉลี่ย) ----------
function rank(values) {
  const order = values.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const ranks = new Array(values.length);
  const ties = [];
  for (let i = 0; i < order.length; ) {
    let j = i;
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[order[k][1]] = r;
    if (j > i) ties.push(j - i + 1);
    i = j + 1;
  }
  return { ranks, ties };
}

function pearson(x, y) {
  const mx = mean(x);
  const my = mean(y);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < x.length; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  return sxx === 0 || syy === 0 ? NaN : sxy / Math.sqrt(sxx * syy);
}

// ---------- สหสัมพันธ์แบบสเปียร์แมน ----------
function spearman(xs, ys) {
  const pairs = xs.map((x, i) => [x, ys[i]]).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  const n = pairs.length;
  if (n < 3) return { n, rho: NaN, p: NaN };
  const rho = pearson(rank(pairs.map((p) => p[0])).ranks, rank(pairs.map((p) => p[1])).ranks);
  if (!Number.isFinite(rho)) return { n, rho: NaN, p: NaN };
  const p = Math.abs(rho) >= 1 ? 0 : tTwoSidedP(rho * Math.sqrt((n - 2) / (1 - rho * rho)), n - 2);
  return { n, rho, p };
}

// ---------- Wilcoxon signed-rank (ข้อมูลจับคู่ before → after) ----------
// ตัดคู่ที่ผลต่าง = 0 ออก (แบบ scipy zero_method="wilcox")
// n ≤ 300 ใช้การแจกแจงแบบแม่นตรง (exact, รวมกรณีค่าซ้ำ) มิฉะนั้นใช้การประมาณด้วยโค้งปกติ
// r = rank-biserial correlation (W+ − W−)/(W+ + W−) บวก = after มากกว่า before
function wilcoxonSignedRank(before, after) {
  const diffs = before
    .map((b, i) => after[i] - b)
    .filter((d) => Number.isFinite(d) && d !== 0);
  const n = diffs.length;
  const nPairs = before.filter((b, i) => Number.isFinite(b) && Number.isFinite(after[i])).length;
  if (n < 1) return { nPairs, n, wPlus: 0, wMinus: 0, z: NaN, p: NaN, r: NaN, method: "-" };
  const { ranks, ties } = rank(diffs.map(Math.abs));
  let wPlus = 0;
  diffs.forEach((d, i) => {
    if (d > 0) wPlus += ranks[i];
  });
  const total = (n * (n + 1)) / 2;
  const wMinus = total - wPlus;

  const mu = total / 2;
  const variance = (n * (n + 1) * (2 * n + 1)) / 24 - ties.reduce((a, t) => a + t ** 3 - t, 0) / 48;
  const z = variance > 0 ? (wPlus - mu) / Math.sqrt(variance) : NaN;

  let p;
  let method;
  if (n <= 300) {
    // อันดับ ×2 เป็นจำนวนเต็มเสมอ (อันดับเฉลี่ยของค่าซ้ำลงท้าย .5 ได้)
    const r2 = ranks.map((r) => Math.round(r * 2));
    const maxSum = r2.reduce((a, b) => a + b, 0);
    let dist = new Float64Array(maxSum + 1);
    dist[0] = 1;
    for (const r of r2) {
      const next = new Float64Array(maxSum + 1);
      for (let s = 0; s <= maxSum; s++) {
        if (!dist[s]) continue;
        next[s] += dist[s] / 2;
        next[s + r] += dist[s] / 2;
      }
      dist = next;
    }
    const obs = Math.round(wPlus * 2);
    let lower = 0;
    let upper = 0;
    for (let s = 0; s <= maxSum; s++) {
      if (s <= obs) lower += dist[s];
      if (s >= obs) upper += dist[s];
    }
    p = Math.min(1, 2 * Math.min(lower, upper));
    method = "exact";
  } else {
    p = normalTwoSidedP(z);
    method = "normal";
  }
  return { nPairs, n, wPlus, wMinus, z, p, r: (wPlus - wMinus) / total, method };
}

// ---------- Mann-Whitney U (สองกลุ่มอิสระ a vs b) ----------
// r = rank-biserial correlation บวก = กลุ่ม b มีค่ามากกว่า
function mannWhitney(a, b) {
  const x = finite(a);
  const y = finite(b);
  const n1 = x.length;
  const n2 = y.length;
  if (!n1 || !n2) return { n1, n2, u: NaN, z: NaN, p: NaN, r: NaN, method: "-" };
  const { ranks, ties } = rank([...x, ...y]);
  const r1 = ranks.slice(0, n1).reduce((s, r) => s + r, 0);
  const u1 = r1 - (n1 * (n1 + 1)) / 2; // จำนวนคู่ที่ a > b (เสมอนับครึ่ง)
  const u2 = n1 * n2 - u1;
  const N = n1 + n2;
  const mu = (n1 * n2) / 2;
  const tieTerm = ties.reduce((s, t) => s + t ** 3 - t, 0);
  const variance = ((n1 * n2) / 12) * (N + 1 - tieTerm / (N * (N - 1)));
  const z = variance > 0 ? (u2 - mu) / Math.sqrt(variance) : NaN;

  let p;
  let method;
  if (N <= 60) {
    // นับทุกวิธีเลือก n1 ตัวจาก N ตัว แล้วดูผลรวมอันดับ (×2) ของกลุ่ม a
    const r2 = ranks.map((r) => Math.round(r * 2));
    const maxSum = r2.reduce((s, r) => s + r, 0);
    let dp = Array.from({ length: n1 + 1 }, () => new Float64Array(maxSum + 1));
    dp[0][0] = 1;
    for (const r of r2) {
      for (let k = n1; k >= 1; k--) {
        const row = dp[k];
        const prev = dp[k - 1];
        for (let s = maxSum; s >= r; s--) row[s] += prev[s - r];
      }
    }
    const counts = dp[n1];
    const totalWays = counts.reduce((s, c) => s + c, 0);
    const obs = Math.round(r1 * 2);
    let lower = 0;
    let upper = 0;
    for (let s = 0; s <= maxSum; s++) {
      if (s <= obs) lower += counts[s];
      if (s >= obs) upper += counts[s];
    }
    p = Math.min(1, (2 * Math.min(lower, upper)) / totalWays);
    method = "exact";
  } else {
    p = normalTwoSidedP(z);
    method = "normal";
  }
  return { n1, n2, u: Math.min(u1, u2), z, p, r: (u2 - u1) / (n1 * n2), method };
}

// ---------- paired t-test ----------
function pairedT(before, after) {
  const d = before.map((b, i) => after[i] - b).filter(Number.isFinite);
  const n = d.length;
  if (n < 2) return { n, meanDiff: NaN, t: NaN, df: NaN, p: NaN, dz: NaN };
  const m = mean(d);
  const s = sd(d);
  if (s === 0) return { n, meanDiff: m, t: NaN, df: n - 1, p: m === 0 ? 1 : 0, dz: NaN };
  const t = m / (s / Math.sqrt(n));
  return { n, meanDiff: m, t, df: n - 1, p: tTwoSidedP(t, n - 1), dz: m / s };
}

// ---------- Fisher's exact test ตาราง 2×2 [[a, b], [c, d]] ----------
function fisherExact(a, b, c, d) {
  const row1 = a + b;
  const col1 = a + c;
  const n = a + b + c + d;
  const logFact = (k) => logGamma(k + 1);
  const logP = (x) =>
    logFact(row1) + logFact(n - row1) + logFact(col1) + logFact(n - col1) -
    logFact(n) - logFact(x) - logFact(row1 - x) - logFact(col1 - x) - logFact(n - row1 - col1 + x);
  const observed = logP(a);
  let p = 0;
  for (let x = Math.max(0, row1 + col1 - n); x <= Math.min(row1, col1); x++) {
    const lp = logP(x);
    if (lp <= observed + 1e-7) p += Math.exp(lp);
  }
  return { p: Math.min(1, p), oddsRatio: b * c === 0 ? Infinity : (a * d) / (b * c) };
}

module.exports = {
  finite,
  mean,
  sd,
  quantile,
  describe,
  rank,
  spearman,
  wilcoxonSignedRank,
  mannWhitney,
  pairedT,
  fisherExact,
};
