/* Driver app: nearby pickups sorted by distance, then the active route with its GPS trail. */
(function () {
  "use strict";

  var UI = window.KFUI;
  var KF = window.KF;
  var money = UI.money;
  var esc = UI.escape;
  var localOrigin = location.protocol === "file:" ? "http://127.0.0.1:3000" :
    /^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? location.origin : "";
  var API = String(window.KF_API_URL || localOrigin).replace(/\/+$/, "");
  var SESSION_KEY = "kf.driver.session";

  var header = document.getElementById("header");
  var main = document.getElementById("main");
  var bottom = document.getElementById("bottom");
  var currentPosition = null;
  var gpsMessage = "GPS is off";
  var gpsWatchId = null;
  var gpsTrail = [];
  var lastLocationPublishedAt = 0;
  var remoteOrders = [];
  var remoteActiveOrder = null;
  var remotePoller = null;
  var remoteMessage = "";
  var liveMap = null;
  var liveMarker = null;
  var liveTrailLayer = null;
  var currentDestination = "";
  var driverSession = null;
  var authMode = "login";

  function renderLogin(message) {
    header.innerHTML =
      '<div class="header-row"><a class="brand" href="./index.html">Kassi<em>Fleet</em></a>' +
        '<span class="badge badge--green">Driver app</span></div>';
    bottom.innerHTML = "";
    main.innerHTML =
      '<div class="pad section-gap"><div class="card card--pad">' +
        '<div class="label">DRIVER ACCESS</div>' +
        '<h1 class="h2" style="margin-top:5px">' + (authMode === "login" ? "Sign in to your account" : "Create your driver account") + "</h1>" +
        '<p class="meta" style="margin-top:5px">Use your registered email to open your driver dashboard.</p>' +
        '<div style="display:flex;gap:8px;margin-top:16px">' +
          '<button class="btn ' + (authMode === "login" ? "btn--primary" : "btn--quiet") + '" data-auth-mode="login">Sign in</button>' +
          '<button class="btn ' + (authMode === "register" ? "btn--primary" : "btn--quiet") + '" data-auth-mode="register">Register</button>' +
        "</div>" +
        '<form id="driverAuthForm" style="display:grid;gap:12px;margin-top:16px">' +
          (authMode === "register"
            ? '<label>Full name<input name="name" autocomplete="name" maxlength="100" required></label>' : "") +
          '<label>Email<input name="email" type="email" autocomplete="email" maxlength="254" required></label>' +
          '<label>Password<input name="password" type="password" autocomplete="' + (authMode === "login" ? "current-password" : "new-password") + '" minlength="8" maxlength="128" required></label>' +
          '<button class="btn btn--primary btn--block" type="submit">' + (authMode === "login" ? "Sign in" : "Create account") + "</button>" +
        "</form>" +
        '<div class="meta" id="authMessage" role="status" aria-live="polite" style="margin-top:12px;color:var(--danger)">' + esc(message || "") + "</div>" +
      "</div></div>";
  }

  async function activateSession(session) {
    if (!session.user || session.user.role !== "driver" || !KF.setDriverIdentity(session.user)) {
      throw new Error("A valid driver account is required.");
    }
    driverSession = session;
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    startRemotePolling();
    render();
  }

  async function restoreSession() {
    var saved;
    try {
      saved = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null");
    } catch (error) {
      saved = null;
    }
    if (!saved || !saved.accessToken || !saved.user) return renderLogin("");
    if (!API) return renderLogin("Driver login needs the deployed backend URL. Set KF_API_URL in apps/js/config.js.");

    try {
      var response = await fetch(API + "/api04/dispatch/my-deliveries", {
        headers: { Authorization: "Bearer " + saved.accessToken }
      });
      if (!response.ok) throw new Error("Your session expired. Sign in again.");
      await activateSession(saved);
    } catch (error) {
      sessionStorage.removeItem(SESSION_KEY);
      driverSession = null;
      renderLogin(error.message || "Could not reach the server. Start the Kassi Fleet backend and try again.");
    }
  }

  function stopGps(message) {
    if (gpsWatchId !== null && navigator.geolocation) navigator.geolocation.clearWatch(gpsWatchId);
    gpsWatchId = null;
    gpsMessage = message || "GPS is off";
  }

  function stopRemotePolling() {
    if (remotePoller) window.clearInterval(remotePoller);
    remotePoller = null;
  }

  async function loadRemoteDeliveries() {
    if (!driverSession || !API) return;
    try {
      var headers = { Authorization: "Bearer " + driverSession.accessToken };
      var results = await Promise.all([
        fetch(API + "/api06/tracking/open", { headers: headers }),
        fetch(API + "/api06/tracking/my-active", { headers: headers })
      ]);
      if (!results[0].ok || !results[1].ok) throw new Error("Could not load online deliveries.");
      remoteOrders = await results[0].json();
      var nextActive = await results[1].json();
      var changed = (remoteActiveOrder && !nextActive) || (!remoteActiveOrder && nextActive) ||
        (remoteActiveOrder && nextActive && (remoteActiveOrder.id !== nextActive.id || remoteActiveOrder.status !== nextActive.status));
      remoteActiveOrder = nextActive;
      remoteMessage = "";
      if (changed) render();
      else if (route() === "nearby") renderRemoteOrderList();
    } catch (error) {
      remoteMessage = "Online tracking is unavailable. Check your connection.";
      if (route() === "nearby") renderRemoteOrderList();
    }
  }

  function startRemotePolling() {
    stopRemotePolling();
    loadRemoteDeliveries();
    remotePoller = window.setInterval(loadRemoteDeliveries, 10000);
  }

  function destroyLiveMap() {
    if (liveMap) liveMap.remove();
    liveMap = null;
    liveMarker = null;
    liveTrailLayer = null;
  }

  function initializeLiveMap(elementId, destination) {
    destroyLiveMap();
    var element = document.getElementById(elementId);
    if (!element) return;
    if (!window.L) {
      element.textContent = "The map could not load. Check your internet connection and refresh.";
      return;
    }

    var center = currentPosition
      ? [currentPosition.latitude, currentPosition.longitude]
      : [-26.2041, 28.0473];
    liveMap = window.L.map(element, { scrollWheelZoom: false }).setView(center, currentPosition ? 16 : 11);
    window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(liveMap);
    liveTrailLayer = window.L.polyline(gpsTrail, {
      color: "#d9500e",
      opacity: 0.9,
      weight: 4
    }).addTo(liveMap);
    var bounds = [];
    if (currentPosition) {
      liveMarker = window.L.circleMarker(center, {
        radius: 8,
        color: "#ffffff",
        weight: 3,
        fillColor: "#12805c",
        fillOpacity: 1
      }).addTo(liveMap);
      bounds.push(center);
    }
    if (destination) {
      var destinationPoint = [destination.latitude, destination.longitude];
      window.L.marker(destinationPoint).addTo(liveMap).bindPopup("Delivery location");
      bounds.push(destinationPoint);
    }
    if (bounds.length > 1) {
      liveMap.fitBounds(window.L.latLngBounds(bounds).pad(0.15));
    }
    window.setTimeout(function () {
      if (liveMap) liveMap.invalidateSize();
    }, 0);
  }

  function distanceMeters(first, second) {
    var radians = Math.PI / 180;
    var latitudeDelta = (second[0] - first[0]) * radians;
    var longitudeDelta = (second[1] - first[1]) * radians;
    var value = Math.sin(latitudeDelta / 2) * Math.sin(latitudeDelta / 2) +
      Math.cos(first[0] * radians) * Math.cos(second[0] * radians) *
      Math.sin(longitudeDelta / 2) * Math.sin(longitudeDelta / 2);
    return 6371000 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
  }

  function updateGpsReadout() {
    var coordinateText = currentPosition
      ? currentPosition.latitude.toFixed(5) + ", " + currentPosition.longitude.toFixed(5) + " · ±" + Math.round(currentPosition.accuracy) + " m"
      : "";
    main.querySelectorAll("[data-gps-status]").forEach(function (element) {
      element.textContent = gpsMessage;
    });
    main.querySelectorAll("[data-gps-coordinates]").forEach(function (element) {
      element.textContent = coordinateText;
    });
    main.querySelectorAll('[data-action="gps"]').forEach(function (button) {
      button.innerHTML = '<i class="ph ' + (gpsWatchId === null ? "ph-crosshair" : "ph-pause") + '"></i>' +
        (gpsWatchId === null ? "Start GPS" : "Stop GPS");
    });
    var mapLink = document.getElementById("gpsMapLink");
    if (mapLink && currentPosition) {
      mapLink.href = "https://www.openstreetmap.org/?mlat=" + currentPosition.latitude +
        "&mlon=" + currentPosition.longitude + "#map=17/" + currentPosition.latitude + "/" + currentPosition.longitude;
      mapLink.hidden = false;
    } else if (mapLink) {
      mapLink.hidden = true;
    }
    var directionsLink = document.getElementById("gpsDirectionsLink");
    if (directionsLink && currentDestination) {
      directionsLink.href = "https://www.google.com/maps/dir/?api=1&destination=" + encodeURIComponent(currentDestination) +
        "&travelmode=driving" + (currentPosition
          ? "&origin=" + currentPosition.latitude + "," + currentPosition.longitude
          : "");
    }
  }

  function updateLiveMap() {
    if (!liveMap || !currentPosition) return;
    var coordinates = [currentPosition.latitude, currentPosition.longitude];
    if (!liveMarker) {
      liveMarker = window.L.circleMarker(coordinates, {
        radius: 8,
        color: "#ffffff",
        weight: 3,
        fillColor: "#12805c",
        fillOpacity: 1
      }).addTo(liveMap);
    } else {
      liveMarker.setLatLng(coordinates);
    }
    if (liveTrailLayer) liveTrailLayer.setLatLngs(gpsTrail);
    liveMap.panTo(coordinates, { animate: true, duration: 0.5 });
  }

  function startGps() {
    if (!navigator.geolocation) {
      gpsMessage = "GPS is not available in this browser.";
      renderCurrentView();
      return;
    }
    if (gpsWatchId !== null) return;

    gpsMessage = "Waiting for GPS signal...";
    renderCurrentView();
    gpsWatchId = navigator.geolocation.watchPosition(function (position) {
      currentPosition = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy
      };
      var coordinates = [currentPosition.latitude, currentPosition.longitude];
      var previous = gpsTrail[gpsTrail.length - 1];
      if (!previous || distanceMeters(previous, coordinates) >= 5) {
        gpsTrail.push(coordinates);
        if (gpsTrail.length > 500) gpsTrail.shift();
      }
      var now = Date.now();
      if (now - lastLocationPublishedAt >= 5000) {
        lastLocationPublishedAt = now;
        KF.updateDriverLocation(me().id, currentPosition);
        if (remoteActiveOrder && driverSession && API) {
          fetch(API + "/api06/tracking/orders/" + encodeURIComponent(remoteActiveOrder.id) + "/location", {
            method: "PUT",
            headers: {
              Authorization: "Bearer " + driverSession.accessToken,
              "Content-Type": "application/json"
            },
            body: JSON.stringify(currentPosition)
          }).catch(function () {
            remoteMessage = "Could not publish GPS to the tracking server.";
          });
        }
      }
      gpsMessage = "GPS tracking is on";
      if (!liveMap) renderCurrentView();
      updateLiveMap();
      updateGpsReadout();
    }, function (error) {
      gpsMessage = error.code === error.PERMISSION_DENIED
        ? "Location access was denied. Allow location access in your browser settings."
        : error.code === error.TIMEOUT
          ? "No GPS fix yet. Move to an open area and try again."
          : "Could not get your location. Check your device location settings.";
      if (error.code === error.PERMISSION_DENIED) stopGps(gpsMessage);
      updateGpsReadout();
    }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 3000 });
  }

  function renderCurrentView() {
    if (!driverSession) return;
    if (route() === "route") renderRoute();
    else renderNearby();
  }

  function route() {
    var raw = location.hash.replace(/^#\/?/, "");
    return raw || "nearby";
  }

  function go(hash) {
    if (location.hash === "#/" + hash) render();
    else location.hash = "#/" + hash;
  }

  function me() {
    return KF.myDriver();
  }

  function activeOrder() {
    return KF.activeOrderForDriver();
  }

  function pickupEta(distKm) {
    return Math.max(3, Math.round(distKm * 3.2)) + " min";
  }

  /* ---------------- Header ---------------- */

  function renderHeader(view) {
    var driver = me();
    var online = KF.get().driver.online;

    if (view === "route") {
      header.innerHTML =
        '<div class="header-row">' +
          '<button class="icon-btn" data-back aria-label="Back to nearby orders"><i class="ph ph-arrow-left"></i></button>' +
          '<div class="header-title" style="flex:1">' +
            '<div style="min-width:0"><div class="h2">Active route</div>' +
            '<div class="meta num">' + (remoteActiveOrder ? remoteActiveOrder.localOrderId : activeOrder() ? activeOrder().id : "No order") + "</div></div>" +
          "</div>" +
            '<button class="icon-btn" data-action="logout" aria-label="Sign out"><i class="ph ph-sign-out"></i></button>' +
          '<a class="icon-btn" href="./index.html" aria-label="All Kassifleet apps"><i class="ph ph-squares-four"></i></a>' +
        "</div>";
      return;
    }

    header.innerHTML =
      '<div class="header-row">' +
        '<div style="min-width:0">' +
          '<div class="label">Courier</div>' +
          '<div class="h2 truncate" style="margin-top:2px">' + esc(driver.name) + "</div>" +
        "</div>" +
        '<div style="display:flex;align-items:center;gap:9px;flex:0 0 auto">' +
          '<span class="meta" style="font-weight:600">' + (online ? "Online" : "Offline") + "</span>" +
          '<button class="switch" role="switch" aria-checked="' + online + '" data-action="online" aria-label="Go online for pickups"></button>' +
          '<span class="avatar" aria-label="' + esc(driverSession.user.email) + '">' + esc(UI.initials(driver.name)) + "</span>" +
          '<button class="icon-btn" data-action="logout" aria-label="Sign out"><i class="ph ph-sign-out"></i></button>' +
        "</div>" +
      "</div>";
  }

  /* ---------------- Nearby ---------------- */

  function nearbyRow(order) {
    var shop = KF.vendor(order.vendorId);
    var items = order.items.reduce(function (sum, item) { return sum + item.qty; }, 0);
    return (
      '<button class="row" data-claim="' + order.id + '" style="align-items:center">' +
        '<span style="flex:0 0 auto;width:42px;text-align:center">' +
          '<span class="row__title num" style="display:block;font-size:14.5px">' + order.distKm.toFixed(1) + "</span>" +
          '<span class="label" style="font-size:9px">km</span>' +
        "</span>" +
        '<span class="row__body">' +
          '<span class="row__title truncate" style="display:block">' + esc(shop.name) + "</span>" +
          '<span class="row__lines"><span>Pickup ' + esc(shop.township) + '</span><span class="sep"></span>' +
            '<span class="num">' + items + " items</span><span class=\"sep\"></span>" +
            '<span class="num">' + pickupEta(order.distKm) + " away</span></span>" +
          '<span class="row__lines"><span>Drop ' + esc(order.address.suburb) + "</span>" +
            '<span class="sep"></span><span class="num">Promised ' + UI.clock(order.promisedAt) + "</span></span>" +
        "</span>" +
        '<span style="flex:0 0 auto;text-align:right">' +
          '<span class="row__title num" style="display:block;font-size:14.5px">' + money(order.payout) + "</span>" +
          '<span class="label" style="font-size:9px">payout</span>' +
        "</span>" +
        '<i class="ph ph-caret-right" style="color:var(--muted-2);font-size:12px"></i>' +
      "</button>"
    );
  }

  function renderNearby() {
    destroyLiveMap();
    var online = KF.get().driver.online;
    var nearby = KF.nearbyOrders();
    var active = activeOrder();
    var day = KF.driverDay(me().id);

    main.innerHTML =
      '<div class="pad" style="padding-top:12px">' +
        '<div id="nearbyMap" class="map map--strip" role="application" aria-label="OpenStreetMap showing your live GPS location"></div>' +
      "</div>" +

      '<div class="pad" style="margin-top:12px"><div class="card card--pad">' +
        '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">' +
          '<div style="min-width:0"><div class="h3">Current location</div>' +
            '<div class="meta" data-gps-status role="status" aria-live="polite" style="margin-top:4px">' + esc(gpsMessage) + "</div>" +
            '<div class="meta num" data-gps-coordinates style="margin-top:4px">' +
              (currentPosition ? currentPosition.latitude.toFixed(5) + ", " + currentPosition.longitude.toFixed(5) + " · ±" + Math.round(currentPosition.accuracy) + " m" : "") +
            "</div>" +
          "</div>" +
          '<button class="btn btn--quiet" data-action="gps"><i class="ph ' + (gpsWatchId === null ? "ph-crosshair" : "ph-pause") + '"></i>' +
            (gpsWatchId === null ? "Start GPS" : "Stop GPS") + "</button>" +
        "</div>" +
        '<a id="gpsMapLink" class="btn btn--quiet btn--block" style="margin-top:10px" hidden target="_blank" rel="noopener noreferrer">' +
          '<i class="ph ph-map-trifold"></i>View on map</a>' +
      "</div></div>" +

      '<div class="pad section-gap"><div id="remoteOrders"></div></div>' +

      (!online
        ? '<div class="pad" style="margin-top:12px"><div class="notice notice--warn"><i class="ph ph-warning-circle"></i><span>You are offline. Go online to see pickups and claim orders.</span></div></div>'
        : "") +

      (active
        ? '<div class="pad" style="margin-top:12px"><div class="active-card">' +
            '<div style="display:flex;align-items:center;justify-content:space-between">' +
              '<span class="inline-flex" style="display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:700;color:var(--green-ink)">' +
                '<span class="dot dot--green"></span>' + UI.statusMeta(active.status).label + "</span>" +
              '<span class="num" style="font-size:11px;color:var(--accent-ink)">' + active.id + "</span>" +
            "</div>" +
            '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-top:7px">' +
              '<div style="min-width:0">' +
                '<div class="h3 truncate">' + esc(KF.vendor(active.vendorId).name) + "</div>" +
                '<div class="meta truncate" style="margin-top:2px">' + esc(active.address.street) + ", " + esc(active.address.suburb) + "</div>" +
              "</div>" +
              '<div style="text-align:right;flex:0 0 auto">' +
                '<div class="num" style="font-size:15px;font-weight:700">' + money(active.payout) + "</div>" +
                '<div class="label" style="font-size:9px;color:var(--accent-ink)">payout</div>' +
              "</div>" +
            "</div>" +
            '<div class="progress" style="margin-top:10px">' +
              '<span data-done="true"></span>' +
              '<span data-done="' + (active.status === "picked_up" || active.status === "delivered") + '"></span>' +
            "</div>" +
            '<div style="display:flex;justify-content:space-between;margin-top:5px;font-size:10px;color:var(--accent-ink)" class="num">' +
              "<span>Claimed " + UI.clock(active.claimedAt) + "</span>" +
              "<span>Due " + UI.clock(active.promisedAt) + "</span>" +
            "</div>" +
            '<button class="btn btn--primary btn--block btn--lg" style="margin-top:11px" data-nav="route">' +
              '<i class="ph ph-navigation-arrow"></i>Continue route</button>' +
          "</div></div>"
        : "") +

      '<div class="pad section-gap">' +
        '<div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:8px">' +
          '<h2 class="h2">Nearby pickups</h2>' +
          '<span class="meta num">' + nearby.length + " ready</span>" +
        "</div>" +
        (nearby.length
          ? '<div class="list">' + nearby.map(nearbyRow).join("") + "</div>"
          : '<div class="card"><div class="empty"><i class="ph ph-map-pin"></i>' +
              '<div class="empty__title">No ready orders right now</div>' +
              '<div class="empty__body">Restaurants mark orders ready for pickup. Keep this screen open.</div>' +
            "</div></div>") +
      "</div>" +

      '<div class="pad section-gap">' +
        '<div class="stats">' +
          "<div><dt>Earned today</dt><dd>" + money(day.earned) + "</dd></div>" +
          "<div><dt>Deliveries</dt><dd>" + day.count + "</dd></div>" +
          "<div><dt>Online</dt><dd>" + (online ? "Yes" : "No") + "</dd></div>" +
        "</div>" +
      "</div>" +
      '<div style="height:18px"></div>';
    initializeLiveMap("nearbyMap");
    updateGpsReadout();
    renderRemoteOrderList();
  }

  function renderRemoteOrderList() {
    var host = document.getElementById("remoteOrders");
    if (!host) return;
    if (remoteActiveOrder) {
      host.innerHTML = '<div class="active-card"><div class="h3">Online delivery</div>' +
        '<div class="meta" style="margin-top:4px">' + esc(remoteActiveOrder.shopName) + " · " + esc(remoteActiveOrder.localOrderId) +
          " · " + esc(remoteActiveOrder.status) + "</div>" +
        '<button class="btn btn--primary btn--block" style="margin-top:10px" data-nav="route">Continue route</button></div>';
      return;
    }
    host.innerHTML =
      '<div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:8px">' +
        '<h2 class="h2">Online deliveries</h2><span class="meta num">' + remoteOrders.length + " ready</span></div>" +
      (remoteMessage ? '<div class="notice notice--warn"><i class="ph ph-warning-circle"></i><span>' + esc(remoteMessage) + "</span></div>" : "") +
      (remoteOrders.length
        ? '<div class="list">' + remoteOrders.map(function (order) {
            var area = [order.address.suburb, order.address.township].filter(Boolean).join(", ");
            return '<div class="row"><span class="row__body"><span class="row__title" style="display:block">' + esc(order.shopName) + "</span>" +
              '<span class="row__lines"><span>' + esc(area || order.address.street || "Delivery") + "</span>" +
                '<span class="sep"></span><span class="num">' + esc(order.localOrderId) + "</span></span></span>" +
              '<button class="btn btn--green btn--sm" data-remote-claim="' + esc(order.id) + '">Claim</button></div>';
          }).join("") + "</div>"
        : '<div class="list-note">New customer deliveries will appear here.</div>');
  }

  async function claimRemoteDelivery(id) {
    try {
      var response = await fetch(API + "/api06/tracking/orders/" + encodeURIComponent(id) + "/claim", {
        method: "PATCH",
        headers: { Authorization: "Bearer " + driverSession.accessToken }
      });
      var order = await response.json();
      if (!response.ok) throw new Error(order.error || "Could not claim this delivery.");
      remoteActiveOrder = order;
      remoteOrders = remoteOrders.filter(function (candidate) { return candidate.id !== id; });
      gpsTrail = [];
      gpsMessage = "GPS is off";
      go("route");
    } catch (error) {
      UI.toast(error.message || "Could not claim this delivery.");
      loadRemoteDeliveries();
    }
  }

  async function advanceRemoteDelivery() {
    if (!remoteActiveOrder) return;
    var next = remoteActiveOrder.status === "claimed" ? "picked_up" : remoteActiveOrder.status === "picked_up" ? "delivered" : null;
    if (!next) return;
    try {
      var response = await fetch(API + "/api06/tracking/orders/" + encodeURIComponent(remoteActiveOrder.id) + "/status", {
        method: "PATCH",
        headers: {
          Authorization: "Bearer " + driverSession.accessToken,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ status: next })
      });
      var result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not update this delivery.");
      if (next === "delivered") {
        stopGps("Delivery complete");
        currentPosition = null;
        remoteActiveOrder = null;
        go("nearby");
      } else {
        remoteActiveOrder.status = next;
        render();
      }
      loadRemoteDeliveries();
    } catch (error) {
      UI.toast(error.message || "Could not update this delivery.");
    }
  }

  /* ---------------- Claim review ---------------- */

  function openClaim(id) {
    var order = KF.order(id);
    if (!order) return;
    var shop = KF.vendor(order.vendorId);

    UI.openSheet(
      '<div class="sheet__title">Claim ' + order.id + "</div>" +
      '<div class="sheet__body">' +
        '<div class="stats">' +
          "<div><dt>Payout</dt><dd>" + money(order.payout) + "</dd></div>" +
          "<div><dt>To pickup</dt><dd>" + order.distKm.toFixed(1) + " km</dd></div>" +
          "<div><dt>Promised</dt><dd>" + UI.clock(order.promisedAt) + "</dd></div>" +
        "</div>" +
        '<div class="divider"></div>' +
        '<div style="display:flex;align-items:flex-start;gap:10px">' +
          '<i class="ph-fill ph-storefront" style="font-size:17px;color:var(--accent);margin-top:1px"></i>' +
          '<div style="flex:1;min-width:0">' +
            '<div class="row__title">' + esc(shop.name) + "</div>" +
            '<div class="meta">' + esc(shop.area) + ", " + esc(shop.township) + " · pickup " + pickupEta(order.distKm) + " away</div>" +
          "</div>" +
        "</div>" +
        '<div class="divider"></div>' +
        '<div style="display:flex;align-items:flex-start;gap:10px">' +
          '<i class="ph-fill ph-house" style="font-size:17px;color:var(--accent);margin-top:1px"></i>' +
          '<div style="flex:1;min-width:0">' +
            '<div class="row__title">Deliver in ' + esc(order.address.suburb) + "</div>" +
            '<div class="meta">' + esc(order.address.note || "No entrance note") + "</div>" +
          "</div>" +
        "</div>" +
        '<div class="divider"></div>' +
        '<div class="label">Items</div>' +
        '<div class="list" style="margin-top:6px">' +
          order.items.map(function (item) {
            return '<div class="row" style="padding:9px 12px"><span class="qty-badge">' + item.qty + "</span>" +
              '<span class="row__body"><span class="row__title" style="display:block;font-weight:600">' + esc(item.name) + "</span>" +
              (item.note ? '<span class="meta">' + esc(item.note) + "</span>" : "") + "</span></div>";
          }).join("") +
        "</div>" +
      "</div>" +
      '<div class="sheet__foot">' +
        (activeOrder()
          ? '<div class="notice notice--info"><i class="ph ph-steering-wheel"></i><span>Finish ' +
            activeOrder().id + " before claiming another order.</span></div>"
          : '<button class="btn btn--green btn--lg btn--block" data-action="claim" data-id="' + order.id + '">Claim order · ' + money(order.payout) + "</button>" +
            '<div class="list-note" style="padding:8px 0 0">One delivery at a time. You get the customer details after claiming.</div>') +
      "</div>"
    );
  }

  /* ---------------- Route ---------------- */

  function renderRoute() {
    destroyLiveMap();
    if (remoteActiveOrder) return renderRemoteRoute();
    var order = activeOrder();
    if (!order) {
      stopGps();
      currentPosition = null;
      currentDestination = "";
      main.innerHTML =
        '<div class="pad section-gap"><div class="card"><div class="empty">' +
          '<i class="ph ph-navigation-arrow"></i>' +
          '<div class="empty__title">No active delivery</div>' +
          '<div class="empty__body">Claim an order from the nearby list to start a route.</div>' +
          '<button class="btn btn--primary" style="margin-top:14px" data-nav="nearby">See nearby pickups</button>' +
        "</div></div></div>";
      bottom.innerHTML = "";
      return;
    }

    var shop = KF.vendor(order.vendorId);
    var picked = order.status === "picked_up";
    var steps = [
      { label: "Claimed", time: order.claimedAt },
      { label: "Picked up", time: order.pickedUpAt },
      { label: "Delivered", time: order.deliveredAt }
    ];
    var current = order.status === "claimed" ? 0 : order.status === "picked_up" ? 1 : 2;
    var destinationPosition = picked && Number.isFinite(order.address.latitude) && Number.isFinite(order.address.longitude)
      ? { latitude: order.address.latitude, longitude: order.address.longitude }
      : null;
    var destination = destinationPosition
      ? destinationPosition.latitude + "," + destinationPosition.longitude
      : picked
        ? [order.address.street, order.address.suburb, order.address.township].filter(Boolean).join(", ")
        : [shop.name, shop.township].filter(Boolean).join(", ");
    currentDestination = destination;

    main.innerHTML =
      '<div class="pad" style="padding-top:12px">' +
        '<div class="banner">' +
          '<div class="banner__icon"><i class="ph-fill ph-navigation-arrow"></i></div>' +
          '<div class="banner__body">' +
            '<div class="banner__title">' + (picked ? "Deliver to " + esc(order.address.street) : "Collect from " + esc(shop.name)) + "</div>" +
            '<div class="banner__sub num">' + order.distKm.toFixed(1) + " km left, arriving " + UI.clock(order.promisedAt) + "</div>" +
          "</div>" +
        "</div>" +
      "</div>" +

      '<div class="pad" style="margin-top:12px">' +
        '<div id="routeMap" class="map map--tall" role="application" aria-label="Live OpenStreetMap showing your GPS position and traveled route"></div>' +
      "</div>" +

      '<div class="pad" style="margin-top:12px"><div class="card card--pad">' +
        '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">' +
          '<div style="min-width:0"><div class="h3">Current location</div>' +
            '<div class="meta" data-gps-status role="status" aria-live="polite" style="margin-top:4px">' + esc(gpsMessage) + "</div>" +
            '<div class="meta num" data-gps-coordinates style="margin-top:4px">' +
              (currentPosition ? currentPosition.latitude.toFixed(5) + ", " + currentPosition.longitude.toFixed(5) + " · ±" + Math.round(currentPosition.accuracy) + " m" : "") +
            "</div>" +
          "</div>" +
          '<button class="btn btn--quiet" data-action="gps"><i class="ph ' + (gpsWatchId === null ? "ph-crosshair" : "ph-pause") + '"></i>' +
            (gpsWatchId === null ? "Start GPS" : "Stop GPS") + "</button>" +
        "</div>" +
        '<a id="gpsMapLink" class="btn btn--quiet btn--block" style="margin-top:10px" hidden target="_blank" rel="noopener noreferrer">' +
          '<i class="ph ph-map-trifold"></i>View live position</a>' +
        '<a id="gpsDirectionsLink" class="btn btn--primary btn--block" style="margin-top:10px" href="https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(destination) +
          '&travelmode=driving' + (currentPosition ? '&origin=' + currentPosition.latitude + ',' + currentPosition.longitude : '') +
          '" target="_blank" rel="noopener noreferrer"><i class="ph ph-navigation-arrow"></i>Start GPS route to ' +
          (picked ? "customer" : "pickup") + "</a>" +
      "</div></div>" +

      '<div class="pad section-gap">' +
        '<div class="card card--pad">' +
          '<div class="steps">' +
            steps.map(function (step, index) {
              var state = index < milestonesDone(order) ? "done" : index === milestonesDone(order) ? "current" : "todo";
              return (
                '<div class="step" data-state="' + state + '">' +
                  '<span class="step__dot">' + (state === "done" ? '<i class="ph-bold ph-check"></i>' : "") + "</span>" +
                  '<span class="step__label">' + step.label + "</span>" +
                  '<span class="step__time num">' + (step.time ? UI.clock(step.time) : "—") + "</span>" +
                "</div>"
              );
            }).join("") +
          "</div>" +
        "</div>" +
      "</div>" +

      '<div class="pad" style="margin-top:12px">' +
        '<div class="card card--pad" style="display:flex;align-items:center;gap:10px">' +
          '<span class="avatar" style="background:var(--accent)">' + esc(UI.initials(order.customer.name)) + "</span>" +
          '<div style="flex:1;min-width:0">' +
            '<div class="row__title">' + esc(order.customer.name) + "</div>" +
            '<div class="meta truncate">' + esc(order.address.street) + ", " + esc(order.address.suburb) + "</div>" +
          "</div>" +
          '<a class="icon-btn" href="tel:' + esc(order.customer.phone.replace(/\s/g, "")) + '" aria-label="Call the customer"><i class="ph ph-phone"></i></a>' +
        "</div>" +
      "</div>" +

      (order.address.note
        ? '<div class="pad" style="margin-top:10px"><div class="notice notice--info"><i class="ph ph-house"></i><span>' + esc(order.address.note) + "</span></div></div>"
        : "") +

      '<div class="pad section-gap">' +
        '<div class="stats">' +
          "<div><dt>Distance left</dt><dd>" + order.distKm.toFixed(1) + " km</dd></div>" +
          "<div><dt>Arrival</dt><dd>" + UI.clock(order.promisedAt) + "</dd></div>" +
          "<div><dt>Payout</dt><dd>" + money(order.payout) + "</dd></div>" +
        "</div>" +
      "</div>" +

      '<div class="pad section-gap">' +
        '<div class="list">' +
          order.items.map(function (item) {
            return '<div class="row" style="padding:10px 14px"><span class="qty-badge">' + item.qty + "</span>" +
              '<span class="row__body"><span class="row__title" style="display:block;font-weight:600">' + esc(item.name) + "</span>" +
              (item.note ? '<span class="meta">' + esc(item.note) + "</span>" : "") + "</span></div>";
          }).join("") +
        "</div>" +
      "</div>" +
      '<div style="height:18px"></div>';

    bottom.innerHTML =
      '<div class="footbar">' +
        '<button class="btn btn--primary btn--lg btn--block" data-action="advance" data-id="' + order.id + '">' +
          (picked ? "Mark delivered · " + money(order.payout) : "Confirm pickup at restaurant") +
        "</button>" +
      "</div>";
    initializeLiveMap("routeMap", destinationPosition);
    updateGpsReadout();
  }

  function renderRemoteRoute() {
    var order = remoteActiveOrder;
    var address = order.address || {};
    var destinationPosition = order.status === "picked_up" && Number.isFinite(address.latitude) && Number.isFinite(address.longitude)
      ? { latitude: address.latitude, longitude: address.longitude }
      : null;
    currentDestination = destinationPosition
      ? destinationPosition.latitude + "," + destinationPosition.longitude
      : [address.street, address.suburb, address.township].filter(Boolean).join(", ") || order.shopName;

    main.innerHTML =
      '<div class="pad" style="padding-top:12px"><div class="banner">' +
        '<div class="banner__icon"><i class="ph-fill ph-navigation-arrow"></i></div>' +
        '<div class="banner__body"><div class="banner__title">' +
          (order.status === "picked_up" ? "Deliver to customer" : "Collect from " + esc(order.shopName)) + "</div>" +
          '<div class="banner__sub">Order ' + esc(order.localOrderId) + " · " + esc(order.status) + "</div></div>" +
      "</div></div>" +
      '<div class="pad" style="margin-top:12px"><div id="routeMap" class="map map--tall" role="application" aria-label="Live GPS map"></div></div>' +
      '<div class="pad" style="margin-top:12px"><div class="card card--pad">' +
        '<div class="h3">Current location</div>' +
        '<div class="meta" data-gps-status role="status" aria-live="polite" style="margin-top:4px">' + esc(gpsMessage) + "</div>" +
        '<div class="meta num" data-gps-coordinates style="margin-top:4px">' +
          (currentPosition ? currentPosition.latitude.toFixed(5) + ", " + currentPosition.longitude.toFixed(5) : "") + "</div>" +
        '<button class="btn btn--quiet btn--block" style="margin-top:10px" data-action="gps">' +
          (gpsWatchId === null ? "Start GPS sharing" : "Stop GPS sharing") + "</button>" +
        '<a id="gpsDirectionsLink" class="btn btn--primary btn--block" style="margin-top:8px" target="_blank" rel="noopener noreferrer">' +
          '<i class="ph ph-navigation-arrow"></i>Open directions</a>' +
      "</div></div>" +
      '<div class="pad section-gap"><div class="list">' +
        order.items.map(function (item) {
          return '<div class="row"><span class="qty-badge">' + Number(item.qty || item.quantity || 1) + "</span>" +
            '<span class="row__body"><span class="row__title">' + esc(item.name) + "</span></span></div>";
        }).join("") +
      "</div></div><div style="height:18px"></div>";

    bottom.innerHTML = '<div class="footbar"><button class="btn btn--primary btn--lg btn--block" data-action="remote-advance">' +
      (order.status === "claimed" ? "Confirm pickup" : "Mark delivered") + "</button></div>";
    initializeLiveMap("routeMap", destinationPosition);
    updateGpsReadout();
  }

  function milestonesDone(order) {
    return order.status === "claimed" ? 1 : order.status === "picked_up" ? 2 : order.status === "delivered" ? 3 : 0;
  }

  /* ---------------- Render ---------------- */

  function render() {
    if (!driverSession) {
      renderLogin("");
      return;
    }
    var view = route();
    renderHeader(view);
    if (view === "route") renderRoute();
    else {
      renderNearby();
      bottom.innerHTML = "";
    }
  }

  /* ---------------- Events ---------------- */

  document.addEventListener("submit", async function (event) {
    if (event.target.id !== "driverAuthForm") return;
    event.preventDefault();
    var button = event.target.querySelector('button[type="submit"]');
    if (button) button.disabled = true;
    if (!API) {
      renderLogin("Driver login needs the deployed backend URL. Set KF_API_URL in apps/js/config.js.");
      return;
    }
    var body = Object.fromEntries(new FormData(event.target));
    var endpoint = authMode === "register" ? "/api01/auth/register" : "/api01/auth/login";

    try {
      var response = await fetch(API + endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      var result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not sign in.");
      if (!result.user || result.user.role !== "driver") throw new Error("Driver account required.");
      await activateSession({ accessToken: result.accessToken, user: result.user });
    } catch (error) {
      renderLogin(error.message === "Failed to fetch"
        ? "Could not reach the server. Start the Kassi Fleet backend and try again."
        : error.message);
    }
  });

  document.addEventListener("click", function (event) {
    var authModeButton = event.target.closest("[data-auth-mode]");
    if (authModeButton) {
      authMode = authModeButton.getAttribute("data-auth-mode");
      renderLogin("");
      return;
    }

    var back = event.target.closest("[data-back]");
    if (back) {
      event.preventDefault();
      go("nearby");
      return;
    }

    var nav = event.target.closest("[data-nav]");
    if (nav) {
      event.preventDefault();
      go(nav.getAttribute("data-nav"));
      return;
    }

    var claimTarget = event.target.closest("[data-claim]");
    if (claimTarget) {
      openClaim(claimTarget.getAttribute("data-claim"));
      return;
    }

    var remoteClaimTarget = event.target.closest("[data-remote-claim]");
    if (remoteClaimTarget) {
      claimRemoteDelivery(remoteClaimTarget.getAttribute("data-remote-claim"));
      return;
    }

    var action = event.target.closest("[data-action]");
    if (!action) return;
    var name = action.getAttribute("data-action");

    if (name === "logout") {
      stopGps();
      stopRemotePolling();
      currentPosition = null;
      gpsTrail = [];
      currentDestination = "";
      remoteOrders = [];
      remoteActiveOrder = null;
      driverSession = null;
      destroyLiveMap();
      sessionStorage.removeItem(SESSION_KEY);
      KF.setDriverOnline(false);
      authMode = "login";
      location.hash = "#/nearby";
      renderLogin("You have signed out.");
      return;
    }

    if (name === "online") {
      var next = !KF.get().driver.online;
      KF.setDriverOnline(next);
      UI.toast(next ? "You are online for pickups" : "You are offline");
      render();
      return;
    }

    if (name === "gps") {
      if (gpsWatchId === null) startGps();
      else {
        stopGps("GPS tracking paused");
        renderCurrentView();
      }
      return;
    }

    if (name === "claim") {
      var id = action.getAttribute("data-id");
      var claimed = KF.claimOrder(id);
      if (!claimed) {
        UI.closeSheet();
        UI.toast(id + " is no longer available");
        render();
        return;
      }
      gpsTrail = [];
      UI.closeSheet();
      UI.toast(id + " claimed. Head to the restaurant.");
      go("route");
      return;
    }

    if (name === "advance") {
      var orderId = action.getAttribute("data-id");
      var wasPicked = KF.order(orderId).status === "picked_up";
      if (KF.advanceDelivery(orderId)) {
        if (wasPicked) {
          stopGps("Delivery complete");
          currentPosition = null;
        }
        UI.toast(wasPicked ? orderId + " delivered. Payout added." : "Pickup confirmed. Head to the customer.");
        render();
      } else {
        UI.toast("That delivery has moved on");
      }
    }

    if (name === "remote-advance") {
      advanceRemoteDelivery();
    }
  });

  window.addEventListener("hashchange", render);

  KF.subscribe(function () {
    if (!driverSession) return;
    var view = route();
    if (view === "route" && !activeOrder()) {
      go("nearby");
      return;
    }
    if (view === "route") renderRoute();
    else renderNearby();
    renderHeader(view);
  });

  UI.bindSheetDismissal();

  if (!location.hash) location.replace("#/nearby");
  restoreSession();
})();
