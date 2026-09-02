(() => {
    if (window.__LEAD_CAPTURE_LOADED__) return;
    window.__LEAD_CAPTURE_LOADED__ = true;

    // Config: set before this script loads, e.g.
    // <script>window.LEAD_CAPTURE_CONFIG = { customerName: "Acme", webhookUrl: "https://hooks.zapier.com/..." };</script>
    var config = window.LEAD_CAPTURE_CONFIG || {};
    var CUSTOMER_NAME = config.customerName || null;
    var WEBHOOK_URL = config.webhookUrl || null;
    var DEBUG = "1" === new URLSearchParams(window.location.search).get("lc_debug");

    var STORAGE_KEY = "_lc_attribution";
    var cachedAttribution = null;

    function log(msg, data) {
        if (DEBUG) console.log("[LeadCapture] " + msg, data !== undefined ? data : "");
    }

    function getCookie(name) {
        var parts = ("; " + document.cookie).split("; " + name + "=");
        return parts.length === 2 ? parts.pop().split(";").shift() : null;
    }

    function setCookie(name, value) {
        try {
            var expires = new Date();
            expires.setTime(expires.getTime() + 31536e6); // 1 year
            document.cookie = name + "=" + value + ";expires=" + expires.toUTCString() + ";path=/;SameSite=Lax;Secure";
        } catch (e) {
            log("Cookie write failed", e);
        }
    }

    function readStoredAttribution() {
        try {
            var raw = localStorage.getItem(STORAGE_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch (e) {
            return null;
        }
    }

    function storeAttribution(attr) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(attr));
        } catch (e) {
            log("Failed to store attribution", e);
        }
    }

    function captureFreshAttribution() {
        var params = new URL(window.location.href).searchParams;
        var attr = {
            utm_source: params.get("utm_source") || null,
            utm_medium: params.get("utm_medium") || null,
            utm_campaign: params.get("utm_campaign") || null,
            utm_term: params.get("utm_term") || null,
            utm_content: params.get("utm_content") || null,
            utm_id: params.get("utm_id") || null,
            click_id: params.get("click_id") || null,
            gclid: params.get("gclid") || null,
            gbraid: params.get("gbraid") || null,
            wbraid: params.get("wbraid") || null,
            fbclid: params.get("fbclid") || null,
            fbp: getCookie("_fbp") || null,
            fbc: getCookie("_fbc") || null,
            landing_page: window.location.href,
            referrer: document.referrer || null
        };
        if (attr.fbclid && !attr.fbc) {
            attr.fbc = "fb.1." + Date.now() + "." + attr.fbclid;
        }
        return attr;
    }

    function hasTrackingParams(url) {
        var params = new URL(url).searchParams;
        return ["utm_source", "utm_medium", "utm_campaign", "gclid", "fbclid", "click_id"].some(function (key) {
            return params.has(key);
        });
    }

    // Mirrors optimizer.js: fresh URL params win, then in-memory cache, then localStorage,
    // then backup cookies (survive storage clears), then a fresh capture as last resort.
    function getAttribution() {
        if (hasTrackingParams(window.location.href)) {
            var fresh = captureFreshAttribution();
            cachedAttribution = fresh;
            storeAttribution(fresh);
            if (fresh.gclid) setCookie("_lc_gclid", fresh.gclid);
            if (fresh.fbclid) setCookie("_lc_fbclid", fresh.fbclid);
            if (fresh.utm_source) setCookie("_lc_utm_source", fresh.utm_source);
            log("Captured fresh attribution", fresh);
            return fresh;
        }

        if (cachedAttribution) return cachedAttribution;

        var stored = readStoredAttribution();
        if (stored) {
            cachedAttribution = stored;
            return stored;
        }

        var recovered = {
            gclid: getCookie("_lc_gclid"),
            fbclid: getCookie("_lc_fbclid"),
            utm_source: getCookie("_lc_utm_source")
        };
        if (recovered.gclid || recovered.fbclid || recovered.utm_source) {
            log("Recovered attribution from backup cookies");
            cachedAttribution = recovered;
            storeAttribution(recovered);
            return recovered;
        }

        var initial = captureFreshAttribution();
        cachedAttribution = initial;
        storeAttribution(initial);
        log("Captured initial attribution", initial);
        return initial;
    }

    // Re-captures attribution on SPA route changes (pushState/replaceState/popstate) if new
    // tracking params appear, without needing a full page reload.
    function watchUrlChanges() {
        var lastUrl = window.location.href;
        var originalPushState = history.pushState;
        var originalReplaceState = history.replaceState;

        function onUrlChange() {
            var current = window.location.href;
            if (current === lastUrl) return;
            lastUrl = current;
            if (hasTrackingParams(current)) {
                log("URL changed with new tracking params, refreshing attribution");
                getAttribution();
            }
        }

        history.pushState = function () {
            originalPushState.apply(this, arguments);
            onUrlChange();
        };
        history.replaceState = function () {
            originalReplaceState.apply(this, arguments);
            onUrlChange();
        };
        window.addEventListener("popstate", onUrlChange);
    }

    function getFormFields(form) {
        var fields = {};
        var elements = form.elements;
        for (var i = 0; i < elements.length; i++) {
            var el = elements[i];
            if (!el.name || el.type === "password") continue;
            if (el.type === "checkbox") {
                fields[el.name] = el.checked;
            } else if (el.type === "radio") {
                if (el.checked) fields[el.name] = el.value;
            } else {
                fields[el.name] = el.value;
            }
        }
        return fields;
    }

    function sendToWebhook(payload) {
        if (!WEBHOOK_URL) {
            log("No webhookUrl configured, skipping send");
            return;
        }
        var body = JSON.stringify(payload);
        log("Sending payload", payload);

        // no-cors avoids the preflight (and Zapier's wildcard CORS + credentials conflict);
        // the response is opaque, but we don't need to read it.
        fetch(WEBHOOK_URL, {
            method: "POST",
            mode: "no-cors",
            headers: { "Content-Type": "application/json" },
            body: body,
            keepalive: true
        }).then(function () {
            log("Sent (opaque response, assumed delivered)");
        }).catch(function (err) {
            log("Failed to send payload", err);
        });
    }

    function handleFormSubmit(event) {
        var form = event.target;
        if (!form || form.tagName !== "FORM") return;

        var payload = {
            customerName: CUSTOMER_NAME,
            eventType: "form_submit",
            timestamp: new Date().toISOString(),
            pageUrl: window.location.href,
            formId: form.getAttribute("id") || form.getAttribute("name") || null,
            fields: getFormFields(form),
            attribution: getAttribution()
        };

        sendToWebhook(payload);
    }

    document.addEventListener("submit", handleFormSubmit, true);
    getAttribution(); // capture/store attribution on page load, not just on submit
    watchUrlChanges(); // keep attribution fresh across SPA route changes
    log("Lead capture initialized", { customerName: CUSTOMER_NAME, webhookUrl: WEBHOOK_URL });
})();
