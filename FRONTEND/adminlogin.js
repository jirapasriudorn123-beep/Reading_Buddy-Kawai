document.addEventListener("DOMContentLoaded", () => {
  // ถ้ามี session แอดมินอยู่แล้วไม่ต้องให้ล็อกอินซ้ำ
  if (localStorage.getItem("adminToken")) {
    window.location.href = "adminhome.html";
    return;
  }

  const form = document.getElementById("loginForm");
  const emailInput = document.getElementById("email");
  const passwordInput = document.getElementById("password");
  const emailError = document.getElementById("emailError");
  const passwordError = document.getElementById("passwordError");

  const passwordToggle = document.getElementById("passwordToggle");
  if (passwordToggle) {
    passwordToggle.addEventListener("click", () => {
      const isPassword = passwordInput.type === "password";
      passwordInput.type = isPassword ? "text" : "password";
      passwordToggle.classList.toggle("show-password", isPassword);
    });
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    emailError.textContent = "";
    passwordError.textContent = "";

    const email = emailInput.value.trim();
    const password = passwordInput.value;

    if (!email || !password) {
      passwordError.textContent = "กรุณากรอกอีเมลและรหัสผ่าน";
      return;
    }

    const submitBtn = form.querySelector(".comfort-button");
    submitBtn?.classList.add("loading");

    try {
      const res = await fetch(`${API_BASE_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        passwordError.textContent = data.message || "เข้าสู่ระบบไม่สำเร็จ";
        return;
      }

      if (!data.user?.isAdmin) {
        passwordError.textContent = "บัญชีนี้ไม่มีสิทธิ์แอดมิน";
        return;
      }

      localStorage.setItem("adminToken", data.token);
      localStorage.setItem("adminUser", JSON.stringify(data.user));
      window.location.href = "adminhome.html";
    } catch (err) {
      console.error("Admin login error:", err);
      passwordError.textContent = "เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ ลองใหม่อีกครั้ง";
    } finally {
      submitBtn?.classList.remove("loading");
    }
  });
});
