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

    function log(msg, data) {
        if (DEBUG) console.log("[LeadCapture] " + msg, data !== undefined ? data : "");
    }

    function getCookie(name) {
        var parts = ("; " + document.cookie).split("; " + name + "=");
        return parts.length === 2 ? parts.pop().split(";").shift() : null;
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

    // Returns cached attribution, refreshing it only when new tracking params show up in the URL.
    function getAttribution() {
        var params = new URL(window.location.href).searchParams;
        var hasTrackingParams = ["utm_source", "gclid", "fbclid", "click_id"].some(function (key) {
            return params.has(key);
        });

        if (hasTrackingParams) {
            var fresh = captureFreshAttribution();
            storeAttribution(fresh);
            log("Captured fresh attribution", fresh);
            return fresh;
        }

        var stored = readStoredAttribution();
        if (stored) return stored;

        var initial = captureFreshAttribution();
        storeAttribution(initial);
        log("Captured initial attribution", initial);
        return initial;
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

        if (navigator.sendBeacon) {
            var blob = new Blob([body], { type: "application/json" });
            var sent = navigator.sendBeacon(WEBHOOK_URL, blob);
            log("Sent via beacon:", sent);
            if (sent) return;
        }

        fetch(WEBHOOK_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: body,
            keepalive: true
        }).then(function (res) {
            log(res.ok ? "Sent successfully" : "Webhook returned HTTP " + res.status);
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
    log("Lead capture initialized", { customerName: CUSTOMER_NAME, webhookUrl: WEBHOOK_URL });
})();
