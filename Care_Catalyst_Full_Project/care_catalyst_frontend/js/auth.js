(function () {
  "use strict";
  var mode = "login";
  var form = document.getElementById("authForm");
  var status = document.getElementById("authStatus");
  var submit = document.getElementById("authSubmit");
  var password = document.getElementById("password");
  var confirmWrap = document.getElementById("confirmWrap");
  var confirmPassword = document.getElementById("confirmPassword");

  function message(text, isError) {
    status.className = "notice " + (isError ? "notice-error" : "notice-info");
    status.innerHTML = "<span>" + (isError ? "!" : "i") + "</span><p></p>";
    status.querySelector("p").textContent = text;
  }
  function setMode(next) {
    mode = next;
    var registering = mode === "register";
    document.getElementById("showLogin").className = "button " + (registering ? "button-secondary" : "button-primary");
    document.getElementById("showRegister").className = "button " + (registering ? "button-primary" : "button-secondary");
    document.getElementById("showLogin").setAttribute("aria-pressed", String(!registering));
    document.getElementById("showRegister").setAttribute("aria-pressed", String(registering));
    confirmWrap.classList.toggle("hidden", !registering);
    confirmPassword.required = registering;
    password.autocomplete = registering ? "new-password" : "current-password";
    submit.textContent = registering ? "Create account" : "Sign in";
    message(registering ? "Create a local account. Passwords must contain at least 12 characters." : "Sign in to the local API account.", false);
  }
  document.getElementById("showLogin").addEventListener("click", function () { setMode("login"); });
  document.getElementById("showRegister").addEventListener("click", function () { setMode("register"); });

  if (!window.CareCatalystAPI) {
    message("The API client did not load. Open this site through the local server at http://127.0.0.1:8000, not directly from a file.", true);
    submit.disabled = true;
    return;
  }
  window.CareCatalystAPI.health().then(function () {
    return window.CareCatalystAPI.me().then(function (result) {
      message("Local server is available. Signed in as " + result.user.username + ".", false);
      submit.textContent = "Open dashboard";
      submit.type = "button";
      submit.addEventListener("click", function () { window.location.href = "index.html"; }, { once: true });
    }).catch(function () {
      message("Local API is available. Sign in or create a demo account to continue.", false);
    });
  }).catch(function () {
    message("Cannot reach the local API. Start run_windows.bat and open http://127.0.0.1:8000/auth.html.", true);
    submit.disabled = true;
  });

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    if (submit.type !== "submit") return;
    var username = document.getElementById("username").value.trim();
    var pass = password.value;
    if (!username || !/^[A-Za-z0-9._-]{1,60}$/.test(username)) return message("Use 1–60 letters, numbers, dots, underscores, or hyphens for the username.", true);
    if (pass.length < 12) return message("Choose a password with at least 12 characters.", true);
    if (mode === "register" && pass !== confirmPassword.value) return message("The passwords do not match.", true);
    submit.disabled = true;
    submit.textContent = mode === "register" ? "Creating account…" : "Signing in…";
    var action = mode === "register" ? window.CareCatalystAPI.register(username, pass) : window.CareCatalystAPI.login(username, pass);
    action.then(function (result) {
      message("Signed in as " + result.user.username + ". Your patient and health records will now be loaded from the signed-in account.", false);
      submit.textContent = "Open dashboard";
      submit.type = "button";
      submit.disabled = false;
      submit.addEventListener("click", function () { window.location.href = "index.html"; }, { once: true });
    }).catch(function (error) {
      message(error.message || "Account request failed.", true);
      submit.disabled = false;
      submit.textContent = mode === "register" ? "Create account" : "Sign in";
    });
  });
})();
