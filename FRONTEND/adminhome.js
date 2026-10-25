// ================== สถิติทั้งหมดของหน้าแอดมินหลัก ==================
// ข้อมูลทุกส่วนมาจาก GET /api/admin/stats/dashboard?range=7|30 (ดู BACKEND/src/services/adminDashboard.js)
// ไฟล์นี้ใช้ทั้งหน้าหลัก (adminhome.html) และหน้าข้อมูลนิสิต (adminstudent.html)
// การ์ดถูกแบ่งไปคนละหน้า ฟังก์ชันวาดการ์ดจึงเช็กก่อนว่าหน้านี้มีการ์ดนั้นไหม ถ้าไม่มีก็ข้าม
const AD_COLORS = {
  users: "#D9714E",
  reading: "#8DB754",
  game: "#F0B23D",
  ai: "#9AA08F",
  grid: "rgba(0,0,0,0.08)",
};
const AD_DONUT_COLORS = ["#8DB754", "#F0B23D", "#D9714E", "#C2D8A4", "#9AA08F", "#E0C36B", "#B6CE8E"];
const THAI_WEEKDAYS = ["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."];
const PET_ACTION_COLORS = {
  visit: "#9AA08F",
  pet: "#8DB754",
  feed: "#F0B23D",
  bath: "#7FA8C9",
  happiness: "#D9714E",
  sleep: "#9B86BD",
};
const PET_ACTION_LABELS = {
  visit: "เปิดหน้าน้องหมา",
  pet: "ลูบหัว / เล่นด้วย (ฟรี)",
  feed: "ให้อาหาร",
  bath: "อาบน้ำ",
  happiness: "ของเล่นเพิ่มความสุข",
  sleep: "พาไปนอน",
};

let adRange = 30;
let adReaders = []; // เก็บไว้กรองตอนพิมพ์ค้นหา
const adCharts = {}; // เก็บกราฟไว้ทำลายก่อนวาดใหม่ตอนเปลี่ยนช่วงเวลา

const num = (n) => Number(n || 0).toLocaleString("th-TH");

// 7 วัน = ชื่อวัน, 30 วัน = วัน/เดือน (ไม่งั้นชื่อวันซ้ำกันจนอ่านไม่ออก)
function adDayLabel(day) {
  const d = new Date(`${day}T00:00:00`);
  return adRange === 7 ? THAI_WEEKDAYS[d.getDay()] : `${d.getDate()}/${d.getMonth() + 1}`;
}

function adLine(ctx, labels, datasets) {
  return new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: datasets.map((d) => ({ ...d, tension: 0.35, pointRadius: 0, borderWidth: 2.5, fill: false })),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, grid: { color: AD_COLORS.grid }, ticks: { precision: 0 } },
        x: { grid: { display: false } },
      },
    },
  });
}

function adBars(items) {
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

function adEmpty(text) {
  return `<p class="ad-empty">${escapeHtml(text)}</p>`;
}

// ---------- การ์ดสรุปด้านบน ----------
// หน้าหลักมีป้ายครบ 5 ใบ ส่วนหน้าข้อมูลนิสิตมีแค่ใบจำนวนนิสิต — ใบที่ไม่มีก็ข้ามไปเงียบๆ
function setTileText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function renderTiles(t) {
  setTileText("statTotalUsers", num(t.users.total));
  renderUsersTrend(t.users.changePercent, t.users.newSinceLastMonth);

  setTileText("statChapters", num(t.chapters.total));
  setTileText("statChaptersNote", `มีมินิเกม ${num(t.chapters.withGame)} บท`);

  setTileText("statStages", num(t.game.stages));
  setTileText("statStagesNote", `${num(t.game.worlds)} โลก · เล่นไปแล้ว ${num(t.game.battles)} ครั้ง`);

  setTileText("statCoins", num(t.coins.inCirculation));
  const coinPill = document.getElementById("statCoinsTrend");
  if (!coinPill) {
    /* หน้านี้ไม่มีป้ายคอยน์ */
  } else if (t.coins.changePercent === null || t.coins.changePercent === undefined) {
    coinPill.textContent = `เดือนนี้แจกไป ${num(t.coins.thisMonth)} คอยน์`;
    coinPill.className = "trend-pill";
  } else {
    const up = t.coins.changePercent >= 0;
    coinPill.textContent = `${up ? "มากกว่า" : "น้อยกว่า"}เดือนที่แล้ว ${Math.abs(t.coins.changePercent)}% ${up ? "📈" : "📉"}`;
    coinPill.className = `trend-pill ${up ? "trend-up" : "trend-down"}`;
  }

  setTileText("statCoupons", num(t.coupons.issued));
  setTileText("statCouponsNote", `มูลค่ารวม ${num(t.coupons.baht)} บาท`);
}

// อัปเดต pill "มากกว่าเดือนที่แล้ว X%" ให้เป็นตัวเลขจริงจาก backend
// - percent = null → ไม่มี baseline (เดือนที่แล้ว 0 user) → โชว์เป็นจำนวน user ใหม่แทน
function renderUsersTrend(percent, newSince) {
  const pill = document.getElementById("statUsersTrend");
  if (!pill) return;
  if (percent === null || percent === undefined) {
    pill.textContent = newSince > 0 ? `+${newSince} คนใหม่เดือนนี้ 📈` : "ยังไม่มี user 🐾";
    pill.className = "trend-pill";
  } else if (percent > 0) {
    pill.textContent = `มากกว่าเดือนที่แล้ว ${percent}% 📈`;
    pill.className = "trend-pill trend-up";
  } else if (percent < 0) {
    pill.textContent = `น้อยกว่าเดือนที่แล้ว ${Math.abs(percent)}% 📉`;
    pill.className = "trend-pill trend-down";
  } else {
    pill.textContent = "เท่ากับเดือนที่แล้ว 🟰";
    pill.className = "trend-pill";
  }
}

// ---------- แนวโน้มการใช้งาน ----------
function renderTrend(rows) {
  const canvas = document.getElementById("adTrendChart");
  if (!canvas || typeof Chart === "undefined") return;
  adCharts.trend?.destroy();
  adCharts.trend = adLine(
    canvas,
    rows.map((r) => adDayLabel(r.day)),
    [
      { label: "ผู้ใช้ที่ใช้งาน", data: rows.map((r) => r.activeUsers), borderColor: AD_COLORS.users },
      { label: "รอบอ่านที่จบ", data: rows.map((r) => r.readings), borderColor: AD_COLORS.reading },
      { label: "ด่านมินิเกม", data: rows.map((r) => r.battles), borderColor: AD_COLORS.game },
      { label: "ถาม AI", data: rows.map((r) => r.aiQuestions), borderColor: AD_COLORS.ai },
    ]
  );
}

// ---------- สัดส่วนการอ่านรายบท ----------
function renderChapterShare(share) {
  if (!document.getElementById("adChapterTotal")) return;
  document.getElementById("adChapterTotal").textContent = num(share.total);
  const legend = document.getElementById("adChapterLegend");
  const canvas = document.getElementById("adChapterChart");
  adCharts.chapter?.destroy();

  if (!share.items.length) {
    legend.innerHTML = adEmpty("ยังไม่มีรอบอ่านที่จบในช่วงนี้");
    return;
  }
  legend.innerHTML = share.items
    .map(
      (it, i) => `<li>
        <span class="ad-dot" style="background:${AD_DONUT_COLORS[i % AD_DONUT_COLORS.length]}"></span>
        <span class="ad-legend-name">บทที่ ${it.chapter} · ${escapeHtml(it.title)}</span>
        <span class="ad-legend-value">${it.percent}%</span>
      </li>`
    )
    .join("");

  if (!canvas || typeof Chart === "undefined") return;
  adCharts.chapter = new Chart(canvas, {
    type: "doughnut",
    data: {
      labels: share.items.map((it) => `บทที่ ${it.chapter}`),
      datasets: [
        {
          data: share.items.map((it) => it.sessions),
          backgroundColor: share.items.map((_, i) => AD_DONUT_COLORS[i % AD_DONUT_COLORS.length]),
          borderWidth: 0,
        },
      ],
    },
    options: { responsive: true, maintainAspectRatio: false, cutout: "68%", plugins: { legend: { display: false } } },
  });
}

// ---------- ภาพรวมน้องหมา ----------
function renderPet(pet) {
  if (!document.getElementById("adPetRing")) return;
  document.getElementById("adPetRing").style.setProperty("--value", pet.happiness);
  document.getElementById("adPetHappiness").textContent = `${pet.happiness}%`;
  document.getElementById("adPetTitle").textContent = `ความสุขเฉลี่ย ${pet.happiness}%`;
  document.getElementById("adPetDesc").textContent = pet.pets
    ? `น้องหมา ${num(pet.pets)} ตัว · เลเวลเฉลี่ย ${pet.avgLevel} (สูงสุด ${pet.topLevel}) · อิ่ม ${pet.hunger}% สะอาด ${pet.cleanliness}% พลัง ${pet.energy}%`
    : "ยังไม่มีผู้ใช้รับน้องหมา";

  const recent = document.getElementById("adPetRecent");
  recent.innerHTML = pet.recent.length
    ? pet.recent
        .map(
          (r) => `<li>
            <span class="ad-dot" style="background:${PET_ACTION_COLORS[r.action] || "#9AA08F"}"></span>
            <span class="ad-legend-name">${escapeHtml(PET_ACTION_LABELS[r.action] || r.action)}</span>
            <span class="ad-legend-value">${escapeHtml(adAgo(r.minutesAgo))}</span>
          </li>`
        )
        .join("")
    : adEmpty("ยังไม่มีการดูแลน้องหมา");
}

// "2 ชม. ที่แล้ว" / "5 นาทีที่แล้ว" / "3 วันที่แล้ว"
function adAgo(minutes) {
  if (minutes < 1) return "เมื่อครู่นี้";
  if (minutes < 60) return `${minutes} นาทีที่แล้ว`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ชม. ที่แล้ว`;
  return `${Math.round(hours / 24)} วันที่แล้ว`;
}

// ---------- อันดับผู้ใช้ที่อ่านมากที่สุด ----------
function renderTopReaders(rows) {
  adReaders = rows;
  drawTopReaders();
}

function drawTopReaders() {
  if (!document.getElementById("adTopReaders")) return;
  const query = (document.getElementById("adReaderSearch")?.value || "").trim().toLowerCase();
  const rows = query ? adReaders.filter((r) => r.username.toLowerCase().includes(query)) : adReaders;
  const table = document.getElementById("adTopReaders");
  if (!rows.length) {
    table.innerHTML = `<tbody><tr><td>${escapeHtml(
      query ? `ไม่พบผู้ใช้ที่ตรงกับ “${query}”` : "ยังไม่มีใครอ่านจบสักรอบ"
    )}</td></tr></tbody>`;
    return;
  }
  table.innerHTML = `<thead><tr>
      <th>ผู้ใช้</th><th>เวลาอ่าน</th><th>จำนวนรอบ</th><th>ก่อน → หลัง</th><th>คอยน์</th>
    </tr></thead><tbody>${rows
      .map((r) => {
        const hours = Math.floor(r.readMinutes / 60);
        const mins = r.readMinutes % 60;
        const score = r.prePercent === null ? "—" : `${r.prePercent} → ${r.postPercent}`;
        return `<tr>
          <td><span class="ad-rank${r.rank <= 3 ? ` is-top${r.rank}` : ""}">${r.rank}</span>${
            r.id ? `<a href="adminuser-detail.html?userId=${r.id}" class="ad-user-link">${escapeHtml(r.username)}</a>` : escapeHtml(r.username)
          }</td>
          <td>${hours ? `${hours} ชม. ` : ""}${mins} น.</td>
          <td>${num(r.sessions)}</td>
          <td>${escapeHtml(score)}</td>
          <td>${num(r.coins)}</td>
        </tr>`;
      })
      .join("")}</tbody>`;
}

// ---------- เวลาอ่านและจำนวนรอบ 7 วัน ----------
function renderReadingByDay(rows) {
  const canvas = document.getElementById("adReadingChart");
  if (!canvas || typeof Chart === "undefined") return;
  adCharts.reading?.destroy();
  adCharts.reading = new Chart(canvas, {
    type: "bar",
    data: {
      labels: rows.map((r) => THAI_WEEKDAYS[new Date(`${r.day}T00:00:00`).getDay()]),
      datasets: [
        { label: "เวลาอ่าน (ชม.)", data: rows.map((r) => r.hours), backgroundColor: AD_COLORS.reading, borderRadius: 6, yAxisID: "y" },
        { label: "รอบอ่าน (ครั้ง)", data: rows.map((r) => r.sessions), backgroundColor: AD_COLORS.game, borderRadius: 6, yAxisID: "y1" },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, grid: { color: AD_COLORS.grid } },
        y1: { beginAtZero: true, position: "right", grid: { display: false }, ticks: { precision: 0 } },
        x: { grid: { display: false } },
      },
    },
  });
}

// ---------- สถิติการทบทวน ----------
function renderReview(review) {
  if (!document.getElementById("adReviewRing")) return;
  document.getElementById("adReviewRing").style.setProperty("--value", review.masteredPercent);
  document.getElementById("adReviewPercent").textContent = `${review.masteredPercent}%`;
  document.getElementById("adReviewDesc").textContent = review.items
    ? `จำได้แล้ว ${num(review.mastered)} จาก ${num(review.items)} ข้อ · ถึงรอบทบทวนตอนนี้ ${num(review.dueNow)} ข้อ · ตอบตอนถึงรอบถูก ${review.dueCorrectPercent}% (${num(review.dueAnswers)} ครั้ง)`
    : "ยังไม่มีข้อที่เข้ารอบทบทวน";

  const trend = document.getElementById("adReviewTrend");
  const t = review.trend;
  if (t && t.changePoints !== null && t.changePoints !== undefined) {
    const up = t.changePoints >= 0;
    trend.hidden = false;
    trend.className = `ad-trend-line${up ? "" : " is-down"}`;
    trend.textContent = `ตอบถูกตอนถึงรอบเดือนนี้ ${t.thisMonthPercent}% (${up ? "▲ +" : "▼ "}${Math.abs(
      t.changePoints
    )} จุด จากเดือนที่แล้ว)`;
  } else if (t && t.answers) {
    trend.hidden = false;
    trend.className = "ad-trend-line";
    trend.textContent = `ตอบถูกตอนถึงรอบเดือนนี้ ${t.thisMonthPercent}% (${num(t.answers)} ครั้ง)`;
  } else {
    trend.hidden = true;
  }

  const topics = document.getElementById("adReviewTopics");
  topics.innerHTML = review.topics.length
    ? adBars(
        review.topics.map((t) => ({
          label: t.title,
          value: t.count,
          note: `${num(t.count)} ครั้ง · ถูก ${t.correctPercent}%`,
        }))
      )
    : adEmpty("ยังไม่มีการทบทวน");
}

// ---------- ผลลัพธ์การเรียนรู้รายบท ----------
function renderLearning(rows) {
  const table = document.getElementById("adLearning");
  if (!table) return;
  if (!rows.length) {
    table.innerHTML = `<tbody><tr><td>${escapeHtml("ยังไม่มีใครทำแบบทดสอบจบสักบท")}</td></tr></tbody>`;
    return;
  }
  table.innerHTML = `<thead><tr>
      <th>บทเรียน</th><th>ทำแล้ว</th><th>ก่อนอ่าน</th><th>หลังอ่าน</th><th>พัฒนาขึ้น</th>
    </tr></thead><tbody>${rows
      .map(
        (r) => `<tr>
          <td>บทที่ ${r.chapter}<span class="ad-cell-sub">${escapeHtml(r.title)}</span></td>
          <td>${num(r.tests)} คน</td>
          <td>${r.pre}</td>
          <td>${r.post}</td>
          <td><span class="ad-gain${r.gain < 0 ? " is-down" : ""}">${r.gain >= 0 ? "+" : ""}${r.gain}%</span></td>
        </tr>`
      )
      .join("")}</tbody>`;
}

// ---------- การใช้ AI ----------
function renderAi(ai) {
  if (!document.getElementById("adAiQuestions")) return;
  document.getElementById("adAiQuestions").textContent = num(ai.questions);
  document.getElementById("adAiUsers").textContent = num(ai.users);
  const list = document.getElementById("adAiTop");
  list.innerHTML = ai.top.length
    ? ai.top
        .map(
          (t) => `<li><span class="ad-q" title="${escapeHtml(t.question)}">${escapeHtml(t.question)}</span>
            <span class="ad-count">${num(t.count)}</span></li>`
        )
        .join("")
    : adEmpty("ยังไม่มีคำถามในช่วงนี้");

  const advice = [];
  if (ai.busiestChapter) {
    advice.push([
      "บทที่ถูกถามมากที่สุด",
      `บทที่ ${ai.busiestChapter.chapter} ${ai.busiestChapter.title} ${num(ai.busiestChapter.count)} ครั้ง`,
    ]);
  }
  if (ai.advice?.weakTopic) {
    const w = ai.advice.weakTopic;
    advice.push([
      "บทที่ตอบผิดบ่อยตอนทบทวน",
      `บทที่ ${w.chapter} ${w.title} ตอบถูก ${w.correctPercent}% จาก ${num(w.answers)} ครั้ง`,
    ]);
  }
  if (ai.advice?.busyHour) {
    const h = ai.advice.busyHour;
    advice.push(["ช่วงเวลาที่ถามเยอะที่สุด", `${String(h.hour).padStart(2, "0")}:00–${String(h.hour + 1).padStart(2, "0")}:00 น. ${num(h.count)} ครั้ง`]);
  }
  const box = document.getElementById("adAiAdvice");
  box.innerHTML = advice.length
    ? advice.map(([title, text]) => `<li><strong>${escapeHtml(title)}</strong><span>${escapeHtml(text)}</span></li>`).join("")
    : adEmpty("ยังไม่มีข้อมูลพอจะสรุป");
}

// ---------- นิสิตที่ควรดูแล ----------
function renderAtRisk(atRisk) {
  const chip = document.getElementById("adRiskChip");
  if (!chip) return;
  const table = document.getElementById("adRiskTable");
  const note = document.getElementById("adRiskNote");
  const c = atRisk.criteria;

  note.textContent =
    `เกณฑ์ที่ใช้: หลังอ่านเฉลี่ยต่ำกว่า ${c.lowPostPercent}% · ทำแบบทดสอบหลังอ่านไม่ผ่านตั้งแต่ ${c.failTries} ครั้งในบทเดียว · ` +
    `ไม่ได้อ่านเกิน ${c.quietDays} วัน · หยุดก่อนครบเวลาเกินครึ่งของรอบที่อ่าน (อย่างน้อย ${c.minRounds} รอบ) · ค้างรอบทบทวนตั้งแต่ ${c.dueItems} ข้อ`;

  if (!atRisk.users.length) {
    chip.textContent = `ไม่มีใครติดธง (${num(atRisk.total)} คน)`;
    table.innerHTML = `<tbody><tr><td>${escapeHtml("ยังไม่มีนิสิตที่เข้าเกณฑ์ — ดีมาก")}</td></tr></tbody>`;
    return;
  }
  chip.textContent = `${num(atRisk.users.length)} จาก ${num(atRisk.total)} คน`;
  table.innerHTML = `<thead><tr>
      <th>นิสิต</th><th>เหตุที่ติดธง</th><th>หลังอ่านเฉลี่ย</th><th>อ่านล่าสุด</th><th></th>
    </tr></thead><tbody>${atRisk.users
      .map(
        (u) => `<tr>
          <td><a href="adminuser-detail.html?userId=${u.id}" class="ad-user-link">${escapeHtml(u.username)}</a></td>
          <td class="ad-risk-tags">${u.tags
            .map((t) => `<span class="ad-tag is-${t.severity}">${escapeHtml(t.text)}</span>`)
            .join("")}</td>
          <td>${u.postPercent === null ? "—" : `${u.postPercent}%`}</td>
          <td>${escapeHtml(u.lastReadDate || "ยังไม่เคยอ่าน")}</td>
          <td><a href="adminuser-detail.html?userId=${u.id}" class="ad-risk-go">ดูรายละเอียด →</a></td>
        </tr>`
      )
      .join("")}</tbody>`;
}

// ---------- กระดิ่ง: สิ่งที่แอดมินแก้ล่าสุด ----------
// เลขบนหัวกระดิ่ง = รายการที่ใหม่กว่าครั้งล่าสุดที่กดเปิดดู (จำไว้ใน localStorage ของเครื่องนี้)
const BELL_SEEN_KEY = "adminUpdatesSeenAt";
let bellLatestAt = "";

// เสียงเดียวกับกระดิ่งฝั่งผู้ใช้ — ดังครั้งเดียวต่ออัปเดตหนึ่งรายการในรอบการใช้งานนี้
// ถ้าเบราว์เซอร์ยังไม่ให้เล่นเสียง (ยังไม่ได้แตะหน้าเว็บ) จะลองใหม่ตอนโหลดข้อมูลรอบถัดไป
const BELL_SOUND = new Audio("sound/notification.m4a");
BELL_SOUND.preload = "auto";
BELL_SOUND.volume = 0.5;
const BELL_SOUNDED_KEY = "adminUpdatesSoundedAt";

function playBellSound(latestAt) {
  let soundedAt = "";
  try {
    soundedAt = sessionStorage.getItem(BELL_SOUNDED_KEY) || "";
  } catch {
    /* ปิด storage: ยอมให้ดังซ้ำได้ ดีกว่าไม่ดังเลย */
  }
  if (!latestAt || latestAt <= soundedAt) return;
  BELL_SOUND.currentTime = 0;
  BELL_SOUND.play()
    .then(() => {
      try {
        sessionStorage.setItem(BELL_SOUNDED_KEY, latestAt);
      } catch {}
    })
    .catch(() => {});
}

function bellSeenAt() {
  try {
    return localStorage.getItem(BELL_SEEN_KEY) || "";
  } catch {
    return "";
  }
}

function markUpdatesSeen() {
  try {
    if (bellLatestAt) localStorage.setItem(BELL_SEEN_KEY, bellLatestAt);
  } catch {
    /* โหมดส่วนตัว / ปิด storage: ซ่อนเลขไปก่อน แล้วค่อยกลับมาใหม่ตอนโหลดหน้า */
  }
  const count = document.getElementById("adBellCount");
  count.hidden = true;
}

function renderUpdates(items) {
  const list = document.getElementById("adBellList");
  if (!list) return;
  const count = document.getElementById("adBellCount");
  list.innerHTML = items.length
    ? items
        .map((u) => `<li>${escapeHtml(u.text)}<span class="ad-bell-when">${escapeHtml(adAgo(u.minutesAgo))}</span></li>`)
        .join("")
    : adEmpty("ยังไม่มีการแก้ไขจากแอดมิน");

  bellLatestAt = items.reduce((max, u) => (String(u.at) > max ? String(u.at) : max), "");
  const seen = bellSeenAt();
  const unseen = items.filter((u) => String(u.at) > seen).length;
  count.hidden = unseen === 0;
  count.textContent = unseen;
  if (unseen > 0) playBellSound(bellLatestAt);
}

// ---------- สถิติมินิเกมรายโลก ----------
function renderGames(rows) {
  const table = document.getElementById("adGames");
  if (!table) return;
  const chip = document.getElementById("adGameChip");
  if (!rows.length) {
    chip.textContent = "ยังไม่มีใครเล่น";
    table.innerHTML = `<tbody><tr><td>${escapeHtml("ยังไม่มีการเล่นมินิเกม")}</td></tr></tbody>`;
    return;
  }
  const plays = rows.reduce((a, r) => a + r.plays, 0);
  const wins = rows.reduce((a, r) => a + r.wins, 0);
  chip.textContent = `เล่นแล้ว ${num(plays)} ครั้ง · ผ่าน ${num(wins)} ครั้ง`;
  table.innerHTML = `<thead><tr>
      <th>โลก / บทเรียน</th><th>จำนวนเล่น</th><th>ผ่าน</th><th>อัตราผ่าน</th>
    </tr></thead><tbody>${rows
      .map(
        (r) => `<tr>
          <td>โลกที่ ${r.world}<span class="ad-cell-sub">${escapeHtml(r.title)}</span></td>
          <td>${num(r.plays)}</td>
          <td>${num(r.wins)}</td>
          <td><div class="ad-cell-bar">
            <div class="ad-bar-track"><div class="ad-bar-fill" style="width:${r.percent}%"></div></div>
            <span>${r.percent}%</span>
          </div></td>
        </tr>`
      )
      .join("")}</tbody>`;
}

function renderDashboard(data) {
  renderTiles(data.tiles);
  renderTrend(data.trend);
  renderChapterShare(data.chapterShare);
  renderPet(data.pet);
  renderTopReaders(data.topReaders);
  renderReadingByDay(data.readingByDay);
  renderReview(data.review);
  renderLearning(data.learning);
  renderAi(data.ai);
  renderGames(data.games);
  renderAtRisk(data.atRisk || { total: 0, users: [], criteria: {} });
  renderUpdates(data.updates || []);
  const updated = document.getElementById("adUpdatedAt");
  if (updated) {
    updated.textContent = `อัปเดตล่าสุด: ${new Date().toLocaleString("th-TH", {
      dateStyle: "long",
      timeStyle: "short",
    })} น.`;
  }
}

// ดาวน์โหลด CSV รายคน (ต้องแนบ token แอดมิน เลยโหลดผ่าน fetch แล้วค่อยสร้างลิงก์)
async function downloadReadersCsv() {
  const btn = document.getElementById("adReadersCsv");
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = "กำลังเตรียมไฟล์...";
  try {
    const response = await fetch(`${API_BASE_URL}/admin/export/users`, {
      headers: { Authorization: `Bearer ${getAdminToken()}` },
    });
    if (response.status === 401 || response.status === 403) {
      clearAdminSession();
      window.location.href = "login.html";
      return;
    }
    if (!response.ok) throw new Error(`ดาวน์โหลดไม่สำเร็จ (${response.status})`);
    const match = (response.headers.get("Content-Disposition") || "").match(/filename="([^"]+)"/);
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = url;
    link.download = match ? match[1] : "reading-buddy-users.csv";
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

async function loadDashboard() {
  try {
    renderDashboard(await adminApiFetch(`/admin/stats/dashboard?range=${adRange}`));
  } catch (err) {
    console.error("โหลดสถิติแอดมินไม่สำเร็จ:", err);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  if (!getAdminToken()) return; // adminAuth.js จะเด้งไป login ให้แล้ว

  const select = document.getElementById("adRangeSelect");
  if (select) {
    select.value = String(adRange);
    select.addEventListener("change", () => {
      adRange = Number(select.value);
      loadDashboard();
    });
  }

  // กระดิ่ง: เปิด/ปิดแผงอัปเดต และปิดเมื่อคลิกที่อื่น
  const bellBtn = document.getElementById("adBellBtn");
  const bellPanel = document.getElementById("adBellPanel");
  if (bellBtn && bellPanel) {
  bellBtn.addEventListener("click", () => {
    const open = bellPanel.hidden;
    bellPanel.hidden = !open;
    bellBtn.setAttribute("aria-expanded", String(open));
    if (open) markUpdatesSeen(); // กดดูแล้ว = เลขบนหัวหาย
  });
  document.addEventListener("click", (e) => {
    if (!bellPanel.hidden && !e.target.closest(".ad-bell-wrap")) {
      bellPanel.hidden = true;
      bellBtn.setAttribute("aria-expanded", "false");
    }
  });
  }

  let searchTimer = null;
  document.getElementById("adReaderSearch")?.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(drawTopReaders, 200);
  });
  document.getElementById("adReadersCsv")?.addEventListener("click", downloadReadersCsv);

  loadDashboard();
});

// ================== โหมดสาธิตจับเวลาอ่าน ==================
// เปิด: ขั้นต่ำ 1 นาที 10 คอยน์ทุก 1 นาที (ใช้ตอนนำเสนอ) — ปิด: 10 นาที 10 คอยน์ทุก 5 นาทีตามปกติ
let demoModeOn = false;

function renderDemoMode(rules) {
  demoModeOn = !!rules.demoMode;
  const desc = document.getElementById("demoModeDesc");
  const btn = document.getElementById("demoModeBtn");
  btn.classList.toggle("is-on", demoModeOn);
  const presets = (rules.presets || []).map((p) => `${p.readMinutes}/${p.breakMinutes}`).join(" หรือ ");
  const rewardText = `ได้ ${rules.coinsPerBlock} คอยน์ทุก ${rules.minutesPerBlock} นาที`;
  desc.hidden = !demoModeOn;
  desc.textContent = demoModeOn
    ? `🧪 โหมดสาธิตเปิดอยู่ — รอบอ่าน ${presets} นาที · ${rewardText} · ไม่จำกัดรอบต่อวัน · อ่านบทละ ${rules.postTestMinReadMinutes} นาทีก็ทำแบบทดสอบหลังอ่านได้ — อย่าลืมปิดหลังสาธิต`
    : `ปกติ: รอบอ่าน Pomodoro ${presets} นาที · ${rewardText} · ได้คอยน์วันละไม่เกิน ${rules.dailyCoinRounds} รอบ`;
  btn.textContent = demoModeOn ? "🧪 ปิดโหมดสาธิต" : "🧪 เปิดโหมดสาธิต";
  btn.disabled = false;
}

async function loadDemoMode() {
  try {
    const { readingRules } = await adminApiFetch("/admin/demo-mode");
    renderDemoMode(readingRules);
  } catch (err) {
    console.error("โหลดสถานะโหมดสาธิตไม่สำเร็จ:", err);
  }
}

async function toggleDemoMode() {
  const turnOn = !demoModeOn;
  const question = turnOn
    ? "เปิดโหมดสาธิต? ผู้ใช้ทุกคนจะตั้งเวลาอ่านได้ตั้งแต่ 1 นาที และได้ 10 คอยน์ทุก 1 นาทีจนกว่าจะปิด"
    : "ปิดโหมดสาธิต? กลับเป็นขั้นต่ำ 10 นาที และ 10 คอยน์ทุก 5 นาที (เซสชันที่เริ่มไปแล้วยังใช้กติกาเดิมของมัน)";
  if (!confirm(question)) return;

  const btn = document.getElementById("demoModeBtn");
  btn.disabled = true;
  try {
    const { readingRules } = await adminApiFetch("/admin/demo-mode", {
      method: "PUT",
      body: JSON.stringify({ enabled: turnOn }),
    });
    renderDemoMode(readingRules);
  } catch (err) {
    alert("เปลี่ยนโหมดไม่สำเร็จ: " + err.message);
    btn.disabled = false;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  if (getAdminToken()) loadDemoMode();
});
