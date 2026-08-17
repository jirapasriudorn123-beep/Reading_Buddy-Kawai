async function handleLogin(e) {
    e.preventDefault();
    
    const data = {
        email: document.getElementById('admin_email').value,
        password: document.getElementById('admin_password').value
    };

    const response = await fetch('URL_ที่เพื่อนจะบอกคุณ', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });

    const result = await response.json();
    if (result.success) {
        window.location.href = "admindashboard.html";
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const adminData = JSON.parse(localStorage.getItem('adminToken')); 

    const nameDisplay = document.getElementById('adminNameDisplay');

    if (adminData && adminData.name) {
        nameDisplay.innerText = adminData.name;
    } else {
        nameDisplay.innerText = "ผู้ดูแลระบบ";
    }
});

// ฟังก์ชันรอรับข้อมูลจาก Backend
async function updateDashboardData() {
    try {
        const response = await fetch('api/admin/stats');
        const data = await response.json();

        document.getElementById('statTotalUsers').innerText = data.totalUsers.toLocaleString();
        document.getElementById('statOnlineUsers').innerText = data.onlineUsers.toLocaleString();
        document.getElementById('statTotalReadingHours').innerText = data.totalReading.toLocaleString();
        document.getElementById('statTotalCoins').innerText = data.totalCoins.toLocaleString();
        document.getElementById('statMiniGamePlayers').innerText = data.gamePlayers.toLocaleString();
        
        updateChart(data.chartData); 
        
    } catch (error) {
        console.error("Backend ยังไม่ส่งข้อมูลมา:", error);
    }
}
