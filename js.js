const API = "http://localhost:3000";
let token = "";
let basket = [];
let menu = [];

const $ = id => document.getElementById(id);
const message = text => { $("message").textContent = text; };

$("loginForm").addEventListener("submit", async event => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.target));

  try {
    const response = await fetch(`${API}/api01/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Login failed");
    if (result.user.role !== "customer") {
      throw new Error("Please sign in using the correct app.");
    }
    token = result.accessToken;
    message(`Welcome, ${result.user.name}!`);
  } catch (error) {
    message(error.message);
  }
});

$("loadMenu").addEventListener("click", async () => {
  if (!token) return message("Sign in before loading the menu.");
  try {
    const response = await fetch(`${API}/api02/menu`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Menu unavailable");
    menu = data;
    $("menu").replaceChildren();

    data.forEach(item => {
      const card = document.createElement("article");
      card.className = "menu-item";
      const title = document.createElement("h3");
      title.textContent = item.name;
      const desc = document.createElement("p");
      desc.textContent = item.description || "";
      const price = document.createElement("p");
      price.textContent = `R${(item.price_cents / 100).toFixed(2)}`;
      const button = document.createElement("button");
      button.textContent = "Add to basket";
      button.addEventListener("click", () => {
        basket.push({ menuItemId: item.id, quantity: 1 });
        renderBasket();
      });
      card.append(title, desc, price, button);
      $("menu").append(card);
    });
  } catch (error) {
    message(error.message);
  }
});

function renderBasket() {
  $("basket").textContent = basket.length
    ? `${basket.length} item(s) in basket`
    : "Your basket is empty.";
}

$("checkoutForm").addEventListener("submit", async event => {
  event.preventDefault();
  if (!token || !basket.length) return message("Sign in and add menu items first.");

  // The backend also verifies item prices and vendor ownership.
  const vendorId = menu.find(item => item.id === basket[0].menuItemId)?.vendor_id;
  if (!vendorId) {
    return message("Menu is missing vendor information. Refresh the menu.");
  }

  try {
    const response = await fetch(`${API}/api03/orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        items: basket,
        vendorId,
        deliveryAddress: new FormData(event.target).get("address")
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Order failed");
    basket = [];
    renderBasket();
    message(`Order placed: ${result.id}`);
  } catch (error) {
    message(error.message);
  }
});