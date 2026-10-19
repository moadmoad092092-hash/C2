(() => {
  "use strict";

  // AlAdhan calculation method 3 = Muslim World League (MWL).
  // This is a reasonable default, not a claim of official Libyan timetable matching.
  const API_BASE = "https://api.aladhan.com/v1";
  const METHOD = 3;
  const METHOD_NAME = "رابطة العالم الإسلامي (MWL)";
  const PRAYERS = [
    { key: "Fajr", name: "الفجر" },
    { key: "Sunrise", name: "الشروق" },
    { key: "Dhuhr", name: "الظهر" },
    { key: "Asr", name: "العصر" },
    { key: "Maghrib", name: "المغرب" },
    { key: "Isha", name: "العشاء" }
  ];

  const CITIES = [
    ["tripoli", "طرابلس", 32.8872, 13.1913],
    ["zawiya", "الزاوية", 32.7522, 12.7278],
    ["benghazi", "بنغازي", 32.1167, 20.0667],
    ["misrata", "مصراتة", 32.3754, 15.0925],
    ["sabha", "سبها", 27.0377, 14.4283],
    ["sirte", "سرت", 31.2089, 16.5887],
    ["derna", "درنة", 32.7670, 22.6367],
    ["tobruk", "طبرق", 32.0896, 23.9539],
    ["zliten", "زليتن", 32.4674, 14.5687],
    ["gharyan", "غريان", 32.1722, 13.0203],
    ["ajdabiya", "أجدابيا", 30.7554, 20.2263],
    ["kufra", "الكفرة", 24.1820, 23.2900]
  ];

  const $ = (id) => document.getElementById(id);
  const citySelect = $("city-select");
  let currentLocation = null;
  let todayData = null;
  let tomorrowData = null;
  let timerId = null;
  let requestToken = 0;

  CITIES.forEach(([id, name]) => {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = name;
    citySelect.appendChild(option);
  });
  $("method-label").textContent = `طريقة الحساب: ${METHOD_NAME}`;

  function dateParts(date = new Date()) {
    return {
      day: String(date.getDate()).padStart(2, "0"),
      month: String(date.getMonth() + 1).padStart(2, "0"),
      year: String(date.getFullYear())
    };
  }
  function apiDate(date = new Date()) {
    const p = dateParts(date);
    return `${p.day}-${p.month}-${p.year}`;
  }
  function localDateLabel(date = new Date()) {
    return new Intl.DateTimeFormat("ar-LY", {
      weekday: "long", year: "numeric", month: "long", day: "numeric"
    }).format(date);
  }
  function cleanTime(value) {
    // AlAdhan may append timezone text or annotations. Keep only HH:MM.
    const match = String(value || "").match(/(\d{1,2}):(\d{2})/);
    if (!match) throw new Error("وصلت استجابة غير مفهومة من خدمة المواقيت.");
    return `${match[1].padStart(2, "0")}:${match[2]}`;
  }
  function timeOnDate(time, date) {
    const [hours, minutes] = cleanTime(time).split(":").map(Number);
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), hours, minutes, 0, 0);
  }
  function formatTime(time) {
    const [hours, minutes] = cleanTime(time).split(":").map(Number);
    const d = new Date(2000, 0, 1, hours, minutes);
    return new Intl.DateTimeFormat("ar-LY", { hour: "numeric", minute: "2-digit", hour12: true }).format(d);
  }
  function setStatus(message = "", isError = false) {
    const el = $("status");
    el.textContent = message;
    el.className = isError ? "status error" : "status";
    $("retry-button").classList.toggle("hidden", !isError);
  }
  function showLoading(message) {
    $("prayer-list").innerHTML = "";
    const card = document.createElement("div");
    card.className = "loading-card";
    card.textContent = message;
    $("prayer-list").appendChild(card);
    $("next-prayer-name").textContent = "—";
    $("next-prayer-time").textContent = "--:--";
    $("countdown").textContent = "--:--:--";
  }
  function updateLocationLabel() {
    if (!currentLocation) return;
    $("location-label").textContent = currentLocation.name;
  }
  async function fetchTimings(location, date) {
    const url = new URL(`${API_BASE}/timings/${apiDate(date)}`);
    url.searchParams.set("latitude", String(location.lat));
    url.searchParams.set("longitude", String(location.lon));
    url.searchParams.set("method", String(METHOD));
    const response = await fetch(url.toString(), { headers: { "Accept": "application/json" } });
    if (!response.ok) throw new Error(`تعذر جلب المواقيت (رمز الاتصال ${response.status}).`);
    const payload = await response.json();
    if (payload.code !== 200 || !payload.data || !payload.data.timings) {
      throw new Error("خدمة المواقيت لم تُرجع بيانات صالحة.");
    }
    return payload.data;
  }
  async function loadLocation(location) {
    const token = ++requestToken;
    currentLocation = location;
    updateLocationLabel();
    showLoading("جارٍ جلب المواقيت الحقيقية…");
    setStatus("جارٍ الاتصال بخدمة AlAdhan.");
    $("gps-button").disabled = true;
    citySelect.disabled = true;
    try {
      const now = new Date();
      const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      const [today, nextDay] = await Promise.all([
        fetchTimings(location, now),
        fetchTimings(location, tomorrow)
      ]);
      if (token !== requestToken) return;
      todayData = today;
      tomorrowData = nextDay;
      renderDates(today);
      renderPrayerCards();
      updateCountdown();
      if (timerId) clearInterval(timerId);
      timerId = setInterval(updateCountdown, 1000);
      setStatus("تم تحميل المواقيت من الخدمة بنجاح.");
    } catch (error) {
      if (token !== requestToken) return;
      todayData = null;
      tomorrowData = null;
      showLoading("لا يمكن عرض المواقيت حاليًا لأن البيانات الحقيقية لم تُحمّل.");
      setStatus(`${error.message || "حدث خطأ غير متوقع."} تحقق من الإنترنت ثم أعد المحاولة.`, true);
    } finally {
      if (token === requestToken) {
        $("gps-button").disabled = false;
        citySelect.disabled = false;
      }
    }
  }
  function renderDates(data) {
    const date = data.date || {};
    $("gregorian-date").textContent = date.readable || localDateLabel();
    const hijri = date.hijri;
    if (hijri && hijri.day && hijri.month && hijri.year) {
      $("hijri-date").textContent = `${hijri.day} ${hijri.month.ar || hijri.month.en} ${hijri.year} هـ`;
    } else {
      $("hijri-date").textContent = "التاريخ الهجري غير متوفر";
    }
  }
  function renderPrayerCards(activeKey = "") {
    if (!todayData) return;
    const root = $("prayer-list");
    root.innerHTML = "";
    PRAYERS.forEach((prayer) => {
      const card = document.createElement("div");
      card.className = `prayer-card${prayer.key === activeKey ? " active" : ""}`;
      const name = document.createElement("span");
      name.className = "prayer-name";
      name.textContent = prayer.name;
      const time = document.createElement("span");
      time.className = "prayer-time";
      time.textContent = formatTime(todayData.timings[prayer.key]);
      card.append(name, time);
      root.appendChild(card);
    });
  }
  function getUpcoming(now) {
    if (!todayData) return null;
    const all = PRAYERS
      .filter(p => p.key !== "Sunrise")
      .map(p => ({ ...p, at: timeOnDate(todayData.timings[p.key], now) }));
    let next = all.find(p => p.at.getTime() > now.getTime());
    if (!next && tomorrowData) {
      const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      next = PRAYERS.filter(p => p.key !== "Sunrise")
        .map(p => ({ ...p, at: timeOnDate(tomorrowData.timings[p.key], tomorrow) }))[0];
    }
    return next || null;
  }
  function updateCountdown() {
    if (!todayData) return;
    const now = new Date();
    const next = getUpcoming(now);
    if (!next) return;
    const diff = Math.max(0, next.at.getTime() - now.getTime());
    const totalSeconds = Math.floor(diff / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    $("next-prayer-name").textContent = next.name;
    $("next-prayer-time").textContent = formatTime(next.at.getHours().toString().padStart(2, "0") + ":" + next.at.getMinutes().toString().padStart(2, "0"));
    $("countdown").textContent = [hours, minutes, seconds].map(n => String(n).padStart(2, "0")).join(":");
    renderPrayerCards(next.at.getDate() === now.getDate() ? next.key : "");
    // Refresh data shortly after local midnight so tomorrow becomes today.
    if (now.getHours() === 0 && now.getMinutes() === 0 && now.getSeconds() < 2) {
      loadLocation(currentLocation);
    }
  }

  citySelect.addEventListener("change", () => {
    const city = CITIES.find(item => item[0] === citySelect.value);
    if (!city) return;
    loadLocation({ name: city[1], lat: city[2], lon: city[3], source: "city" });
  });
  $("gps-button").addEventListener("click", () => {
    if (!("geolocation" in navigator)) {
      setStatus("متصفحك لا يدعم تحديد الموقع. اختر مدينة من القائمة.", true);
      return;
    }
    setStatus("بانتظار موافقتك على مشاركة الموقع…");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        citySelect.value = "";
        loadLocation({
          name: `موقعي الحالي (${position.coords.latitude.toFixed(3)}, ${position.coords.longitude.toFixed(3)})`,
          lat: position.coords.latitude,
          lon: position.coords.longitude,
          source: "gps"
        });
      },
      (error) => {
        let message = "تعذر تحديد الموقع. اختر مدينة يدويًا.";
        if (error.code === 1) message = "رفضت إذن الموقع. يمكنك اختيار مدينة يدويًا من القائمة.";
        else if (error.code === 2) message = "تعذر معرفة موقعك. تحقق من GPS أو اختر مدينة يدويًا.";
        else if (error.code === 3) message = "انتهت مهلة تحديد الموقع. حاول مجددًا أو اختر مدينة يدويًا.";
        setStatus(message, true);
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 300000 }
    );
  });
  $("retry-button").addEventListener("click", () => {
    if (currentLocation) loadLocation(currentLocation);
    else setStatus("اختر مدينة أولًا أو اضغط «تحديد موقعي تلقائيًا».", true);
  });

  // Initial load is intentional and uses real coordinates for Tripoli, not hard-coded prayer times.
  const tripoli = CITIES[0];
  citySelect.value = tripoli[0];
  loadLocation({ name: tripoli[1], lat: tripoli[2], lon: tripoli[3], source: "city" });
})();