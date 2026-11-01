/* Customer app: discover restaurants, build a basket, checkout, track the order. */
(function () {
  "use strict";

  var UI = window.KFUI;
  var KF = window.KF;
  var money = UI.money;
  var esc = UI.escape;
  var localOrigin = location.protocol === "file:" ? "http://127.0.0.1:3000" :
    /^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? location.origin : "";
  var API = String(window.KF_API_URL || localOrigin).replace(/\/+$/, "");
  var SESSION_KEY = "kf.customer.session";

  var header = document.getElementById("header");
  var main = document.getElementById("main");
  var bottom = document.getElementById("bottom");
  var customerSession = null;
  var authMode = "login";
  var remoteTrackingOrderId = null;
  var remoteTrackingPoller = null;
  var remoteTrackingData = null;
  var remoteOrders = [];

  function renderAuth(message) {
    header.className = "app-header";
    header.innerHTML = '<div class="header-row"><div class="brand">Kassi<em>Fleet</em></div>' +
      '<a class="icon-btn" href="./index.html" aria-label="All Kassifleet apps"><i class="ph ph-squares-four"></i></a></div>';
    bottom.innerHTML = "";
    main.innerHTML =
      '<div class="pad section-gap"><div class="card card--pad">' +
        '<div class="label">CUSTOMER ACCESS</div>' +
        '<h1 class="h2" style="margin-top:5px">' + (authMode === "login" ? "Sign in to order" : "Create your customer account") + "</h1>" +
        '<p class="meta" style="margin-top:5px">Sign in to browse restaurants and keep your orders together.</p>' +
        '<div style="display:flex;gap:8px;margin-top:16px">' +
          '<button class="btn ' + (authMode === "login" ? "btn--primary" : "btn--quiet") + '" data-auth-mode="login">Sign in</button>' +
          '<button class="btn ' + (authMode === "register" ? "btn--primary" : "btn--quiet") + '" data-auth-mode="register">Create account</button>' +
        "</div>" +
        '<form id="customerAuthForm" class="stack" style="margin-top:16px">' +
          (authMode === "register"
            ? '<label class="field">Full name<input name="name" autocomplete="name" maxlength="100" required></label>' : "") +
          '<label class="field">Email<input name="email" type="email" autocomplete="email" maxlength="254" required></label>' +
          '<label class="field">Password<input name="password" type="password" autocomplete="' +
            (authMode === "login" ? "current-password" : "new-password") + '" minlength="8" maxlength="128" required></label>' +
          '<button class="btn btn--primary btn--block" type="submit">' +
            (authMode === "login" ? "Sign in" : "Create account") + "</button>" +
        "</form>" +
        '<div class="meta" role="status" aria-live="polite" style="margin-top:12px;color:var(--danger)">' + esc(message || "") + "</div>" +
      "</div></div>";
  }

  function activateSession(session) {
    if (!session.user || session.user.role !== "customer" || !KF.setCustomerIdentity(session.user)) {
      throw new Error("A valid customer account is required.");
    }
    customerSession = session;
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    render();
  }

  async function restoreSession() {
    var saved;
    try {
      saved = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null");
    } catch (error) {
      saved = null;
    }
    if (!saved || !saved.accessToken || !saved.user) return renderAuth("");
    if (!API) return renderAuth("Customer login needs the deployed backend URL. Set KF_API_URL in apps/js/config.js.");

    try {
      var response = await fetch(API + "/api02/menu", {
        headers: { Authorization: "Bearer " + saved.accessToken }
      });
      if (!response.ok) throw new Error("Your session expired. Sign in again.");
      activateSession(saved);
    } catch (error) {
      sessionStorage.removeItem(SESSION_KEY);
      customerSession = null;
      renderAuth(error.message || "Could not reach the server. Start the Kassi Fleet backend and try again.");
    }
  }

  var uiState = {
    query: "",
    category: "All",
    tip: 1000,
    payment: "cash",
    note: "",
    fulfilment: "delivery",
    sort: "fastest",
    filters: {
      township: "All",
      maxFee: null,
      maxEta: null,
      minRating: null,
      acceptingOnly: false,
      shopQuery: ""
    }
  };

  var SORTS = [
    { key: "fastest", label: "Fastest delivery" },
    { key: "cheapest", label: "Lowest delivery fee" },
    { key: "rating", label: "Highest rated" }
  ];

  var FEE_OPTIONS = [
    { value: null, label: "Any fee" },
    { value: 1000, label: "Under R10" },
    { value: 2000, label: "Under R20" }
  ];

  var ETA_FILTERS = [
    { value: null, label: "Any time" },
    { value: 25, label: "Under 25 min" },
    { value: 35, label: "Under 35 min" }
  ];

  var RATINGS = [
    { value: null, label: "Any rating" },
    { value: 4.5, label: "4.5 and up" },
    { value: 4.7, label: "4.7 and up" }
  ];

  var CATEGORIES = [
    { key: "All", test: function () { return true; } },
    { key: "Kotas", test: function (v) { return hasCategory(v, "kota"); } },
    { key: "Pap and stews", test: function (v) { return hasCategory(v, "pap"); } },
    { key: "Braai", test: function (v) { return hasCategory(v, "grill") || hasCategory(v, "platter"); } },
    { key: "Hake", test: function (v) { return hasCategory(v, "hake"); } },
    { key: "Deli", test: function (v) { return hasCategory(v, "roll") || hasCategory(v, "sandwich"); } }
  ];

  function hasCategory(vendor, term) {
    return vendor.menu.some(function (item) {
      return item.category.toLowerCase().indexOf(term) !== -1;
    });
  }

  function route() {
    var raw = location.hash.replace(/^#\/?/, "");
    var parts = raw.split("/");
    var name = parts[0] || "home";
    if (name === "r") name = "restaurant";
    if (name === "remote-track") return { name: name, id: decodeURIComponent(parts[1] || "") };
    return { name: name, id: parts[1] || null };
  }

  function dotTone(status) {
    var tone = UI.statusMeta(status).tone;
    if (tone === "green") return "green";
    if (tone === "amber") return "amber";
    if (tone === "accent") return "accent";
    if (tone === "danger") return "accent";
    return "muted";
  }

  function go(hash) {
    if (location.hash === hash) render();
    else location.hash = hash;
  }

  function vendorById(id) {
    return KF.vendor(id);
  }

  /* ---------------- Header ---------------- */

  function renderHeader(view) {
    var state = KF.get();

    if (view.name === "restaurant") {
      var shop = vendorById(view.id);
      header.className = "app-header app-header--line";
      header.innerHTML =
        '<div class="header-row">' +
          '<button class="icon-btn" data-back aria-label="Back to restaurants"><i class="ph ph-arrow-left"></i></button>' +
          '<div class="header-title" style="flex:1">' +
            '<div style="min-width:0">' +
              '<div class="h2 truncate">' + esc(shop ? shop.name : "Restaurant") + "</div>" +
              '<div class="meta truncate">' + esc(shop ? shop.cuisine : "") + "</div>" +
            "</div>" +
          "</div>" +
          '<button class="icon-btn" data-nav="#/orders" aria-label="Your orders"><i class="ph ph-receipt"></i></button>' +
        "</div>";
      return;
    }

    if (view.name === "checkout") {
      header.className = "app-header app-header--line";
      header.innerHTML =
        '<div class="header-row">' +
          '<button class="icon-btn" data-back aria-label="Back"><i class="ph ph-arrow-left"></i></button>' +
          '<div class="header-title" style="flex:1">' +
            '<div style="min-width:0"><div class="h2">Checkout</div>' +
            '<div class="meta truncate">' + esc((KF.basketView().vendor || {}).name || "") + "</div></div>" +
          "</div>" +
        "</div>";
      return;
    }

    if (view.name === "track") {
      var order = KF.order(view.id);
      var collect = order && order.fulfilment === "collect";
      header.className = "app-header app-header--line";
      header.innerHTML =
        '<div class="header-row">' +
          '<button class="icon-btn" data-nav="#/orders" aria-label="Back to your orders"><i class="ph ph-arrow-left"></i></button>' +
          '<div class="header-title" style="flex:1">' +
            '<div style="min-width:0"><div class="h2">' + (collect ? "Collection" : "Order " + esc(view.id)) + "</div>" +
            '<div class="meta truncate">' + (collect ? esc(view.id) + " · " : "") +
              esc(order ? vendorById(order.vendorId).name : "") + "</div></div>" +
          "</div>" +
          '<button class="icon-btn" data-nav="#/home" aria-label="Browse restaurants"><i class="ph ph-house"></i></button>' +
        "</div>";
      return;
    }

    if (view.name === "remote-track") {
      header.className = "app-header app-header--line";
      header.innerHTML =
        '<div class="header-row">' +
          '<button class="icon-btn" data-nav="#/orders" aria-label="Back to your orders"><i class="ph ph-arrow-left"></i></button>' +
          '<div class="header-title" style="flex:1"><div style="min-width:0"><div class="h2">Live delivery</div>' +
            '<div class="meta truncate">' + esc(view.id) + "</div></div></div>" +
          '<button class="icon-btn" data-nav="#/home" aria-label="Browse restaurants"><i class="ph ph-house"></i></button>' +
        "</div>";
      return;
    }

    if (view.name === "orders") {
      header.className = "app-header";
      header.innerHTML =
        '<div class="header-row">' +
          '<div class="brand">Kassi<em>Fleet</em></div>' +
          '<button class="avatar" data-nav="#/account" aria-label="Your account">' + esc(UI.initials(state.customer.name)) + "</button>" +
        "</div>" +
        '<h1 class="h1" style="margin-top:12px">Your orders</h1>';
      return;
    }

    if (view.name === "account") {
      header.className = "app-header";
      header.innerHTML =
        '<div class="header-row">' +
          '<div class="brand">Kassi<em>Fleet</em></div>' +
          '<button class="icon-btn" data-nav="#/home" aria-label="Back to restaurants"><i class="ph ph-house"></i></button>' +
        "</div>" +
        '<h1 class="h1" style="margin-top:12px">Your account</h1>';
      return;
    }

    /* home */
    header.className = "app-header";
    header.innerHTML =
      '<div class="header-row">' +
        '<div class="brand">Kassi<em>Fleet</em></div>' +
        '<button class="avatar" data-nav="#/account" aria-label="Your account">' + esc(UI.initials(state.customer.name)) + "</button>" +
      "</div>" +
      '<div style="margin-top:10px">' +
        '<div class="label">Deliver to ' + esc(state.customer.address.township || "") + "</div>" +
        '<button class="addr" data-action="address" style="margin-top:3px" aria-label="Change delivery address">' +
          '<i class="ph-fill ph-map-pin" style="color:var(--accent)"></i>' +
          "<span>" + esc(state.customer.address.street) + ", " + esc(state.customer.address.suburb) + "</span>" +
          '<i class="ph ph-caret-down"></i>' +
        "</button>" +
      "</div>" +
      '<div class="search" style="margin-top:10px">' +
        '<i class="ph ph-magnifying-glass"></i>' +
        '<label class="sr-only" for="search">Search restaurants and dishes</label>' +
        '<input id="search" type="search" placeholder="Search restaurants and dishes" autocomplete="off" spellcheck="false" ' +
          'enterkeyhint="search" value="' + esc(uiState.query) + '">' +
        (uiState.query ? '<button class="search__clear" data-action="clear-search" aria-label="Clear search"><i class="ph ph-x"></i></button>' : "") +
      "</div>";
  }

  /* ---------------- Home ---------------- */

  function matches(vendor, terms) {
    if (!terms.length) return true;
    var haystack = [vendor.name, vendor.cuisine, vendor.area, vendor.shopId, vendor.email]
      .concat(vendor.menu.map(function (item) { return item.name; }))
      .join(" ")
      .toLowerCase();
    return terms.every(function (term) { return haystack.indexOf(term) !== -1; });
  }

  function restaurantRow(vendor) {
    var closed = !vendor.accepting;
    return (
      '<button class="rest" data-nav="#/r/' + vendor.id + '" aria-label="' + esc(vendor.name) + '">' +
        '<span class="rest__media"><img src="' + esc(vendor.image) + '" alt="' + esc(vendor.imageAlt) + '" loading="lazy" width="86" height="86"></span>' +
        '<span class="rest__body">' +
          '<span style="display:flex;align-items:center;gap:6px">' +
            '<span class="rest__name truncate">' + esc(vendor.name) + "</span>" +
            (closed ? '<span class="badge badge--ink">Paused</span>' : "") +
          "</span>" +
          '<span class="rest__cuisine" style="display:block">' + esc(vendor.cuisine) + ", " + esc(vendor.township) + "</span>" +
          '<span class="rest__facts">' +
            (vendor.reviews
              ? '<span class="rest__rating"><i class="ph-fill ph-star"></i>' + vendor.rating.toFixed(1) + "</span>" +
                '<span class="sep"></span><span class="num">' + vendor.reviews + "</span>"
              : '<span class="rest__rating">New</span>') +
            '<span class="sep"></span><span>' + esc(UI.etaRange(vendor)) + "</span>" +
            '<span class="sep"></span><span>' + money(vendor.fee) + "</span>" +
          "</span>" +
        "</span>" +
      "</button>"
    );
  }

  function dishResults(query) {
    if (!query) return "";
    var term = query.toLowerCase();
    var rows = [];
    KF.get().vendors.forEach(function (vendor) {
      vendor.menu.forEach(function (item) {
        if (item.name.toLowerCase().indexOf(term) === -1 && item.desc.toLowerCase().indexOf(term) === -1) return;
        rows.push({ vendor: vendor, item: item });
      });
    });
    if (!rows.length) return "";
    return (
      '<div class="pad section-gap">' +
        '<div class="h3" style="margin-bottom:8px">Dishes</div>' +
        '<div class="list">' +
          rows.slice(0, 4).map(function (row) {
            return (
              '<button class="row" data-nav="#/r/' + row.vendor.id + '">' +
                '<span class="row__body">' +
                  '<span class="row__title truncate" style="display:block">' + esc(row.item.name) + "</span>" +
                  '<span class="row__lines"><span>' + esc(row.vendor.name) + "</span><span class=\"sep\"></span><span>" + esc(UI.etaRange(row.vendor)) + "</span></span>" +
                "</span>" +
                '<span class="price-chip" style="font-size:13px">' + money(row.item.price) + "</span>" +
              "</button>"
            );
          }).join("") +
        "</div>" +
      "</div>"
    );
  }

  function passesFilters(vendor) {
    var filters = uiState.filters;
    if (!shopQueryMatches(vendor)) return false;
    if (filters.township !== "All" && vendor.township !== filters.township) return false;
    if (filters.maxEta != null && vendor.etaMin[1] > filters.maxEta) return false;
    if (filters.maxFee != null && vendor.fee > filters.maxFee) return false;
    if (filters.minRating != null && vendor.rating < filters.minRating) return false;
    if (filters.acceptingOnly && !vendor.accepting) return false;
    return true;
  }

  function shopQueryMatches(vendor) {
    var query = uiState.filters.shopQuery.trim().toLowerCase();
    if (!query) return true;
    var haystack = [vendor.name, vendor.email, vendor.shopId, vendor.area].join(" ").toLowerCase();
    return query.split(/\s+/).every(function (term) {
      return haystack.indexOf(term) !== -1;
    });
  }

  function sortVendors(list) {
    var comparators = {
      fastest: function (a, b) { return a.etaMin[1] - b.etaMin[1]; },
      cheapest: function (a, b) { return a.fee - b.fee; },
      rating: function (a, b) { return b.rating - a.rating; }
    };
    var comparator = comparators[uiState.sort] || comparators.fastest;
    return list.slice().sort(function (a, b) {
      /* kitchens that paused orders sit at the bottom of every sort */
      if (a.accepting !== b.accepting) return a.accepting ? -1 : 1;
      return comparator(a, b);
    });
  }

  function filteredVendors() {
    var terms = uiState.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    var category = CATEGORIES.filter(function (c) { return c.key === uiState.category; })[0] || CATEGORIES[0];
    return sortVendors(
      KF.get().vendors.filter(function (v) {
        return category.test(v) && matches(v, terms) && passesFilters(v);
      })
    );
  }

  function sortLabel() {
    var found = SORTS.filter(function (option) { return option.key === uiState.sort; })[0];
    return (found || SORTS[0]).label;
  }

  function activeFilterCount() {
    var filters = uiState.filters;
    var count = 0;
    if (filters.shopQuery.trim()) count += 1;
    if (filters.township !== "All") count += 1;
    if (filters.maxFee != null) count += 1;
    if (filters.maxEta != null) count += 1;
    if (filters.minRating != null) count += 1;
    if (filters.acceptingOnly) count += 1;
    return count;
  }

  function activeFilterList() {
    var filters = uiState.filters;
    var chips = [];
    if (filters.shopQuery.trim()) chips.push({ action: "clear-shop-query", label: "Shop " + filters.shopQuery.trim() });
    if (filters.township !== "All") chips.push({ action: "clear-township", label: filters.township });
    if (filters.maxFee != null) chips.push({ action: "clear-fee", label: "Fee under " + money(filters.maxFee) });
    if (filters.maxEta != null) chips.push({ action: "clear-eta", label: "Under " + filters.maxEta + " min" });
    if (filters.minRating != null) chips.push({ action: "clear-rating", label: filters.minRating.toFixed(1) + " and up" });
    if (filters.acceptingOnly) chips.push({ action: "clear-accepting", label: "Accepting now" });
    return chips;
  }

  function filterChipsHtml() {
    var chips = activeFilterList();
    if (!chips.length) return "";
    return (
      '<div class="rail" style="margin-top:8px">' +
        chips.map(function (chip) {
          return (
            '<button class="chip chip--active" data-action="' + chip.action + '">' +
              esc(chip.label) + '<i class="ph ph-x"></i></button>'
          );
        }).join("") +
        '<button class="chip chip--text" data-action="clear-filters">Clear all</button>' +
      "</div>"
    );
  }

  function feedHtml() {
    var terms = uiState.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    var vendors = filteredVendors();

    if (!vendors.length) {
      return (
        '<div class="pad section-gap"><div class="card">' +
          '<div class="empty"><i class="ph ph-storefront"></i>' +
            '<div class="empty__title">No restaurants match that</div>' +
            '<div class="empty__body">Try another dish, or clear the search.</div>' +
          "</div>" +
        "</div></div>"
      );
    }

    return (
      dishResults(uiState.query) +
      '<div class="pad section-gap">' +
        '<div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:8px">' +
          '<h2 class="h2">Restaurants</h2>' +
          '<span class="meta num">' + vendors.length + " near you</span>" +
        "</div>" +
        '<div class="list">' + vendors.map(restaurantRow).join("") + "</div>" +
      "</div>" +
      '<div class="list-note">Delivery fees and times come from each restaurant.</div>'
    );
  }

  function renderHome() {
    var filterCount = activeFilterCount();
    main.innerHTML =
      '<div style="padding-top:2px">' +
        '<div class="rail" role="group" aria-label="Browse by category" style="margin-top:10px">' +
          CATEGORIES.map(function (category) {
            return (
              '<button class="chip" data-action="category" data-key="' + category.key + '" aria-pressed="' +
                (uiState.category === category.key) + '">' + category.key + "</button>"
            );
          }).join("") +
        "</div>" +

        '<div class="pad tool-row">' +
          '<button class="chip chip--control" data-action="sort" aria-haspopup="dialog">' +
            '<i class="ph ph-sort-ascending"></i>' + esc(sortLabel()) +
            '<i class="ph ph-caret-down"></i>' +
          "</button>" +
          '<button class="chip chip--control" data-action="filters" aria-haspopup="dialog">' +
            '<i class="ph ph-funnel"></i>Filters' +
            (filterCount ? '<span class="chip__count num">' + filterCount + "</span>" : "") +
          "</button>" +
        "</div>" +

        filterChipsHtml() +
      "</div>" +
      '<div id="feed">' + feedHtml() + "</div>";
  }

  function refreshFeed() {
    var feed = document.getElementById("feed");
    if (feed) feed.innerHTML = feedHtml();
    var rail = main.querySelector(".rail");
    if (rail) {
      Array.prototype.forEach.call(rail.querySelectorAll("[data-key]"), function (chip) {
        chip.setAttribute("aria-pressed", String(chip.getAttribute("data-key") === uiState.category));
      });
    }
  }

  /* ---------------- Restaurant ---------------- */

  function stepper(item) {
    return (
      '<span class="stepper">' +
        '<button type="button" data-action="qty" data-item="' + item.id + '" data-delta="-1" aria-label="Remove one ' + esc(item.name) + '"><i class="ph ph-minus"></i></button>' +
        "<span>" + item.qty + "</span>" +
        '<button type="button" data-action="qty" data-item="' + item.id + '" data-delta="1" aria-label="Add one ' + esc(item.name) + '"><i class="ph ph-plus"></i></button>' +
      "</span>"
    );
  }

  function menuRow(vendor, item, inBasket) {
    var unavailable = !item.available;
    return (
      '<div class="menu-row">' +
        '<div class="menu-row__body">' +
          '<div class="menu-row__name">' + esc(item.name) + "</div>" +
          '<div class="menu-row__desc clamp-2">' + esc(item.desc) + "</div>" +
          '<div class="menu-row__price">' + money(item.price) + "</div>" +
          (unavailable ? '<div class="menu-row__off">Sold out</div>' : "") +
        "</div>" +
        (unavailable
          ? '<span class="badge badge--ink" style="margin-top:2px">Sold out</span>'
          : inBasket
            ? stepper(Object.assign({ id: item.id, qty: inBasket.qty }, {}))
            : '<button class="btn btn--ghost btn--sm" style="margin-top:2px" data-action="add" data-vendor="' + vendor.id + '" data-item="' + item.id + '">Add</button>') +
      "</div>"
    );
  }

  function renderRestaurant(view) {
    var shop = vendorById(view.id);
    if (!shop) {
      main.innerHTML = '<div class="pad section-gap"><div class="card"><div class="empty"><i class="ph ph-storefront"></i><div class="empty__title">Restaurant not found</div></div></div></div>';
      return;
    }

    var basket = KF.basketView();
    var inBasket = {};
    if (basket.vendor && basket.vendor.id === shop.id) {
      basket.lines.forEach(function (line) {
        inBasket[line.item.id] = line;
      });
    }

    var groups = [];
    shop.menu.forEach(function (item) {
      var group = groups.filter(function (g) { return g.name === item.category; })[0];
      if (!group) {
        group = { name: item.category, items: [] };
        groups.push(group);
      }
      group.items.push(item);
    });

    main.innerHTML =
      '<div class="hero">' +
        '<img src="' + esc(shop.image) + '" alt="' + esc(shop.imageAlt) + '">' +
        '<div class="hero__shade"></div>' +
      "</div>" +
      '<div class="pad" style="margin-top:14px">' +
        '<div class="sub">' + esc(shop.cuisine) + ", " + esc(shop.area) + ", " + esc(shop.township) + "</div>" +
        '<div class="stats" style="margin-top:10px">' +
          "<div><dt>Delivery</dt><dd>" + esc(UI.etaRange(shop)) + "</dd></div>" +
          "<div><dt>Fee</dt><dd>" + money(shop.fee) + "</dd></div>" +
          "<div><dt>Rating</dt><dd>" + (shop.reviews ? shop.rating.toFixed(1) : "New") + "</dd></div>" +
        "</div>" +
        '<div class="meta" style="margin-top:10px;display:flex;align-items:center;gap:6px;flex-wrap:wrap">' +
          '<span class="shop-id num">' + esc(shop.shopId) + "</span>" +
          '<i class="ph ph-shopping-bag" style="color:var(--green)"></i>' +
          "<span>" + esc(shop.street) + ", " + esc(shop.area) + "</span>" +
        "</div>" +
        (!shop.accepting
          ? '<div class="notice notice--warn" style="margin-top:12px"><i class="ph ph-warning-circle"></i><span>This kitchen has paused new orders. You can still browse the menu.</span></div>'
          : "") +
        (!shop.menu.length
          ? '<div class="notice notice--info" style="margin-top:12px"><i class="ph ph-bowl-food"></i><span>This shop has not published its menu yet. Check back later.</span></div>'
          : "") +
      "</div>" +
      '<div class="section-gap">' +
        groups.map(function (group) {
          return (
            '<div class="pad" style="padding-top:2px"><div class="label" style="padding:6px 0 4px">' + esc(group.name) + "</div></div>" +
            '<div class="list" style="border-radius:0;box-shadow:none;border-top:1px solid var(--hair-soft);border-bottom:1px solid var(--hair-soft)">' +
              group.items.map(function (item) { return menuRow(shop, item, inBasket[item.id]); }).join("") +
            "</div>"
          );
        }).join("") +
      "</div>" +
      '<div style="height:16px"></div>';
  }

  /* ---------------- Checkout ---------------- */

  function tipOptions() {
    return [0, 1000, 2000, 3000];
  }

  function checkoutTotals(basket) {
    var collect = uiState.fulfilment === "collect";
    var fee = collect || !basket.vendor ? 0 : basket.vendor.fee;
    var tip = collect ? 0 : uiState.tip;
    return {
      collect: collect,
      fee: fee,
      tip: tip,
      total: basket.subtotal + fee + tip
    };
  }

  function resetFilters() {
    uiState.filters = { township: "All", maxFee: null, maxEta: null, minRating: null, acceptingOnly: false, shopQuery: "" };
  }

  function afterFilterChange() {
    render();
    var sheet = document.getElementById("sheet");
    if (sheet && sheet.getAttribute("data-open") === "true") openFilters();
  }

  function chipsGroupHtml(options, selected, action) {
    return (
      '<div class="chips">' +
      options
        .map(function (option) {
          var value = option.value == null ? "" : String(option.value);
          var target = selected == null ? "" : String(selected);
          return (
            '<button class="chip" data-action="' + action + '" data-value="' + esc(value) + '" aria-pressed="' +
            (value === target) + '">' + esc(option.label) + "</button>"
          );
        })
        .join("") +
      "</div>"
    );
  }

  function openFilters() {
    var filters = uiState.filters;
    var townships = [{ value: "All", label: "All townships" }].concat(
      KF.townships().map(function (name) {
        return { value: name, label: name };
      })
    );
    var resultCount = filteredVendors().length;

    UI.openSheet(
      '<div class="sheet__title">Filter vendors</div>' +
      '<div class="sheet__body">' +
        '<div class="filter-group">' +
          '<div class="label">Registered shop</div>' +
          '<div class="search" style="height:44px">' +
            '<i class="ph ph-storefront" style="font-size:15px"></i>' +
            '<label class="sr-only" for="filterShopQuery">Filter by shop name, registered email or shop ID</label>' +
            '<input id="filterShopQuery" type="search" autocomplete="off" spellcheck="false" ' +
              'placeholder="Name, email or SHP-1041" value="' + esc(filters.shopQuery) + '">' +
          "</div>" +
        "</div>" +
        '<div class="filter-group"><div class="label">Township</div>' +
          chipsGroupHtml(townships, filters.township, "filter-township") +
        "</div>" +
        '<div class="filter-group">' +
          '<div class="label">Delivery fee</div>' +
          chipsGroupHtml(FEE_OPTIONS, filters.maxFee, "filter-fee") +
        "</div>" +
        '<div class="filter-group">' +
          '<div class="label">Arrives in</div>' +
          chipsGroupHtml(ETA_FILTERS, filters.maxEta, "filter-eta") +
        "</div>" +
        '<div class="filter-group">' +
          '<div class="label">Rating</div>' +
          chipsGroupHtml(RATINGS, filters.minRating, "filter-rating") +
        "</div>" +
        '<div class="filter-group">' +
          '<div class="label">Availability</div>' +
          '<button class="row" style="padding:10px 0" data-action="toggle-accepting" role="switch" aria-checked="' +
            filters.acceptingOnly + '">' +
            '<span class="row__body"><span class="row__title" style="display:block">Accepting orders only</span>' +
            '<span class="meta">Hide kitchens that paused orders</span></span>' +
            '<span class="switch" aria-checked="' + filters.acceptingOnly + '"></span>' +
          "</button>" +
        "</div>" +
      "</div>" +
      '<div class="sheet__foot"><div class="btn-row">' +
        '<button class="btn btn--ghost btn--lg" data-action="reset-filters">Reset</button>' +
        '<button class="btn btn--primary btn--lg" data-action="close-sheet" id="filterShow">' +
          (resultCount === 1 ? "Show 1 vendor" : "Show " + resultCount + " vendors") +
        "</button>" +
      "</div></div>"
    );
  }

  function openSort() {
    UI.openSheet(
      '<div class="sheet__title">Sort vendors</div>' +
      '<div class="sheet__body stack-sm">' +
        SORTS.map(function (option) {
          return (
            '<button class="radio-row" role="radio" aria-checked="' + (uiState.sort === option.key) + '" ' +
              'data-action="sort-pick" data-value="' + option.key + '">' +
              '<span class="radio-row__mark"></span>' +
              '<span class="row__body"><span class="row__title" style="display:block">' + option.label + "</span></span>" +
            "</button>"
          );
        }).join("") +
      "</div>"
    );
  }

  function renderCheckout() {
    var basket = KF.basketView();
    var state = KF.get();

    if (!basket.vendor || !basket.lines.length) {
      main.innerHTML =
        '<div class="pad section-gap"><div class="card"><div class="empty">' +
          '<i class="ph ph-basket"></i>' +
          '<div class="empty__title">Your basket is empty</div>' +
          '<div class="empty__body">Add a dish from a restaurant to start an order.</div>' +
          '<button class="btn btn--primary" style="margin-top:14px" data-nav="#/home">Browse restaurants</button>' +
        "</div></div></div>";
      return;
    }

    var unavailable = basket.lines.filter(function (line) { return !line.available; });
    var totals = checkoutTotals(basket);
    var isCollect = totals.collect;

    main.innerHTML =
      '<div class="pad" style="padding-top:12px">' +
        '<div class="seg" role="tablist" aria-label="Delivery or collection">' +
          '<button role="tab" aria-selected="' + (!isCollect) + '" data-action="fulfil" data-value="delivery">Deliver</button>' +
          '<button role="tab" aria-selected="' + isCollect + '" data-action="fulfil" data-value="collect">Collect</button>' +
        "</div>" +
      "</div>" +

      '<div class="pad section-gap">' +
        '<div class="card">' +
          (isCollect
            ? '<div class="row" style="align-items:flex-start">' +
                '<i class="ph-fill ph-storefront" style="font-size:16px;color:var(--accent);margin-top:2px"></i>' +
                '<div class="row__body">' +
                  '<div class="label">Collect in ' + esc(basket.vendor.township) + "</div>" +
                  '<div class="row__title" style="margin-top:2px">' + esc(basket.vendor.name) + "</div>" +
                  '<div class="meta" style="margin-top:2px">' + esc(basket.vendor.street) + ", " + esc(basket.vendor.area) + "</div>" +
                "</div>" +
                '<a class="linkish" href="tel:' + esc(String(basket.vendor.phone || "").replace(/\s/g, "")) + '">Call</a>' +
              "</div>"
            : '<div class="row" style="align-items:flex-start">' +
                '<i class="ph-fill ph-map-pin" style="font-size:16px;color:var(--accent);margin-top:2px"></i>' +
                '<div class="row__body">' +
                  '<div class="label">Deliver to ' + esc(state.customer.address.township || "") + "</div>" +
                  '<div class="row__title" style="margin-top:2px">' + esc(state.customer.address.street) + ", " + esc(state.customer.address.suburb) + "</div>" +
                  '<div class="meta" style="margin-top:2px">' + esc(state.customer.address.note || "No entrance note") + "</div>" +
                "</div>" +
                '<button class="linkish" data-action="address">Change</button>' +
              "</div>") +
        "</div>" +
      "</div>" +

      (isCollect
        ? '<div class="pad" style="margin-top:12px"><div class="notice notice--info"><i class="ph ph-shopping-bag"></i><span>' +
          "Ready in about " + basket.vendor.etaMin[1] + " min. Your collection code appears on the order page.</span></div></div>"
        : "") +

      '<div class="pad section-gap">' +
        '<div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:8px">' +
          '<h2 class="h2">' + esc(basket.vendor.name) + "</h2>" +
          '<span class="meta num">' + basket.count + (basket.count === 1 ? " item" : " items") + "</span>" +
        "</div>" +
        '<div class="list">' +
          basket.lines.map(function (line) {
            return (
              '<div class="row">' +
                '<div class="row__body">' +
                  '<div class="row__title" style="font-weight:600">' + esc(line.item.name) + "</div>" +
                  '<div class="meta num" style="margin-top:2px">' + money(line.item.price) + " each</div>" +
                  (line.available ? "" : '<div class="menu-row__off" style="color:var(--danger)">Sold out</div>') +
                "</div>" +
                stepper({ id: line.item.id, qty: line.qty, name: line.item.name }) +
                '<span class="num" style="font-weight:650;font-size:13px;min-width:52px;text-align:right">' + money(line.total) + "</span>" +
              "</div>"
            );
          }).join("") +
        "</div>" +
      "</div>" +

      '<div class="pad section-gap">' +
        '<h2 class="h2" style="margin-bottom:8px">Payment</h2>' +
        '<div class="stack-sm">' +
          '<button class="radio-row" data-action="payment" data-value="cash" role="radio" aria-checked="' + (uiState.payment === "cash") + '">' +
            '<span class="radio-row__mark"></span>' +
            '<span class="row__body"><span class="row__title" style="display:block">' +
              (isCollect ? "Cash at the counter" : "Cash on delivery") + "</span>" +
            '<span class="meta">' + (isCollect ? "Pay when you collect" : "Pay the driver at the door") + "</span></span>" +
            '<i class="ph ph-money" style="color:var(--muted)"></i>' +
          "</button>" +
          '<button class="radio-row" data-action="payment" data-value="card" role="radio" aria-checked="' + (uiState.payment === "card") + '">' +
            '<span class="radio-row__mark"></span>' +
            '<span class="row__body"><span class="row__title" style="display:block">' +
              (isCollect ? "Card at the counter" : "Card on delivery") + "</span>" +
            '<span class="meta">' + (isCollect ? "Card machine at the till" : "Driver brings a card machine") + "</span></span>" +
            '<i class="ph ph-credit-card" style="color:var(--muted)"></i>' +
          "</button>" +
        "</div>" +
      "</div>" +

      (isCollect
        ? ""
        : '<div class="pad section-gap">' +
            '<h2 class="h2" style="margin-bottom:8px">Tip the driver</h2>' +
            '<div class="rail" style="padding:0">' +
              tipOptions().map(function (amount) {
                return '<button class="chip" data-action="tip" data-value="' + amount + '" aria-pressed="' + (uiState.tip === amount) + '">' +
                  (amount ? money(amount) : "No tip") + "</button>";
              }).join("") +
            "</div>" +
          "</div>") +

      '<div class="pad section-gap">' +
        '<label class="field">Order note' +
          '<textarea id="orderNote" placeholder="' +
            (isCollect ? "Anything the kitchen should know" : "Anything the restaurant or driver should know") +
          '" maxlength="180">' + esc(uiState.note) + "</textarea>" +
        "</label>" +
      "</div>" +

      '<div class="pad section-gap">' +
        '<dl class="card card--pad">' +
          '<div class="kv"><dt>Subtotal</dt><dd>' + money(basket.subtotal) + "</dd></div>" +
          (isCollect
            ? '<div class="kv"><dt>Collection</dt><dd>No fee</dd></div>'
            : '<div class="kv"><dt>Delivery fee</dt><dd>' + money(totals.fee) + "</dd></div>" +
              '<div class="kv"><dt>Tip</dt><dd>' + money(totals.tip) + "</dd></div>") +
          '<div class="kv kv--total"><dt>Total</dt><dd>' + money(totals.total) + "</dd></div>" +
        "</dl>" +
      "</div>" +

      (unavailable.length
        ? '<div class="pad" style="margin-top:12px"><div class="notice notice--warn"><i class="ph ph-warning-circle"></i><span>' +
            esc(unavailable[0].item.name) + " is sold out. Remove it to place the order.</span></div></div>"
        : "") +
      '<div style="height:18px"></div>';
  }

  /* ---------------- Tracking ---------------- */

  function milestoneIndex(status) {
    return { placed: 0, accepted: 1, ready: 2, claimed: 2, picked_up: 3, delivered: 4 }[status] || 0;
  }

  function renderCollection(order) {
    var shop = vendorById(order.vendorId);
    var stepIndex = { placed: 0, accepted: 1, ready: 2, delivered: 3 }[order.status] || 0;
    var steps = [
      { label: "Order sent", time: order.placedAt },
      { label: "Preparing", time: order.acceptedAt },
      { label: "Ready to collect", time: order.readyAt },
      { label: "Collected", time: order.deliveredAt }
    ];
    var directions =
      "https://www.google.com/maps/search/?api=1&query=" +
      encodeURIComponent(order.address.street + ", " + order.address.suburb + ", " + order.address.township);

    main.innerHTML =
      '<div class="pad" style="padding-top:12px">' +
        '<div class="card code-card">' +
          '<div class="code-card__top">' +
            '<span class="label">Collection code</span>' +
            UI.orderBadge(order) +
          "</div>" +
          '<div class="code num">' + esc(order.collectCode || "—") + "</div>" +
          '<div class="meta">' +
            (order.status === "delivered"
              ? "Collected " + UI.clock(order.deliveredAt)
              : order.status === "ready"
                ? "Ready now, collect before " + UI.clock(order.promisedAt)
                : "Ready around " + UI.clock(order.promisedAt)) +
          "</div>" +
        "</div>" +
      "</div>" +

      '<div class="pad" style="margin-top:12px">' +
        '<div class="map" style="height:190px;position:relative">' +
          UI.map({
            height: 210,
            pins: [{ x: order.pickup[0], y: order.pickup[1], type: "vendor" }],
            label: "Map to the collection point"
          }) +
          '<div class="map__chip map__chip--tl num">' + esc(shop.township) + "</div>" +
        "</div>" +
      "</div>" +

      '<div class="pad" style="margin-top:12px">' +
        '<div class="card card--pad">' +
          '<div class="row" style="padding:0;align-items:flex-start">' +
            '<i class="ph-fill ph-storefront" style="font-size:17px;color:var(--accent);margin-top:2px"></i>' +
            '<div class="row__body">' +
              '<div class="row__title">' + esc(shop.name) + "</div>" +
              '<div class="meta" style="margin-top:2px">' + esc(order.address.street) + "</div>" +
              '<div class="meta">' + esc(order.address.suburb) + ", " + esc(order.address.township) + "</div>" +
            "</div>" +
          "</div>" +
          '<div class="btn-row" style="margin-top:12px">' +
            '<a class="btn btn--ghost" href="' + esc(directions) + '" target="_blank" rel="noreferrer">' +
              '<i class="ph ph-navigation-arrow"></i>Directions</a>' +
            '<a class="btn btn--ghost" href="tel:' + esc(String(shop.phone || "").replace(/\s/g, "")) + '">' +
              '<i class="ph ph-phone"></i>Call</a>' +
          "</div>" +
        "</div>" +
      "</div>" +

      '<div class="pad section-gap">' +
        '<div class="card card--pad">' +
          '<div class="steps">' +
            steps.map(function (step, index) {
              var state = index < stepIndex ? "done" : index === stepIndex ? "current" : "todo";
              return (
                '<div class="step" data-state="' + state + '">' +
                  '<span class="step__dot">' + (state === "done" ? '<i class="ph-bold ph-check"></i>' : "") + "</span>" +
                  '<span class="step__label">' + step.label + "</span>" +
                  '<span class="step__time num">' + (step.time ? UI.clock(step.time) : "—") + "</span>" +
                "</div>"
              );
            }).join("") +
          "</div>" +
          (order.status === "placed"
            ? '<div class="notice notice--info" style="margin-top:14px"><i class="ph ph-timer"></i><span>Waiting for the kitchen to accept.</span></div>'
            : "") +
        "</div>" +
      "</div>" +

      '<div class="pad section-gap">' +
        '<h2 class="h2" style="margin-bottom:8px">What you ordered</h2>' +
        '<div class="list">' +
          order.items.map(function (item) {
            return (
              '<div class="row" style="padding:11px 14px">' +
                '<span class="qty-badge">' + item.qty + "</span>" +
                '<div class="row__body">' +
                  '<div class="row__title" style="font-weight:600">' + esc(item.name) + "</div>" +
                  (item.note ? '<div class="meta">' + esc(item.note) + "</div>" : "") +
                "</div>" +
                '<span class="num" style="font-size:13px;font-weight:600">' + money(item.price * item.qty) + "</span>" +
              "</div>"
            );
          }).join("") +
        "</div>" +
      "</div>" +

      '<div class="pad section-gap">' +
        '<dl class="card card--pad">' +
          '<div class="kv"><dt>Subtotal</dt><dd>' + money(order.subtotal) + "</dd></div>" +
          '<div class="kv"><dt>Collection</dt><dd>No fee</dd></div>' +
          '<div class="kv"><dt>Payment</dt><dd>' + (order.payment === "card" ? "Card at the counter" : "Cash at the counter") + "</dd></div>" +
          '<div class="kv kv--total"><dt>Total</dt><dd>' + money(order.total) + "</dd></div>" +
        "</dl>" +
      "</div>" +

      (order.status === "delivered"
        ? '<div class="pad section-gap"><button class="btn btn--primary btn--lg btn--block" data-action="reorder" data-order="' + order.id + '">Order this again</button></div>'
        : "") +
      '<div style="height:20px"></div>';
  }

  function stopRemoteTracking() {
    if (remoteTrackingPoller) window.clearInterval(remoteTrackingPoller);
    remoteTrackingPoller = null;
    remoteTrackingOrderId = null;
  }

  function remoteTrackingHtml() {
    if (!remoteTrackingData) {
      return '<div class="h3">Live delivery tracker</div>' +
        '<div class="meta" role="status" aria-live="polite" style="margin-top:4px">Connecting to the delivery tracker…</div>';
    }

    var statusLabels = {
      new: "Finding a driver",
      claimed: "Driver assigned",
      picked_up: "On the way",
      delivered: "Delivered"
    };
    var location = remoteTrackingData.location;
    var ageMs = location ? Date.now() - new Date(location.updatedAt).getTime() : Infinity;
    var isLive = ageMs >= 0 && ageMs <= 30000;

    return '<div class="h3">Live delivery tracker</div>' +
      '<div class="meta" role="status" aria-live="polite" style="margin-top:4px">' +
        esc(statusLabels[remoteTrackingData.status] || remoteTrackingData.status) + "</div>" +
      (location
        ? '<div class="meta num" style="margin-top:5px">' + (isLive ? "Live · updated " : "Last fix · updated ") +
            esc(UI.ago(location.updatedAt)) + (Number.isFinite(location.accuracy) ? " · ±" + Math.round(location.accuracy) + " m" : "") + "</div>" +
          '<div class="meta num" style="margin-top:3px">' + location.latitude.toFixed(5) + ", " + location.longitude.toFixed(5) + "</div>" +
          '<a class="btn btn--quiet btn--block" style="margin-top:10px" href="https://www.openstreetmap.org/?mlat=' +
            location.latitude + "&mlon=" + location.longitude + '#map=17/' + location.latitude + "/" + location.longitude +
            '" target="_blank" rel="noopener noreferrer"><i class="ph ph-map-trifold"></i>View driver on map</a>'
        : '<div class="meta" style="margin-top:4px">' + (remoteTrackingData.status === "new"
            ? "Driver GPS appears here after a driver claims this order and starts GPS."
            : "Waiting for the driver to start GPS sharing.") + "</div>");
  }

  function refreshRemoteTracking() {
    if (!customerSession || !remoteTrackingOrderId) return;
    fetch(API + "/api06/tracking/orders/" + encodeURIComponent(remoteTrackingOrderId), {
      headers: { Authorization: "Bearer " + customerSession.accessToken }
    }).then(function (response) {
      if (!response.ok) throw new Error("Tracking request failed");
      return response.json();
    }).then(function (data) {
      remoteTrackingData = data;
      var panel = document.getElementById("remoteTrackingPanel");
      if (panel) panel.innerHTML = remoteTrackingHtml();
    }).catch(function () {
      var panel = document.getElementById("remoteTrackingPanel");
      if (panel && !remoteTrackingData) {
        panel.innerHTML = '<div class="h3">Live delivery tracker</div>' +
          '<div class="meta" role="status" aria-live="polite" style="margin-top:4px">Tracking server is unavailable right now.</div>';
      }
    });
  }

  function startRemoteTracking(order) {
    var trackingId = typeof order === "string" ? order : order && order.remoteTrackingId;
    if (!trackingId || !customerSession) {
      stopRemoteTracking();
      remoteTrackingData = null;
      return;
    }
    if (remoteTrackingOrderId === trackingId && remoteTrackingPoller) return;
    stopRemoteTracking();
    remoteTrackingOrderId = trackingId;
    remoteTrackingData = null;
    refreshRemoteTracking();
    remoteTrackingPoller = window.setInterval(refreshRemoteTracking, 7000);
  }

  function renderTrack(view) {
    var order = KF.order(view.id);
    if (!order) {
      main.innerHTML = '<div class="pad section-gap"><div class="card"><div class="empty"><i class="ph ph-receipt"></i><div class="empty__title">Order not found</div></div></div></div>';
      return;
    }

    if (order.fulfilment === "collect") {
      renderCollection(order);
      return;
    }

    var shop = vendorById(order.vendorId);
    startRemoteTracking(order);
    var driver = order.driverId ? KF.driver(order.driverId) : null;
    var driverLocation = driver && driver.location;
    var locationAgeMs = driverLocation ? Date.now() - new Date(driverLocation.updatedAt).getTime() : Infinity;
    var locationIsLive = locationAgeMs >= 0 && locationAgeMs <= 30000;
    var current = milestoneIndex(order.status);
    var steps = [
      { label: "Order sent", time: order.placedAt },
      { label: "Preparing", time: order.acceptedAt },
      { label: "Ready", time: order.readyAt },
      { label: "Picked up", time: order.pickedUpAt },
      { label: "Delivered", time: order.deliveredAt }
    ];

    var mapPins = [{ x: order.pickup[0], y: order.pickup[1], type: "vendor" }];
    var trail = null;
    var planned = order.status === "claimed" || order.status === "picked_up" ? order.remaining : null;
    if (order.status === "claimed") {
      mapPins.push({ x: order.pickup[0], y: order.pickup[1], type: "driver" });
    } else if (order.status === "picked_up" || order.status === "delivered") {
      var points = order.trail || [];
      var last = points[points.length - 1];
      mapPins.push({ x: last[0], y: last[1], type: "driver" });
      trail = order.trail;
      planned = order.remaining;
    }
    if (order.status === "delivered") {
      mapPins = [
        { x: order.pickup[0], y: order.pickup[1], type: "vendor" },
        { x: order.drop[0], y: order.drop[1], type: "drop" }
      ];
      trail = order.trail;
      planned = null;
    } else {
      mapPins.push({ x: order.drop[0], y: order.drop[1], type: "drop" });
    }

    var etaLabel = order.status === "delivered"
      ? "Delivered " + UI.clock(order.deliveredAt)
      : "Arriving " + UI.clock(order.promisedAt);

    main.innerHTML =
      '<div class="pad" style="padding-top:12px">' +
        '<div class="map map--mid" style="position:relative">' +
          UI.map({ height: 210, pins: mapPins, trail: trail, planned: planned, label: "Map of your delivery route" }) +
          '<div class="map__chip map__chip--tl"><span class="dot dot--' + dotTone(order.status) + '"></span>' +
            esc(UI.statusMeta(order.status).label) + "</div>" +
          '<div class="map__chip map__chip--br num">' + esc(etaLabel) + "</div>" +
        "</div>" +
      "</div>" +

      (driver && order.status !== "delivered"
        ? '<div class="pad" style="margin-top:12px"><div class="card card--pad">' +
            '<div class="h3">Driver live location</div>' +
            '<div class="meta" role="status" aria-live="polite" style="margin-top:4px">' +
              (driverLocation
                ? (locationIsLive ? "Live · updated " : "Last fix · updated ") + UI.ago(driverLocation.updatedAt) +
                  (Number.isFinite(driverLocation.accuracy) ? " · ±" + Math.round(driverLocation.accuracy) + " m" : "")
                : "Waiting for the driver to start GPS sharing.") +
            "</div>" +
            (driverLocation
              ? '<div class="meta num" style="margin-top:4px">' + driverLocation.latitude.toFixed(5) + ", " + driverLocation.longitude.toFixed(5) + "</div>" +
                '<a class="btn btn--quiet btn--block" style="margin-top:10px" href="https://www.openstreetmap.org/?mlat=' +
                  driverLocation.latitude + "&mlon=" + driverLocation.longitude + '#map=17/' + driverLocation.latitude + "/" + driverLocation.longitude +
                  '" target="_blank" rel="noopener noreferrer"><i class="ph ph-map-trifold"></i>View driver on map</a>' : "") +
          "</div></div>"
        : "") +

      '<div class="pad" style="margin-top:14px">' +
        '<div class="card card--pad">' +
          '<div class="steps">' +
            steps.map(function (step, index) {
              var state = index < current ? "done" : index === current ? "current" : "todo";
              return (
                '<div class="step" data-state="' + state + '">' +
                  '<span class="step__dot">' + (state === "done" ? '<i class="ph-bold ph-check"></i>' : "") + "</span>" +
                  '<span class="step__label">' + step.label + "</span>" +
                  '<span class="step__time num">' + (step.time ? UI.clock(step.time) : "—") + "</span>" +
                "</div>"
              );
            }).join("") +
          "</div>" +
          (order.status === "placed"
            ? '<div class="notice notice--info" style="margin-top:14px"><i class="ph ph-timer"></i><span>Waiting for the kitchen to accept.</span></div>'
            : "") +
        "</div>" +
      "</div>" +

      (driver
        ? '<div class="pad" style="margin-top:12px"><div class="card card--pad" style="display:flex;align-items:center;gap:10px">' +
            '<span class="avatar" style="background:var(--green)">' + esc(UI.initials(driver.name)) + "</span>" +
            '<div style="flex:1;min-width:0">' +
              '<div class="row__title">' + esc(driver.name) + "</div>" +
              '<div class="meta truncate">' + esc(driver.vehicle) + "</div>" +
            "</div>" +
            '<a class="icon-btn" href="tel:' + esc(String(driver.phone || "").replace(/\s/g, "")) + '" aria-label="Call your driver"><i class="ph ph-phone"></i></a>' +
          "</div></div>"
        : "") +

      '<div class="pad section-gap">' +
        '<h2 class="h2" style="margin-bottom:8px">' + esc(shop.name) + "</h2>" +
        '<div class="list">' +
          order.items.map(function (item) {
            return (
              '<div class="row" style="padding:11px 14px">' +
                '<span class="qty-badge">' + item.qty + "</span>" +
                '<div class="row__body">' +
                  '<div class="row__title" style="font-weight:600">' + esc(item.name) + "</div>" +
                  (item.note ? '<div class="meta">' + esc(item.note) + "</div>" : "") +
                "</div>" +
                '<span class="num" style="font-size:13px;font-weight:600">' + money(item.price * item.qty) + "</span>" +
              "</div>"
            );
          }).join("") +
        "</div>" +
      "</div>" +

      '<div class="pad section-gap">' +
        '<dl class="card card--pad">' +
          '<div class="kv"><dt>Delivery to</dt><dd style="font-weight:500">' + esc(order.address.street) + ", " + esc(order.address.suburb) + ", " + esc(order.address.township || "") + "</dd></div>" +
          (order.address.note ? '<div class="kv"><dt>Note</dt><dd style="font-weight:500">' + esc(order.address.note) + "</dd></div>" : "") +
          '<div class="kv"><dt>Payment</dt><dd>' + (order.payment === "card" ? "Card on delivery" : "Cash on delivery") + "</dd></div>" +
          '<div class="kv"><dt>Delivery fee</dt><dd>' + money(order.fee) + "</dd></div>" +
          '<div class="kv"><dt>Tip</dt><dd>' + money(order.tip) + "</dd></div>" +
          '<div class="kv kv--total"><dt>Total</dt><dd>' + money(order.total) + "</dd></div>" +
        "</dl>" +
      "</div>" +

      (order.status === "delivered"
        ? '<div class="pad section-gap"><button class="btn btn--primary btn--lg btn--block" data-action="reorder" data-order="' + order.id + '">Order this again</button></div>'
        : "") +
      '<div style="height:20px"></div>';
  }

  /* ---------------- Orders + account ---------------- */

  function renderOrders() {
    var orders = KF.customerOrders();
    if (!orders.length) {
      main.innerHTML =
        '<div class="pad section-gap"><div class="card"><div class="empty">' +
          '<i class="ph ph-receipt"></i>' +
          '<div class="empty__title">No orders yet</div>' +
          '<div class="empty__body">Your orders and their status will show here.</div>' +
          '<button class="btn btn--primary" style="margin-top:14px" data-nav="#/home">Find food</button>' +
        "</div></div></div>" +
        '<div class="pad section-gap"><div id="remoteOrderList"></div></div>';
      loadRemoteOrders();
      return;
    }

    main.innerHTML =
      '<div class="pad section-gap"><div class="list">' +
        orders.map(function (order) {
          var shop = vendorById(order.vendorId);
          var count = order.items.reduce(function (sum, item) { return sum + item.qty; }, 0);
          return (
            '<button class="row" data-nav="#/track/' + order.id + '" style="align-items:flex-start">' +
              '<div class="row__body">' +
                '<div style="display:flex;align-items:center;gap:7px">' +
                  '<span class="row__title truncate">' + esc(shop.name) + "</span>" +
                  UI.orderBadge(order) +
                "</div>" +
                '<div class="row__lines"><span>' + UI.fulfilTag(order) + "</span></div>" +
                '<div class="row__lines"><span>' + order.id + '</span><span class="sep"></span><span class="num">' + UI.ago(order.placedAt) + " ago</span>" +
                  '<span class="sep"></span><span class="num">' + count + " items</span></div>" +
              "</div>" +
              '<span class="num" style="font-weight:650;font-size:13.5px">' + money(order.total) + "</span>" +
              '<i class="ph ph-caret-right" style="color:var(--muted-2);font-size:12px"></i>' +
            "</button>"
          );
        }).join("") +
      "</div></div>" +
      '<div class="pad section-gap"><div id="remoteOrderList"></div></div>';
    loadRemoteOrders();
  }

  function loadRemoteOrders() {
    if (!API || !customerSession) return;
    fetch(API + "/api06/tracking/mine", {
      headers: { Authorization: "Bearer " + customerSession.accessToken }
    }).then(function (response) {
      if (!response.ok) throw new Error("Could not load tracked orders.");
      return response.json();
    }).then(function (orders) {
      remoteOrders = orders;
      var host = document.getElementById("remoteOrderList");
      if (!host || !orders.length) return;
      host.innerHTML = '<h2 class="h2" style="margin-bottom:8px">Tracked deliveries</h2><div class="list">' +
        orders.map(function (order) {
          var statusLabels = { new: "Finding a driver", claimed: "Driver assigned", picked_up: "On the way", delivered: "Delivered" };
          return '<button class="row" data-nav="#/remote-track/' + encodeURIComponent(order.id) + '">' +
            '<span class="row__body"><span class="row__title" style="display:block">' + esc(order.shopName) + "</span>" +
              '<span class="meta">' + esc(statusLabels[order.status] || order.status) + " · " + esc(order.localOrderId) + "</span></span>" +
            '<i class="ph ph-caret-right" style="color:var(--muted-2);font-size:12px"></i>' +
          "</button>";
        }).join("") + "</div>";
    }).catch(function () {
      var host = document.getElementById("remoteOrderList");
      if (host) host.innerHTML = '<div class="list-note">Live tracking history is unavailable while the backend is offline.</div>';
    });
  }

  function renderRemoteTrack(view) {
    var trackingId = view.id;
    remoteTrackingData = null;
    main.innerHTML = '<div class="pad section-gap"><div class="card card--pad" id="remoteTrackingPanel">' +
      remoteTrackingHtml() + "</div></div>";
    startRemoteTracking(trackingId);
    refreshRemoteTracking();
  }

  function renderAccount() {
    var state = KF.get();
    var address = state.customer.address;
    main.innerHTML =
      '<div class="pad section-gap">' +
        '<div class="card card--pad" style="display:flex;align-items:center;gap:12px">' +
          '<span class="avatar" style="width:44px;height:44px;font-size:13px">' + esc(UI.initials(state.customer.name)) + "</span>" +
          '<div style="min-width:0">' +
            '<div class="h3">' + esc(state.customer.name) + "</div>" +
            '<div class="meta">' + esc(state.customer.email || state.customer.phone) + "</div>" +
          "</div>" +
        "</div>" +
      "</div>" +

      '<div class="pad section-gap">' +
        '<h2 class="h2" style="margin-bottom:8px">Delivery address</h2>' +
        '<div class="card">' +
          '<div class="row" style="align-items:flex-start">' +
            '<i class="ph-fill ph-map-pin" style="font-size:16px;color:var(--accent);margin-top:2px"></i>' +
            '<div class="row__body">' +
              '<div class="row__title">' + esc(state.customer.address.street) + "</div>" +
              '<div class="meta">' + esc(state.customer.address.suburb) + ", " + esc(state.customer.address.township || "") + "</div>" +
              '<div class="meta" style="margin-top:2px">' + esc(state.customer.address.note || "No entrance note") + "</div>" +
              (Number.isFinite(address.latitude) && Number.isFinite(address.longitude)
                ? '<a class="meta" style="display:inline-block;margin-top:6px;color:var(--accent-ink)" href="https://www.openstreetmap.org/?mlat=' +
                  address.latitude + "&mlon=" + address.longitude + '#map=17/' + address.latitude + "/" + address.longitude +
                  '" target="_blank" rel="noopener noreferrer">View saved GPS pin</a>' : "") +
            "</div>" +
            '<button class="linkish" data-action="address">Edit</button>' +
          "</div>" +
        "</div>" +
      "</div>" +

      '<div class="pad section-gap">' +
        '<div class="list">' +
          '<button class="row" data-nav="#/orders">' +
            '<i class="ph ph-receipt" style="font-size:17px"></i>' +
            '<span class="row__body"><span class="row__title" style="display:block">Your orders</span>' +
            '<span class="meta">' + KF.customerOrders().length + " previous orders</span></span>" +
            '<i class="ph ph-caret-right" style="color:var(--muted-2);font-size:12px"></i>' +
          "</button>" +
          '<a class="row" href="./index.html">' +
            '<i class="ph ph-squares-four" style="font-size:17px"></i>' +
            '<span class="row__body"><span class="row__title" style="display:block">All Kassifleet apps</span>' +
            '<span class="meta">Customer, vendor, driver and owner</span></span>' +
            '<i class="ph ph-caret-right" style="color:var(--muted-2);font-size:12px"></i>' +
          "</a>" +
        "</div>" +
      "</div>" +

      '<div class="pad section-gap">' +
        '<button class="btn btn--quiet btn--block" data-action="reset">Reset local data</button>' +
        '<button class="btn btn--quiet btn--block" data-action="logout" style="margin-top:8px">Sign out</button>' +
        '<div class="list-note" style="padding:10px 0 0">Shops and orders are stored in your browser so the four apps can share them.</div>' +
      "</div>" +
      '<div style="height:16px"></div>';
  }

  /* ---------------- Bottom bar ---------------- */

  function renderBottom(view) {
    var basket = KF.basketView();

    if (view.name === "checkout" && basket.vendor && basket.lines.length) {
      var totals = checkoutTotals(basket);
      bottom.innerHTML =
        '<div class="footbar">' +
          '<div class="footbar__row"><span>' +
            (totals.collect ? "Collection, no delivery fee" : basket.count + " items, delivery and tip") +
            "</span>" +
            '<span class="footbar__total">' + money(totals.total) + "</span></div>" +
          '<button class="btn btn--primary btn--lg btn--block" data-action="place-order">' +
            (totals.collect ? "Place collection order" : "Place order") +
          "</button>" +
        "</div>";
      return;
    }

    if (view.name === "track" || view.name === "remote-track" || view.name === "checkout") {
      bottom.innerHTML = "";
      return;
    }

    var bar = "";
    if (basket.vendor && basket.count > 0 && (view.name === "home" || view.name === "restaurant")) {
      bar =
        '<div class="basket-bar">' +
          '<div class="basket-bar__body">' +
            '<div class="basket-bar__top"><span>' + basket.count + (basket.count === 1 ? " item" : " items") + "</span>" +
              '<span class="num">' + money(basket.subtotal) + "</span></div>" +
            '<div class="basket-bar__sub">' + esc(basket.vendor.name) + "</div>" +
          "</div>" +
          '<button class="basket-bar__cta" data-nav="#/checkout">View basket<i class="ph ph-arrow-right"></i></button>' +
        "</div>";
    }

    if (view.name === "home" || view.name === "orders" || view.name === "account") {
      bottom.innerHTML =
        bar +
        '<nav class="nav" aria-label="Main">' +
          '<button data-nav="#/home" data-key="home" aria-label="Restaurants"><i class="ph ph-house"></i>Home</button>' +
          '<button data-nav="#/orders" data-key="orders" aria-label="Your orders"><i class="ph ph-receipt"></i>Orders</button>' +
          '<button data-nav="#/account" data-key="account" aria-label="Account"><i class="ph ph-user"></i>Account</button>' +
        "</nav>";
      var current = view.name;
      Array.prototype.forEach.call(bottom.querySelectorAll("[data-key]"), function (node) {
        if (node.getAttribute("data-key") === current) node.setAttribute("aria-current", "page");
      });
      return;
    }

    bottom.innerHTML = bar;
  }

  /* ---------------- Render ---------------- */

  var lastKey = null;

  function render() {
    if (!customerSession) {
      renderAuth("");
      return;
    }
    var view = route();
    if (view.name !== "track" && view.name !== "remote-track") stopRemoteTracking();
    var key = view.name + "/" + (view.id || "");
    renderHeader(view);

    if (view.name === "home") renderHome();
    else if (view.name === "restaurant") renderRestaurant(view);
    else if (view.name === "checkout") renderCheckout();
    else if (view.name === "track") renderTrack(view);
    else if (view.name === "remote-track") renderRemoteTrack(view);
    else if (view.name === "orders") renderOrders();
    else if (view.name === "account") renderAccount();
    else renderHome();

    renderBottom(view);

    if (key !== lastKey) {
      main.scrollTop = 0;
      lastKey = key;
    }
  }

  /* ---------------- Actions ---------------- */

  document.addEventListener("submit", async function (event) {
    if (event.target.id !== "customerAuthForm") return;
    event.preventDefault();
    var button = event.target.querySelector('button[type="submit"]');
    if (button) button.disabled = true;
    if (!API) {
      renderAuth("Customer login needs the deployed backend URL. Set KF_API_URL in apps/js/config.js.");
      return;
    }
    var body = Object.fromEntries(new FormData(event.target));
    if (authMode === "register") body.role = "customer";

    try {
      var response = await fetch(API + (authMode === "register" ? "/api01/auth/register" : "/api01/auth/login"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      var result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not sign in.");
      if (!result.user || result.user.role !== "customer") throw new Error("Customer account required.");
      activateSession({ accessToken: result.accessToken, user: result.user });
    } catch (error) {
      renderAuth(error.message === "Failed to fetch"
        ? "Could not reach the server. Start the Kassi Fleet backend and try again."
        : error.message);
    }
  });

  function openAddressSheet() {
    var address = KF.get().customer.address;
    var hasGpsPin = Number.isFinite(address.latitude) && Number.isFinite(address.longitude);
    UI.openSheet(
      '<div class="sheet__title">Delivery address</div>' +
      '<form class="sheet__body stack" id="addressForm">' +
        '<input type="hidden" name="latitude" value="' + (hasGpsPin ? address.latitude : "") + '">' +
        '<input type="hidden" name="longitude" value="' + (hasGpsPin ? address.longitude : "") + '">' +
        '<label class="field">Street address<input name="street" value="' + esc(address.street) + '" required autocomplete="street-address"></label>' +
        '<label class="field">Suburb or section<input name="suburb" value="' + esc(address.suburb) + '" required></label>' +
        '<label class="field">Township<select name="township">' +
          KF.townships()
            .map(function (name) {
              return '<option value="' + esc(name) + '"' + (address.township === name ? " selected" : "") + ">" + esc(name) + "</option>";
            })
            .join("") +
          '</select><span class="field__hint">Kassifleet delivers inside these townships only.</span></label>' +
        '<div class="stack" style="gap:6px"><button class="btn btn--quiet" type="button" data-action="customer-gps"><i class="ph ph-crosshair"></i>Use current location</button>' +
          '<div class="field__hint" id="customerGpsStatus" role="status" aria-live="polite">' +
            (hasGpsPin ? "GPS pin saved · " + address.latitude.toFixed(5) + ", " + address.longitude.toFixed(5) : "Add a GPS pin to help the driver find your address.") +
          "</div>" +
          (hasGpsPin ? '<button class="linkish" type="button" data-action="clear-customer-gps">Remove GPS pin</button>' : "") +
        "</div>" +
        '<label class="field">Entrance or landmark note<textarea name="note" placeholder="Gate code, unit number or landmark">' + esc(address.note) + "</textarea></label>" +
      "</form>" +
      '<div class="sheet__foot"><button class="btn btn--primary btn--lg btn--block" data-sheet="save-address">Save address</button></div>'
    );

    document.querySelector('[data-sheet="save-address"]').addEventListener("click", function () {
      var form = document.getElementById("addressForm");
      if (!form.reportValidity()) return;
      var data = new FormData(form);
      KF.updateAddress({
        street: String(data.get("street")).trim(),
        suburb: String(data.get("suburb")).trim(),
        township: String(data.get("township")),
        note: String(data.get("note")).trim(),
        latitude: data.get("latitude"),
        longitude: data.get("longitude")
      });
      UI.closeSheet();
      UI.toast("Delivery address updated");
      render();
    });
  }

  function locateCustomerAddress() {
    var status = document.getElementById("customerGpsStatus");
    var form = document.getElementById("addressForm");
    if (!navigator.geolocation) {
      if (status) status.textContent = "GPS is not available in this browser.";
      return;
    }
    if (status) status.textContent = "Finding your location...";

    navigator.geolocation.getCurrentPosition(function (position) {
      form.elements.latitude.value = String(position.coords.latitude);
      form.elements.longitude.value = String(position.coords.longitude);
      if (status) {
        status.textContent = "GPS pin captured · " + position.coords.latitude.toFixed(5) + ", " +
          position.coords.longitude.toFixed(5) + " · ±" + Math.round(position.coords.accuracy) + " m";
      }
      if (!form.querySelector('[data-action="clear-customer-gps"]')) {
        var clearButton = document.createElement("button");
        clearButton.type = "button";
        clearButton.className = "linkish";
        clearButton.setAttribute("data-action", "clear-customer-gps");
        clearButton.textContent = "Remove GPS pin";
        status.parentNode.appendChild(clearButton);
      }
    }, function (error) {
      if (!status) return;
      status.textContent = error.code === error.PERMISSION_DENIED
        ? "Location access was denied. Allow it in your browser settings and try again."
        : error.code === error.TIMEOUT
          ? "Could not get a GPS fix in time. Try again outdoors."
          : "Could not get your location. Check your device location settings.";
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  }

  function confirmReplace(vendorId, itemId, shop) {
    UI.openSheet(
      '<div class="sheet__title">Replace your basket?</div>' +
      '<div class="sheet__body"><p class="sub">Your basket has dishes from ' + esc(KF.basketView().vendor.name) +
        ". A basket can only hold items from one restaurant.</p></div>" +
      '<div class="sheet__foot"><div class="btn-row">' +
        '<button class="btn btn--ghost btn--lg" data-sheet="keep">Keep basket</button>' +
        '<button class="btn btn--primary btn--lg" data-sheet="replace">Replace</button>' +
      "</div></div>"
    );
    document.querySelector('[data-sheet="keep"]').addEventListener("click", UI.closeSheet);
    document.querySelector('[data-sheet="replace"]').addEventListener("click", function () {
      KF.replaceBasket(vendorId, itemId);
      UI.closeSheet();
      UI.toast("Basket replaced with " + shop.name);
      render();
    });
  }

  async function placeOrder() {
    var result = KF.placeOrder({
      tip: uiState.tip,
      payment: uiState.payment,
      note: uiState.note,
      fulfilment: uiState.fulfilment
    });
    if (!result.ok) {
      UI.toast(result.reason);
      return;
    }
    uiState.note = "";
    var trackingError = "";
    if (result.order.fulfilment === "delivery" && customerSession && API) {
      try {
        var response = await fetch(API + "/api06/tracking/orders", {
          method: "POST",
          headers: {
            Authorization: "Bearer " + customerSession.accessToken,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            localOrderId: result.order.id,
            shopName: KF.vendor(result.order.vendorId).name,
            address: result.order.address,
            items: result.order.items,
            totalCents: Math.round(result.order.total * 100),
            fulfilment: result.order.fulfilment
          })
        });
        var trackedOrder = await response.json();
        if (!response.ok) throw new Error(trackedOrder.error || "Tracking unavailable");
        KF.setRemoteTrackingId(result.order.id, trackedOrder.id);
      } catch (error) {
        trackingError = "Live tracking could not start. Check the backend connection.";
      }
    } else if (result.order.fulfilment === "delivery") {
      trackingError = "Live tracking is unavailable until the backend URL is configured.";
    }
    var collect = result.order.fulfilment === "collect";
    UI.toast(
      (collect ? "Collection order sent to " : "Order sent to ") + KF.vendor(result.order.vendorId).name
    );
    if (trackingError) UI.toast(trackingError);
    go("#/track/" + result.order.id);
  }

  function reorder(id) {
    var order = KF.order(id);
    if (!order) return;
    KF.clearBasket();
    order.items.forEach(function (item) {
      var shop = KF.vendor(order.vendorId);
      var match = shop.menu.filter(function (menuItem) {
        return menuItem.name === item.name;
      })[0];
      if (match) KF.addToBasket(shop.id, match.id);
    });
    UI.toast("Items added to your basket");
    go("#/checkout");
  }

  document.addEventListener("click", function (event) {
    var authModeButton = event.target.closest("[data-auth-mode]");
    if (authModeButton) {
      authMode = authModeButton.getAttribute("data-auth-mode");
      renderAuth("");
      return;
    }

    var back = event.target.closest("[data-back]");
    if (back) {
      event.preventDefault();
      if (history.length > 1) history.back();
      else go("#/home");
      return;
    }

    var nav = event.target.closest("[data-nav]");
    if (nav) {
      event.preventDefault();
      go(nav.getAttribute("data-nav"));
      return;
    }

    var action = event.target.closest("[data-action]");
    if (!action) return;

    var actionName = action.getAttribute("data-action");
    if (!actionName) return;

    if (actionName === "logout") {
      customerSession = null;
      sessionStorage.removeItem(SESSION_KEY);
      KF.clearBasket();
      authMode = "login";
      location.hash = "#/home";
      renderAuth("You have signed out.");
      return;
    }

    if (actionName === "address") {
      openAddressSheet();
      return;
    }

    if (actionName === "customer-gps") {
      locateCustomerAddress();
      return;
    }

    if (actionName === "clear-customer-gps") {
      var addressForm = document.getElementById("addressForm");
      addressForm.elements.latitude.value = "";
      addressForm.elements.longitude.value = "";
      var gpsStatus = document.getElementById("customerGpsStatus");
      if (gpsStatus) gpsStatus.textContent = "GPS pin removed. Save the address to confirm.";
      action.remove();
      return;
    }

    if (actionName === "filters") {
      openFilters();
      return;
    }

    if (actionName === "sort") {
      openSort();
      return;
    }

    if (actionName === "close-sheet") {
      UI.closeSheet();
      return;
    }

    if (actionName === "filter-township") {
      var township = action.getAttribute("data-value");
      uiState.filters.township = township && township !== "All" ? township : "All";
      afterFilterChange();
      return;
    }

    if (actionName === "filter-fee") {
      var feeValue = action.getAttribute("data-value");
      uiState.filters.maxFee = feeValue ? Number(feeValue) : null;
      afterFilterChange();
      return;
    }

    if (actionName === "filter-eta") {
      var etaValue = action.getAttribute("data-value");
      uiState.filters.maxEta = etaValue ? Number(etaValue) : null;
      afterFilterChange();
      return;
    }

    if (actionName === "filter-rating") {
      var ratingValue = action.getAttribute("data-value");
      uiState.filters.minRating = ratingValue ? Number(ratingValue) : null;
      afterFilterChange();
      return;
    }

    if (actionName === "toggle-accepting") {
      uiState.filters.acceptingOnly = !uiState.filters.acceptingOnly;
      afterFilterChange();
      return;
    }

    if (actionName === "reset-filters") {
      resetFilters();
      afterFilterChange();
      return;
    }

    if (actionName === "clear-filters") {
      resetFilters();
      render();
      return;
    }

    if (actionName === "clear-shop-query") {
      uiState.filters.shopQuery = "";
      render();
      return;
    }

    if (actionName === "clear-township") {
      uiState.filters.township = "All";
      render();
      return;
    }

    if (actionName === "clear-fee") {
      uiState.filters.maxFee = null;
      render();
      return;
    }

    if (actionName === "clear-eta") {
      uiState.filters.maxEta = null;
      render();
      return;
    }

    if (actionName === "clear-rating") {
      uiState.filters.minRating = null;
      render();
      return;
    }

    if (actionName === "clear-accepting") {
      uiState.filters.acceptingOnly = false;
      render();
      return;
    }

    if (actionName === "sort-pick") {
      uiState.sort = action.getAttribute("data-value");
      UI.closeSheet();
      render();
      return;
    }

    if (actionName === "fulfil") {
      uiState.fulfilment = action.getAttribute("data-value") === "collect" ? "collect" : "delivery";
      render();
      return;
    }

    if (actionName === "clear-search") {
      uiState.query = "";
      render();
      return;
    }

    if (actionName === "category") {
      uiState.category = action.getAttribute("data-key");
      refreshFeed();
      return;
    }

    if (actionName === "add") {
      var vendorId = action.getAttribute("data-vendor");
      var itemId = action.getAttribute("data-item");
      var result = KF.addToBasket(vendorId, itemId);
      if (!result.ok && result.reason === "other-vendor") {
        confirmReplace(vendorId, itemId, result.shop);
        return;
      }
      if (!result.ok) {
        UI.toast(result.reason);
        return;
      }
      var item = KF.vendor(vendorId).menu.filter(function (menuItem) { return menuItem.id === itemId; })[0];
      UI.toast(item.name + " added");
      render();
      return;
    }

    if (actionName === "qty") {
      var id = action.getAttribute("data-item");
      var delta = Number(action.getAttribute("data-delta"));
      var basket = KF.basketView();
      var line = basket.lines.filter(function (entry) { return entry.item.id === id; })[0];
      var nextQty = (line ? line.qty : 0) + delta;
      KF.setQty(id, Math.max(0, nextQty));
      render();
      return;
    }

    if (actionName === "payment") {
      uiState.payment = action.getAttribute("data-value");
      render();
      return;
    }

    if (actionName === "tip") {
      uiState.tip = Number(action.getAttribute("data-value"));
      render();
      return;
    }

    if (actionName === "place-order") {
      placeOrder();
      return;
    }

    if (actionName === "reorder") {
      reorder(action.getAttribute("data-order"));
      return;
    }

    if (actionName === "reset") {
      KF.reset();
      if (customerSession) KF.setCustomerIdentity(customerSession.user);
      UI.toast("Local data reset");
      render();
    }
  });

  document.addEventListener("input", function (event) {
    if (event.target.id === "filterShopQuery") {
      uiState.filters.shopQuery = event.target.value;
      render();
      var apply = document.getElementById("filterShow");
      if (apply) {
        var total = filteredVendors().length;
        apply.textContent = total === 1 ? "Show 1 vendor" : "Show " + total + " vendors";
      }
      return;
    }

    if (event.target.id === "search") {
      uiState.query = event.target.value;
      var clear = header.querySelector(".search__clear");
      if (uiState.query && !clear) {
        header.querySelector(".search").insertAdjacentHTML(
          "beforeend",
          '<button class="search__clear" data-action="clear-search" aria-label="Clear search"><i class="ph ph-x"></i></button>'
        );
      }
      if (!uiState.query && clear) clear.remove();
      refreshFeed();
      return;
    }

    if (event.target.id === "orderNote") {
      uiState.note = event.target.value;
    }
  });

  window.addEventListener("hashchange", render);

  KF.subscribe(function () {
    if (!customerSession) return;
    var view = route();
    /* keep the note being typed while the store re-renders */
    var noteField = document.getElementById("orderNote");
    if (noteField) uiState.note = noteField.value;
    render();
  });

  UI.bindSheetDismissal();

  if (!location.hash) location.replace("#/home");
  restoreSession();
})();
