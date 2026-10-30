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
    if (data.user.role !== "vendor") throw new Error("Vendor account required");
    token = data.accessToken;
    message(`Signed in as ${data.user.name}`);
  } catch (e) { message(e.message); }
});

$("menuForm").addEventListener("submit", async event => {
  event.preventDefault();
  if (!token) return message("Please sign in first.");

  const form = new FormData(event.target);
  const priceCents = Math.round(Number(form.get("price")) * 100);

  try {
    const response = await fetch(`${API}/api02/menu`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        name: form.get("name"),
        description: form.get("description"),
        priceCents
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not add item");
    message(`Added ${data.name}`);
    event.target.reset();
  } catch (e) { message(e.message); }
});