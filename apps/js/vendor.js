/* Vendor app: sign in as a registered shop, work the order queue, keep the menu honest. */
(function () {
  "use strict";

  var UI = window.KFUI;
  var KF = window.KF;
  var money = UI.money;
  var esc = UI.escape;

  var header = document.getElementById("header");
  var main = document.getElementById("main");
  var bottom = document.getElementById("bottom");

  var view = { tab: "orders", queue: "placed", fulfil: "all" };
  var signIn = { email: "", shopId: "", error: "", lockedMs: 0 };
  var dish = { open: false, errors: {}, draft: { name: "", price: "", category: "", desc: "" } };

  function currentShop() {
    return KF.sessionShop();
  }

  function applyFulfil(orders) {
    if (view.fulfil === "all") return orders;
    return orders.filter(function (order) {
      return order.fulfilment === view.fulfil;
    });
  }

  function route() {
    var raw = location.hash.replace(/^#\/?/, "");
    return raw || "orders";
  }

  function go(hash) {
    if (location.hash === "#/" + hash) render();
    else location.hash = "#/" + hash;
  }

  /* ---------------- Sign in ---------------- */

  function renderSignIn() {
    header.className = "app-header";
    header.innerHTML =
      '<div class="header-row">' +
        '<div class="brand">Kassi<em>Fleet</em></div>' +
        '<a class="icon-btn" href="./index.html" aria-label="All Kassifleet apps"><i class="ph ph-squares-four"></i></a>' +
      "</div>";

    var notice = "";
    if (signIn.lockedMs > Date.now()) {
      notice =
        '<div class="notice notice--warn"><i class="ph ph-lock-key"></i><span>Too many attempts. Try again in ' +
        Math.max(1, Math.ceil((signIn.lockedMs - Date.now()) / 1000)) +
        "s.</span></div>";
    } else if (signIn.error) {
      notice = '<div class="notice notice--error"><i class="ph ph-warning-circle"></i><span>' + esc(signIn.error) + "</span></div>";
    }

    main.innerHTML =
      '<div class="pad" style="padding-top:16px">' +
        '<div class="card" style="padding:18px">' +
          '<div style="display:flex;align-items:center;gap:10px">' +
            '<span style="display:grid;place-items:center;width:40px;height:40px;border-radius:11px;background:var(--ink);color:#fff">' +
              '<i class="ph ph-storefront" style="font-size:18px"></i>' +
            "</span>" +
            '<div style="min-width:0">' +
              '<div class="h3">Kitchen sign in</div>' +
              '<div class="meta truncate">Registered shops only</div>' +
            "</div>" +
          "</div>" +
          '<h1 class="h1" style="margin-top:14px">Open your kitchen</h1>' +
          '<p class="sub" style="margin-top:3px">Enter the email the shop registered with and the shop ID the owner issued. Both must belong to the same shop.</p>' +
          (notice ? '<div style="margin-top:12px">' + notice + "</div>" : "") +
          '<form class="stack" id="vendorSignIn" style="margin-top:14px" novalidate>' +
            UI.field({
              name: "email",
              label: "Registered email",
              type: "email",
              value: signIn.email,
              placeholder: "orders@shop.co.za",
              inputmode: "email",
              autocomplete: "email"
            }) +
            UI.field({
              name: "shopId",
              label: "Shop ID",
              value: signIn.shopId,
              placeholder: "SHP-1041",
              autocomplete: "off",
              hint: "Printed on the owner console under Shops"
            }) +
          "</form>" +
          '<button class="btn btn--primary btn--lg btn--block" style="margin-top:14px" data-action="sign-in">Sign in</button>' +
        "</div>" +
        '<div class="list-note" style="padding:12px 2px">No email? Ask the owner to add the shop in the owner console.</div>' +
        '<a class="btn btn--quiet btn--block" href="./index.html">Back to the four apps</a>' +
      "</div>";

    bottom.innerHTML = "";
  }

  function submitSignIn() {
    var form = document.getElementById("vendorSignIn");
    if (!form) return;
    signIn.email = String(form.elements.email.value || "").trim();
    signIn.shopId = String(form.elements.shopId.value || "").trim().toUpperCase();
    signIn.error = "";

    if (!signIn.email || !signIn.shopId) {
      signIn.error = "Enter the registered email and the shop ID.";
      renderSignIn();
      return;
    }

    var result = KF.signInShop(signIn.email, signIn.shopId);
    if (result.ok) {
      signIn = { email: "", shopId: "", error: "", lockedMs: 0 };
      dish = { open: false, errors: {}, draft: { name: "", price: "", category: "", desc: "" } };
      render();
      UI.toast("Signed in to " + result.shop.name);
      return;
    }

    if (result.locked) {
      signIn.lockedMs = Date.now() + result.msLeft;
      signIn.error = "";
    } else {
      signIn.error = "Email and shop ID do not match a registered shop. " + result.attemptsLeft +
        (result.attemptsLeft === 1 ? " attempt" : " attempts") + " left.";
    }
    renderSignIn();
  }

  /* ---------------- Header ---------------- */

  function renderHeader(shop) {
    header.className = "app-header app-header--line";
    header.innerHTML =
      '<div class="header-row">' +
        '<div style="min-width:0">' +
          '<div style="display:flex;align-items:center;gap:6px">' +
            '<span class="label">Kitchen</span><span class="sep"></span>' +
            '<span class="label num">' + esc(shop.shopId) + "</span>" +
          "</div>" +
          '<div class="h2 truncate" style="margin-top:2px">' + esc(shop.name) + "</div>" +
        "</div>" +
        '<div style="display:flex;align-items:center;gap:8px;flex:0 0 auto">' +
          '<span class="meta" style="font-weight:600">' + (shop.accepting ? "Accepting" : "Paused") + "</span>" +
          '<button class="switch" role="switch" aria-checked="' + shop.accepting + '" data-action="accepting" ' +
            'aria-label="Accept new orders"></button>' +
          '<button class="icon-btn" data-action="sign-out" aria-label="Sign out of this kitchen"><i class="ph ph-sign-out"></i></button>' +
        "</div>" +
      "</div>";
  }

  /* ---------------- Orders ---------------- */

  function fulfilFilterHtml() {
    var options = [
      { value: "all", label: "All orders" },
      { value: "delivery", label: "Delivery" },
      { value: "collect", label: "Collection" }
    ];
    return (
      '<div class="rail" style="padding:0;margin-top:10px">' +
      options
        .map(function (option) {
          return (
            '<button class="chip" data-action="fulfil-filter" data-value="' + option.value + '" aria-pressed="' +
            (view.fulfil === option.value) + '">' + option.label + "</button>"
          );
        })
        .join("") +
      "</div>"
    );
  }

  function queueRows(queue, key) {
    var orders = queue[key];
    if (!orders.length) {
      var copy = {
        placed: ["No new orders", "New tickets land here the moment a customer checks out."],
        accepted: ["Nothing on the pass", "Accepted orders show here while the kitchen cooks."],
        ready: ["Nothing waiting for pickup", "Orders you mark ready appear here until a driver claims them."]
      }[key];
      return (
        '<div class="card"><div class="empty"><i class="ph ph-chef-hat"></i>' +
          '<div class="empty__title">' + copy[0] + "</div>" +
          '<div class="empty__body">' + copy[1] + "</div>" +
        "</div></div>"
      );
    }

    return (
      '<div class="list">' +
        orders.map(function (order) {
          var items = order.items.reduce(function (sum, item) { return sum + item.qty; }, 0);
          var action = "";
          if (key === "placed") {
            action = '<button class="btn btn--green" data-action="accept" data-id="' + order.id + '">Accept</button>';
          } else if (key === "accepted") {
            action = '<button class="btn btn--primary" data-action="ready" data-id="' + order.id + '">Mark ready</button>';
          } else if (order.fulfilment === "collect") {
            action = '<button class="btn btn--green" data-action="collect" data-id="' + order.id + '">Hand over</button>';
          } else {
            var waiting = UI.minutesSince(order.readyAt);
            action =
              '<span class="badge badge--ink">' +
              (waiting < 1 ? "Ready just now" : "Unassigned " + waiting + " min") +
              "</span>";
          }

          return (
            '<div class="row" style="align-items:center">' +
              '<button class="row__body" data-open="' + order.id + '" style="text-align:left">' +
                '<div style="display:flex;align-items:center;gap:7px">' +
                  '<span class="row__title num">' + order.id + "</span>" +
                  UI.fulfilTag(order) +
                  '<span class="meta num">' + UI.ago(order.placedAt) + " ago</span>" +
                "</div>" +
                '<div class="row__lines"><span>' + esc(order.address.suburb) + '</span><span class="sep"></span>' +
                  '<span class="num">' + items + (items === 1 ? " item" : " items") + '</span><span class="sep"></span>' +
                  '<span class="num">' + money(order.total) + "</span></div>" +
                '<div class="row__lines"><span>Promised ' + UI.clock(order.promisedAt) + "</span></div>" +
              "</button>" +
              action +
            "</div>"
          );
        }).join("") +
      "</div>"
    );
  }

  function renderOrders(shop) {
    var all = KF.vendorQueue(shop.id);
    var queue = {
      placed: applyFulfil(all.placed),
      accepted: applyFulfil(all.accepted),
      ready: applyFulfil(all.ready)
    };
    var tabs = [
      { key: "placed", label: "New", count: queue.placed.length },
      { key: "accepted", label: "Preparing", count: queue.accepted.length },
      { key: "ready", label: "Ready", count: queue.ready.length }
    ];

    main.innerHTML =
      '<div class="pad" style="padding-top:12px">' +
        '<div class="seg" role="tablist" aria-label="Order states">' +
          tabs.map(function (tab) {
            return '<button role="tab" aria-selected="' + (view.queue === tab.key) + '" data-action="queue" data-key="' + tab.key + '">' +
              tab.label + '<span class="seg__count num">' + tab.count + "</span></button>";
          }).join("") +
        "</div>" +
        fulfilFilterHtml() +
      "</div>" +
      (!shop.accepting
        ? '<div class="pad" style="margin-top:12px"><div class="notice notice--warn"><i class="ph ph-warning-circle"></i><span>New orders are paused. Turn on accepting orders to receive tickets.</span></div></div>'
        : "") +
      '<div class="pad section-gap">' + queueRows(queue, view.queue) + "</div>" +
      '<div style="height:16px"></div>';
  }

  /* ---------------- Menu ---------------- */

  function renderMenu(shop) {
    var groups = [];
    shop.menu.forEach(function (item) {
      var group = groups.filter(function (g) { return g.name === item.category; })[0];
      if (!group) {
        group = { name: item.category, items: [] };
        groups.push(group);
      }
      group.items.push(item);
    });

    var body = shop.menu.length
      ? groups.map(function (group) {
          return (
            '<div class="label" style="padding:10px 0 6px">' + esc(group.name) + "</div>" +
            '<div class="list">' +
              group.items.map(function (item) {
                return (
                  '<div class="row">' +
                    '<div class="row__body">' +
                      '<div class="row__title" style="font-weight:600">' + esc(item.name) + "</div>" +
                      '<div class="row__lines"><span class="num">' + money(item.price) + '</span><span class="sep"></span>' +
                        "<span>" + (item.available ? "Available" : "Sold out") + "</span></div>" +
                    "</div>" +
                    '<button class="switch" role="switch" aria-checked="' + item.available + '" data-action="dish" data-id="' + item.id + '" ' +
                      'aria-label="' + esc(item.name) + ' available"></button>' +
                  "</div>"
                );
              }).join("") +
            "</div>"
          );
        }).join("")
      : '<div class="card"><div class="empty"><i class="ph ph-bowl-food"></i>' +
          '<div class="empty__title">No dishes yet</div>' +
          '<div class="empty__body">Add a dish so customers can order from this shop.</div>' +
          '<button class="btn btn--primary" style="margin-top:14px" data-action="add-dish">Add the first dish</button>' +
        "</div></div>";

    main.innerHTML =
      '<div class="pad section-gap">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px">' +
          '<div style="min-width:0">' +
            '<h2 class="h2">Menu</h2>' +
            '<div class="meta num">' + shop.menu.length + (shop.menu.length === 1 ? " dish" : " dishes") + " published</div>" +
          "</div>" +
          '<button class="btn btn--ghost btn--sm" data-action="add-dish"><i class="ph ph-plus"></i>Add dish</button>' +
        "</div>" +
        body +
      "</div>" +
      '<div class="list-note">Unavailable dishes are hidden from customers straight away.</div>' +
      '<div style="height:16px"></div>';
  }

  /* ---------------- Today ---------------- */

  function renderToday(shop) {
    var delivered = KF.vendorDelivered(shop.id);
    var takings = delivered.reduce(function (sum, order) { return sum + order.total; }, 0);
    var queue = KF.vendorQueue(shop.id);
    var preparing = queue.placed.length + queue.accepted.length;

    main.innerHTML =
      '<div class="pad section-gap">' +
        '<div class="card card--pad">' +
          '<div class="label">Takings today</div>' +
          '<div class="price-chip" style="font-size:26px;margin-top:4px">' + money(takings) + "</div>" +
          '<div class="stats" style="margin-top:12px">' +
            "<div><dt>Delivered</dt><dd>" + delivered.length + "</dd></div>" +
            "<div><dt>In kitchen</dt><dd>" + preparing + "</dd></div>" +
            "<div><dt>Waiting</dt><dd>" + queue.ready.length + "</dd></div>" +
          "</div>" +
        "</div>" +
      "</div>" +

      '<div class="pad section-gap">' +
        '<div class="list">' +
          '<div class="row">' +
            '<i class="ph ph-identification-card" style="font-size:17px"></i>' +
            '<span class="row__body"><span class="row__title" style="display:block">' + esc(shop.shopId) + "</span>" +
            '<span class="meta truncate">' + esc(shop.email) + "</span></span>" +
          "</div>" +
          '<div class="row">' +
            '<i class="ph ph-map-pin" style="font-size:17px"></i>' +
            '<span class="row__body"><span class="row__title" style="display:block">' + esc(shop.township) + "</span>" +
            '<span class="meta">' + esc(shop.street) + ", " + esc(shop.area) + "</span></span>" +
          "</div>" +
          '<button class="row" data-action="add-dish">' +
            '<i class="ph ph-plus-circle" style="font-size:17px"></i>' +
            '<span class="row__body"><span class="row__title" style="display:block">Publish a dish</span>' +
            '<span class="meta">Shows on the customer menu immediately</span></span>' +
            '<i class="ph ph-caret-right" style="color:var(--muted-2);font-size:12px"></i>' +
          "</button>" +
        "</div>" +
      "</div>" +

      '<div class="pad section-gap">' +
        '<h2 class="h2" style="margin-bottom:8px">Completed orders</h2>' +
        (delivered.length
          ? '<div class="list">' +
              delivered
                .slice()
                .sort(function (a, b) { return new Date(b.deliveredAt) - new Date(a.deliveredAt); })
                .map(function (order) {
                  return (
                    '<div class="row">' +
                      '<div class="row__body">' +
                        '<div class="row__title num" style="font-weight:600">' + order.id + "</div>" +
                        '<div class="row__lines"><span>' + esc(order.customer.name) + "</span>" +
                          '<span class="sep"></span><span class="num">' + UI.clock(order.deliveredAt) + "</span></div>" +
                      "</div>" +
                      '<span class="num" style="font-weight:650;font-size:13px">' + money(order.total) + "</span>" +
                    "</div>"
                  );
                }).join("") +
            "</div>"
          : '<div class="card"><div class="empty"><i class="ph ph-receipt"></i><div class="empty__title">No deliveries yet</div></div></div>') +
      "</div>" +
      '<div class="list-note">Takings count delivered orders only.</div>' +
      '<div style="height:16px"></div>';
  }

  /* ---------------- Ticket ---------------- */

  function openTicket(id) {
    var order = KF.order(id);
    if (!order) return;
    var actionLabel = { placed: "Accept order", accepted: "Mark ready", ready: null }[order.status];
    var actionAttr = { placed: "accept", accepted: "ready" }[order.status];
    if (order.status === "ready" && order.fulfilment === "collect") {
      actionLabel = "Hand over order";
      actionAttr = "collect";
    }

    UI.openSheet(
      '<div class="sheet__title num">' + order.id + "</div>" +
      '<div class="sheet__body">' +
        '<div style="display:flex;gap:7px;align-items:center;flex-wrap:wrap">' +
          UI.orderBadge(order) +
          UI.fulfilTag(order) +
          '<span class="meta num">Placed ' + UI.ago(order.placedAt) + " ago</span>" +
          '<span class="meta num">Promised ' + UI.clock(order.promisedAt) + "</span>" +
        "</div>" +
        '<div class="divider"></div>' +
        '<div class="list" style="border-radius:12px">' +
          order.items.map(function (item) {
            return (
              '<div class="row" style="padding:11px 12px">' +
                '<span class="qty-badge">' + item.qty + "</span>" +
                '<div class="row__body">' +
                  '<div class="row__title" style="font-weight:600">' + esc(item.name) + "</div>" +
                  (item.note ? '<div class="meta" style="margin-top:2px">' + esc(item.note) + "</div>" : "") +
                "</div>" +
                '<span class="num" style="font-size:12.5px;font-weight:600">' + money(item.price * item.qty) + "</span>" +
              "</div>"
            );
          }).join("") +
        "</div>" +
        '<div class="divider"></div>' +
        '<div class="label">' + (order.fulfilment === "collect" ? "Collected from the counter" : "Deliver to") + "</div>" +
        '<div style="margin-top:3px">' +
          '<div class="row__title">' + esc(order.customer.name) + "</div>" +
          '<div class="meta">' + esc(order.address.street) + ", " + esc(order.address.suburb) + ", " + esc(order.address.township || "") + "</div>" +
          (order.address.note ? '<div class="meta" style="margin-top:2px">' + esc(order.address.note) + "</div>" : "") +
        "</div>" +
        (order.fulfilment === "collect"
          ? '<div class="divider"></div><div class="kv"><dt>Collection code</dt><dd class="num">' + esc(order.collectCode || "—") + "</dd></div>"
          : "") +
        '<div class="divider"></div>' +
        '<div class="kv"><dt>Subtotal</dt><dd>' + money(order.subtotal) + "</dd></div>" +
        '<div class="kv"><dt>Delivery fee</dt><dd>' + money(order.fee) + "</dd></div>" +
        '<div class="kv"><dt>Tip</dt><dd>' + money(order.tip) + "</dd></div>" +
        '<div class="kv kv--total"><dt>Total</dt><dd>' + money(order.total) + "</dd></div>" +
      "</div>" +
      '<div class="sheet__foot">' +
        (actionLabel
          ? '<button class="btn btn--primary btn--lg btn--block" data-action="' + actionAttr + '" data-id="' + order.id + '">' + actionLabel + "</button>"
          : '<div class="notice notice--info"><i class="ph ph-steering-wheel"></i><span>Ready for pickup. A driver claims this order from their app.</span></div>') +
      "</div>"
    );
  }

  /* ---------------- Dish form ---------------- */

  function renderDishForm() {
    var errorCount = Object.keys(dish.errors).length;
    UI.openSheet(
      '<div class="sheet__title">Publish a dish</div>' +
      '<form class="sheet__body stack" id="dishForm" novalidate>' +
        (errorCount
          ? '<div class="notice notice--error"><i class="ph ph-warning-circle"></i><span>' +
            (errorCount === 1 ? "One field needs attention." : errorCount + " fields need attention.") + "</span></div>"
          : '<div class="notice notice--info"><i class="ph ph-bowl-food"></i><span>Dishes go live on the customer menu as soon as you publish.</span></div>') +
        UI.field({
          name: "name",
          label: "Dish name",
          value: dish.draft.name,
          placeholder: "e.g. Full house kota",
          error: dish.errors.name
        }) +
        '<div class="pair">' +
          UI.field({
            name: "price",
            label: "Price (R)",
            value: dish.draft.price,
            placeholder: "55",
            inputmode: "decimal",
            error: dish.errors.price
          }) +
          UI.field({
            name: "category",
            label: "Menu section",
            value: dish.draft.category,
            placeholder: "Kotas",
            error: dish.errors.category
          }) +
        "</div>" +
        UI.field({
          name: "desc",
          label: "What is in it",
          value: dish.draft.desc,
          placeholder: "Chips, polony, cheese and atchar",
          hint: "Optional, shown under the dish name"
        }) +
      "</form>" +
      '<div class="sheet__foot"><div class="btn-row">' +
        '<button class="btn btn--ghost btn--lg" data-action="close-sheet">Cancel</button>' +
        '<button class="btn btn--primary btn--lg" data-action="save-dish">Publish</button>' +
      "</div></div>"
    );
  }

  function openDishForm() {
    dish.errors = {};
    dish.draft = { name: "", price: "", category: "", desc: "" };
    renderDishForm();
  }

  function saveDish(shop) {
    var form = document.getElementById("dishForm");
    if (!form) return;
    dish.draft = {
      name: String(form.elements.name.value || "").trim(),
      price: String(form.elements.price.value || "").trim(),
      category: String(form.elements.category.value || "").trim(),
      desc: String(form.elements.desc.value || "").trim()
    };

    var result = KF.addDish(shop.shopId, dish.draft);
    if (!result.ok) {
      dish.errors = result.errors || {};
      renderDishForm();
      return;
    }
    UI.closeSheet();
    UI.toast(result.item.name + " is live on the menu");
    render();
  }

  /* ---------------- Bottom ---------------- */

  function renderBottom(tab) {
    bottom.innerHTML =
      '<nav class="nav" aria-label="Vendor sections">' +
        '<button data-nav="orders" data-key="orders" aria-label="Orders"><i class="ph ph-receipt"></i>Orders</button>' +
        '<button data-nav="menu" data-key="menu" aria-label="Menu"><i class="ph ph-bowl-food"></i>Menu</button>' +
        '<button data-nav="today" data-key="today" aria-label="Today"><i class="ph ph-wallet"></i>Today</button>' +
      "</nav>";
    Array.prototype.forEach.call(bottom.querySelectorAll("[data-key]"), function (node) {
      if (node.getAttribute("data-key") === tab) node.setAttribute("aria-current", "page");
    });
  }

  /* ---------------- Render ---------------- */

  function render() {
    var shop = currentShop();
    if (!shop) {
      renderSignIn();
      return;
    }
    renderHeader(shop);
    var tab = route();
    if (tab === "menu") renderMenu(shop);
    else if (tab === "today") renderToday(shop);
    else renderOrders(shop);
    renderBottom(tab);
  }

  /* ---------------- Events ---------------- */

  document.addEventListener("click", function (event) {
    var nav = event.target.closest("[data-nav]");
    if (nav) {
      event.preventDefault();
      go(nav.getAttribute("data-nav"));
      return;
    }

    /* Only tickets in the list open a sheet; the sheet itself also carries data-open. */
    var opener = event.target.closest("[data-open]");
    if (opener && main.contains(opener)) {
      openTicket(opener.getAttribute("data-open"));
      return;
    }

    var action = event.target.closest("[data-action]");
    if (!action) return;
    var name = action.getAttribute("data-action");
    var shop = currentShop();

    if (name === "sign-in") {
      submitSignIn();
      return;
    }

    if (name === "sign-out") {
      KF.endShopSession();
      UI.closeSheet();
      signIn = { email: "", shopId: "", error: "", lockedMs: 0 };
      render();
      UI.toast("Signed out of the kitchen");
      return;
    }

    if (!shop) return;

    if (name === "close-sheet") {
      UI.closeSheet();
      return;
    }

    if (name === "add-dish") {
      openDishForm();
      return;
    }

    if (name === "save-dish") {
      saveDish(shop);
      return;
    }

    if (name === "queue") {
      view.queue = action.getAttribute("data-key");
      render();
      return;
    }

    if (name === "accepting") {
      KF.setShopAccepting(shop.shopId, !shop.accepting);
      UI.toast(shop.accepting ? "Accepting new orders" : "New orders paused");
      render();
      return;
    }

    if (name === "fulfil-filter") {
      view.fulfil = action.getAttribute("data-value");
      render();
      return;
    }

    if (name === "collect") {
      var collectedId = action.getAttribute("data-id");
      if (KF.markCollected(collectedId)) {
        UI.closeSheet();
        UI.toast(collectedId + " handed over");
        render();
      } else {
        UI.toast("That order has moved on");
        UI.closeSheet();
      }
      return;
    }

    if (name === "dish") {
      var itemId = action.getAttribute("data-id");
      KF.toggleDish(shop.id, itemId);
      var item = shop.menu.filter(function (entry) { return entry.id === itemId; })[0];
      if (item) UI.toast(item.name + (item.available ? " is back on the menu" : " marked sold out"));
      render();
      return;
    }

    if (name === "accept") {
      var id = action.getAttribute("data-id");
      if (KF.acceptOrder(id)) {
        UI.closeSheet();
        UI.toast(id + " accepted. Cooking now.");
        render();
      } else {
        UI.toast(id + " has already moved on");
        UI.closeSheet();
      }
      return;
    }

    if (name === "ready") {
      var readyId = action.getAttribute("data-id");
      var readyOrder = KF.order(readyId);
      var readyCopy = readyOrder && readyOrder.fulfilment === "collect" ? " ready to collect" : " ready for a driver";
      if (KF.markReady(readyId)) {
        UI.closeSheet();
        UI.toast(readyId + readyCopy);
        render();
      } else {
        UI.toast(readyId + " has already moved on");
        UI.closeSheet();
      }
    }
  });

  document.addEventListener("input", function (event) {
    var owner = event.target.closest ? event.target.closest("#dishForm .field") : null;
    if (!owner) return;
    owner.classList.remove("field--invalid");
    var note = owner.querySelector(".field__error");
    if (note) note.remove();
    var key = event.target.getAttribute("name");
    if (key) delete dish.errors[key];
    if (!Object.keys(dish.errors).length) {
      var alert = document.querySelector("#dishForm .notice--error");
      if (alert) alert.remove();
    }
  });

  document.addEventListener("submit", function (event) {
    if (event.target.id === "vendorSignIn") {
      event.preventDefault();
      submitSignIn();
      return;
    }
    if (event.target.id === "dishForm") {
      event.preventDefault();
      var shop = currentShop();
      if (shop) saveDish(shop);
    }
  });

  window.addEventListener("hashchange", render);

  KF.subscribe(function () {
    render();
  });

  UI.bindSheetDismissal();

  if (!location.hash) location.replace("#/orders");
  render();
})();
