/* MORGGY account page — authentication and profile.
   All reads and writes go through the anon key and are constrained by RLS:
   a customer can only ever see their own profile and orders. */
(function () {
  "use strict";

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var C = window.MORGGY || {};

  function notice(host, kind, title, body) {
    if (!host) return;
    host.innerHTML = '<div class="notice"' + (kind === "muted" ? ' style="border-left-color:var(--line-strong)"' : "") +
      "><strong>" + title + "</strong>" + body + "</div>";
  }

  function message(host, text, isError) {
    if (!host) return;
    host.innerHTML = '<p class="result-count" style="margin-top:12px' +
      (isError ? ";color:#8a2f22" : "") + '">' + text + "</p>";
  }

  var ready = window.Store && window.Store.configured;
  var noticeHost = $("#accountNotice");
  var authPanels = $("#authPanels");
  var profilePanels = $("#profilePanels");

  if (!ready) {
    if (authPanels) authPanels.hidden = true;
    notice(noticeHost, "muted", "Accounts are not connected yet",
      "This storefront is running without a Supabase project, so sign-in is unavailable. " +
      "Add the project URL and anon key to <code>assets/js/config.js</code>. " +
      "Orders can still be placed as a guest, and existing orders can be found on the " +
      '<a href="track.html">tracking page</a>.');
    return;
  }

  var dbPromise = window.Store.client();

  function showSignedOut() {
    if (authPanels) authPanels.hidden = false;
    if (profilePanels) profilePanels.hidden = true;
  }

  async function showSignedIn(user) {
    if (authPanels) authPanels.hidden = true;
    if (profilePanels) profilePanels.hidden = false;

    var emailHost = $("#accountEmail");
    if (emailHost) emailHost.textContent = user.email || "";

    var db = await dbPromise;
    var profile = await db.from("profiles")
      .select("full_name, phone, market")
      .eq("id", user.id)
      .maybeSingle();

    if (profile.error) {
      message($("#profileResult"), "We could not load your profile. " + profile.error.message, true);
    } else if (profile.data) {
      $("#pf-name").value = profile.data.full_name || "";
      $("#pf-phone").value = profile.data.phone || "";
      $("#pf-market").value = profile.data.market || "";
    }

    loadOrders();
  }

  async function loadOrders() {
    var host = $("#orderHistory");
    if (!host) return;
    try {
      var orders = await window.Store.myOrders();
      if (!orders.length) {
        host.innerHTML = '<p class="result-count">No orders are linked to this account yet. ' +
          'Guest orders still appear on the <a href="track.html">tracking page</a>.</p>';
        return;
      }
      host.innerHTML = orders.map(function (order) {
        return '<div class="summary-row"><span>' + order.order_number +
          '<small>' + new Date(order.placed_at).toLocaleDateString() + " · " + order.status.replace(/_/g, " ") +
          "</small></span><span>" + order.currency_display + " " +
          Number(order.total_usd).toFixed(2) + " USD</span></div>";
      }).join("");
    } catch (err) {
      host.innerHTML = '<p class="result-count">Your orders could not be loaded right now.</p>';
    }
  }

  /* ---------- forms ---------- */
  var signIn = $("#signInForm");
  if (signIn) {
    signIn.onsubmit = async function (event) {
      event.preventDefault();
      var form = event.target;
      if (!form.checkValidity()) { form.reportValidity(); return; }
      var out = $("#signInResult");
      message(out, "Signing in…");
      try {
        var db = await dbPromise;
        var result = await db.auth.signInWithPassword({
          email: form.email.value.trim(),
          password: form.password.value
        });
        if (result.error) throw result.error;
        form.reset();
        message(out, "");
        showSignedIn(result.data.user);
      } catch (err) {
        message(out, "That email and password did not match. Please try again.", true);
      }
    };
  }

  var signUp = $("#signUpForm");
  if (signUp) {
    signUp.onsubmit = async function (event) {
      event.preventDefault();
      var form = event.target;
      if (!form.checkValidity()) { form.reportValidity(); return; }
      var out = $("#signUpResult");
      message(out, "Creating your account…");
      try {
        var db = await dbPromise;
        var result = await db.auth.signUp({
          email: form.email.value.trim(),
          password: form.password.value,
          options: {
            data: { full_name: form.fullName.value.trim(), market: form.market.value },
            emailRedirectTo: location.origin + location.pathname
          }
        });
        if (result.error) throw result.error;

        if (result.data.session) {
          form.reset();
          message(out, "");
          showSignedIn(result.data.user);
        } else {
          message(out, "Check your inbox: confirm your email address, then sign in.");
        }
      } catch (err) {
        message(out, err.message || "The account could not be created.", true);
      }
    };
  }

  var reset = $("#resetForm");
  if (reset) {
    reset.onsubmit = async function (event) {
      event.preventDefault();
      var form = event.target;
      if (!form.checkValidity()) { form.reportValidity(); return; }
      var out = $("#resetResult");
      message(out, "Sending…");
      try {
        var db = await dbPromise;
        var result = await db.auth.resetPasswordForEmail(form.email.value.trim(), {
          redirectTo: location.origin + location.pathname
        });
        if (result.error) throw result.error;
        message(out, "If that address has an account, a reset link is on its way.");
        form.reset();
      } catch (err) {
        message(out, "The reset email could not be sent. Please try again.", true);
      }
    };
  }

  var profileForm = $("#profileForm");
  if (profileForm) {
    profileForm.onsubmit = async function (event) {
      event.preventDefault();
      var out = $("#profileResult");
      message(out, "Saving…");
      try {
        var db = await dbPromise;
        var user = (await db.auth.getUser()).data.user;
        if (!user) throw new Error("Not signed in.");

        var payload = {
          full_name: profileForm.fullName.value.trim() || null,
          phone: profileForm.phone.value.trim() || null,
          market: profileForm.market.value || null
        };

        var result = await db.from("profiles").update(payload).eq("id", user.id);
        if (result.error) throw result.error;
        message(out, "Saved.");
      } catch (err) {
        message(out, err.message || "Those details could not be saved.", true);
      }
    };
  }

  var signOutBtn = $("#signOutBtn");
  if (signOutBtn) {
    signOutBtn.onclick = async function () {
      var db = await dbPromise;
      await db.auth.signOut();
      showSignedOut();
      var out = $("#signInResult");
      message(out, "You are signed out.");
    };
  }

  /* ---------- boot ---------- */
  dbPromise.then(function (db) {
    db.auth.getSession().then(function (result) {
      var session = result.data.session;
      if (session && session.user) showSignedIn(session.user);
      else showSignedOut();
    });
  }).catch(function () {
    notice(noticeHost, "muted", "Accounts are unavailable",
      "The authentication service could not be reached. Guest checkout and the tracking page still work.");
    showSignedOut();
  });
})();
