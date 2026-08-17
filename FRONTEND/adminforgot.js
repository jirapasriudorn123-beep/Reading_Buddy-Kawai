document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("resetForm");
  const emailInput = document.getElementById("email");
  const emailError = document.getElementById("emailError");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    emailError.textContent = "";

    const email = emailInput.value.trim();
    if (!email) {
      emailError.textContent = "กรุณากรอกอีเมล";
      return;
    }

    const submitBtn = form.querySelector(".comfort-button");
    submitBtn?.classList.add("loading");

    try {
      const res = await fetch(`${API_BASE_URL}/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        emailError.textContent = data.message || "ส่งคำขอไม่สำเร็จ";
        return;
      }

      alert(data.message || "หากอีเมลนี้มีอยู่ในระบบ เราได้ส่งลิงก์สำหรับรีเซ็ตรหัสผ่านไปให้แล้ว");
      if (data.devResetUrl) {
        console.log("[DEV] ลิงก์รีเซ็ตรหัสผ่าน:", data.devResetUrl);
      }
      window.location.href = "adminlogin.html";
    } catch (err) {
      console.error("Admin forgot password error:", err);
      emailError.textContent = "เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ ลองใหม่อีกครั้ง";
    } finally {
      submitBtn?.classList.remove("loading");
    }
  });
});
