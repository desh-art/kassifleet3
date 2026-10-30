/* Kassifleet shared UI helpers: formatting, mapping, feedback. */
(function (global) {
  "use strict";

  var SVG_NS = "http://www.w3.org/2000/svg";

  /* ---------------- Text + numbers ---------- */

  function money(cents) {
    var value = (Number(cents) || 0) / 100;
    var negative = value < 0;
    var size = Math.abs(value);
    var whole = Math.floor(size);
    var frac = Math.round((size - whole) * 100);
    var grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
    return (negative ? "-R" : "R") + grouped + (frac ? "." + String(frac).padStart(2, "0") : "");
  }

  function clock(value) {
    if (!value) return "—";
    var d = new Date(value);
    if (isNaN(d.getTime())) return "—";
    return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  }

  function ago(value) {
    if (!value) return "—";
    var ms = Date.now() - new Date(value).getTime();
    if (isNaN(ms)) return "—";
    var mins = Math.max(0, Math.round(ms / 60000));
    if (mins < 1) return "now";
    if (mins < 60) return mins + " min";
    var hours = Math.floor(mins / 60);
    var rest = mins % 60;
    return hours + " h" + (rest ? " " + rest + " min" : "");
  }

  function minutesSince(value) {
    if (!value) return 0;
    return Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000));
  }

  function until(value) {
    if (!value) return "—";
    var mins = Math.round((new Date(value).getTime() - Date.now()) / 60000);
    if (mins <= 0) return "due now";
    return "in " + mins + " min";
  }

  function etaRange(vendor) {
    if (!vendor) return "—";
    return vendor.etaMin[0] + "–" + vendor.etaMin[1] + " min";
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function initials(name) {
    return String(name || "")
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map(function (part) {
        return part.charAt(0).toUpperCase();
      })
      .join("");
  }

  /**
   * Labelled form control with inline validation message.
   * config: { name, label, value, type, placeholder, hint, error, options,
   *           inputmode, autocomplete, maxlength }
   */
  function field(config) {
    var error = config.error;
    var value = config.value == null ? "" : config.value;
    var control;

    if (config.options) {
      control =
        '<select name="' + escapeHtml(config.name) + '">' +
        config.options
          .map(function (option) {
            var optionValue = typeof option === "string" ? option : option.value;
            var optionLabel = typeof option === "string" ? option : option.label;
            return (
              '<option value="' + escapeHtml(optionValue) + '"' +
              (String(value) === String(optionValue) ? " selected" : "") + ">" +
              escapeHtml(optionLabel) + "</option>"
            );
          })
          .join("") +
        "</select>";
    } else {
      control =
        '<input name="' + escapeHtml(config.name) + '" type="' + (config.type || "text") + '" value="' + escapeHtml(value) + '"' +
        (config.placeholder ? ' placeholder="' + escapeHtml(config.placeholder) + '"' : "") +
        (config.inputmode ? ' inputmode="' + config.inputmode + '"' : "") +
        (config.autocomplete ? ' autocomplete="' + config.autocomplete + '"' : "") +
        (config.maxlength ? ' maxlength="' + config.maxlength + '"' : "") +
        ">";
    }

    var note = error
      ? '<span class="field__error"><i class="ph ph-warning-circle"></i>' + escapeHtml(error) + "</span>"
      : config.hint
        ? '<span class="field__hint">' + escapeHtml(config.hint) + "</span>"
        : "";

    return '<label class="field' + (error ? " field--invalid" : "") + '">' + escapeHtml(config.label) + control + note + "</label>";
  }

  /* ---------------- Status vocabulary ---------- */

  var STATUS = {
    placed: { label: "Sent to restaurant", tone: "ink", rank: 0 },
    accepted: { label: "Preparing", tone: "accent", rank: 1 },
    ready: { label: "Ready for pickup", tone: "amber", rank: 2 },
    claimed: { label: "Driver on the way", tone: "accent", rank: 3 },
    picked_up: { label: "On the way", tone: "accent", rank: 3 },
    delivered: { label: "Delivered", tone: "green", rank: 4 },
    cancelled: { label: "Cancelled", tone: "danger", rank: -1 }
  };

  function statusMeta(status) {
    return STATUS[status] || { label: status || "Unknown", tone: "ink", rank: 0 };
  }

  function badge(status) {
    var meta = statusMeta(status);
    return '<span class="badge badge--' + meta.tone + '">' + escapeHtml(meta.label) + "</span>";
  }

  /* Collection orders share states with delivery orders but read differently. */
  function orderStatus(order) {
    var meta = statusMeta(order.status);
    if (order.fulfilment === "collect") {
      if (order.status === "ready") return { label: "Ready to collect", tone: "amber", rank: meta.rank };
      if (order.status === "delivered") return { label: "Collected", tone: "green", rank: meta.rank };
    }
    return meta;
  }

  function orderBadge(order) {
    var meta = orderStatus(order);
    return '<span class="badge badge--' + meta.tone + '">' + escapeHtml(meta.label) + "</span>";
  }

  function fulfilTag(order) {
    return (
      '<span class="tag"><i class="ph ph-' +
      (order.fulfilment === "collect" ? "shopping-bag" : "scooter") +
      '"></i>' +
      (order.fulfilment === "collect" ? "Collection" : "Delivery") +
      "</span>"
    );
  }

  /* ---------------- Map artwork ---------------- */

  var STRIP_BASE = [
    '<rect width="358" height="152" fill="#EDEAE0"/>',
    '<g fill="#E4E0D2">',
    '<rect x="6" y="4" width="64" height="34" rx="4"/>',
    '<rect x="100" y="6" width="78" height="24" rx="4"/>',
    '<rect x="206" y="4" width="60" height="32" rx="4"/>',
    '<rect x="292" y="4" width="58" height="30" rx="4"/>',
    '<rect x="4" y="60" width="62" height="30" rx="4"/>',
    '<rect x="100" y="62" width="72" height="26" rx="4"/>',
    '<rect x="204" y="58" width="64" height="34" rx="4"/>',
    '<rect x="290" y="54" width="64" height="36" rx="4"/>',
    '<rect x="8" y="118" width="60" height="28" rx="4"/>',
    '<rect x="96" y="120" width="82" height="26" rx="4"/>',
    '<rect x="204" y="118" width="58" height="30" rx="4"/>',
    '<rect x="292" y="118" width="58" height="28" rx="4"/>',
    "</g>",
    '<g stroke="#FBFAF5" fill="none" stroke-linecap="round">',
    '<path d="M0 48H358" stroke-width="13"/>',
    '<path d="M0 106H358" stroke-width="9"/>',
    '<path d="M84 0V152" stroke-width="9"/>',
    '<path d="M192 0V152" stroke-width="7"/>',
    '<path d="M282 0V152" stroke-width="11"/>',
    "</g>",
    '<path d="M0 138C56 130 104 146 158 138S262 126 358 136" stroke="#CBDFD4" stroke-width="3" stroke-dasharray="7 6" fill="none"/>',
    '<text x="14" y="78" font-family="Inter, sans-serif" font-size="8" letter-spacing="1" fill="#9C9788">MELROSE</text>',
    '<text x="200" y="146" font-family="Inter, sans-serif" font-size="8" letter-spacing="1" fill="#9C9788">ILLOVO</text>'
  ].join("");

  var TALL_BASE = [
    '<rect width="360" height="300" fill="#EDEAE0"/>',
    '<g fill="#E4E0D2">',
    '<rect x="4" y="4" width="52" height="60" rx="4"/>',
    '<rect x="76" y="6" width="62" height="54" rx="4"/>',
    '<rect x="164" y="4" width="56" height="60" rx="4"/>',
    '<rect x="252" y="6" width="44" height="56" rx="4"/>',
    '<rect x="314" y="4" width="42" height="62" rx="4"/>',
    '<rect x="4" y="94" width="52" height="40" rx="4"/>',
    '<rect x="76" y="90" width="62" height="46" rx="4"/>',
    '<rect x="164" y="92" width="56" height="42" rx="4"/>',
    '<rect x="252" y="92" width="44" height="42" rx="4"/>',
    '<rect x="314" y="94" width="42" height="42" rx="4"/>',
    '<rect x="4" y="162" width="52" height="44" rx="4"/>',
    '<rect x="76" y="164" width="62" height="40" rx="4"/>',
    '<rect x="164" y="162" width="56" height="44" rx="4"/>',
    '<rect x="252" y="162" width="44" height="42" rx="4"/>',
    '<rect x="314" y="162" width="42" height="44" rx="4"/>',
    '<rect x="4" y="232" width="52" height="60" rx="4"/>',
    '<rect x="76" y="234" width="62" height="58" rx="4"/>',
    '<rect x="164" y="232" width="56" height="60" rx="4"/>',
    '<rect x="252" y="234" width="44" height="58" rx="4"/>',
    '<rect x="314" y="232" width="42" height="60" rx="4"/>',
    "</g>",
    '<g stroke="#FBFAF5" fill="none" stroke-linecap="round">',
    '<path d="M0 78H360" stroke-width="13"/>',
    '<path d="M0 148H360" stroke-width="9"/>',
    '<path d="M0 220H360" stroke-width="11"/>',
    '<path d="M62 0V300" stroke-width="9"/>',
    '<path d="M150 0V300" stroke-width="6"/>',
    '<path d="M232 0V300" stroke-width="9"/>',
    '<path d="M306 0V300" stroke-width="7"/>',
    "</g>",
    '<path d="M0 292C60 284 110 300 170 292S280 280 360 290" stroke="#CBDFD4" stroke-width="3" stroke-dasharray="7 6" fill="none"/>',
    '<text x="10" y="44" font-family="Inter, sans-serif" font-size="8" letter-spacing="1" fill="#9C9788">MELROSE</text>',
    '<text x="248" y="44" font-family="Inter, sans-serif" font-size="8" letter-spacing="1" fill="#9C9788">ILLOVO</text>',
    '<text x="162" y="256" font-family="Inter, sans-serif" font-size="7.5" letter-spacing="0.5" fill="#A8A292">YEOVILLE</text>'
  ].join("");

  var gradSeq = 0;

  function smoothPath(points, width, height) {
    if (!points || points.length < 2) return "";
    var pts = points.map(function (p) {
      return [p[0] * width, p[1] * height];
    });
    var d = "M" + pts[0][0].toFixed(1) + " " + pts[0][1].toFixed(1);
    for (var i = 0; i < pts.length - 1; i++) {
      var a = pts[i];
      var b = pts[i + 1];
      var mx = (a[0] + b[0]) / 2;
      var my = (a[1] + b[1]) / 2;
      d += " Q" + a[0].toFixed(1) + " " + a[1].toFixed(1) + " " + mx.toFixed(1) + " " + my.toFixed(1);
    }
    var last = pts[pts.length - 1];
    d += " L" + last[0].toFixed(1) + " " + last[1].toFixed(1);
    return d;
  }

  function pinMarkup(pin, width, height) {
    var x = pin.x * width;
    var y = pin.y * height;
    var type = pin.type || "pickup";
    if (type === "driver") {
      return (
        '<g><circle cx="' + x + '" cy="' + y + '" r="11" fill="#FFFFFF" fill-opacity="0.92"/>' +
        '<circle cx="' + x + '" cy="' + y + '" r="7.5" fill="#101828" stroke="#FFFFFF" stroke-width="2.5"/>' +
        '<path d="M' + x + " " + y + "L" + (x - 3.5) + " " + (y - 12) + "L" + (x + 5) + " " + (y - 6) + 'Z" fill="#101828"/></g>'
      );
    }
    if (type === "vendor") {
      return (
        '<g><rect x="' + (x - 7) + '" y="' + (y - 7) + '" width="14" height="14" rx="4" fill="#101828" stroke="#FFFFFF" stroke-width="2.5"/>' +
        '<circle cx="' + x + '" cy="' + y + '" r="2" fill="#FFFFFF"/></g>'
      );
    }
    if (type === "drop") {
      return (
        '<g><circle cx="' + x + '" cy="' + y + '" r="9.5" fill="#FFFFFF" stroke="#D9500E" stroke-width="2.5"/>' +
        '<circle cx="' + x + '" cy="' + y + '" r="3.4" fill="#D9500E"/></g>'
      );
    }
    if (type === "idle") {
      return '<circle cx="' + x + '" cy="' + y + '" r="6" fill="#FFFFFF" fill-opacity="0.75" stroke="#8C8778" stroke-width="1.5"/>';
    }
    return (
      '<g><circle cx="' + x + '" cy="' + y + '" r="6.5" fill="#FFFFFF" stroke="#D9500E" stroke-width="2"/>' +
      '<circle cx="' + x + '" cy="' + y + '" r="2" fill="#D9500E"/></g>'
    );
  }

  /**
   * Street-plan map. Options:
   *   height    152 (strip) or >= 200 (tall)
   *   pins      [{x, y, type: pickup|drop|driver|vendor|idle}] normalised 0..1
   *   ring      {x, y, r} normalised; drawn as the delivery radius
   *   trail     [[x, y], ...] completed GPS breadcrumb (solid)
   *   planned   [[x, y], ...] remaining route (dashed)
   *   label     accessible label
   */
  function map(options) {
    var opts = options || {};
    var tall = (opts.height || 152) >= 200;
    var width = tall ? 360 : 358;
    var height = tall ? 300 : 152;
    var out = [];

    out.push(
      '<svg viewBox="0 0 ' + width + " " + height + '" preserveAspectRatio="xMidYMid slice" role="img" aria-label="' +
        escapeHtml(opts.label || "Street map of the delivery area") + '">'
    );
    out.push(tall ? TALL_BASE : STRIP_BASE);

    if (opts.ring) {
      var cx = opts.ring.x * width;
      var cy = opts.ring.y * height;
      var r = opts.ring.r * width;
      out.push(
        '<circle cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="' + r.toFixed(1) +
          '" fill="none" stroke="#D9500E" stroke-opacity="0.3" stroke-width="1.5" stroke-dasharray="4 5"/>'
      );
    }

    if (opts.planned && opts.planned.length > 1) {
      var plannedD = smoothPath(opts.planned, width, height);
      out.push('<path d="' + plannedD + '" fill="none" stroke="#FBFAF5" stroke-width="8" stroke-linecap="round"/>');
      out.push(
        '<path d="' + plannedD + '" fill="none" stroke="#D9500E" stroke-opacity="0.5" stroke-width="4" ' +
          'stroke-dasharray="6 6" stroke-linecap="round"/>'
      );
    }

    if (opts.trail && opts.trail.length > 1) {
      var trailD = smoothPath(opts.trail, width, height);
      var gradId = "kfTrail" + ++gradSeq;
      var first = opts.trail[0];
      var lastTrail = opts.trail[opts.trail.length - 1];
      out.push(
        '<defs><linearGradient id="' + gradId + '" gradientUnits="userSpaceOnUse" x1="' + (first[0] * width).toFixed(1) +
          '" y1="' + (first[1] * height).toFixed(1) + '" x2="' + (lastTrail[0] * width).toFixed(1) +
          '" y2="' + (lastTrail[1] * height).toFixed(1) + '">' +
          '<stop offset="0" stop-color="#EFB58A"/><stop offset="0.4" stop-color="#E2874C"/>' +
          '<stop offset="1" stop-color="#D9500E"/></linearGradient></defs>'
      );
      out.push('<path d="' + trailD + '" fill="none" stroke="#FBFAF5" stroke-width="9" stroke-linecap="round"/>');
      out.push('<path d="' + trailD + '" fill="none" stroke="url(#' + gradId + ')" stroke-width="4.5" stroke-linecap="round"/>');
    }

    (opts.pins || []).forEach(function (pin) {
      out.push(pinMarkup(pin, width, height));
    });

    out.push("</svg>");
    return out.join("");
  }

  /* ---------------- Feedback ---------------- */

  var toastTimer = null;

  function toast(message, action) {
    var host = document.getElementById("toast");
    if (!host) return;
    while (host.firstChild) host.removeChild(host.firstChild);

    var text = document.createElement("span");
    text.textContent = message;
    host.appendChild(text);

    if (action && action.label) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = action.label;
      btn.addEventListener("click", function () {
        hideToast();
        if (typeof action.onSelect === "function") action.onSelect();
      });
      host.appendChild(btn);
    }

    host.setAttribute("data-show", "true");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, action ? 5200 : 3200);
  }

  function hideToast() {
    var host = document.getElementById("toast");
    if (host) host.setAttribute("data-show", "false");
  }

  /* ---------------- Sheets ---------------- */

  function openSheet(html) {
    var sheet = document.getElementById("sheet");
    var scrim = document.getElementById("scrim");
    if (!sheet || !scrim) return;
    sheet.innerHTML = '<div class="handle"></div>' + html;
    sheet.setAttribute("data-open", "true");
    sheet.setAttribute("aria-hidden", "false");
    scrim.setAttribute("data-open", "true");
    var focusable = sheet.querySelector("button, input, textarea, a[href]");
    if (focusable) focusable.focus({ preventScroll: true });
  }

  function closeSheet() {
    var sheet = document.getElementById("sheet");
    var scrim = document.getElementById("scrim");
    if (!sheet || !scrim) return;
    sheet.setAttribute("data-open", "false");
    sheet.setAttribute("aria-hidden", "true");
    scrim.setAttribute("data-open", "false");
    sheet.innerHTML = "";
  }

  function bindSheetDismissal() {
    var scrim = document.getElementById("scrim");
    if (scrim) scrim.addEventListener("click", closeSheet);
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") closeSheet();
    });
    anchorToast();
  }

  /* Keep toasts clear of whichever bottom bar the screen is showing. */
  function anchorToast() {
    var host = document.getElementById("toast");
    var bar = document.getElementById("bottom");
    if (!host || !bar) return;
    var place = function () {
      host.style.bottom = 16 + (bar.offsetHeight || 0) + "px";
    };
    place();
    if (typeof ResizeObserver === "function") {
      new ResizeObserver(place).observe(bar);
    }
  }

  /* ---------------- Misc ---------- */

  function el(html) {
    var wrap = document.createElement("div");
    wrap.innerHTML = html.trim();
    return wrap.firstElementChild;
  }

  function setActive(container, key) {
    if (!container) return;
    Array.prototype.forEach.call(container.querySelectorAll("[data-key]"), function (node) {
      var on = node.getAttribute("data-key") === key;
      if (on) node.setAttribute("aria-current", node.classList.contains("nav__item") ? "page" : "true");
      else node.removeAttribute("aria-current");
    });
  }

  /* The app manages its own scroll position inside .app-main. */
  try {
    if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  } catch (error) {
    /* ignore */
  }

  global.KFUI = {
    money: money,
    clock: clock,
    ago: ago,
    minutesSince: minutesSince,
    until: until,
    etaRange: etaRange,
    escape: escapeHtml,
    initials: initials,
    field: field,
    statusMeta: statusMeta,
    orderStatus: orderStatus,
    orderBadge: orderBadge,
    fulfilTag: fulfilTag,
    badge: badge,
    map: map,
    toast: toast,
    hideToast: hideToast,
    openSheet: openSheet,
    closeSheet: closeSheet,
    bindSheetDismissal: bindSheetDismissal,
    el: el,
    svgNs: SVG_NS
  };
})(window);
