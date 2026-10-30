const API = "http://localhost:3000";
let token = "";
const $ = id => document.getElementById(id);
const message = text => { $("message").textContent = text; };

$("loginForm").addEventListener("submit", async event => {
  event.preventDefault();
  try {
    const response = await fetch(`${API}/api01/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(new FormData(event.target)))
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Login failed");
    if (data.user.role !== "platform_admin") {
      throw new Error("Administrator access required");
    }
    token = data.accessToken;
    message("Administrator authenticated.");
  } catch (e) { message(e.message); }
});

$("loadOverview").addEventListener("click", async () => {
  if (!token) return message("Administrator sign in required.");
  try {
    const response = await fetch(`${API}/api05/admin/overview`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Access denied");

    $("overview").replaceChildren();
    for (const [label, value] of Object.entries(data)) {
      const card = document.createElement("article");
      card.className = "menu-item";
      const title = document.createElement("p");
      title.textContent = label;
      const count = document.createElement("h2");
      count.textContent = String(value);
      card.append(title, count);
      $("overview").append(card);
    }
  } catch (e) { message(e.message); }
});