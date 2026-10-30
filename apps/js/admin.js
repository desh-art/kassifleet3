/* Owner console: PIN gate, then the fleet, the queue, the drivers and the payouts. */
(function () {
  "use strict";

  var UI = window.KFUI;
  var KF = window.KF;
  var money = UI.money;
  var esc = UI.escape;

  var UNLOCK_KEY = "kf.owner.unlocked";

  var header = document.getElementById("header");
  var main = document.getElementById("main");
  var bottom = document.getElementById("bottom");

  var pin = "";
  var pinError = "";
  var unlocked = false;
  var queueFilter = "unassigned";
  var lockTicker = null;
  var suppressRender = false;

  /* Shop registry screen state */
  var shopQuery = "";
  var shopStatus = "all";
  var shopTownship = "All";
  var shopForm = null;
  var shopErrors = {};
  var editingShopId = null;
  var pinErrors = {};

  try {
    unlocked = sessionStorage.getItem(UNLOCK_KEY) === "1";
  } catch (error) {
    unlocked = false;
  }

  function route() {
    var raw = location.hash.replace(/^#\/?/, "");
    return raw || "fleet";
  }

  function go(hash) {
    if (location.hash === "#/" + hash) render();
    else location.hash = "#/" + hash;
  }

  function openOrders() {
    return KF.get().orders.filter(function (order) {
      return order.status !== "delivered" && order.status !== "cancelled";
    });
  }

  function ordersForQueue(key) {
    var unassigned = KF.nearbyOrders();
    if (key === "unassigned") return unassigned;
    if (key === "risk") return unassigned.filter(KF.atRisk);
    return openOrders().filter(function (order) {
      return order.status === "claimed" || order.status === "picked_up";
    });
  }

  function driverState(driver) {
    var active = KF.get().orders.filter(function (order) {
      return order.driverId === driver.id && (order.status === "claimed" || order.status === "picked_up");
    })[0];
    if (active) return { key: "on", label: "On delivery", order: active, tone: "accent" };
    var stale = UI.minutesSince(driver.lastFix) > 10;
    if (stale) return { key: "off", label: "Offline", order: null, tone: "muted" };
    return { key: "free", label: "Available", order: null, tone: "green" };
  }

  /* ---------------- Lock screen ---------------- */

  function stopTicker() {
    if (lockTicker) {
      clearInterval(lockTicker);
      lockTicker = null;
    }
  }

  function startTicker() {
    stopTicker();
    if (!KF.adminState().locked) return;
    lockTicker = setInterval(function () {
      if (unlocked) {
        stopTicker();
        return;
      }
      if (!KF.adminState().locked) {
        stopTicker();
        pinError = "";
      }
      if (!unlocked) renderLock();
    }, 1000);
  }

  function lockNotice() {
    var admin = KF.adminState();
    if (admin.locked) {
      var seconds = Math.max(0, Math.ceil(admin.msLeft / 1000));
      var mins = Math.floor(seconds / 60);
      var rest = seconds % 60;
      return (
        '<div class="notice notice--warn"><i class="ph ph-lock-key"></i><span>Too many attempts. Try again in ' +
        (mins > 0 ? mins + " min " : "") +
        rest +
        "s.</span></div>"
      );
    }
    if (pinError) {
      return '<div class="notice notice--warn"><i class="ph ph-warning-circle"></i><span>' + esc(pinError) + "</span></div>";
    }
    var left = 5 - admin.fails;
    return (
      '<div class="notice notice--info"><i class="ph ph-shield-check"></i><span>' +
      (admin.fails
        ? admin.fails + " failed attempt" + (admin.fails === 1 ? "" : "s") + ". " + left + " left before a 5 minute lock."
        : "Only the owner account can unlock this console.") +
      "</span></div>"
    );
  }

  function keypadHtml() {
    var admin = KF.adminState();
    var disabled = admin.locked ? " disabled" : "";
    var digits = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    return (
      '<div class="keypad">' +
      digits
        .map(function (digit) {
          return '<button type="button" data-action="pin-digit" data-digit="' + digit + '"' + disabled + ">" + digit + "</button>";
        })
        .join("") +
      '<button type="button" class="keypad__meta" data-action="pin-clear"' + disabled + ">Clear</button>" +
      '<button type="button" data-action="pin-digit" data-digit="0"' + disabled + ">0</button>" +
      '<button type="button" data-action="pin-back"' + disabled + ' aria-label="Delete last digit"><i class="ph ph-backspace" style="font-size:17px"></i></button>' +
      "</div>"
    );
  }

  function renderLock() {
    stopTicker();
    var admin = KF.adminState();
    var owner = "owner@kassifleet.co.za";

    header.className = "app-header";
    header.innerHTML =
      '<div class="header-row">' +
        '<div class="brand">Kassi<em>Fleet</em></div>' +
        '<a class="icon-btn" href="./index.html" aria-label="All Kassifleet apps"><i class="ph ph-squares-four"></i></a>' +
      "</div>";

    main.innerHTML =
      '<div class="pad" style="padding-top:16px">' +
        '<div class="card" style="padding:18px">' +
          '<div style="display:flex;align-items:center;gap:10px">' +
            '<span style="display:grid;place-items:center;width:40px;height:40px;border-radius:11px;background:var(--ink);color:#fff">' +
              '<i class="ph ph-lock-key" style="font-size:18px"></i>' +
            "</span>" +
            '<div style="min-width:0">' +
              '<div class="h3">Owner console</div>' +
              '<div class="meta truncate">' + esc(owner) + "</div>" +
            "</div>" +
          "</div>" +
          '<h1 class="h1" style="margin-top:14px">Enter owner PIN</h1>' +
          '<p class="sub" style="margin-top:3px">Four digits. Dispatch, drivers and payouts stay locked until the PIN is right.</p>' +

          '<div class="pin" style="margin-top:14px">' +
            [0, 1, 2, 3]
              .map(function (index) {
                var filled = index < pin.length;
                var focus = index === pin.length && pin.length < 4 && !admin.locked;
                return (
                  '<div class="pin__slot"' + (focus ? ' data-focus="true"' : "") + ">" +
                    (filled ? '<span class="pin__dot"></span>' : "") +
                  "</div>"
                );
              })
              .join("") +
          "</div>" +

          '<div style="min-height:44px;margin-top:10px">' + lockNotice() + "</div>" +

          '<div style="margin-top:4px">' + keypadHtml() + "</div>" +

          '<button class="btn btn--primary btn--lg btn--block" style="margin-top:12px" data-action="unlock"' +
            (pin.length === 4 && !admin.locked ? "" : " disabled") +
            ">Unlock console</button>" +
        "</div>" +

        '<div class="list-note" style="text-align:center;padding:12px 6px">' +
          "A recovery key resets the PIN. <a href=\"./index.html\" style=\"text-decoration:underline\">All apps</a>" +
        "</div>" +
      "</div>";

    bottom.innerHTML = "";
    startTicker();
  }

  /* ---------------- Header + nav ---------------- */

  function renderHeader(view) {
    var names = { fleet: "Fleet", orders: "Order queue", shops: "Shops", drivers: "Drivers", payouts: "Payouts" };
    var counts = KF.adminCounts();

    header.innerHTML =
      '<div class="header-row">' +
        '<div style="min-width:0">' +
          '<div class="label">Owner</div>' +
          '<div class="h2" style="margin-top:2px">' + esc(names[view] || "Fleet") + "</div>" +
        "</div>" +
        '<div style="display:flex;align-items:center;gap:8px">' +
          '<button class="icon-btn" data-action="lock" aria-label="Lock the console"><i class="ph ph-lock-simple"></i></button>' +
          '<a class="icon-btn" href="./index.html" aria-label="All Kassifleet apps"><i class="ph ph-squares-four"></i></a>' +
        "</div>" +
      "</div>" +
      '<div class="meta num" style="margin-top:6px">' +
        (view === "shops"
          ? KF.shops().length + " shops registered, " +
            KF.shops().filter(function (shop) {
              return shop.accepting;
            }).length + " accepting orders"
          : counts.unassigned + " unassigned, " + counts.atRisk + " at risk, " + counts.active + " on the road") +
      "</div>";
  }

  function renderNav(view) {
    bottom.innerHTML =
      '<nav class="nav" style="--nav-cols:5" aria-label="Console sections">' +
        '<button data-nav="fleet" data-key="fleet"><i class="ph ph-map-trifold"></i>Fleet</button>' +
        '<button data-nav="orders" data-key="orders"><i class="ph ph-receipt"></i>Orders</button>' +
        '<button data-nav="shops" data-key="shops"><i class="ph ph-storefront"></i>Shops</button>' +
        '<button data-nav="drivers" data-key="drivers"><i class="ph ph-steering-wheel"></i>Drivers</button>' +
        '<button data-nav="payouts" data-key="payouts"><i class="ph ph-wallet"></i>Payouts</button>' +
      "</nav>";
    Array.prototype.forEach.call(bottom.querySelectorAll("[data-key]"), function (node) {
      if (node.getAttribute("data-key") === view) node.setAttribute("aria-current", "page");
    });
  }

  /* ---------------- Fleet ---------------- */

  function orderRow(order) {
    var shop = KF.vendor(order.vendorId);
    var driver = order.driverId ? KF.driver(order.driverId) : null;
    var waiting = UI.minutesSince(order.readyAt || order.placedAt);
    var timing;
    if (order.fulfilment === "collect") {
      timing = order.status === "ready" ? "Ready for collection" : "Collection order";
    } else if (driver) {
      timing = "Driver " + driver.name;
    } else if (order.status === "ready") {
      timing = waiting < 1 ? "Just ready" : "Unassigned " + waiting + " min";
    } else {
      timing = "Placed " + UI.ago(order.placedAt) + " ago";
    }

    return (
      '<button class="row" data-open-order="' + order.id + '">' +
        '<span class="row__body">' +
          '<span style="display:flex;align-items:center;gap:7px">' +
            '<span class="row__title num">' + order.id + "</span>" +
            UI.orderBadge(order) +
          "</span>" +
          '<span class="row__lines"><span>' + esc(shop.name) + "</span><span class=\"sep\"></span>" +
            "<span>" + esc(shop.township) + " to " + esc(order.address.suburb) + "</span></span>" +
          '<span class="row__lines"><span class="num">Promised ' + UI.clock(order.promisedAt) + "</span>" +
            '<span class="sep"></span><span class="num">' + esc(timing) + "</span></span>" +
        "</span>" +
        '<i class="ph ph-caret-right" style="color:var(--muted-2);font-size:12px"></i>' +
      "</button>"
    );
  }

  function fleetMap() {
    var pins = KF.nearbyOrders()
      .slice(0, 5)
      .map(function (order) {
        return { x: order.pickup[0], y: order.pickup[1], type: "pickup" };
      });
    var drivers = KF.get().drivers;
    var positions = [
      [0.48, 0.5],
      [0.3, 0.34],
      [0.74, 0.64]
    ];
    drivers.forEach(function (driver, index) {
      var state = driverState(driver);
      var point = state.order && state.order.trail ? orderTail(state.order) : positions[index];
      if (!state.order) {
        pins.push({ x: state.key === "off" ? 0.84 : positions[index][0], y: state.key === "off" ? 0.24 : positions[index][1], type: state.key === "off" ? "idle" : "driver" });
      } else {
        pins.push({ x: point[0], y: point[1], type: "driver" });
      }
    });

    var live = openOrders().filter(function (order) {
      return order.status === "picked_up";
    })[0];

    return (
      '<div class="map map--mid" style="position:relative">' +
        UI.map({
          height: 210,
          pins: pins,
          trail: live ? live.trail : null,
          planned: live ? live.remaining : null,
          label: "Live fleet map with pickups, drivers and the route on the road"
        }) +
        '<div class="map__chip map__chip--tl"><span class="dot dot--accent"></span>Pickups</div>' +
        '<div class="map__chip map__chip--br"><span class="dot" style="background:var(--ink)"></span>Drivers</div>' +
      "</div>"
    );
  }

  function orderTail(order) {
    var points = order.trail || [];
    return points[points.length - 1] || order.pickup;
  }

  function renderFleet() {
    var counts = KF.adminCounts();
    var tabs = [
      { key: "unassigned", label: "Unassigned", count: KF.nearbyOrders().length },
      { key: "risk", label: "At risk", count: KF.adminCounts().atRisk },
      { key: "active", label: "On the road", count: KF.adminCounts().active }
    ];
    if (queueFilter === "risk" && !tabs[1].count) queueFilter = "unassigned";
    var list = ordersForQueue(queueFilter);

    main.innerHTML =
      '<div class="pad" style="padding-top:12px">' +
        '<div class="seg" role="tablist" aria-label="Queue filter">' +
          tabs
            .map(function (tab) {
              return (
                '<button role="tab" aria-selected="' + (queueFilter === tab.key) + '" data-action="queue" data-key="' + tab.key + '">' +
                tab.label + '<span class="seg__count num">' + tab.count + "</span></button>"
              );
            })
            .join("") +
        "</div>" +
      "</div>" +

      '<div class="pad" style="margin-top:12px">' + fleetMap() + "</div>" +

      '<div class="pad section-gap">' +
        '<div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:8px">' +
          '<h2 class="h2">' + (queueFilter === "risk" ? "Waiting over 10 min" : queueFilter === "active" ? "On the road" : "Waiting for a driver") + "</h2>" +
          '<span class="meta num">' + list.length + " orders</span>" +
        "</div>" +
        (list.length
          ? '<div class="list">' + list.map(orderRow).join("") + "</div>"
          : '<div class="card"><div class="empty"><i class="ph ph-check-circle"></i>' +
              '<div class="empty__title">Nothing waiting</div>' +
              '<div class="empty__body">Every ready order has a driver on it.</div>' +
            "</div></div>") +
      "</div>" +

      '<div class="pad section-gap">' +
        '<div class="list">' +
          '<button class="row" data-action="pin-sheet">' +
            '<i class="ph ph-lock-key" style="font-size:17px"></i>' +
            '<span class="row__body"><span class="row__title" style="display:block">Owner security</span>' +
            '<span class="meta">Change the four-digit PIN. Stored as a salted hash.</span></span>' +
            '<i class="ph ph-caret-right" style="color:var(--muted-2);font-size:12px"></i>' +
          "</button>" +
          '<button class="row" data-action="lock">' +
            '<i class="ph ph-lock-simple" style="font-size:17px"></i>' +
            '<span class="row__body"><span class="row__title" style="display:block">Lock this console</span>' +
            '<span class="meta">You will need the PIN again to get back in</span></span>' +
            '<i class="ph ph-caret-right" style="color:var(--muted-2);font-size:12px"></i>' +
          "</button>" +
        "</div>" +
      "</div>" +
      '<div style="height:18px"></div>';
  }

  function renderOrdersView() {
    var orders = openOrders()
      .slice()
      .sort(function (a, b) {
        return new Date(a.promisedAt) - new Date(b.promisedAt);
      });

    main.innerHTML =
      '<div class="pad section-gap">' +
        '<div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:8px">' +
          '<h2 class="h2">Open orders</h2>' +
          '<span class="meta num">' + orders.length + " active</span>" +
        "</div>" +
        (orders.length
          ? '<div class="list">' + orders.map(orderRow).join("") + "</div>"
          : '<div class="card"><div class="empty"><i class="ph ph-receipt"></i><div class="empty__title">No open orders</div></div></div>') +
      "</div>" +
      '<div class="list-note">Sorted by promised time, soonest first.</div>' +
      '<div style="height:18px"></div>';
  }

  /* ---------------- Shops ---------------- */

  function shopSearchTerms() {
    return String(shopQuery || "")
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
  }

  function filteredShops() {
    var terms = shopSearchTerms();
    return KF.shops()
      .filter(function (shop) {
        if (shopStatus === "active" && !shop.accepting) return false;
        if (shopStatus === "paused" && shop.accepting) return false;
        if (shopTownship !== "All" && shop.township !== shopTownship) return false;
        if (!terms.length) return true;
        var haystack = [shop.name, shop.email, shop.shopId, shop.township].join(" ").toLowerCase();
        return terms.every(function (term) {
          return haystack.indexOf(term) !== -1;
        });
      })
      .sort(function (a, b) {
        if (a.accepting !== b.accepting) return a.accepting ? -1 : 1;
        return String(a.name).localeCompare(String(b.name));
      });
  }

  function shopRow(shop) {
    var stats = KF.shopStats(shop.shopId);
    return (
      '<button class="row" data-open-shop="' + esc(shop.shopId) + '">' +
        '<span class="avatar">' + esc(UI.initials(shop.name)) + "</span>" +
        '<span class="row__body">' +
          '<span style="display:flex;align-items:center;gap:6px">' +
            '<span class="row__title truncate">' + esc(shop.name) + "</span>" +
            '<span class="dot dot--' + (shop.accepting ? "green" : "muted") + '"></span>' +
          "</span>" +
          '<span class="row__lines"><span class="num">' + esc(shop.shopId) + '</span><span class="sep"></span>' +
            '<span class="truncate">' + esc(shop.email) + "</span></span>" +
          '<span class="row__lines"><span>' + esc(shop.township) + "</span>" +
            '<span class="sep"></span><span class="num">' + money(shop.fee) + " fee</span>" +
            '<span class="sep"></span><span class="num">' + stats.open + " open</span></span>" +
        "</span>" +
        '<i class="ph ph-caret-right" style="color:var(--muted-2);font-size:12px"></i>' +
      "</button>"
    );
  }

  function renderShops() {
    var all = KF.shops();
    var accepting = all.filter(function (shop) { return shop.accepting; }).length;
    var tabs = [
      { key: "all", label: "All", count: all.length },
      { key: "active", label: "Accepting", count: accepting },
      { key: "paused", label: "Paused", count: all.length - accepting }
    ];
    var townships = [{ value: "All", label: "All townships" }].concat(
      KF.townships().map(function (name) {
        return { value: name, label: name };
      })
    );

    main.innerHTML =
      '<div class="pad" style="padding-top:12px">' +
        '<div class="search">' +
          '<i class="ph ph-magnifying-glass"></i>' +
          '<label class="sr-only" for="shopSearch">Search shops by name, registered email or shop ID</label>' +
          '<input id="shopSearch" type="search" autocomplete="off" spellcheck="false" ' +
            'placeholder="Name, email or shop ID" value="' + esc(shopQuery) + '">' +
          (shopQuery ? '<button class="search__clear" data-action="shop-search-clear" aria-label="Clear shop search"><i class="ph ph-x"></i></button>' : "") +
        "</div>" +
        '<div class="seg" role="tablist" aria-label="Shop status" style="margin-top:10px">' +
          tabs
            .map(function (tab) {
              return (
                '<button role="tab" aria-selected="' + (shopStatus === tab.key) + '" data-action="shop-status" data-key="' + tab.key + '">' +
                tab.label + '<span class="seg__count num">' + tab.count + "</span></button>"
              );
            })
            .join("") +
        "</div>" +
      "</div>" +

      '<div class="rail" style="margin-top:10px" role="group" aria-label="Filter by township">' +
        townships
          .map(function (option) {
            return (
              '<button class="chip" data-action="shop-township" data-value="' + esc(option.value) + '" aria-pressed="' +
              (shopTownship === option.value) + '">' + esc(option.label) + "</button>"
            );
          })
          .join("") +
      "</div>" +

      '<div id="shopList">' + shopListHtml() + "</div>";
  }

  function shopListHtml() {
    var all = KF.shops();
    var accepting = all.filter(function (shop) {
      return shop.accepting;
    }).length;
    var list = filteredShops();

    return (
      '<div class="pad section-gap">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:9px">' +
          '<div style="min-width:0">' +
            '<h2 class="h2">Registered shops</h2>' +
            '<div class="meta num">' + list.length + " of " + all.length + " shops, " + accepting + " accepting orders</div>" +
          "</div>" +
          '<button class="btn btn--primary btn--sm" data-action="add-shop"><i class="ph ph-plus"></i>Add shop</button>' +
        "</div>" +
        (list.length
          ? '<div class="list">' + list.map(shopRow).join("") + "</div>"
          : '<div class="card"><div class="empty"><i class="ph ph-storefront"></i>' +
              '<div class="empty__title">No shop matches that</div>' +
              '<div class="empty__body">Search by registered email, shop ID or name, or clear the filters.</div>' +
            "</div></div>") +
      "</div>" +
      '<div class="list-note">Every shop signs in to the kitchen app with its registered email and shop ID.</div>' +
      '<div style="height:18px"></div>'
    );
  }

  function openShopSheet(shopId) {
    var shop = KF.shopById(shopId);
    if (!shop) return;
    var stats = KF.shopStats(shop.shopId);
    var activity = KF.shopActivity(shop.shopId);

    UI.openSheet(
      '<div class="sheet__title">' + esc(shop.name) + "</div>" +
      '<div class="sheet__body">' +
        '<div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap">' +
          '<span class="shop-id num">' + esc(shop.shopId) + "</span>" +
          '<span class="badge badge--' + (shop.accepting ? "green" : "ink") + '">' +
            (shop.accepting ? "Accepting orders" : "Paused") + "</span>" +
        "</div>" +
        '<div class="divider"></div>' +
        '<div class="kv"><dt>Registered email</dt><dd style="font-weight:500;word-break:break-word">' + esc(shop.email) + "</dd></div>" +
        '<div class="kv"><dt>Township</dt><dd style="font-weight:500">' + esc(shop.township) + "</dd></div>" +
        '<div class="kv"><dt>Address</dt><dd style="font-weight:500">' + esc(shop.street) + ", " + esc(shop.area) + "</dd></div>" +
        '<div class="kv"><dt>Contact</dt><dd class="num">' + esc(shop.phone) + "</dd></div>" +
        '<div class="kv"><dt>Kitchen</dt><dd style="font-weight:500">' + esc(shop.cuisine) + "</dd></div>" +
        '<div class="kv"><dt>Delivery fee</dt><dd>' + money(shop.fee) + "</dd></div>" +
        '<div class="kv"><dt>Preparation</dt><dd class="num">' + shop.etaMin[1] + " min</dd></div>" +
        '<div class="kv"><dt>Menu</dt><dd class="num">' + shop.menu.length + (shop.menu.length === 1 ? " dish" : " dishes") + "</dd></div>" +
        '<div class="divider"></div>' +
        '<div class="stats">' +
          "<div><dt>Open orders</dt><dd>" + stats.open + "</dd></div>" +
          "<div><dt>Completed</dt><dd>" + stats.done + "</dd></div>" +
          "<div><dt>Takings</dt><dd>" + money(stats.takings) + "</dd></div>" +
        "</div>" +
        '<div style="margin-top:12px">' +
          '<button class="row" style="padding:10px 0" data-action="shop-accepting" data-id="' + esc(shop.shopId) + '" ' +
            'role="switch" aria-checked="' + shop.accepting + '">' +
            '<span class="row__body"><span class="row__title" style="display:block">Accepting orders</span>' +
            '<span class="meta">Turn off to stop new tickets reaching this kitchen</span></span>' +
            '<span class="switch" aria-checked="' + shop.accepting + '"></span>' +
          "</button>" +
        "</div>" +
        (activity.length
          ? '<div class="divider"></div><div class="label">Registry activity</div>' +
            '<div class="audit">' +
              activity
                .map(function (entry) {
                  return (
                    '<div class="audit__row"><span class="audit__text">' + esc(entry.detail || entry.action) + "</span>" +
                    '<span class="audit__time num">' + esc(UI.ago(entry.at)) + "</span></div>"
                  );
                })
                .join("") +
            "</div>"
          : "") +
      "</div>" +
      '<div class="sheet__foot"><div class="btn-row">' +
        '<button class="btn btn--ghost btn--lg" data-action="edit-shop" data-id="' + esc(shop.shopId) + '">Edit details</button>' +
        '<button class="btn btn--primary btn--lg" data-action="close-sheet">Done</button>' +
      "</div></div>"
    );
  }

  /* ---------------- Add / edit shop ---------------- */

  function field(control) {
    return UI.field({
      name: control.name,
      label: control.label,
      type: control.type,
      value: shopForm[control.name],
      placeholder: control.placeholder,
      hint: control.hint,
      inputmode: control.inputmode,
      autocomplete: control.autocomplete,
      error: shopErrors[control.name],
      options: control.type === "select" ? control.options : null
    });
  }

  function renderShopForm() {
    var editing = !!editingShopId;
    var errorCount = Object.keys(shopErrors).length;

    UI.openSheet(
      '<div class="sheet__title">' + (editing ? "Edit shop" : "Add a shop") + "</div>" +
      '<form class="sheet__body stack" id="shopForm" novalidate>' +
        (errorCount
          ? '<div class="notice notice--error"><i class="ph ph-warning-circle"></i><span>' +
            (errorCount === 1 ? "One field needs attention." : errorCount + " fields need attention.") + "</span></div>"
          : '<div class="notice notice--info"><i class="ph ph-identification-card"></i><span>' +
            (editing
              ? "The shop ID stays the same. Changes show up for customers straight away."
              : "The shop ID is issued when you save. The registered email must be unique.") + "</span></div>") +

        field({ name: "name", label: "Registered shop name", placeholder: "e.g. Nomsa's Kitchen", autocomplete: "organization" }) +
        field({ name: "email", label: "Registered email", type: "email", placeholder: "orders@shop.co.za", inputmode: "email", autocomplete: "email", hint: "Used to sign in to the kitchen app" }) +
        field({ name: "township", label: "Township", type: "select", options: KF.townships() }) +
        field({ name: "area", label: "Section or suburb", placeholder: "e.g. Orlando West" }) +
        field({ name: "street", label: "Street address", placeholder: "e.g. 1140 Mputa St", autocomplete: "street-address" }) +
        field({ name: "cuisine", label: "What the kitchen sells", placeholder: "e.g. Kotas, pap and stews" }) +
        field({ name: "phone", label: "Contact number", type: "tel", placeholder: "011 936 4410", inputmode: "tel", autocomplete: "tel" }) +

        '<div class="pair">' +
          field({ name: "fee", label: "Delivery fee (R)", type: "text", inputmode: "decimal", placeholder: "15" }) +
          field({ name: "prepMinutes", label: "Preparation (min)", type: "text", inputmode: "numeric", placeholder: "35" }) +
        "</div>" +

        '<label class="row" style="padding:12px 0;gap:12px">' +
          '<span class="row__body"><span class="row__title" style="display:block">Accepting orders</span>' +
          '<span class="meta">Paused shops stay listed and are marked paused</span></span>' +
          '<span class="switch-control">' +
            '<input type="checkbox" name="accepting"' + (shopForm.accepting ? " checked" : "") + ' aria-label="Accepting orders">' +
            '<span class="switch" aria-hidden="true"></span>' +
          "</span>" +
        "</label>" +
      "</form>" +
      '<div class="sheet__foot"><div class="btn-row">' +
        '<button class="btn btn--ghost btn--lg" data-action="cancel-shop">Cancel</button>' +
        '<button class="btn btn--primary btn--lg" data-action="save-shop">' + (editing ? "Save changes" : "Add shop") + "</button>" +
      "</div></div>"
    );
  }

  function openShopForm(shopId) {
    var shop = shopId ? KF.shopById(shopId) : null;
    editingShopId = shop ? shop.shopId : null;
    shopErrors = {};
    shopForm = shop
      ? {
          name: shop.name,
          email: shop.email,
          township: shop.township,
          area: shop.area,
          street: shop.street,
          cuisine: shop.cuisine,
          phone: shop.phone,
          fee: (shop.fee / 100).toFixed(2).replace(/\.00$/, ""),
          prepMinutes: String(shop.etaMin[1]),
          accepting: shop.accepting
        }
      : {
          name: "",
          email: "",
          township: KF.townships()[0],
          area: "",
          street: "",
          cuisine: "",
          phone: "",
          fee: "15",
          prepMinutes: "35",
          accepting: true
        };
    renderShopForm();
  }

  function readShopForm() {
    var form = document.getElementById("shopForm");
    if (!form || !shopForm) return;
    ["name", "email", "area", "street", "cuisine", "phone", "fee", "prepMinutes"].forEach(function (key) {
      var input = form.elements[key];
      if (input) shopForm[key] = input.value;
    });
    var township = form.elements.township;
    if (township) shopForm.township = township.value;
    var accepting = form.elements.accepting;
    if (accepting) shopForm.accepting = accepting.checked;
  }

  function saveShop() {
    readShopForm();
    var result = editingShopId ? KF.updateShop(editingShopId, shopForm) : KF.addShop(shopForm);
    if (!result.ok) {
      shopErrors = result.errors || { form: "Could not save this shop" };
      renderShopForm();
      UI.toast("Check the highlighted fields");
      return;
    }
    editingShopId = null;
    shopErrors = {};
    UI.closeSheet();
    UI.toast(result.shop.shopId + " saved. " + result.shop.name + " is in the registry.");
    render();
  }

  /* ---------------- Owner PIN rotation ---------------- */

  function openPinSheet() {
    pinErrors = {};
    UI.openSheet(
      '<div class="sheet__title">Change owner PIN</div>' +
      '<form class="sheet__body stack" id="pinForm" novalidate>' +
        '<div class="notice notice--info"><i class="ph ph-shield-check"></i><span>' +
          "The PIN is stored as a salted SHA-256 hash in this browser. It is never written in the clear." +
        "</span></div>" +
        '<label class="field' + (pinErrors.current ? " field--invalid" : "") + '">Current PIN' +
          '<input name="current" type="password" inputmode="numeric" maxlength="4" autocomplete="current-password" placeholder="4 digits">' +
          (pinErrors.current ? '<span class="field__error"><i class="ph ph-warning-circle"></i>' + esc(pinErrors.current) + "</span>" : "") +
        "</label>" +
        '<label class="field' + (pinErrors.next ? " field--invalid" : "") + '">New PIN' +
          '<input name="next" type="password" inputmode="numeric" maxlength="4" autocomplete="new-password" placeholder="4 digits">' +
          (pinErrors.next ? '<span class="field__error"><i class="ph ph-warning-circle"></i>' + esc(pinErrors.next) + "</span>" : "") +
        "</label>" +
        '<label class="field' + (pinErrors.confirm ? " field--invalid" : "") + '">Repeat new PIN' +
          '<input name="confirm" type="password" inputmode="numeric" maxlength="4" autocomplete="new-password" placeholder="4 digits">' +
          (pinErrors.confirm ? '<span class="field__error"><i class="ph ph-warning-circle"></i>' + esc(pinErrors.confirm) + "</span>" : "") +
        "</label>" +
      "</form>" +
      '<div class="sheet__foot"><div class="btn-row">' +
        '<button class="btn btn--ghost btn--lg" data-action="close-sheet">Cancel</button>' +
        '<button class="btn btn--primary btn--lg" data-action="save-pin">Save PIN</button>' +
      "</div></div>"
    );
  }

  function savePin() {
    var form = document.getElementById("pinForm");
    if (!form) return;
    var current = String(form.elements.current.value || "");
    var next = String(form.elements.next.value || "");
    var confirm = String(form.elements.confirm.value || "");
    pinErrors = {};

    if (!/^\d{4}$/.test(next)) pinErrors.next = "Use exactly four digits";
    else if (next !== confirm) pinErrors.confirm = "The two new PINs do not match";

    if (Object.keys(pinErrors).length) {
      openPinSheet();
      return;
    }

    var result = KF.changePin(current, next);
    if (!result.ok) {
      if (result.reason === "current") pinErrors.current = "That is not the current PIN";
      else if (result.reason === "same") pinErrors.next = "Choose a different PIN";
      else pinErrors.next = "Use exactly four digits";
      openPinSheet();
      return;
    }

    UI.closeSheet();
    UI.toast("Owner PIN changed");
  }

  /* ---------------- Drivers ---------------- */

  function renderDrivers() {
    var drivers = KF.get().drivers;
    main.innerHTML =
      '<div class="pad section-gap">' +
        '<div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:8px">' +
          '<h2 class="h2">Drivers</h2>' +
          '<span class="meta num">' + drivers.length + " on the roster</span>" +
        "</div>" +
        '<div class="list">' +
          drivers
            .map(function (driver) {
              var state = driverState(driver);
              var lines = "";
              if (state.order) {
                lines =
                  '<span class="row__lines"><span>' + state.label + " " + state.order.id + "</span>" +
                  '<span class="sep"></span><span>Drop ' + esc(state.order.address.suburb) + "</span></span>" +
                  '<span class="row__lines"><span class="num">Location ' + UI.ago(driver.lastFix) + "</span>" +
                  '<span class="sep"></span><span class="num">' + state.order.distKm.toFixed(1) + " km left</span></span>";
              } else {
                lines =
                  '<span class="row__lines"><span>' + state.label + "</span>" +
                  '<span class="sep"></span><span class="num">Location ' + UI.ago(driver.lastFix) + "</span></span>" +
                  '<span class="row__lines"><span>' + esc(driver.vehicle) + "</span></span>";
              }
              return (
                '<button class="row" data-open-driver="' + driver.id + '">' +
                  '<span class="row__body">' +
                    '<span style="display:flex;align-items:center;gap:7px">' +
                      '<span class="row__title">' + esc(driver.name) + "</span>" +
                      '<span class="dot dot--' + state.tone + '"></span>' +
                    "</span>" +
                    lines +
                  "</span>" +
                  '<i class="ph ph-caret-right" style="color:var(--muted-2);font-size:12px"></i>' +
                "</button>"
              );
            })
            .join("") +
        "</div>" +
      "</div>" +
      '<div style="height:18px"></div>';
  }

  /* ---------------- Payouts ---------------- */

  function renderPayouts() {
    var drivers = KF.get().drivers;
    var total = 0;

    var rows = drivers.map(function (driver) {
      var day = KF.driverDay(driver.id);
      total += day.earned;
      return (
        '<div class="row">' +
          '<span class="avatar">' + esc(UI.initials(driver.name)) + "</span>" +
          '<span class="row__body">' +
            '<span class="row__title">' + esc(driver.name) + "</span>" +
            '<span class="row__lines"><span class="num">' + day.count + (day.count === 1 ? " delivery today" : " deliveries today") + "</span>" +
            '<span class="sep"></span><span class="num">' + esc(driver.vehicle) + "</span></span>" +
          "</span>" +
          '<span style="flex:0 0 auto;text-align:right">' +
            '<span class="num" style="display:block;font-weight:650;font-size:13.5px">' + money(day.earned) + "</span>" +
            '<span class="meta">' + (day.count ? "Due Friday" : "Nothing due") + "</span>" +
          "</span>" +
        "</div>"
      );
    });

    main.innerHTML =
      '<div class="pad section-gap">' +
        '<div class="card card--pad">' +
          '<div class="label">Due Friday</div>' +
          '<div class="price-chip" style="font-size:26px;margin-top:4px">' + money(total) + "</div>" +
          '<div class="meta" style="margin-top:2px">Driver payouts on delivered orders</div>' +
        "</div>" +
      "</div>" +
      '<div class="pad section-gap"><div class="list">' + rows.join("") + "</div></div>" +
      '<div style="height:18px"></div>';
  }

  /* ---------------- Sheets ---------------- */

  function openOrderSheet(id) {
    var order = KF.order(id);
    if (!order) return;
    var shop = KF.vendor(order.vendorId);
    var driver = order.driverId ? KF.driver(order.driverId) : null;
    var items = order.items.reduce(function (sum, item) { return sum + item.qty; }, 0);

    UI.openSheet(
      '<div class="sheet__title num">' + order.id + "</div>" +
      '<div class="sheet__body">' +
        '<div style="display:flex;gap:7px;align-items:center;flex-wrap:wrap">' +
          UI.orderBadge(order) +
          '<span class="meta num">Promised ' + UI.clock(order.promisedAt) + "</span>" +
        "</div>" +
        '<div class="divider"></div>' +
        '<div class="kv"><dt>Restaurant</dt><dd style="font-weight:500">' + esc(shop.name) + ", " + esc(shop.township) + "</dd></div>" +
        '<div class="kv"><dt>' + (order.fulfilment === "collect" ? "Collection point" : "Drop-off") + "</dt>" +
          '<dd style="font-weight:500">' + esc(order.address.street) + ", " + esc(order.address.suburb) + "</dd></div>" +
        '<div class="kv"><dt>Customer</dt><dd style="font-weight:500">' + esc(order.customer.name) + "</dd></div>" +
        '<div class="kv"><dt>Items</dt><dd>' + items + "</dd></div>" +
        '<div class="kv"><dt>Total</dt><dd>' + money(order.total) + "</dd></div>" +
        '<div class="kv"><dt>Fulfilment</dt><dd>' + (order.fulfilment === "collect" ? "Collection" : "Delivery") + "</dd></div>" +
        (order.fulfilment === "collect"
          ? '<div class="kv"><dt>Collection code</dt><dd class="num">' + esc(order.collectCode || "—") + "</dd></div>"
          : '<div class="kv"><dt>Driver</dt><dd>' +
            (driver
              ? esc(driver.name)
              : UI.minutesSince(order.readyAt || order.placedAt) < 1
                ? "Unassigned just now"
                : "Unassigned " + UI.minutesSince(order.readyAt || order.placedAt) + " min") +
            "</dd></div>") +
        '<div class="divider"></div>' +
        '<div class="list" style="border-radius:12px">' +
          order.items
            .map(function (item) {
              return (
                '<div class="row" style="padding:9px 12px">' +
                  '<span class="qty-badge">' + item.qty + "</span>" +
                  '<span class="row__body"><span class="row__title" style="display:block;font-weight:600">' + esc(item.name) + "</span>" +
                  (item.note ? '<span class="meta">' + esc(item.note) + "</span>" : "") +
                  "</span>" +
                "</div>"
              );
            })
            .join("") +
        "</div>" +
      "</div>" +
      '<div class="sheet__foot">' +
        (driver
          ? '<a class="btn btn--primary btn--lg btn--block" href="tel:' + esc(String(driver.phone || "").replace(/\s/g, "")) + '">Call ' + esc(driver.name) + "</a>"
          : order.fulfilment === "collect"
            ? '<div class="notice notice--info"><i class="ph ph-shopping-bag"></i><span>Collection order. The customer collects at the counter with code ' +
              esc(order.collectCode || "—") + ".</span></div>"
            : '<div class="notice notice--info"><i class="ph ph-steering-wheel"></i><span>Waiting for a driver to claim this order in the driver app.</span></div>') +
      "</div>"
    );
  }

  function openDriverSheet(id) {
    var driver = KF.driver(id);
    if (!driver) return;
    var state = driverState(driver);

    var mapHtml = "";
    if (state.order) {
      var order = state.order;
      var last = orderTail(order);
      mapHtml =
        '<div class="map" style="height:210px;position:relative;margin-top:10px">' +
          UI.map({
            height: 210,
            pins: [
              { x: order.pickup[0], y: order.pickup[1], type: "vendor" },
              { x: last[0], y: last[1], type: "driver" },
              { x: order.drop[0], y: order.drop[1], type: "drop" }
            ],
            trail: order.status === "picked_up" ? order.trail : null,
            planned: order.remaining,
            label: "Recorded route for " + driver.name
          }) +
          '<div class="map__chip map__chip--bl num">' + order.distKm.toFixed(1) + " km left</div>" +
        "</div>";
    }

    UI.openSheet(
      '<div class="sheet__title">' + esc(driver.name) + "</div>" +
      '<div class="sheet__body">' +
        '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
          '<span class="badge badge--' + (state.tone === "muted" ? "ink" : state.tone) + '">' + state.label + "</span>" +
          '<span class="meta num">Location ' + UI.ago(driver.lastFix) + "</span>" +
        "</div>" +
        '<div class="divider"></div>' +
        '<div class="kv"><dt>Vehicle</dt><dd style="font-weight:500">' + esc(driver.vehicle) + "</dd></div>" +
        '<div class="kv"><dt>Zone</dt><dd style="font-weight:500">' + esc(driver.zone) + "</dd></div>" +
        (state.order
          ? '<div class="kv"><dt>Order</dt><dd>' + state.order.id + "</dd></div>" +
            '<div class="kv"><dt>Drop-off</dt><dd style="font-weight:500">' + esc(state.order.address.suburb) + "</dd></div>"
          : "") +
        mapHtml +
      "</div>" +
      '<div class="sheet__foot"><a class="btn btn--primary btn--lg btn--block" href="tel:' +
        esc(String(driver.phone || "").replace(/\s/g, "")) + '">Call ' + esc(driver.name.split(" ")[0]) + "</a></div>"
    );
  }

  /* ---------------- Render ---------------- */

  function render() {
    if (!unlocked) {
      renderLock();
      return;
    }
    var view = route();
    renderHeader(view);
    if (view === "orders") renderOrdersView();
    else if (view === "shops") renderShops();
    else if (view === "drivers") renderDrivers();
    else if (view === "payouts") renderPayouts();
    else renderFleet();
    renderNav(view);
  }

  /* ---------------- Events ---------------- */

  function submitPin() {
    if (pin.length !== 4) return;
    suppressRender = true;
    var result = KF.verifyPin(pin);
    suppressRender = false;

    if (result.ok) {
      unlocked = true;
      pin = "";
      pinError = "";
      try {
        sessionStorage.setItem(UNLOCK_KEY, "1");
      } catch (error) {
        /* ignore */
      }
      stopTicker();
      if (!location.hash) location.replace("#/fleet");
      render();
      UI.toast("Console unlocked");
      return;
    }

    pin = "";
    pinError = result.locked
      ? ""
      : "Incorrect PIN. " + result.attemptsLeft + " attempt" + (result.attemptsLeft === 1 ? "" : "s") + " left before a 5 minute lock.";
    renderLock();
  }

  document.addEventListener("click", function (event) {
    var nav = event.target.closest("[data-nav]");
    if (nav) {
      event.preventDefault();
      go(nav.getAttribute("data-nav"));
      return;
    }

    var orderTarget = event.target.closest("[data-open-order]");
    if (orderTarget) {
      openOrderSheet(orderTarget.getAttribute("data-open-order"));
      return;
    }

    var driverTarget = event.target.closest("[data-open-driver]");
    if (driverTarget) {
      openDriverSheet(driverTarget.getAttribute("data-open-driver"));
      return;
    }

    var shopTarget = event.target.closest("[data-open-shop]");
    if (shopTarget) {
      openShopSheet(shopTarget.getAttribute("data-open-shop"));
      return;
    }

    var action = event.target.closest("[data-action]");
    if (!action) return;
    var name = action.getAttribute("data-action");

    if (name === "close-sheet" || name === "cancel-shop") {
      UI.closeSheet();
      return;
    }

    if (name === "add-shop") {
      openShopForm(null);
      return;
    }

    if (name === "edit-shop") {
      openShopForm(action.getAttribute("data-id"));
      return;
    }

    if (name === "save-shop") {
      saveShop();
      return;
    }

    if (name === "shop-accepting") {
      var shopId = action.getAttribute("data-id");
      var shop = KF.shopById(shopId);
      if (!shop) return;
      KF.setShopAccepting(shopId, !shop.accepting);
      openShopSheet(shopId);
      render();
      UI.toast(shop.name + (shop.accepting ? " is taking orders" : " paused new orders"));
      return;
    }

    if (name === "pin-sheet") {
      openPinSheet();
      return;
    }

    if (name === "save-pin") {
      savePin();
      return;
    }

    if (name === "shop-status") {
      shopStatus = action.getAttribute("data-key");
      renderShops();
      return;
    }

    if (name === "shop-township") {
      shopTownship = action.getAttribute("data-value") || "All";
      renderShops();
      return;
    }

    if (name === "shop-search-clear") {
      shopQuery = "";
      renderShops();
      return;
    }

    if (name === "pin-digit") {
      if (pin.length >= 4 || KF.adminState().locked) return;
      pin += action.getAttribute("data-digit");
      pinError = "";
      renderLock();
      return;
    }

    if (name === "pin-back") {
      pin = pin.slice(0, -1);
      renderLock();
      return;
    }

    if (name === "pin-clear") {
      pin = "";
      pinError = "";
      renderLock();
      return;
    }

    if (name === "unlock") {
      submitPin();
      return;
    }

    if (name === "lock") {
      unlocked = false;
      pin = "";
      pinError = "";
      try {
        sessionStorage.removeItem(UNLOCK_KEY);
      } catch (error) {
        /* ignore */
      }
      UI.closeSheet();
      render();
      UI.toast("Console locked");
      return;
    }

    if (name === "queue") {
      queueFilter = action.getAttribute("data-key");
      renderFleet();
    }
  });

  document.addEventListener("submit", function (event) {
    if (event.target.id === "shopForm") {
      event.preventDefault();
      saveShop();
      return;
    }
    if (event.target.id === "pinForm") {
      event.preventDefault();
      savePin();
    }
  });

  document.addEventListener("input", function (event) {
    /* Editing a field clears its validation message straight away. */
    var owner = event.target.closest ? event.target.closest("#shopForm .field") : null;
    if (owner) {
      owner.classList.remove("field--invalid");
      var note = owner.querySelector(".field__error");
      if (note) note.remove();
      var key = event.target.getAttribute("name");
      if (key) delete shopErrors[key];
      if (!Object.keys(shopErrors).length) {
        var alert = document.querySelector("#shopForm .notice--error");
        if (alert) alert.remove();
      }
    }

    if (event.target.id !== "shopSearch") return;
    shopQuery = event.target.value;
    var host = document.getElementById("shopList");
    if (host) host.innerHTML = shopListHtml();

    var box = event.target.closest(".search");
    var clear = box ? box.querySelector(".search__clear") : null;
    if (shopQuery && box && !clear) {
      box.insertAdjacentHTML(
        "beforeend",
        '<button class="search__clear" data-action="shop-search-clear" aria-label="Clear shop search"><i class="ph ph-x"></i></button>'
      );
    } else if (!shopQuery && clear) {
      clear.remove();
    }
  });

  window.addEventListener("hashchange", render);

  KF.subscribe(function () {
    if (suppressRender) return;
    if (unlocked) render();
    else renderLock();
  });

  UI.bindSheetDismissal();

  if (!location.hash) location.replace("#/fleet");
  render();
})();
