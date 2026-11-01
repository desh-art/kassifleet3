/* Kassifleet demo store — one order ledger shared by the four apps.
   Everything is local (localStorage) so the apps run without a server;
   swap these methods for the REST endpoints when the backend is ready. */
(function (global) {
  "use strict";

  var KEY = "kassifleet.apps.v1";
  var VERSION = 3;
  /* The factory PIN is only ever used to seed a salted hash; it is never stored. */
  var FACTORY_PIN = "7731";
  var PIN_PEPPER = ":kassifleet:";
  var MAX_FAILS = 5;
  var LOCK_MS = 5 * 60 * 1000;
  var SHOP_FAILS = 5;
  var SHOP_LOCK_MS = 60 * 1000;
  var TOWNSHIPS = ["Soweto", "Alexandra", "Tembisa", "Katlehong", "Vosloorus"];
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

  /* ---------------- Hashing (no dependency, no network) ---------------- */

  function sha256(text) {
    function rightRotate(value, amount) {
      return (value >>> amount) | (value << (32 - amount));
    }
    var mathPow = Math.pow;
    var maxWord = mathPow(2, 32);
    var result = "";
    var words = [];
    var asciiBitLength = text.length * 8;
    var hash = (sha256.h = sha256.h || []);
    var k = (sha256.k = sha256.k || []);
    var primeCounter = k.length;
    var isComposite = {};
    for (var candidate = 2; primeCounter < 64; candidate++) {
      if (!isComposite[candidate]) {
        for (var i = 0; i < 313; i += candidate) isComposite[i] = candidate;
        hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
        k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
      }
    }
    text += "\x80";
    while (text.length % 64 - 56) text += "\x00";
    for (i = 0; i < text.length; i++) {
      var code = text.charCodeAt(i);
      if (code >> 8) return "";
      words[i >> 2] |= code << (((3 - i) % 4) * 8);
    }
    words[words.length] = (asciiBitLength / maxWord) | 0;
    words[words.length] = asciiBitLength;
    for (var j = 0; j < words.length; ) {
      var w = words.slice(j, (j += 16));
      var oldHash = hash;
      hash = hash.slice(0, 8);
      for (i = 0; i < 64; i++) {
        var w15 = w[i - 15];
        var w2 = w[i - 2];
        var a = hash[0];
        var e = hash[4];
        var temp1 =
          hash[7] +
          (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25)) +
          ((e & hash[5]) ^ (~e & hash[6])) +
          k[i] +
          (w[i] =
            i < 16
              ? w[i]
              : (w[i - 16] +
                  (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3)) +
                  w[i - 7] +
                  (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))) |
            0);
        var temp2 =
          (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22)) +
          ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
        hash = [(temp1 + temp2) | 0].concat(hash);
        hash[4] = (hash[4] + temp1) | 0;
      }
      for (i = 0; i < 8; i++) hash[i] = (hash[i] + oldHash[i]) | 0;
    }
    for (i = 0; i < 8; i++) {
      for (j = 3; j + 1; j--) {
        var byte = (hash[i] >> (j * 8)) & 255;
        result += (byte < 16 ? "0" : "") + byte.toString(16);
      }
    }
    return result;
  }

  function randomSalt() {
    var bytes = new Uint8Array(16);
    if (global.crypto && global.crypto.getRandomValues) {
      global.crypto.getRandomValues(bytes);
    } else {
      for (var i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    return Array.prototype.map
      .call(bytes, function (byte) {
        return ("0" + byte.toString(16)).slice(-2);
      })
      .join("");
  }

  function pinHash(pin, salt) {
    return sha256(String(salt) + ":" + String(pin) + PIN_PEPPER);
  }

  function constantTimeEqual(a, b) {
    var left = String(a || "");
    var right = String(b || "");
    if (left.length !== right.length) return false;
    var diff = 0;
    for (var i = 0; i < left.length; i++) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
    return diff === 0;
  }

  function newSecurityBlock(pin) {
    var salt = randomSalt();
    return { alg: "sha256", salt: salt, pin: pinHash(pin, salt), attempts: MAX_FAILS, rotation: 0 };
  }

  /* ---------------- Shop registry metadata ---------------- */

  var SHOP_REGISTRY = [
    { id: "mama", shopId: "SHP-1041", email: "kitchen@mamadlamini.co.za", registered: "2024-02-11T09:20:00.000Z" },
    { id: "kota", shopId: "SHP-1042", email: "orders@kotacorner.co.za", registered: "2024-03-04T11:05:00.000Z" },
    { id: "braai", shopId: "SHP-1043", email: "grill@brosiphogrill.co.za", registered: "2024-05-19T14:40:00.000Z" },
    { id: "fish", shopId: "SHP-1044", email: "counter@thefishcove.co.za", registered: "2024-07-02T08:15:00.000Z" },
    { id: "deli", shopId: "SHP-1045", email: "hello@spazafreshdeli.co.za", registered: "2024-09-27T16:30:00.000Z" }
  ];

  var shops = {
    kota: "Kota with chips and polony",
    stew: "Beef stew and pap",
    chakalaka: "Chakalaka and rice",
    wings: "Chicken wings",
    amasi: "Amasi 500 ml",
    fullKota: "Full house kota",
    halfKota: "Half kota",
    russian: "Russian and chips",
    platter: "Braai platter for one",
    wors: "Wors and pap",
    hake: "Hake and chips",
    calamari: "Calamari combo",
    boerie: "Boerewors roll",
    sarmie: "Cheese and tomato sandwich"
  };

  function it(name, price, qty, note) {
    return { name: name, price: price, qty: qty || 1, note: note || "" };
  }

  function minsAgo(n) {
    return new Date(Date.now() - n * 60000).toISOString();
  }

  function minsAhead(n) {
    return new Date(Date.now() + n * 60000).toISOString();
  }

  function mkOrder(cfg) {
    var items = cfg.items || [];
    var subtotal = items.reduce(function (sum, item) {
      return sum + item.price * item.qty;
    }, 0);
    var collect = cfg.fulfilment === "collect";
    var fee = collect ? 0 : cfg.fee || 0;
    var tip = collect ? 0 : cfg.tip || 0;
    return {
      id: cfg.id,
      vendorId: cfg.vendorId,
      driverId: cfg.driverId || null,
      customer: cfg.customer,
      address: cfg.address,
      items: items,
      subtotal: subtotal,
      fee: fee,
      tip: tip,
      total: subtotal + fee + tip,
      payment: cfg.payment || "cash",
      fulfilment: collect ? "collect" : "delivery",
      collectCode: collect
        ? cfg.collectCode || String(1000 + Math.floor(Math.random() * 9000))
        : null,
      status: cfg.status,
      placedAt: cfg.placedAt,
      acceptedAt: cfg.acceptedAt || null,
      readyAt: cfg.readyAt || null,
      claimedAt: cfg.claimedAt || null,
      pickedUpAt: cfg.pickedUpAt || null,
      deliveredAt: cfg.deliveredAt || null,
      promisedAt: cfg.promisedAt,
      pickup: cfg.pickup || [0.2, 0.8],
      drop: cfg.drop || [0.8, 0.3],
      trail: cfg.trail || null,
      remaining: cfg.remaining || null,
      distKm: cfg.distKm || 1.5,
      payout: cfg.payout || 0
    };
  }

  function seedVendors() {
    return [
      {
        id: "mama",
        name: "Mama Dlamini's Kitchen",
        cuisine: "Kota, pap and stews",
        township: "Soweto",
        area: "Orlando West",
        street: "Cnr Mputa St & Klipspruit Valley Rd",
        phone: "011 936 4410",
        rating: 4.8,
        reviews: 312,
        etaMin: [25, 35],
        fee: 1500,
        accepting: true,
        image: "https://images.pexels.com/photos/33673824/pexels-photo-33673824.jpeg?auto=compress&cs=tinysrgb&w=600&h=600&fit=crop",
        imageAlt: "Kota bread and chips in a takeaway box, photographed by pedro furtado on Pexels",
        menu: [
          { id: "mama-kota", name: shops.kota, desc: "Quarter loaf, slap chips, polony and atchar", price: 4200, category: "Kotas", available: true },
          { id: "mama-stew", name: shops.stew, desc: "Slow-cooked beef, stiff pap and gravy", price: 6800, category: "Pap and stews", available: true },
          { id: "mama-chakalaka", name: shops.chakalaka, desc: "Spicy relish with steamed rice", price: 4500, category: "Pap and stews", available: true },
          { id: "mama-wings", name: shops.wings, desc: "Six grilled wings, peri-peri or plain", price: 6400, category: "Grills", available: true },
          { id: "mama-amasi", name: shops.amasi, desc: "Fermented milk, served cold", price: 1800, category: "Drinks", available: false }
        ]
      },
      {
        id: "kota",
        name: "Kota Corner",
        cuisine: "Kotas and takeaways",
        township: "Alexandra",
        area: "Alexandra East",
        street: "12 8th Ave",
        phone: "011 443 8820",
        rating: 4.6,
        reviews: 198,
        etaMin: [20, 30],
        fee: 1000,
        accepting: true,
        image: "https://images.pexels.com/photos/33673831/pexels-photo-33673831.jpeg?auto=compress&cs=tinysrgb&w=600&h=600&fit=crop",
        imageAlt: "Takeaway boxes of chips and rolls, photographed by pedro furtado on Pexels",
        menu: [
          { id: "kota-full", name: shops.fullKota, desc: "Chips, polony, cheese, egg and atchar", price: 5500, category: "Kotas", available: true },
          { id: "kota-half", name: shops.halfKota, desc: "Chips, polony and atchar", price: 3200, category: "Kotas", available: true },
          { id: "kota-russian", name: shops.russian, desc: "Russian sausage with slap chips", price: 4800, category: "Combos", available: true }
        ]
      },
      {
        id: "braai",
        name: "Bra Sipho's Grill",
        cuisine: "Braai and grills",
        township: "Tembisa",
        area: "Sedibeng",
        street: "46 Andrew Mapheto Dr",
        phone: "011 925 3371",
        rating: 4.7,
        reviews: 421,
        etaMin: [30, 40],
        fee: 1800,
        accepting: true,
        image: "https://images.pexels.com/photos/8250369/pexels-photo-8250369.jpeg?auto=compress&cs=tinysrgb&w=600&h=600&fit=crop",
        imageAlt: "Grilled meat and salad in a takeaway container, photographed by Julia Filirovska on Pexels",
        menu: [
          { id: "braai-platter", name: shops.platter, desc: "Wors, chicken and pap with chakalaka", price: 9500, category: "Platters", available: true },
          { id: "braai-wors", name: shops.wors, desc: "Two wors, stiff pap and gravy", price: 7200, category: "Grills", available: true }
        ]
      },
      {
        id: "fish",
        name: "The Fish Cove",
        cuisine: "Hake and seafood",
        township: "Katlehong",
        area: "Katlehong North",
        street: "3 Observatory Ave",
        phone: "011 902 4471",
        rating: 4.5,
        reviews: 156,
        etaMin: [25, 35],
        fee: 2000,
        accepting: true,
        image: "https://images.pexels.com/photos/2034899/pexels-photo-2034899.jpeg?auto=compress&cs=tinysrgb&w=600&h=600&fit=crop",
        imageAlt: "Fish and chips held above a table, photographed by Gustav Lundborg on Pexels",
        menu: [
          { id: "fish-hake", name: shops.hake, desc: "Two hake fillets, chips and lemon", price: 7800, category: "Hake", available: true },
          { id: "fish-calamari", name: shops.calamari, desc: "Calamari tubes, chips and tartare", price: 10500, category: "Combos", available: true }
        ]
      },
      {
        id: "deli",
        name: "Spaza Fresh Deli",
        cuisine: "Deli and sandwiches",
        township: "Vosloorus",
        area: "Vosloorus Ext 6",
        street: "31 Bierman Rd",
        phone: "011 903 5522",
        rating: 4.4,
        reviews: 87,
        etaMin: [15, 25],
        fee: 1200,
        accepting: false,
        image: "https://images.pexels.com/photos/31701975/pexels-photo-31701975.jpeg?auto=compress&cs=tinysrgb&w=600&h=600&fit=crop",
        imageAlt: "Warm takeaway food in open boxes, photographed by Mediha Ekici on Pexels",
        menu: [
          { id: "deli-boerie", name: shops.boerie, desc: "Boerewors, caramelised onion and roll", price: 3800, category: "Rolls", available: true },
          { id: "deli-sarmie", name: shops.sarmie, desc: "White bread, cheddar, tomato and chutney", price: 3200, category: "Sandwiches", available: true }
        ]
      }
    ];
  }

  /* Registered identity for every shop: id, email, join date. */
  function registerShops(vendors) {
    vendors.forEach(function (shop) {
      var meta = SHOP_REGISTRY.filter(function (entry) {
        return entry.id === shop.id;
      })[0];
      if (!meta) return;
      shop.shopId = meta.shopId;
      shop.email = meta.email;
      shop.registeredAt = meta.registered;
      shop.status = shop.accepting ? "active" : "paused";
    });
    return vendors;
  }

  function seed() {
    var vendors = registerShops(seedVendors());
    var nomsa = { name: "Nomsa Khumalo", phone: "071 428 9930" };
    var home = {
      street: "1140 Mputa St",
      suburb: "Orlando West",
      township: "Soweto",
      note: "Gate 214. Call on arrival."
    };

    var orders = [
      mkOrder({
        id: "KF-4821",
        vendorId: "mama",
        driverId: "d1",
        customer: nomsa,
        address: home,
        items: [it(shops.kota, 4200, 2, "One without atchar"), it(shops.amasi, 1800, 1)],
        fee: 1500,
        tip: 800,
        payment: "card",
        status: "picked_up",
        placedAt: minsAgo(26),
        acceptedAt: minsAgo(24),
        readyAt: minsAgo(18),
        claimedAt: minsAgo(12),
        pickedUpAt: minsAgo(9),
        promisedAt: minsAhead(8),
        pickup: [0.18, 0.74],
        drop: [0.84, 0.28],
        trail: [[0.18, 0.74], [0.24, 0.68], [0.32, 0.64], [0.4, 0.62], [0.48, 0.56], [0.56, 0.52]],
        remaining: [[0.56, 0.52], [0.64, 0.46], [0.7, 0.4], [0.76, 0.34], [0.84, 0.28]],
        distKm: 2.6,
        payout: 3800
      }),
      mkOrder({
        id: "KF-4822",
        vendorId: "mama",
        customer: { name: "Thandi Mokoena", phone: "083 210 4477" },
        address: { street: "27 Bolani Rd", suburb: "Diepkloof", township: "Soweto", note: "Buzz twice." },
        items: [it(shops.stew, 6800, 1, "Extra gravy"), it(shops.chakalaka, 4500, 2)],
        fee: 1500,
        status: "placed",
        placedAt: minsAgo(3),
        promisedAt: minsAhead(42),
        payout: 3900
      }),
      mkOrder({
        id: "KF-4823",
        vendorId: "mama",
        customer: { name: "Sipho Dlamini", phone: "072 664 1180" },
        address: { street: "14 Ngakane St", suburb: "Orlando East", township: "Soweto", note: "" },
        items: [it(shops.wings, 6400, 2), it(shops.chakalaka, 4500, 1), it(shops.amasi, 1800, 1)],
        fee: 1500,
        tip: 1000,
        status: "accepted",
        placedAt: minsAgo(9),
        acceptedAt: minsAgo(8),
        promisedAt: minsAhead(36),
        payout: 4200
      }),
      mkOrder({
        id: "KF-4828",
        vendorId: "mama",
        customer: { name: "Lerato Mahlangu", phone: "076 991 2244" },
        address: { street: "21 Mooki St", suburb: "Orlando West", township: "Soweto", note: "Leave at the door." },
        items: [it(shops.kota, 4200, 1), it(shops.amasi, 1800, 1)],
        fee: 1500,
        tip: 500,
        status: "ready",
        placedAt: minsAgo(20),
        acceptedAt: minsAgo(18),
        readyAt: minsAgo(13),
        promisedAt: minsAhead(26),
        pickup: [0.17, 0.82],
        drop: [0.66, 0.42],
        distKm: 1.9,
        payout: 3200
      }),
      mkOrder({
        id: "KF-4824",
        vendorId: "kota",
        customer: { name: "Lerato Dube", phone: "081 554 0092" },
        address: { street: "5 Roosevelt St", suburb: "Alexandra East", township: "Alexandra", note: "" },
        items: [it(shops.fullKota, 5500, 2)],
        fee: 1000,
        status: "ready",
        placedAt: minsAgo(14),
        acceptedAt: minsAgo(12),
        readyAt: minsAgo(6),
        promisedAt: minsAhead(30),
        pickup: [0.3, 0.5],
        drop: [0.36, 0.34],
        distKm: 0.8,
        payout: 2800
      }),
      mkOrder({
        id: "KF-4825",
        vendorId: "braai",
        customer: { name: "Peter van Wyk", phone: "082 337 7781" },
        address: { street: "46 Andrew Mapheto Dr", suburb: "Sedibeng", township: "Tembisa", note: "Ring the bell at unit 3." },
        items: [it(shops.wors, 7200, 1)],
        fee: 1800,
        tip: 700,
        status: "ready",
        placedAt: minsAgo(17),
        acceptedAt: minsAgo(15),
        readyAt: minsAgo(11),
        promisedAt: minsAhead(26),
        pickup: [0.44, 0.42],
        drop: [0.3, 0.24],
        distKm: 1.3,
        payout: 4100
      }),
      mkOrder({
        id: "KF-4826",
        vendorId: "fish",
        customer: { name: "Aisha Patel", phone: "084 220 6613" },
        address: { street: "9 Mofokeng Section", suburb: "Katlehong North", township: "Katlehong", note: "" },
        items: [it(shops.hake, 7800, 1)],
        fee: 2000,
        status: "ready",
        placedAt: minsAgo(22),
        acceptedAt: minsAgo(19),
        readyAt: minsAgo(15),
        promisedAt: minsAhead(22),
        pickup: [0.58, 0.62],
        drop: [0.74, 0.7],
        distKm: 2.1,
        payout: 2400
      }),
      mkOrder({
        id: "KF-4827",
        vendorId: "deli",
        customer: { name: "John Mahlangu", phone: "079 118 5520" },
        address: { street: "31 Bierman Rd", suburb: "Vosloorus Ext 6", township: "Vosloorus", note: "" },
        items: [it(shops.boerie, 3800, 2)],
        fee: 1200,
        status: "ready",
        placedAt: minsAgo(26),
        acceptedAt: minsAgo(23),
        readyAt: minsAgo(19),
        promisedAt: minsAhead(19),
        pickup: [0.62, 0.78],
        drop: [0.82, 0.86],
        distKm: 3.4,
        payout: 3600
      }),
      mkOrder({
        id: "KF-4819",
        vendorId: "mama",
        driverId: "d1",
        customer: nomsa,
        address: home,
        items: [it(shops.stew, 6800, 1), it(shops.chakalaka, 4500, 1)],
        fee: 1500,
        tip: 700,
        payment: "card",
        status: "delivered",
        placedAt: minsAgo(88),
        acceptedAt: minsAgo(86),
        readyAt: minsAgo(78),
        claimedAt: minsAgo(74),
        pickedUpAt: minsAgo(70),
        deliveredAt: minsAgo(62),
        promisedAt: minsAgo(60),
        payout: 2600
      }),
      mkOrder({
        id: "KF-4820",
        vendorId: "mama",
        driverId: "d1",
        customer: { name: "Sipho Dlamini", phone: "072 664 1180" },
        address: { street: "14 Ngakane St", suburb: "Orlando East", township: "Soweto", note: "" },
        items: [it(shops.wings, 6400, 1), it(shops.kota, 4200, 1)],
        fee: 1500,
        status: "delivered",
        placedAt: minsAgo(70),
        acceptedAt: minsAgo(68),
        readyAt: minsAgo(60),
        claimedAt: minsAgo(56),
        pickedUpAt: minsAgo(52),
        deliveredAt: minsAgo(45),
        promisedAt: minsAgo(42),
        payout: 2900
      }),
      mkOrder({
        id: "KF-4817",
        vendorId: "mama",
        driverId: "d1",
        customer: { name: "Zanele Mbeki", phone: "071 900 3344" },
        address: { street: "3 Mooki St", suburb: "Orlando West", township: "Soweto", note: "" },
        items: [it(shops.wings, 6400, 2)],
        fee: 1500,
        tip: 1200,
        status: "delivered",
        placedAt: minsAgo(132),
        acceptedAt: minsAgo(130),
        readyAt: minsAgo(122),
        claimedAt: minsAgo(118),
        pickedUpAt: minsAgo(114),
        deliveredAt: minsAgo(104),
        promisedAt: minsAgo(100),
        payout: 3100
      }),
      mkOrder({
        id: "KF-4816",
        vendorId: "kota",
        driverId: "d2",
        customer: { name: "Bongani Sithole", phone: "078 442 1190" },
        address: { street: "2 Roosevelt St", suburb: "Alexandra East", township: "Alexandra", note: "" },
        items: [it(shops.fullKota, 5500, 1), it(shops.russian, 4800, 1)],
        fee: 1000,
        status: "delivered",
        placedAt: minsAgo(120),
        acceptedAt: minsAgo(118),
        readyAt: minsAgo(108),
        claimedAt: minsAgo(104),
        pickedUpAt: minsAgo(100),
        deliveredAt: minsAgo(92),
        promisedAt: minsAgo(88),
        payout: 2400
      }),
      mkOrder({
        id: "KF-4829",
        vendorId: "mama",
        customer: { name: "Thabo Nkosi", phone: "074 220 8811" },
        address: {
          street: "Cnr Mputa St & Klipspruit Valley Rd",
          suburb: "Orlando West",
          township: "Soweto",
          note: "Collect at the counter"
        },
        items: [it(shops.kota, 4200, 2)],
        fulfilment: "collect",
        collectCode: "4182",
        status: "accepted",
        placedAt: minsAgo(7),
        acceptedAt: minsAgo(6),
        promisedAt: minsAhead(18)
      }),
      mkOrder({
        id: "KF-4830",
        vendorId: "kota",
        customer: { name: "Zanele Mthembu", phone: "081 664 2210" },
        address: {
          street: "12 8th Ave",
          suburb: "Alexandra East",
          township: "Alexandra",
          note: "Collect at the counter"
        },
        items: [it(shops.fullKota, 5500, 1), it(shops.russian, 4800, 1)],
        fulfilment: "collect",
        collectCode: "2290",
        status: "ready",
        placedAt: minsAgo(16),
        acceptedAt: minsAgo(14),
        readyAt: minsAgo(4),
        promisedAt: minsAhead(9)
      }),
      mkOrder({
        id: "KF-4818",
        vendorId: "mama",
        customer: nomsa,
        address: {
          street: "Cnr Mputa St & Klipspruit Valley Rd",
          suburb: "Orlando West",
          township: "Soweto",
          note: "Collect at the counter"
        },
        items: [it(shops.kota, 4200, 1), it(shops.wings, 6400, 1)],
        fulfilment: "collect",
        collectCode: "5621",
        status: "delivered",
        placedAt: minsAgo(150),
        acceptedAt: minsAgo(148),
        readyAt: minsAgo(138),
        deliveredAt: minsAgo(132),
        promisedAt: minsAgo(130)
      })
    ];

    return {
      v: VERSION,
      seq: 4831,
      shopSeq: 1045,
      customer: { name: nomsa.name, phone: nomsa.phone, address: home },
      basket: { vendorId: null, lines: [] },
      vendors: vendors,
      orders: orders,
      drivers: [
        { id: "d1", name: "Thabo Mokoena", phone: "071 555 0182", vehicle: "Scooter CA 418 227", zone: "Melrose", lastFix: minsAgo(0) },
        { id: "d2", name: "Naledi Phiri", phone: "083 220 7741", vehicle: "Scooter CA 991 502", zone: "Yeoville", lastFix: minsAgo(2) },
        { id: "d3", name: "Musa Khumalo", phone: "079 418 9920", vehicle: "Bicycle", zone: "Troyeville", lastFix: minsAgo(41) }
      ],
      driver: { id: "d1", online: true },
      admin: { fails: 0, lockUntil: 0 },
      security: newSecurityBlock(FACTORY_PIN),
      vendorSession: { shopId: null, fails: 0, lockUntil: 0 },
      audit: [
        {
          at: new Date().toISOString(),
          action: "registry.opened",
          shopId: null,
          detail: "Shop registry created with " + vendors.length + " registered shops"
        }
      ]
    };
  }

  /* ---------------- Persistence ---------------- */

  var state = load();
  var listeners = [];

  /* Shop ids and registered emails arrived in v3; older ledgers are upgraded in place. */
  function upgrade(parsed) {
    if (!parsed || !Array.isArray(parsed.orders)) return null;
    if (parsed.v !== 2 && parsed.v !== VERSION) return null;

    parsed.vendors = Array.isArray(parsed.vendors) ? parsed.vendors : seedVendors();
    parsed.vendors.forEach(function (shop) {
      if (!shop.shopId || !shop.email) {
        var meta = SHOP_REGISTRY.filter(function (entry) {
          return entry.id === shop.id;
        })[0];
        shop.shopId = shop.shopId || (meta ? meta.shopId : "SHP-" + (1000 + Math.floor(Math.random() * 9000)));
        shop.email = shop.email || (meta ? meta.email : "shop-" + String(shop.shopId).toLowerCase() + "@kassifleet.co.za");
        shop.registeredAt = shop.registeredAt || new Date().toISOString();
      }
      if (!shop.status) shop.status = shop.accepting ? "active" : "paused";
    });

    if (!parsed.security || !parsed.security.pin) parsed.security = newSecurityBlock(FACTORY_PIN);
    if (!parsed.vendorSession) parsed.vendorSession = { shopId: null, fails: 0, lockUntil: 0 };
    if (!Array.isArray(parsed.audit)) parsed.audit = [];
    if (!parsed.shopSeq) {
      parsed.shopSeq = parsed.vendors.reduce(function (highest, shop) {
        var number = Number(String(shop.shopId || "").replace(/\D/g, ""));
        return number > highest ? number : highest;
      }, 1045);
    }
    parsed.v = VERSION;
    return parsed;
  }

  function load() {
    try {
      var raw = global.localStorage.getItem(KEY);
      if (raw) {
        var parsed = upgrade(JSON.parse(raw));
        if (parsed) {
          global.localStorage.setItem(KEY, JSON.stringify(parsed));
          return parsed;
        }
      }
    } catch (error) {
      /* storage may be blocked; fall back to memory */
    }
    var fresh = seed();
    try {
      global.localStorage.setItem(KEY, JSON.stringify(fresh));
    } catch (error) {
      /* ignore */
    }
    return fresh;
  }

  function save() {
    try {
      global.localStorage.setItem(KEY, JSON.stringify(state));
    } catch (error) {
      /* ignore */
    }
    listeners.forEach(function (fn) {
      try {
        fn(state);
      } catch (error) {
        setTimeout(function () {
          throw error;
        });
      }
    });
  }

  global.addEventListener("storage", function (event) {
    if (event.key !== KEY || !event.newValue) return;
    try {
      var parsed = JSON.parse(event.newValue);
      if (parsed && parsed.v === VERSION) {
        state = parsed;
        listeners.forEach(function (fn) {
          fn(state);
        });
      }
    } catch (error) {
      /* ignore malformed writes */
    }
  });

  /* ---------------- Read helpers ---------------- */

  function get() {
    return state;
  }

  function subscribe(fn) {
    listeners.push(fn);
    return function () {
      listeners = listeners.filter(function (item) {
        return item !== fn;
      });
    };
  }

  function vendor(id) {
    return state.vendors.filter(function (v) {
      return v.id === id;
    })[0];
  }

  function driver(id) {
    return state.drivers.filter(function (d) {
      return d.id === id;
    })[0];
  }

  function updateDriverLocation(driverId, position) {
    var target = driver(driverId);
    if (!target || !position) return false;
    var latitude = Number(position.latitude);
    var longitude = Number(position.longitude);
    var accuracy = Number(position.accuracy);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;

    target.location = {
      latitude: latitude,
      longitude: longitude,
      accuracy: Number.isFinite(accuracy) ? accuracy : null,
      updatedAt: new Date().toISOString()
    };
    try {
      global.localStorage.setItem(KEY, JSON.stringify(state));
    } catch (error) {
      return false;
    }
    return true;
  }

  function order(id) {
    return state.orders.filter(function (o) {
      return o.id === id;
    })[0];
  }

  function setRemoteTrackingId(orderId, trackingId) {
    var target = order(orderId);
    if (!target || !trackingId) return false;
    target.remoteTrackingId = String(trackingId);
    save();
    return true;
  }

  function myDriver() {
    return driver(state.driver.id);
  }

  function setDriverIdentity(profile) {
    var id = "account-" + String(profile.id || "");
    var existing = driver(id);
    if (!profile.id || !profile.name) return false;
    if (existing) {
      existing.name = profile.name;
      existing.email = profile.email || "";
    } else {
      state.drivers.push({ id: id, name: profile.name, email: profile.email || "", phone: "", vehicle: "", zone: "" });
    }
    state.driver.id = id;
    state.driver.online = false;
    save();
    return true;
  }

  function basketView() {
    var shop = state.basket.vendorId ? vendor(state.basket.vendorId) : null;
    var lines = [];
    var subtotal = 0;
    var count = 0;

    if (shop) {
      state.basket.lines.forEach(function (line) {
        var item = shop.menu.filter(function (m) {
          return m.id === line.itemId;
        })[0];
        if (!item) return;
        var lineTotal = item.price * line.qty;
        subtotal += lineTotal;
        count += line.qty;
        lines.push({ item: item, qty: line.qty, note: line.note || "", total: lineTotal, available: item.available });
      });
    }

    return { vendor: shop || null, lines: lines, subtotal: subtotal, count: count };
  }

  function customerOrders() {
    return state.orders
      .filter(function (o) {
        if (state.customer.id) return o.customerId === state.customer.id;
        return o.customerId
          ? o.customerId === state.customer.id
          : o.customer && o.customer.name === state.customer.name;
      })
      .sort(function (a, b) {
        return new Date(b.placedAt) - new Date(a.placedAt);
      });
  }

  function vendorQueue(vendorId) {
    return {
      placed: ordersFor(vendorId, "placed"),
      accepted: ordersFor(vendorId, "accepted"),
      ready: ordersFor(vendorId, "ready"),
      active: ordersFor(vendorId, "claimed").concat(ordersFor(vendorId, "picked_up"))
    };
  }

  function ordersFor(vendorId, status) {
    return state.orders
      .filter(function (o) {
        return o.vendorId === vendorId && o.status === status;
      })
      .sort(function (a, b) {
        return new Date(a.placedAt) - new Date(b.placedAt);
      });
  }

  function vendorDelivered(vendorId) {
    return state.orders.filter(function (o) {
      return o.vendorId === vendorId && o.status === "delivered";
    });
  }

  function nearbyOrders() {
    return state.orders
      .filter(function (o) {
        /* collection orders never need a driver */
        return o.status === "ready" && !o.driverId && o.fulfilment !== "collect";
      })
      .sort(function (a, b) {
        return a.distKm - b.distKm;
      });
  }

  function activeOrderForDriver() {
    return (
      state.orders.filter(function (o) {
        return o.driverId === state.driver.id && (o.status === "claimed" || o.status === "picked_up");
      })[0] || null
    );
  }

  function atRisk(order) {
    if (order.status !== "ready" || order.driverId || order.fulfilment === "collect") return false;
    var since = order.readyAt || order.placedAt;
    return Date.now() - new Date(since).getTime() > 10 * 60000;
  }

  function adminCounts() {
    var unassigned = nearbyOrders();
    return {
      unassigned: unassigned.length,
      atRisk: unassigned.filter(atRisk).length,
      active: state.orders.filter(function (o) {
        return o.status === "claimed" || o.status === "picked_up";
      }).length
    };
  }

  function driverDay(driverId) {
    var done = state.orders.filter(function (o) {
      return o.driverId === driverId && o.status === "delivered";
    });
    return {
      count: done.length,
      earned: done.reduce(function (sum, o) {
        return sum + (o.payout || 0);
      }, 0),
      orders: done
    };
  }

  function adminState() {
    return {
      fails: state.admin.fails,
      lockedUntil: state.admin.lockUntil,
      locked: state.admin.lockUntil > Date.now(),
      msLeft: Math.max(0, state.admin.lockUntil - Date.now())
    };
  }

  /* ---------------- Basket actions ---------------- */

  function addToBasket(vendorId, itemId) {
    var shop = vendor(vendorId);
    if (!shop) return { ok: false, reason: "Restaurant not found" };
    var item = shop.menu.filter(function (m) {
      return m.id === itemId;
    })[0];
    if (!item || !item.available) return { ok: false, reason: "That dish is unavailable" };

    if (state.basket.vendorId && state.basket.vendorId !== vendorId && state.basket.lines.length) {
      return { ok: false, reason: "other-vendor", shop: shop, item: item };
    }

    state.basket.vendorId = vendorId;
    var line = state.basket.lines.filter(function (l) {
      return l.itemId === itemId;
    })[0];
    if (line) line.qty += 1;
    else state.basket.lines.push({ itemId: itemId, qty: 1, note: "" });
    save();
    return { ok: true };
  }

  function replaceBasket(vendorId, itemId) {
    state.basket = { vendorId: vendorId, lines: [{ itemId: itemId, qty: 1, note: "" }] };
    save();
  }

  function setQty(itemId, qty) {
    state.basket.lines = state.basket.lines
      .map(function (line) {
        if (line.itemId !== itemId) return line;
        line.qty = qty;
        return line;
      })
      .filter(function (line) {
        return line.qty > 0;
      });
    if (!state.basket.lines.length) state.basket.vendorId = null;
    save();
  }

  function setLineNote(itemId, note) {
    state.basket.lines.forEach(function (line) {
      if (line.itemId === itemId) line.note = note;
    });
    save();
  }

  function clearBasket() {
    state.basket = { vendorId: null, lines: [] };
    save();
  }

  function updateAddress(address) {
    state.customer.address = {
      label: address.label || state.customer.address.label || "Home",
      street: address.street,
      suburb: address.suburb,
      township: address.township || state.customer.address.township || "Soweto",
      note: address.note || "",
      latitude: Number.isFinite(Number(address.latitude)) && address.latitude !== "" ? Number(address.latitude) : null,
      longitude: Number.isFinite(Number(address.longitude)) && address.longitude !== "" ? Number(address.longitude) : null
    };
    save();
  }

  function updateCustomer(patch) {
    state.customer = Object.assign({}, state.customer, patch);
    save();
  }

  function setCustomerIdentity(profile) {
    if (!profile || !profile.id || !profile.name) return false;
    if (state.customer.id !== profile.id) {
      state.customer.phone = "";
      state.customer.address = { label: "Home", street: "", suburb: "", township: "Soweto", note: "" };
      state.basket = { vendorId: null, lines: [] };
    }
    state.customer.id = profile.id;
    state.customer.name = profile.name;
    state.customer.email = profile.email || "";
    save();
    return true;
  }

  /* ---------------- Order actions ---------------- */

  function placeOrder(options) {
    var opts = options || {};
    var basket = basketView();
    if (!basket.vendor || !basket.lines.length) return { ok: false, reason: "Your basket is empty" };

    var blocked = basket.lines.filter(function (line) {
      return !line.available;
    });
    if (blocked.length) {
      return { ok: false, reason: blocked[0].item.name + " just went unavailable" };
    }

    var now = new Date();
    var shop = basket.vendor;
    var collect = opts.fulfilment === "collect";
    var tip = collect ? 0 : opts.tip || 0;
    var fee = collect ? 0 : shop.fee;
    var promisedMinutes = collect ? shop.etaMin[1] : shop.etaMin[1] + 10;

    var order = {
      id: "KF-" + ++state.seq,
      customerId: state.customer.id || null,
      vendorId: shop.id,
      driverId: null,
      customer: { name: state.customer.name, phone: state.customer.phone },
      address: collect
        ? {
            street: basket.vendor.street,
            suburb: basket.vendor.area,
            township: basket.vendor.township,
            note: "Collect at the counter"
          }
        : {
            street: state.customer.address.street,
            suburb: state.customer.address.suburb,
            township: state.customer.address.township || "",
            note: opts.note || state.customer.address.note,
            latitude: state.customer.address.latitude,
            longitude: state.customer.address.longitude
          },
      items: basket.lines.map(function (line) {
        return { name: line.item.name, price: line.item.price, qty: line.qty, note: line.note };
      }),
      subtotal: basket.subtotal,
      fee: fee,
      tip: tip,
      total: basket.subtotal + fee + tip,
      payment: opts.payment || "cash",
      fulfilment: collect ? "collect" : "delivery",
      collectCode: collect ? String(1000 + Math.floor(Math.random() * 9000)) : null,
      status: "placed",
      placedAt: now.toISOString(),
      acceptedAt: null,
      readyAt: null,
      claimedAt: null,
      pickedUpAt: null,
      deliveredAt: null,
      promisedAt: new Date(now.getTime() + promisedMinutes * 60000).toISOString(),
      pickup: [0.18, 0.72],
      drop: [0.8, 0.3],
      trail: [[0.18, 0.72], [0.24, 0.68], [0.32, 0.64], [0.4, 0.6]],
      remaining: [[0.4, 0.6], [0.5, 0.54], [0.6, 0.48], [0.7, 0.38], [0.8, 0.3]],
      distKm: 1.8,
      payout: collect ? 0 : Math.round((basket.subtotal * 0.22 + 600) / 100) * 100
    };

    state.orders.unshift(order);
    state.basket = { vendorId: null, lines: [] };
    save();
    return { ok: true, order: order };
  }

  function acceptOrder(id) {
    var target = order(id);
    if (!target || target.status !== "placed") return false;
    target.status = "accepted";
    target.acceptedAt = new Date().toISOString();
    save();
    return true;
  }

  function markReady(id) {
    var target = order(id);
    if (!target || target.status !== "accepted") return false;
    target.status = "ready";
    target.readyAt = new Date().toISOString();
    /* Every delivery in the pickup pool needs a payout for the driver. */
    if (target.fulfilment !== "collect" && !target.payout) {
      target.payout = Math.round((target.subtotal * 0.22 + 600) / 100) * 100;
    }
    save();
    return true;
  }

  function markCollected(id) {
    var target = order(id);
    if (!target || target.fulfilment !== "collect" || target.status !== "ready") return false;
    target.status = "delivered";
    target.deliveredAt = new Date().toISOString();
    save();
    return true;
  }

  function claimOrder(id) {
    var target = order(id);
    if (!target || target.status !== "ready" || target.driverId) return false;
    if (target.fulfilment === "collect") return false;
    /* One active delivery at a time. */
    if (activeOrderForDriver()) return false;
    target.driverId = state.driver.id;
    target.status = "claimed";
    target.claimedAt = new Date().toISOString();
    save();
    return true;
  }

  function advanceDelivery(id) {
    var target = order(id);
    if (!target) return false;
    if (target.status === "claimed") {
      target.status = "picked_up";
      target.pickedUpAt = new Date().toISOString();
      save();
      return true;
    }
    if (target.status === "picked_up") {
      target.status = "delivered";
      target.deliveredAt = new Date().toISOString();
      save();
      return true;
    }
    return false;
  }

  function toggleDish(vendorId, itemId) {
    var shop = vendor(vendorId);
    if (!shop) return;
    shop.menu.forEach(function (item) {
      if (item.id === itemId) item.available = !item.available;
    });
    save();
  }

  function toggleAccepting(vendorId) {
    var shop = vendor(vendorId);
    if (!shop) return;
    setShopAccepting(shop.shopId, !shop.accepting);
  }

  function setDriverOnline(online) {
    state.driver.online = !!online;
    save();
  }

  /* ---------------- Shop registry ---------------- */

  function shopList() {
    return state.vendors.slice();
  }

  function shopById(shopId) {
    return (
      state.vendors.filter(function (shop) {
        return String(shop.shopId).toUpperCase() === String(shopId).toUpperCase();
      })[0] || null
    );
  }

  function emailTaken(email, exceptId) {
    var target = String(email || "").trim().toLowerCase();
    return state.vendors.some(function (shop) {
      return shop.id !== exceptId && String(shop.email || "").toLowerCase() === target;
    });
  }

  function nextShopId() {
    var candidate;
    do {
      state.shopSeq = (state.shopSeq || 1045) + 1;
      candidate = "SHP-" + state.shopSeq;
    } while (shopById(candidate));
    return candidate;
  }

  function clean(value) {
    return String(value == null ? "" : value).trim().replace(/\s+/g, " ");
  }

  function phoneDigits(value) {
    return String(value || "").replace(/\D/g, "");
  }

  /* Same rules the owner sees in the console; returns field -> message. */
  function validateShop(input, exceptId) {
    var errors = {};
    var name = clean(input.name);
    if (!name) errors.name = "Enter the registered shop name";
    else if (name.length < 2 || name.length > 60) errors.name = "Use 2 to 60 characters";

    var email = clean(input.email).toLowerCase();
    if (!email) errors.email = "Enter the email the shop registered with";
    else if (!EMAIL_RE.test(email) || email.length > 120) errors.email = "That email address is not valid";
    else if (emailTaken(email, exceptId)) errors.email = "Another shop already uses this email";

    if (TOWNSHIPS.indexOf(input.township) === -1) errors.township = "Choose a township we deliver in";

    var area = clean(input.area);
    if (!area) errors.area = "Enter the section or suburb";
    else if (area.length > 40) errors.area = "Keep the section under 40 characters";

    var street = clean(input.street);
    if (!street) errors.street = "Enter the street address";
    else if (street.length > 90) errors.street = "Keep the address under 90 characters";

    var cuisine = clean(input.cuisine);
    if (!cuisine) errors.cuisine = "Describe what the kitchen sells";
    else if (cuisine.length > 60) errors.cuisine = "Keep it under 60 characters";

    var phone = phoneDigits(input.phone);
    if (!phone) errors.phone = "Enter a contact number";
    else if (phone.length !== 10 || phone.charAt(0) !== "0") errors.phone = "Use a 10 digit South African number";

    var fee = Number(input.fee);
    if (!isFinite(fee) || fee < 0) errors.fee = "Enter a delivery fee in rand";
    else if (fee > 150) errors.fee = "That fee is above the R150 cap";

    var prep = Number(input.prepMinutes);
    if (!isFinite(prep)) errors.prepMinutes = "Enter the preparation time";
    else if (prep < 10 || prep > 120) errors.prepMinutes = "Use 10 to 120 minutes";

    return errors;
  }

  function formatPhone(digits) {
    var value = phoneDigits(digits);
    return value.length === 10 ? value.slice(0, 3) + " " + value.slice(3, 6) + " " + value.slice(6) : value;
  }

  function logAudit(action, shop, detail) {
    state.audit = state.audit || [];
    state.audit.unshift({
      at: new Date().toISOString(),
      action: action,
      shopId: shop ? shop.shopId : null,
      detail: detail || ""
    });
    state.audit = state.audit.slice(0, 60);
  }

  function addShop(input) {
    /* Validation runs on the values the owner typed (rand, minutes). */
    var candidate = {
      name: clean(input.name),
      email: clean(input.email).toLowerCase(),
      township: input.township,
      area: clean(input.area),
      street: clean(input.street),
      cuisine: clean(input.cuisine),
      phone: formatPhone(input.phone),
      fee: Number(input.fee),
      prepMinutes: Number(input.prepMinutes),
      accepting: input.accepting !== false
    };

    var errors = validateShop(candidate, null);
    if (Object.keys(errors).length) return { ok: false, errors: errors };

    var shopId = nextShopId();
    var shop = {
      id: "shop-" + shopId.toLowerCase(),
      shopId: shopId,
      name: candidate.name,
      email: candidate.email,
      registeredAt: new Date().toISOString(),
      cuisine: candidate.cuisine,
      township: candidate.township,
      area: candidate.area,
      street: candidate.street,
      phone: candidate.phone,
      rating: 0,
      reviews: 0,
      etaMin: [Math.max(10, candidate.prepMinutes - 10), candidate.prepMinutes],
      fee: Math.round(candidate.fee * 100),
      accepting: candidate.accepting,
      status: candidate.accepting ? "active" : "paused",
      image:
        "https://images.pexels.com/photos/31701975/pexels-photo-31701975.jpeg?auto=compress&cs=tinysrgb&w=600&h=600&fit=crop",
      imageAlt: "Warm takeaway food in open boxes, photographed by Mediha Ekici on Pexels",
      menu: []
    };

    state.vendors.push(shop);
    logAudit("shop.added", shop, shop.name + " registered with " + shop.email);
    save();
    return { ok: true, shop: shop };
  }

  function updateShop(shopId, input) {
    var shop = shopById(shopId);
    if (!shop) return { ok: false, errors: { form: "That shop is no longer registered" } };

    var candidate = {
      name: clean(input.name),
      email: clean(input.email).toLowerCase(),
      township: input.township,
      area: clean(input.area),
      street: clean(input.street),
      cuisine: clean(input.cuisine),
      phone: formatPhone(input.phone),
      fee: Number(input.fee),
      prepMinutes: Number(input.prepMinutes),
      accepting: input.accepting !== false
    };

    var errors = validateShop(candidate, shop.id);
    if (Object.keys(errors).length) return { ok: false, errors: errors };

    var emailChanged = shop.email !== candidate.email;
    shop.name = candidate.name;
    shop.email = candidate.email;
    shop.township = candidate.township;
    shop.area = candidate.area;
    shop.street = candidate.street;
    shop.cuisine = candidate.cuisine;
    shop.phone = candidate.phone;
    shop.fee = Math.round(candidate.fee * 100);
    shop.etaMin = [Math.max(10, candidate.prepMinutes - 10), candidate.prepMinutes];
    shop.accepting = candidate.accepting;
    shop.status = candidate.accepting ? "active" : "paused";

    logAudit(
      "shop.updated",
      shop,
      shop.shopId + " details updated" + (emailChanged ? ", registered email changed" : "")
    );
    save();
    return { ok: true, shop: shop };
  }

  function setShopAccepting(shopId, accepting) {
    var shop = shopById(shopId);
    if (!shop) return false;
    shop.accepting = !!accepting;
    shop.status = shop.accepting ? "active" : "paused";
    logAudit(shop.accepting ? "shop.opened" : "shop.paused", shop, shop.shopId + (shop.accepting ? " opened for orders" : " paused orders"));
    save();
    return true;
  }

  function addDish(shopId, input) {
    var shop = shopById(shopId);
    if (!shop) return { ok: false, reason: "Shop not found" };
    var name = clean(input.name);
    var category = clean(input.category) || "Kitchen";
    var price = Math.round(Number(input.price) * 100);
    var errors = {};
    if (!name) errors.name = "Give the dish a name";
    else if (name.length > 60) errors.name = "Keep the name under 60 characters";
    if (!isFinite(price) || price <= 0) errors.price = "Enter a price in rand";
    else if (price > 200000) errors.price = "That price is too high";
    if (category.length > 30) errors.category = "Keep the category short";
    if (Object.keys(errors).length) return { ok: false, errors: errors };

    var item = {
      id: shop.shopId.toLowerCase() + "-" + (shop.menu.length + 1) + "-" + Date.now().toString(36),
      name: name,
      desc: clean(input.desc) || "",
      price: price,
      category: category,
      available: true
    };
    shop.menu.push(item);
    logAudit("menu.added", shop, item.name + " added to the menu");
    save();
    return { ok: true, item: item };
  }

  function shopStats(shopId) {
    var shop = shopById(shopId);
    if (!shop) return { orders: 0, open: 0, done: 0, takings: 0 };
    var mine = state.orders.filter(function (order) {
      return order.vendorId === shop.id;
    });
    return {
      orders: mine.length,
      open: mine.filter(function (order) {
        return order.status !== "delivered" && order.status !== "cancelled";
      }).length,
      done: mine.filter(function (order) {
        return order.status === "delivered";
      }).length,
      takings: mine.reduce(function (sum, order) {
        return order.status === "delivered" ? sum + order.total : sum;
      }, 0)
    };
  }

  function shopActivity(shopId) {
    return (state.audit || []).filter(function (entry) {
      return entry.shopId === shopId;
    }).slice(0, 4);
  }

  /* Vendor sign in: the registered email and the shop id must belong to the same shop. */
  function signInShop(email, shopId) {
    var session = state.vendorSession || (state.vendorSession = { shopId: null, fails: 0, lockUntil: 0 });
    if (session.lockUntil > Date.now()) {
      return { ok: false, locked: true, msLeft: session.lockUntil - Date.now() };
    }
    var shop = shopById(clean(shopId));
    var target = clean(email).toLowerCase();
    if (shop && String(shop.email || "").toLowerCase() === target) {
      session.shopId = shop.shopId;
      session.fails = 0;
      session.lockUntil = 0;
      logAudit("shop.signin", shop, shop.shopId + " signed in on the kitchen app");
      save();
      return { ok: true, shop: shop };
    }
    session.fails += 1;
    if (session.fails >= SHOP_FAILS) {
      session.lockUntil = Date.now() + SHOP_LOCK_MS;
      session.fails = 0;
      save();
      return { ok: false, locked: true, msLeft: SHOP_LOCK_MS };
    }
    save();
    return { ok: false, attemptsLeft: SHOP_FAILS - session.fails };
  }

  function sessionShop() {
    var session = state.vendorSession;
    if (!session || !session.shopId) return null;
    return shopById(session.shopId);
  }

  function endShopSession() {
    if (state.vendorSession) state.vendorSession.shopId = null;
    save();
  }

  /* ---------------- Owner PIN (salted hash, never plain text) ---------------- */

  function verifyPin(pin) {
    var admin = state.admin;
    if (admin.lockUntil > Date.now()) {
      return { ok: false, locked: true, attemptsLeft: 0, msLeft: admin.lockUntil - Date.now() };
    }
    var security = state.security || (state.security = newSecurityBlock(FACTORY_PIN));
    if (constantTimeEqual(pinHash(String(pin), security.salt), security.pin)) {
      admin.fails = 0;
      admin.lockUntil = 0;
      save();
      return { ok: true, attemptsLeft: MAX_FAILS };
    }
    admin.fails += 1;
    if (admin.fails >= MAX_FAILS) {
      admin.lockUntil = Date.now() + LOCK_MS;
      admin.fails = 0;
      save();
      return { ok: false, locked: true, attemptsLeft: 0, msLeft: LOCK_MS };
    }
    save();
    return { ok: false, locked: false, attemptsLeft: MAX_FAILS - admin.fails };
  }

  function changePin(currentPin, nextPin) {
    var security = state.security || (state.security = newSecurityBlock(FACTORY_PIN));
    if (!constantTimeEqual(pinHash(String(currentPin), security.salt), security.pin)) {
      return { ok: false, reason: "current" };
    }
    if (!/^\d{4}$/.test(String(nextPin))) return { ok: false, reason: "format" };
    if (String(nextPin) === String(currentPin)) return { ok: false, reason: "same" };
    state.security = newSecurityBlock(String(nextPin));
    state.admin.fails = 0;
    state.admin.lockUntil = 0;
    logAudit("security.pin", null, "Owner PIN rotated");
    save();
    return { ok: true };
  }

  function reset() {
    state = seed();
    save();
    return state;
  }

  global.KF = {
    get: get,
    subscribe: subscribe,
    vendor: vendor,
    driver: driver,
    order: order,
    setRemoteTrackingId: setRemoteTrackingId,
    myDriver: myDriver,
    setDriverIdentity: setDriverIdentity,
    basketView: basketView,
    customerOrders: customerOrders,
    vendorQueue: vendorQueue,
    vendorDelivered: vendorDelivered,
    nearbyOrders: nearbyOrders,
    activeOrderForDriver: activeOrderForDriver,
    atRisk: atRisk,
    adminCounts: adminCounts,
    driverDay: driverDay,
    adminState: adminState,
    addToBasket: addToBasket,
    replaceBasket: replaceBasket,
    setQty: setQty,
    setLineNote: setLineNote,
    clearBasket: clearBasket,
    updateAddress: updateAddress,
    updateCustomer: updateCustomer,
    setCustomerIdentity: setCustomerIdentity,
    placeOrder: placeOrder,
    acceptOrder: acceptOrder,
    markReady: markReady,
    markCollected: markCollected,
    claimOrder: claimOrder,
    advanceDelivery: advanceDelivery,
    toggleDish: toggleDish,
    toggleAccepting: toggleAccepting,
    setDriverOnline: setDriverOnline,
    updateDriverLocation: updateDriverLocation,
    shops: shopList,
    shopById: shopById,
    addShop: addShop,
    updateShop: updateShop,
    setShopAccepting: setShopAccepting,
    addDish: addDish,
    shopStats: shopStats,
    shopActivity: shopActivity,
    signInShop: signInShop,
    sessionShop: sessionShop,
    endShopSession: endShopSession,
    verifyPin: verifyPin,
    changePin: changePin,
    audit: function () {
      return (state.audit || []).slice();
    },
    reset: reset,
    townships: function () {
      return TOWNSHIPS.slice();
    },
    securityInfo: function () {
      var security = state.security || {};
      return { alg: security.alg, salt: security.salt, hash: security.pin };
    },
    ownerPinHint: "The owner PIN is stored as a salted hash and can be changed in the console."
  };
})(window);
