async function loadScores() {
  try {
    const { byCoins, byReading } = await adminApiFetch("/admin/scores");

    const coinBody = document.getElementById("coinScoreBody");
    coinBody.innerHTML = byCoins.length
      ? byCoins
          .map(
            (u, i) => `
        <tr>
          <td>${i + 1}</td>
          <td>${u.username}</td>
          <td>🪙 ${u.coins.toLocaleString()}</td>
        </tr>`
          )
          .join("")
      : `<tr><td colspan="3" style="text-align:center;color:#999;">ยังไม่มีข้อมูล</td></tr>`;

    const readingBody = document.getElementById("readingScoreBody");
    readingBody.innerHTML = byReading.length
      ? byReading
          .map(
            (u, i) => `
        <tr>
          <td>${i + 1}</td>
          <td>${u.username}</td>
          <td>${u.totalMinutes.toLocaleString()} นาที</td>
        </tr>`
          )
          .join("")
      : `<tr><td colspan="3" style="text-align:center;color:#999;">ยังไม่มีข้อมูล</td></tr>`;
  } catch (err) {
    console.error("โหลดอันดับไม่สำเร็จ:", err);
    alert("โหลดอันดับไม่สำเร็จ: " + err.message);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  if (!getAdminToken()) return;
  loadScores();
});
