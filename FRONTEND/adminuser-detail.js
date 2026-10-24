// ================== รายงานรายคน (adminuser-detail.html?userId=1) ==================
// ข้อมูลทั้งหมดมาจาก GET /api/admin/users/:id/report (ดู BACKEND/src/services/adminUserReport.js)
// เข้าหน้านี้จากปุ่มรูปกราฟในหน้า "จัดการผู้ใช้" หรือคลิกชื่อผู้ใช้ในการ์ดสถิติการอ่านของหน้าหลัก

const userId = Number(new URLSearchParams(location.search).get("userId"));
const num = (n) => Number(n || 0).toLocaleString("th-TH");

function minutesText(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h} ชม. ${m} น.` : `${m} นาที`;
}

function barList(items) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return items
    .map(
      (i) => `<li>
        <div class="ad-bar-top"><span>${escapeHtml(i.label)}</span><span class="ad-bar-value">${escapeHtml(i.note)}</span></div>
        <div class="ad-bar-track"><div class="ad-bar-fill" style="width:${Math.round((i.value / max) * 100)}%"></div></div>
      </li>`
    )
    .join("");
}

function renderProfile(p) {
  document.getElementById("udAvatar").textContent = p.username.slice(0, 1).toUpperCase();
  document.getElementById("udName").textContent = p.username;
  document.getElementById("udMeta").innerHTML =
    `สมัคร ${escapeHtml(p.registeredAt?.slice(0, 10) || "—")} · เข้าใช้ล่าสุด ${escapeHtml(p.lastActiveAt?.slice(0, 16) || "ยังไม่เคยเข้าใช้")}` +
    (p.researchConsent
      ? ` <span class="ud-consent">ยินยอมให้ใช้ข้อมูลวิจัย</span>`
      : ` <span class="ud-consent is-off">ไม่ยินยอมให้ใช้ข้อมูลวิจัย</span>`);
  document.getElementById("udNoConsent").hidden = p.researchConsent;

  const tiles = [
    ["วันที่เข้าใช้", `${num(p.activeDays)} วัน`, `อ่านติดกันนานสุด ${num(p.longestStreak)} วัน`],
    ["เวลาอ่านรวม", minutesText(p.readMinutes), `เฉลี่ย ${p.minutesPerActiveDay} นาทีต่อวันที่เข้าใช้`],
    [
      "บทที่ผ่าน",
      `${num(p.chaptersPassed)} / ${num(p.chaptersTotal)} บท`,
      p.avgPostPercent === null ? "ยังไม่มีคะแนนหลังอ่าน" : `หลังอ่านเฉลี่ย ${p.avgPostPercent}% (ผ่านที่ ${p.passScorePercent}%)`,
    ],
    ["รอบที่อ่านจบ", `${num(p.rounds)} รอบ`, `หยุดก่อนครบเวลา ${num(p.stoppedEarly)} รอบ`],
    ["คอยน์ตอนนี้", num(p.coinsNow), `ใช้ไปแล้ว ${num(p.coinsSpent)} คอยน์`],
  ];
  document.getElementById("udTiles").innerHTML = tiles
    .map(
      ([label, value, note]) => `<div class="stat-card ad-tile">
        <div class="ad-tile-head">${escapeHtml(label)}</div>
        <div class="stat-value">${escapeHtml(value)}</div>
        <span class="stat-note">${escapeHtml(note)}</span>
      </div>`
    )
    .join("");
}

// กราฟ ก่อน → หลังอ่าน: แถวละบท จุดซ้าย/ขวา = คะแนน 0-100%
function renderSlopes(chapters) {
  const box = document.getElementById("udSlopes");
  const scored = chapters.filter((c) => c.prePercent !== null || c.postPercent !== null);
  if (!scored.length) {
    box.innerHTML = '<p class="ad-empty">ยังไม่มีคะแนนแบบทดสอบของคนนี้</p>';
    return;
  }
  const x = (v) => 92 + v * 4.4;
  const rows = scored
    .map((c, i) => {
      const y = 34 + i * 38;
      const pre = c.prePercent ?? 0;
      const post = c.postPercent ?? 0;
      const gain = c.gain === null ? "" : `${c.gain >= 0 ? "+" : ""}${c.gain}`;
      return `
        <text x="0" y="${y + 5}" font-size="13" fill="#555">บทที่ ${c.chapter}</text>
        <line x1="${x(Math.min(pre, post))}" y1="${y}" x2="${x(Math.max(pre, post))}" y2="${y}"
              stroke="#C2D8A4" stroke-width="7" stroke-linecap="round"/>
        ${c.prePercent === null ? "" : `<circle cx="${x(pre)}" cy="${y}" r="7" fill="#D9714E"/>`}
        ${c.postPercent === null ? "" : `<circle cx="${x(post)}" cy="${y}" r="7" fill="#89B05D"/>`}
        <text x="${x(Math.max(pre, post)) + 14}" y="${y + 5}" font-size="12.5" font-weight="600"
              fill="${c.gain !== null && c.gain < 0 ? "#b35a3a" : "#4f6a2c"}">${escapeHtml(gain)}</text>`;
    })
    .join("");

  const gridY = 34 + scored.length * 38 - 20;
  const grid = [0, 25, 50, 75, 100]
    .map(
      (v) => `<line x1="${x(v)}" y1="14" x2="${x(v)}" y2="${gridY}" stroke="#EDE7D7" stroke-width="1"/>
               <text x="${x(v)}" y="${gridY + 18}" text-anchor="middle" font-size="11.5" fill="#8a8373">${v}%</text>`
    )
    .join("");

  box.innerHTML = `<svg viewBox="0 0 560 ${gridY + 30}" style="width:100%; height:${gridY + 30}px" role="img"
      aria-label="กราฟคะแนนก่อนอ่านและหลังอ่านของแต่ละบท">${grid}${rows}</svg>
    <div class="chart-legend">
      <span class="legend-item"><span class="legend-dot" style="background:#D9714E"></span>ก่อนอ่าน</span>
      <span class="legend-item"><span class="legend-dot" style="background:#89B05D"></span>หลังอ่าน</span>
    </div>`;
}

function renderReview(review) {
  document.getElementById("udReviewRing").style.setProperty("--value", review.masteredPercent);
  document.getElementById("udReviewPercent").textContent = `${review.masteredPercent}%`;
  document.getElementById("udReviewTitle").textContent = review.items
    ? `จำได้แล้ว ${num(review.mastered)} จาก ${num(review.items)} ข้อ`
    : "ยังไม่มีข้อที่เข้ารอบทบทวน";
  document.getElementById("udReviewDesc").textContent = review.items
    ? `ถึงรอบทบทวนตอนนี้ ${num(review.dueNow)} ข้อ · ตอบตอนถึงรอบถูก ${review.dueCorrectPercent}% (${num(review.dueAnswers)} ครั้ง)`
    : "ข้อจะเข้ารอบทบทวนหลังทำแบบทดสอบหลังอ่าน";

  document.getElementById("udIntervals").innerHTML = review.intervals.some((i) => i.answers)
    ? barList(
        review.intervals.map((i) => ({
          label: `เว้น ${i.days} วัน`,
          value: i.correctPercent,
          note: i.answers ? `ถูก ${i.correctPercent}% (${num(i.answers)} ครั้ง)` : "ยังไม่ถึงรอบ",
        }))
      )
    : '<p class="ad-empty">ยังไม่มีการตอบตอนถึงรอบทบทวน</p>';
}

function renderSessions(rows) {
  const table = document.getElementById("udSessions");
  if (!rows.length) {
    table.innerHTML = `<tbody><tr><td>${escapeHtml("ยังไม่มีรอบอ่านที่จบ")}</td></tr></tbody>`;
    return;
  }
  table.innerHTML = `<thead><tr>
      <th>เริ่มอ่าน</th><th>บท</th><th>ตั้งเวลา</th><th>อ่านจริง</th><th>หน้าที่เปิด</th><th>ผล</th>
    </tr></thead><tbody>${rows
      .map(
        (s) => `<tr>
          <td>${escapeHtml(s.startedAt.slice(5, 16))}</td>
          <td>บทที่ ${s.chapter}</td>
          <td>${s.plannedMinutes} น.</td>
          <td>${s.readMinutes} น.</td>
          <td>${s.pdfTotalPages ? `${num(s.pagesViewed)} / ${num(s.pdfTotalPages)}` : num(s.pagesViewed)}</td>
          <td><span class="ad-gain${s.stoppedEarly ? " is-down" : ""}">${s.stoppedEarly ? "หยุดก่อนครบ" : "อ่านครบเวลา"}</span></td>
        </tr>`
      )
      .join("")}</tbody>`;
}

function renderGameAndPet(game, pet, ai) {
  document.getElementById("udGameChip").textContent = `เล่นแล้ว ${num(game.plays)} ครั้ง · ชนะ ${num(game.wins)} ครั้ง`;
  document.getElementById("udWorlds").innerHTML = game.worlds.length
    ? barList(
        game.worlds.map((w) => ({
          label: `โลกที่ ${w.world} · ${w.title}`,
          value: w.cleared,
          note: `${w.cleared} / ${game.stagesPerWorld} ด่าน`,
        }))
      )
    : '<p class="ad-empty">ยังไม่มีโลกในเกม</p>';

  document.getElementById("udPet").textContent = pet
    ? `${pet.name} · เลเวล ${pet.level} · ความสุข ${pet.happiness}% · ดูแลฟรี ${num(pet.careFree)} ครั้ง · ใช้ไอเทม ${num(pet.careItem)} ครั้ง`
    : "ยังไม่ได้รับน้องหมา";

  document.getElementById("udAi").textContent = ai.questions
    ? `ถามไปแล้ว ${num(ai.questions)} ครั้ง` +
      (ai.busiestChapter ? ` · ถามตอนเปิดบทที่ ${ai.busiestChapter.chapter} มากที่สุด ${num(ai.busiestChapter.count)} ครั้ง` : "")
    : "ยังไม่เคยถาม AI";
}


// ---------- สรุปสถานะการเรียน (ธงจากข้อมูลการใช้งาน) ----------
function renderFlags(flags) {
  const list = document.getElementById("udFlagList");
  if (!flags.length) {
    list.innerHTML = `<div class="ud-flag is-ok">
      <span class="ud-flag-dot"></span>
      <span><strong>ยังไม่มีข้อมูลพอจะสรุป</strong><br>ยังไม่ได้อ่านหรือทำแบบทดสอบมากพอ</span>
    </div>`;
    return;
  }
  list.innerHTML = flags
    .map(
      (f) => `<div class="ud-flag is-${f.severity}">
        <span class="ud-flag-dot"></span>
        <span><strong>${escapeHtml(f.title)}</strong><br>${escapeHtml(f.detail)}</span>
      </div>`
    )
    .join("");
}

// ---------- ปฏิทินการอ่าน (84 วัน) ----------
const HEAT_COLORS = ["#EFE9D8", "#D7E4C0", "#A8C77C", "#6F9440"];
const HEAT_WEEKDAYS = ["จ.", "", "พ.", "", "ศ.", "", "อา."];

function renderHeatmap(days) {
  const level = (m) => (m === 0 ? 0 : m < 15 ? 1 : m < 40 ? 2 : 3);
  const cell = 18;
  const gap = 5;
  const left = 26;
  const top = 20;

  // คอลัมน์ = สัปดาห์ (เริ่มวันจันทร์) · แถว = วันในสัปดาห์
  const first = new Date(`${days[0].day}T00:00:00Z`);
  const offset = (first.getUTCDay() + 6) % 7;
  const squares = days
    .map((d, i) => {
      const idx = i + offset;
      const x = left + Math.floor(idx / 7) * (cell + gap);
      const y = top + (idx % 7) * (cell + gap);
      return `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="5" fill="${HEAT_COLORS[level(d.minutes)]}">
        <title>${escapeHtml(d.day)} · ${d.minutes ? `${d.minutes} นาที` : "ไม่ได้อ่าน"}</title></rect>`;
    })
    .join("");

  const labels = HEAT_WEEKDAYS.map((w, i) =>
    w ? `<text x="0" y="${top + i * (cell + gap) + 13}" font-size="12" fill="#8a8373">${w}</text>` : ""
  ).join("");

  // ป้ายเดือนที่คอลัมน์แรกของแต่ละเดือน
  const months = [];
  let lastMonth = null;
  days.forEach((d, i) => {
    const month = d.day.slice(0, 7);
    if (month === lastMonth) return;
    lastMonth = month;
    const x = left + Math.floor((i + offset) / 7) * (cell + gap);
    const name = new Date(`${d.day}T00:00:00Z`).toLocaleDateString("th-TH", { month: "short" });
    months.push(`<text x="${x}" y="12" font-size="12" fill="#8a8373">${escapeHtml(name)}</text>`);
  });

  const width = left + Math.ceil((days.length + offset) / 7) * (cell + gap) + 4;
  const legendY = top + 7 * (cell + gap) + 16;
  const legend =
    `<text x="${left}" y="${legendY + 11}" font-size="12" fill="#8a8373">น้อย</text>` +
    HEAT_COLORS.map(
      (c, i) => `<rect x="${left + 34 + i * 18}" y="${legendY}" width="13" height="13" rx="4" fill="${c}"/>`
    ).join("") +
    `<text x="${left + 34 + HEAT_COLORS.length * 18 + 5}" y="${legendY + 11}" font-size="12" fill="#8a8373">มาก</text>`;

  // สรุปใต้ปฏิทิน: อ่านไปกี่วัน ติดกันนานสุดกี่วัน และเฉลี่ยวันละกี่นาที (เฉพาะช่วง 12 สัปดาห์นี้)
  const readDays = days.filter((d) => d.minutes > 0);
  const totalMinutes = readDays.reduce((a, d) => a + d.minutes, 0);
  let streak = 0;
  let longest = 0;
  days.forEach((d) => {
    streak = d.minutes > 0 ? streak + 1 : 0;
    longest = Math.max(longest, streak);
  });
  const busiest = readDays.reduce((a, d) => (a && a.minutes >= d.minutes ? a : d), null);

  const stats = [
    ["วันที่อ่าน", `${num(readDays.length)} / ${num(days.length)} วัน`],
    ["อ่านติดกันนานสุด", `${num(longest)} วัน`],
    ["เฉลี่ยต่อวันที่อ่าน", readDays.length ? `${Math.round(totalMinutes / readDays.length)} นาที` : "—"],
    ["อ่านมากที่สุด", busiest ? `${num(busiest.minutes)} นาที (${busiest.day.slice(5)})` : "—"],
  ];

  document.getElementById("udHeatmap").innerHTML = `<svg viewBox="0 0 ${width} ${legendY + 18}"
    style="display:block; margin:0 auto; width:100%; max-width:${width * 1.5}px; height:auto" role="img" aria-label="ปฏิทินแสดงวันที่อ่านย้อนหลัง 12 สัปดาห์">
    ${months.join("")}${labels}${squares}${legend}</svg>
    <ul class="ud-cal-stats">${stats
      .map((s) => `<li><span>${escapeHtml(s[0])}</span><strong>${escapeHtml(s[1])}</strong></li>`)
      .join("")}</ul>`;
}

// ---------- หกเหลี่ยมความแม่นรายบท ----------
function renderRadar(accuracy) {
  const box = document.getElementById("udRadar");
  const answered = accuracy.filter((a) => a.percent !== null);
  if (answered.length < 3) {
    box.innerHTML = '<p class="ad-empty">ยังตอบคำถามไม่พอจะวาดกราฟ (ต้องมีอย่างน้อย 3 บท)</p>';
    return;
  }

  const cx = 180;
  const cy = 160;
  const R = 105;
  const n = accuracy.length;
  const point = (i, value) => {
    const a = (Math.PI / 180) * ((360 / n) * i - 90);
    const r = (value / 100) * R;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  };
  const poly = (values) =>
    values.map((v, i) => point(i, v ?? 0).map((x) => Math.round(x)).join(",")).join(" ");

  const rings = [25, 50, 75, 100]
    .map((v) => `<polygon points="${poly(new Array(n).fill(v))}" fill="none" stroke="#EDE7D7" stroke-width="1.5"/>`)
    .join("");
  const spokes = accuracy
    .map((_, i) => {
      const [x, y] = point(i, 100);
      return `<line x1="${cx}" y1="${cy}" x2="${Math.round(x)}" y2="${Math.round(y)}" stroke="#EDE7D7" stroke-width="1.5"/>`;
    })
    .join("");

  const labels = accuracy
    .map((a, i) => {
      const [lx, ly] = point(i, 132);
      const anchor = Math.abs(lx - cx) < 12 ? "middle" : lx > cx ? "start" : "end";
      const thin = a.answers > 0 && a.answers < 5;
      const color = a.percent === null ? "#aaa" : "#7a7466";
      const value =
        a.percent === null ? "ยังไม่ตอบ" : `${a.percent}% (${a.answers} ข้อ)${thin ? " · ข้อมูลน้อย" : ""}`;
      return `<text x="${Math.round(lx)}" y="${Math.round(ly)}" text-anchor="${anchor}" font-size="12.5" font-weight="600" fill="#555">บทที่ ${a.chapter}</text>
        <text x="${Math.round(lx)}" y="${Math.round(ly) + 15}" text-anchor="${anchor}" font-size="11.5" fill="${color}">${escapeHtml(value)}</text>`;
    })
    .join("");

  const dots = accuracy
    .map((a, i) => {
      if (a.percent === null) return "";
      const [x, y] = point(i, a.percent);
      const thin = a.answers < 5;
      return `<circle cx="${Math.round(x)}" cy="${Math.round(y)}" r="5" fill="#E38A4D" opacity="${thin ? 0.45 : 1}"/>`;
    })
    .join("");

  box.innerHTML = `<svg viewBox="0 0 360 340" style="width:100%; height:340px" role="img"
      aria-label="กราฟหกเหลี่ยมความแม่นรายบท เทียบกับค่าเฉลี่ยของทุกคน">
      ${rings}${spokes}
      <polygon points="${poly(accuracy.map((a) => a.percent))}" fill="rgba(246,188,84,.45)" stroke="#E38A4D" stroke-width="3"/>
      ${dots}${labels}
    </svg>
    <p class="ad-sub" style="margin:4px 0 0">ตัวเลขใต้ชื่อบท = ตอบถูกกี่ % จากที่ตอบไปทั้งหมดของบทนั้น</p>`;
}

// ---------- จุดที่อ่อนที่สุด: บทที่แม่นน้อยสุด + ข้อที่ตอบผิดบ่อย ----------
function renderWeakSpots(accuracy, weakSpots) {
  const lead = document.getElementById("udWeakLead");
  const list = document.getElementById("udWeakList");
  const summary = document.getElementById("udWeakSummary");

  // บทที่อ่อนที่สุด = ความแม่นต่ำสุดในบทที่ตอบไปแล้วอย่างน้อย 5 ข้อ
  const scored = accuracy.filter((a) => a.percent !== null && a.answers >= 5);
  if (scored.length) {
    const weakest = scored.reduce((a, c) => (c.percent < a.percent ? c : a));
    lead.innerHTML =
      `อ่อนที่สุดคือ <strong>บทที่ ${weakest.chapter} ${escapeHtml(weakest.title)}</strong> — ` +
      `ตอบถูก ${weakest.percent}% จาก ${num(weakest.answers)} ข้อที่ตอบไป`;
    summary.textContent = `บทที่ ${weakest.chapter} ${weakest.title} · ตอบถูก ${weakest.percent}%`;
  } else {
    lead.textContent = "ยังตอบคำถามไม่พอจะบอกว่าอ่อนบทไหน (ต้องมีอย่างน้อย 5 ข้อในบทนั้น)";
    summary.textContent = "ยังมีข้อมูลไม่พอ";
  }

  list.innerHTML = weakSpots.length
    ? weakSpots
        .map(
          (w) => `<li>
            <span class="ud-weak-q">${escapeHtml(w.question)}</span>
            <span class="ud-weak-meta">บทที่ ${w.chapter} · ตอบผิด ${num(w.wrong)} จาก ${num(w.asked)} ครั้ง${
              w.mastered ? " · ตอนนี้จำได้แล้ว" : ""
            }</span>
          </li>`
        )
        .join("")
    : '<li class="ud-weak-empty">ยังไม่มีข้อที่ตอบผิดซ้ำ</li>';
}

// ---------- ความคืบหน้ารายสัปดาห์ ----------
function renderWeekly(weeks) {
  const box = document.getElementById("udWeekly");
  if (!weeks.some((w) => w.readMinutes || w.postPercent !== null)) {
    box.innerHTML = '<p class="ad-empty">ยังไม่มีการอ่านใน 8 สัปดาห์ล่าสุด</p>';
    return;
  }
  const maxMinutes = Math.max(30, ...weeks.map((w) => w.readMinutes));
  const w = 900;
  const base = 180;
  const height = 150;
  const step = (w - 80) / weeks.length;

  const bars = weeks
    .map((week, i) => {
      const x = 50 + i * step;
      const h = Math.round((week.readMinutes / maxMinutes) * height);
      const label = new Date(`${week.weekStart}T00:00:00Z`).toLocaleDateString("th-TH", { day: "numeric", month: "short" });
      return `<rect x="${Math.round(x)}" y="${base - h}" width="${Math.round(step * 0.4)}" height="${h}" rx="6" fill="#C2D8A4">
          <title>${escapeHtml(label)} · ${week.readMinutes} นาที · ${week.rounds} รอบ</title></rect>
        <text x="${Math.round(x + step * 0.2)}" y="${base + 20}" text-anchor="middle" font-size="11.5" fill="#7a7466">${escapeHtml(label)}</text>`;
    })
    .join("");

  const scored = weeks
    .map((week, i) => (week.postPercent === null ? null : { i, y: base - (week.postPercent / 100) * height }))
    .filter(Boolean);
  const line = scored.length
    ? `<polyline points="${scored
        .map((s) => `${Math.round(50 + s.i * step + step * 0.2)},${Math.round(s.y)}`)
        .join(" ")}" fill="none" stroke="#E38A4D" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>` +
      scored
        .map(
          (s) =>
            `<circle cx="${Math.round(50 + s.i * step + step * 0.2)}" cy="${Math.round(s.y)}" r="4.5" fill="#E38A4D">
              <title>หลังอ่านเฉลี่ย ${weeks[s.i].postPercent}%</title></circle>`
        )
        .join("")
    : "";

  box.innerHTML = `<svg viewBox="0 0 ${w} 210" style="width:100%; height:210px" role="img" aria-label="กราฟความคืบหน้ารายสัปดาห์">
      <line x1="40" y1="30" x2="${w - 20}" y2="30" stroke="#EDE7D7" stroke-width="1"/>
      <line x1="40" y1="105" x2="${w - 20}" y2="105" stroke="#EDE7D7" stroke-width="1"/>
      <line x1="40" y1="${base}" x2="${w - 20}" y2="${base}" stroke="#D8D1BE" stroke-width="1.5"/>
      <text x="34" y="34" text-anchor="end" font-size="11.5" fill="#8a8373">${maxMinutes} น.</text>
      <text x="34" y="${base + 4}" text-anchor="end" font-size="11.5" fill="#8a8373">0</text>
      ${bars}${line}
    </svg>
    <div class="chart-legend">
      <span class="legend-item"><span class="legend-dot" style="background:#C2D8A4"></span>เวลาอ่าน (นาที)</span>
      <span class="legend-item"><span class="legend-dot" style="background:#E38A4D"></span>คะแนนหลังอ่านเฉลี่ย</span>
    </div>`;
}

// ---------- ฟีดแบ็กถึงนิสิต ----------
// รายการเดียวกันมีทั้งข้อความของเราและคำตอบของนิสิต (sender = admin | student)
function renderFeedback(items) {
  const list = document.getElementById("udFeedbackList");
  list.innerHTML = items.length
    ? items
        .map((f) => {
          const fromStudent = f.sender === "student";
          const who = fromStudent ? "นิสิตตอบกลับ" : `โดย ${escapeHtml(f.admin_name || "แอดมิน")}`;
          return `<li class="${fromStudent ? "is-reply" : ""}">
            <div class="ud-fb-head">
              <span>${escapeHtml(f.created_at?.slice(0, 16) || "")} · ${who}</span>
              <button type="button" class="ud-fb-del" data-id="${f.id}" aria-label="ลบข้อความนี้">ลบ</button>
            </div>
            <p>${escapeHtml(f.message)}</p>
          </li>`;
        })
        .join("")
    : '<li class="ud-fb-empty">ยังไม่เคยส่งฟีดแบ็กถึงคนนี้</li>';
}

async function sendFeedback(e) {
  e.preventDefault();
  const input = document.getElementById("udFeedbackText");
  const btn = document.getElementById("udFeedbackSend");
  const message = input.value.trim();
  if (!message) return;
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = "กำลังส่ง...";
  try {
    const { feedback } = await adminApiFetch(`/admin/users/${userId}/feedback`, {
      method: "POST",
      body: JSON.stringify({ message }),
    });
    input.value = "";
    document.getElementById("udFeedbackCount").textContent = "0 ตัวอักษร";
    currentFeedback = [feedback, ...currentFeedback];
    renderFeedback(currentFeedback);
  } catch (err) {
    alert("ส่งไม่สำเร็จ: " + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

async function deleteFeedback(id) {
  if (!confirm("ลบข้อความนี้? ทั้งสองฝ่ายจะไม่เห็นข้อความนี้อีก")) return;
  try {
    await adminApiFetch(`/admin/feedback/${id}`, { method: "DELETE" });
    currentFeedback = currentFeedback.filter((f) => f.id !== id);
    renderFeedback(currentFeedback);
  } catch (err) {
    alert("ลบไม่สำเร็จ: " + err.message);
  }
}

let currentFeedback = [];

function openWeakModal() {
  document.getElementById("udWeakModal").classList.add("active");
}

function closeWeakModal() {
  document.getElementById("udWeakModal").classList.remove("active");
}

function openFeedbackModal() {
  document.getElementById("udFeedbackWho").textContent = document.getElementById("udName").textContent;
  document.getElementById("udFeedbackModal").classList.add("active");
  document.getElementById("udFeedbackText").focus();
}

function closeFeedbackModal() {
  document.getElementById("udFeedbackModal").classList.remove("active");
}

async function loadReport() {
  if (!userId) {
    document.getElementById("udName").textContent = "ไม่พบผู้ใช้ที่ต้องการดู";
    document.getElementById("udMeta").innerHTML = '<a href="adminuser.html">กลับหน้าจัดการผู้ใช้</a>';
    return;
  }
  try {
    const data = await adminApiFetch(`/admin/users/${userId}/report`);
    renderProfile({ ...data.profile, coinsSpent: data.shop.coinsSpent });
    renderFlags(data.flags || []);
    renderHeatmap(data.heatmap || []);
    renderRadar(data.accuracy || []);
    renderWeakSpots(data.accuracy || [], data.weakSpots || []);
    renderWeekly(data.weekly || []);
    currentFeedback = data.feedback || [];
    renderFeedback(currentFeedback);
    renderSlopes(data.chapters);
    renderReview(data.review);
    renderSessions(data.sessions);
    renderGameAndPet(data.game, data.pet, data.ai);
    document.getElementById("udUpdated").textContent = `ดูข้อมูล ณ ${new Date().toLocaleString("th-TH", {
      dateStyle: "long",
      timeStyle: "short",
    })} น.`;
  } catch (err) {
    document.getElementById("udName").textContent = "โหลดข้อมูลไม่สำเร็จ";
    document.getElementById("udMeta").textContent = err.message;
  }
}

// CSV ของคนนี้: กรองไฟล์ "รายคน" ให้เหลือแถวของผู้ใช้คนนี้ (ใช้ข้อมูลชุดเดียวกับไฟล์วิจัย)
async function downloadCsv() {
  const btn = document.getElementById("udCsv");
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = "กำลังเตรียมไฟล์...";
  try {
    const { columns, rows } = await adminApiFetch("/admin/export/users/data");
    const name = document.getElementById("udName").textContent;
    const mine = rows.filter((r) => r.username === name);
    if (!mine.length) throw new Error("ผู้ใช้คนนี้ไม่อยู่ในข้อมูลวิจัย (อาจยังไม่ยินยอม)");
    const escape = (v) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = "﻿" + [columns.join(","), ...mine.map((r) => columns.map((c) => escape(r[c])).join(","))].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `reading-buddy-${name}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  if (!getAdminToken()) return; // adminAuth.js จะเด้งไป login ให้แล้ว
  document.getElementById("udPrint").addEventListener("click", () => window.print());
  document.getElementById("udCsv").addEventListener("click", downloadCsv);
  document.getElementById("udWeakOpen").addEventListener("click", openWeakModal);
  document.getElementById("udWeakClose").addEventListener("click", closeWeakModal);
  document.getElementById("udWeakModal").addEventListener("click", (e) => {
    if (e.target.id === "udWeakModal") closeWeakModal(); // คลิกพื้นหลัง = ปิด
  });
  document.getElementById("udFeedbackOpen").addEventListener("click", openFeedbackModal);
  document.getElementById("udFeedbackClose").addEventListener("click", closeFeedbackModal);
  document.getElementById("udFeedbackModal").addEventListener("click", (e) => {
    if (e.target.id === "udFeedbackModal") closeFeedbackModal(); // คลิกพื้นหลัง = ปิด
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    closeFeedbackModal();
    closeWeakModal();
  });
  document.getElementById("udFeedbackForm").addEventListener("submit", sendFeedback);
  document.getElementById("udFeedbackText").addEventListener("input", (e) => {
    document.getElementById("udFeedbackCount").textContent = `${num(e.target.value.length)} ตัวอักษร`;
  });
  document.getElementById("udFeedbackList").addEventListener("click", (e) => {
    const btn = e.target.closest(".ud-fb-del");
    if (btn) deleteFeedback(Number(btn.dataset.id));
  });
  loadReport();
});
