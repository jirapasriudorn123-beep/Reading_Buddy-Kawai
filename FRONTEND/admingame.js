async function loadGameProgress() {
  try {
    const { players, totalPlayers } = await adminApiFetch("/admin/game-progress");
    document.getElementById("statGameTotalPlayers").textContent = totalPlayers.toLocaleString();

    const tbody = document.getElementById("gameProgressBody");
    tbody.innerHTML = players.length
      ? players
          .map(
            (p) => `
      <tr>
        <td>${p.username}</td>
        <td>World ${p.unlocked_world}</td>
        <td>Stage ${p.unlocked_stage}</td>
        <td>${p.updated_at || "-"}</td>
      </tr>`
          )
          .join("")
      : `<tr><td colspan="4" style="text-align:center;color:#999;">ยังไม่มีผู้เล่นเริ่มเกม</td></tr>`;
  } catch (err) {
    console.error("โหลดความคืบหน้าเกมไม่สำเร็จ:", err);
    alert("โหลดความคืบหน้าเกมไม่สำเร็จ: " + err.message);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  if (!getAdminToken()) return;
  loadGameProgress();
});
