(function () {
  var ENDPOINT = "/api/subscribe";
  var MAILTO = "dave@nexusgpartners.net";

  function digits(phone) {
    var d = String(phone || "").replace(/\D/g, "");
    if (d.length === 11 && d.charAt(0) === "1") d = d.slice(1);
    return d;
  }

  function payloadFrom(form) {
    var fd = new FormData(form);
    return {
      firstName: String(fd.get("firstName") || "").trim(),
      lastName: String(fd.get("lastName") || "").trim(),
      shop: String(fd.get("shop") || "").trim(),
      city: String(fd.get("city") || "").trim(),
      state: String(fd.get("state") || "").trim(),
      phone: String(fd.get("phone") || "").trim(),
      email: String(fd.get("email") || "").trim(),
      jobs: fd.getAll("jobs").map(String),
      adsNow: String(fd.get("adsNow") || ""),
      notes: String(fd.get("notes") || "").trim(),
      consent: form.querySelector('input[name="consent"]').checked === true,
      contact_fax: String(fd.get("contact_fax") || "")
    };
  }

  function summary(payload) {
    return [
      "Name: " + payload.firstName + " " + payload.lastName,
      "Shop: " + payload.shop,
      "City: " + payload.city + ", " + payload.state,
      "Phone: " + payload.phone,
      "Email: " + payload.email,
      "Jobs: " + (payload.jobs.join(", ") || "(not specified)"),
      "Running ads now: " + (payload.adsNow || "(not specified)"),
      "SMS consent: " + (payload.consent ? "yes" : "no"),
      "Notes: " + (payload.notes || "(none)")
    ].join("\n");
  }

  function showThanks(form, payload) {
    var thanks = form.parentElement.querySelector(".form-thanks");
    var detail = thanks.querySelector(".thanks-detail");
    var sms = payload.consent
      ? "You agreed to text messages at this number about the audit and scheduling. Reply STOP to opt out."
      : "You did not opt in to text messages. Dave will use phone or email.";
    detail.textContent = "Dave has the request for " + payload.shop + ". He will follow up at " + payload.phone + " or " + payload.email + ". " + sms;
    form.hidden = true;
    thanks.hidden = false;
    thanks.focus();
  }

  function showMailFallback(form, payload) {
    var status = form.querySelector(".form-status");
    var text = summary(payload);
    status.textContent = "";
    var p = document.createElement("p");
    p.textContent = "This page could not save the form automatically. Your email app should open a draft to " + MAILTO + ". Send that draft to finish the request. If no draft opens, copy the details below or call (220) 208-0593.";
    var pre = document.createElement("pre");
    pre.textContent = text;
    status.appendChild(p);
    status.appendChild(pre);
    window.location.href = "mailto:" + MAILTO + "?subject=" + encodeURIComponent("Free HVAC ad audit — " + payload.shop) + "&body=" + encodeURIComponent(text);
  }

  function bind(form) {
    var phone = form.querySelector('input[name="phone"]');
    var button = form.querySelector('button[type="submit"]');
    var label = button.textContent;
    phone.addEventListener("input", function () { phone.setCustomValidity(""); });

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      if (!form.reportValidity()) return;
      var d = digits(phone.value);
      if (d.length !== 10) {
        phone.setCustomValidity("Enter a 10-digit mobile number.");
        phone.reportValidity();
        return;
      }
      phone.setCustomValidity("");
      var payload = payloadFrom(form);
      button.disabled = true;
      button.textContent = "Sending…";

      fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify(payload)
      }).then(function (res) {
        return res.text().then(function (raw) {
          var data = {};
          try { data = JSON.parse(raw); } catch (err) { data = {}; }
          return { ok: res.ok, status: res.status, data: data };
        });
      }).then(function (result) {
        if (result.status === 400) {
          var status = form.querySelector(".form-status");
          status.textContent = (result.data && result.data.error) || "Check the form and try again.";
          return;
        }
        if (result.ok && result.data && result.data.success) {
          showThanks(form, payload);
          return;
        }
        showMailFallback(form, payload);
      }).catch(function () {
        showMailFallback(form, payload);
      }).then(function () {
        if (!form.hidden) {
          button.disabled = false;
          button.textContent = label;
        }
      });
    });
  }

  document.querySelectorAll("form.audit-form").forEach(bind);
})();
