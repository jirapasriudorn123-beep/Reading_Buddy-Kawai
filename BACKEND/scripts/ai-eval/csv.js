// CSV อ่าน/เขียนแบบเล็กๆ ใช้ในสคริปต์ประเมิน AI (UTF-8 + BOM เปิดใน Excel แล้วภาษาไทยไม่เพี้ยน)

function toCsv(columns, rows) {
  const escape = (value) => {
    if (value === null || value === undefined) return "";
    const s = String(value);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + [columns.join(","), ...rows.map((r) => columns.map((c) => escape(r[c])).join(","))].join("\r\n") + "\r\n";
}

// รองรับช่องที่มีเครื่องหมายคำพูด/จุลภาค/ขึ้นบรรทัดใหม่ (ไฟล์ที่ผู้ประเมินแก้ใน Excel แล้วบันทึกเป็น CSV)
function parseCsv(text) {
  const src = text.replace(/^﻿/, "");
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [header, ...data] = rows.filter((r) => r.some((c) => c !== ""));
  return data.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? "").trim()])));
}

module.exports = { toCsv, parseCsv };
