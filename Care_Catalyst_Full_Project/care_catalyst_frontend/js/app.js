(function () {
  "use strict";
  var KEYS = { patients: "careCatalyst_patients", assessments: "careCatalyst_assessments", entries: "careCatalyst_entries", followups: "careCatalyst_followups" };
  var remoteReady = false;
  var remoteWriteQueue = Promise.resolve();
  var syncStatusText = "Waiting for account data";
  function setSyncStatus(state, message) {
    syncStatusText = message || state;
    var status = document.getElementById("ccSyncStatus");
    if (status) {
      status.textContent = syncStatusText;
      status.className = "cc-sync-status cc-sync-" + state;
      status.setAttribute("role", state === "error" ? "alert" : "status");
    }
  }
  function mountSyncStatus() {
    var host = document.querySelector(".topbar-right");
    if (!host || document.getElementById("ccSyncStatus")) return;
    var status = document.createElement("span");
    status.id = "ccSyncStatus";
    status.className = "cc-sync-status cc-sync-loading";
    status.textContent = syncStatusText;
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    host.insertBefore(status, host.firstChild);
  }
  function read(key) {
    try {
      var value = localStorage.getItem(KEYS[key]);
      if (!value) return [];
      var parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.filter(function (item) { return item && typeof item === "object"; }) : [];
    } catch (e) { return []; }
  }
  function syncCollection(key, before, after) {
    if (!remoteReady || !window.CareCatalystAPI) return;
    var oldById = {}, newById = {};
    before.forEach(function (item) { if (item && item.id) oldById[item.id] = item; });
    after.forEach(function (item) { if (item && item.id) newById[item.id] = item; });
    setSyncStatus("syncing", "Saving changes…");
    remoteWriteQueue = remoteWriteQueue.then(function () {
      var jobs = [];
      Object.keys(newById).forEach(function (rid) {
        var oldRecord = oldById[rid], newRecord = newById[rid];
        if (!oldRecord || JSON.stringify(oldRecord) !== JSON.stringify(newRecord)) jobs.push(window.CareCatalystAPI.save(key, newRecord));
      });
      Object.keys(oldById).forEach(function (rid) {
        if (!newById[rid]) jobs.push(window.CareCatalystAPI.remove(key, rid).catch(function (error) {
          if (!/not found/i.test(error.message || "")) throw error;
        }));
      });
      return Promise.all(jobs).then(function () {
        setSyncStatus("saved", "All changes saved to your account on this local server");
      });
    }).catch(function (error) {
      setSyncStatus("error", "Sync failed — changes may only be in this browser");
      toast("The browser view changed, but the server could not save every record: " + (error.message || "unknown error") + ". Refresh after checking the server.", true);
    });
  }
  function write(key, records) {
    var before = read(key);
    try {
      localStorage.setItem(KEYS[key], JSON.stringify(records));
      syncCollection(key, before, records);
      return true;
    } catch (e) { toast("Your browser could not save this change. Check available storage.", true); return false; }
  }
  function startWorkspace() {
    var page = document.body.getAttribute("data-page");
    if (page === "auth" || !window.CareCatalystAPI) return Promise.resolve(false);
    return window.CareCatalystAPI.me().then(function () {
      return Promise.all(["patients", "assessments", "entries", "followups"].map(function (key) {
        return window.CareCatalystAPI.list(key).then(function (records) {
          localStorage.setItem(KEYS[key], JSON.stringify(records));
        });
      }));
    }).then(function () { remoteReady = true; mountSyncStatus(); setSyncStatus("saved", "Account data loaded from the local server"); return true; }).catch(function (error) {
      if (/sign in/i.test(error.message || "")) { window.location.href = "auth.html"; return false; }
      document.body.innerHTML = '<main class="auth-shell"><section class="auth-card"><h1>Care Catalyst server unavailable</h1><p>The app could not load your account records. Start the local backend and try again.</p><p class="muted">' + escapeHTML(error.message || "Connection failed") + '</p><a class="button button-primary" href="auth.html">Open account access</a></section></main>';
      return false;
    });
  }
  function id() { return "cc_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8); }
  function dateLabel(value) {
    if (!value) return "Date not provided";
    var date = new Date(value);
    if (isNaN(date.getTime())) return "Date not available";
    return date.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }
  function escapeHTML(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (char) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
    });
  }
  function toast(message, error) {
    var region = document.getElementById("toastRegion");
    if (!region) { window.alert(message); return; }
    var item = document.createElement("div");
    item.className = "toast" + (error ? " error" : "");
    item.textContent = message;
    region.appendChild(item);
    window.setTimeout(function () { if (item.parentNode) item.parentNode.removeChild(item); }, 3800);
  }
  function localDateISO(date) {
    var d = date || new Date();
    return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0");
  }
  function followupCategory(task) {
    if ((task.status || "pending") !== "pending") return task.status || "pending";
    if (!task.dueDate) return "no-date";
    var today = localDateISO();
    if (task.dueDate < today) return "overdue";
    if (task.dueDate === today) return "today";
    var soon = new Date(); soon.setDate(soon.getDate()+7);
    if (task.dueDate <= localDateISO(soon)) return "upcoming";
    return "later";
  }
  function renderDashboard() {
    var patients = read("patients"), assessments = read("assessments"), entries = read("entries"), followups = read("followups");
    setText("metricPatients", patients.length);
    setText("metricAssessments", assessments.length);
    setText("metricFollowups", followups.filter(function (f) { return (f.status || "pending") === "pending"; }).length);
    var unlinkedAssessments = assessments.filter(function (a) {
      return !entries.some(function (e) { return e.type === "Symptom assessment" && (e.assessmentId === a.id || (!e.assessmentId && (e.patientId || "") === (a.patientId || "") && (e.summary || "") === (a.symptoms || ""))); });
    });
    setText("metricEntries", entries.length + unlinkedAssessments.length);
    var today = new Date();
    setText("todayLabel", today.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }));
    var patientMap = {};
    patients.forEach(function (p) { patientMap[p.id] = p.name || "Unnamed patient"; });
    var pending = followups.filter(function (f) { return (f.status || "pending") === "pending"; }).sort(function (a,b) {
      var da = a.dueDate || "9999-99-99", db = b.dueDate || "9999-99-99"; return da.localeCompare(db);
    }).slice(0,4);
    var followContainer = document.getElementById("dashboardFollowups");
    if (followContainer) {
      if (!pending.length) followContainer.innerHTML = '<div class="empty-state compact"><span class="empty-icon">✓</span><strong>You are all caught up</strong><p>Follow-up tasks you add will appear here.</p></div>';
      else followContainer.innerHTML = pending.map(function (f) {
        var cat = followupCategory(f), label = cat === "overdue" ? "Overdue" : cat === "today" ? "Due today" : cat === "upcoming" ? "Coming up" : cat === "no-date" ? "No due date" : "Scheduled";
        return '<div class="follow-item '+(cat === "overdue" ? "overdue" : cat === "today" ? "today" : "upcoming")+'"><span class="follow-bullet">▣</span><span class="follow-copy"><strong>'+escapeHTML(f.title || "Follow-up task")+'</strong><small>'+escapeHTML(patientMap[f.patientId] || "No patient linked")+' · '+escapeHTML(f.dueDate || "No due date")+'</small></span><span class="follow-tag">'+label+'</span></div>';
      }).join("");
    }
    // Assessments are also written to the timeline; avoid showing the same event twice.
    var timelineAssessments = assessments.filter(function (a) {
      return !entries.some(function (e) {
        return e.type === "Symptom assessment" && (e.assessmentId === a.id || (!e.assessmentId && (e.patientId || "") === (a.patientId || "") && (e.summary || "") === (a.symptoms || "")));
      });
    });
    var recent = entries.map(function (e) { return Object.assign({kind:"entry"},e); }).concat(timelineAssessments.map(function (a) { return Object.assign({kind:"assessment"},a); }));
    recent.sort(function (a,b) { return new Date(b.createdAt || b.date || 0)-new Date(a.createdAt || a.date || 0); });
    var story = document.getElementById("dashboardStory");
    if (story) {
      if (!recent.length) story.innerHTML = '<div class="empty-state compact"><span class="empty-icon">◷</span><strong>Your story starts here</strong><p>Add an assessment, note, or measurement to build a timeline.</p></div>';
      else story.innerHTML = recent.slice(0,4).map(function (e) {
        var title = e.kind === "assessment" ? "Symptom assessment" : (e.type || "Health update");
        var summary = e.kind === "assessment" ? (e.symptoms || "Symptom information recorded") : (e.summary || e.value || e.notes || "Health information recorded");
        return '<div class="mini-entry"><span class="mini-entry-icon">'+(e.kind === "assessment" ? "⌕" : "◷")+'</span><div><strong>'+escapeHTML(title)+'</strong><p>'+escapeHTML(summary)+'</p><time>'+escapeHTML(dateLabel(e.createdAt || e.date))+'</time></div></div>';
      }).join("");
    }
  }
  function setText(id, value) { var el = document.getElementById(id); if (el) el.textContent = String(value); }
  function setupMenu() {
    var button = document.getElementById("menuToggle"), sidebar = document.getElementById("sidebar");
    if (!button || !sidebar) return;
    button.addEventListener("click", function () {
      var open = sidebar.classList.toggle("open");
      button.setAttribute("aria-expanded", open ? "true" : "false");
      button.setAttribute("aria-label", open ? "Close navigation" : "Open navigation");
    });
    function closeMenu() {
      sidebar.classList.remove("open");
      button.setAttribute("aria-expanded", "false");
      button.setAttribute("aria-label", "Open navigation");
    }
    document.addEventListener("click", function (event) {
      if (window.innerWidth <= 850 && sidebar.classList.contains("open") && !sidebar.contains(event.target) && event.target !== button) closeMenu();
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && sidebar.classList.contains("open")) {
        closeMenu();
        button.focus();
      }
    });
  }
  function setupLogout() {
    var host = document.querySelector(".topbar-right");
    if (!host || !window.CareCatalystAPI || host.querySelector("[data-cc-logout]")) return;
    var button = document.createElement("button");
    button.type = "button";
    button.className = "small-button";
    button.setAttribute("data-cc-logout", "true");
    button.textContent = "Sign out";
    button.addEventListener("click", function () {
      if (!window.confirm("Sign out of Care Catalyst on this browser?")) return;
      button.disabled = true;
      window.CareCatalystAPI.logout().then(function () {
        Object.keys(KEYS).forEach(function (key) {
          try { localStorage.removeItem(KEYS[key]); } catch (error) { /* storage may be unavailable */ }
        });
        window.location.href = "auth.html";
      }).catch(function (error) {
        button.disabled = false;
        toast("Could not complete sign out: " + (error.message || "server error"), true);
      });
    });
    host.appendChild(button);
  }
  function setupActiveNav() {
    var page = document.body.getAttribute("data-page") || "";
    document.querySelectorAll(".nav-link").forEach(function (link) {
      var href = link.getAttribute("href") || "";
      var target = href.replace(".html", "");
      if ((page === "dashboard" && href === "index.html") || (page && target === page)) link.classList.add("active");
      else link.classList.remove("active");
    });
  }
  window.CareCatalyst = {
    read: read, write: write, id: id, dateLabel: dateLabel, escapeHTML: escapeHTML, toast: toast,
    localDateISO: localDateISO, followupCategory: followupCategory,
    saveAssessment: function (record) {
      var all=read("assessments"), entries=read("entries"), assessmentId=id(), createdAt=new Date().toISOString();
      var assessment=Object.assign({id:assessmentId,createdAt:createdAt},record);
      var entry=Object.assign({id:id(),createdAt:createdAt,assessmentId:assessmentId,type:"Symptom assessment",summary:record.symptoms,details:record.context||"",source:"User-reported"},{patientId:record.patientId||""});
      all.unshift(assessment);
      if(!write("assessments",all)) return false;
      entries.unshift(entry);
      if(!write("entries",entries)) {
        write("assessments",all.filter(function(a){return a.id!==assessmentId;}));
        return false;
      }
      return true;
    },
    saveEntry: function (record) { var all=read("entries"); all.unshift(Object.assign({id:id(),createdAt:new Date().toISOString()},record)); return write("entries",all); },
    saveFollowup: function (record) { var all=read("followups"); all.unshift(Object.assign({id:id(),createdAt:new Date().toISOString(),status:"pending"},record)); return write("followups",all); }
  };

  function populatePatientSelect(selectId, allowAll) {
    var select = document.getElementById(selectId); if (!select) return;
    var current = select.value, patients = read("patients");
    select.innerHTML = '<option value="">'+(allowAll ? "All records / no patient selected" : "No patient linked")+'</option>';
    patients.forEach(function (p) { var o=document.createElement("option"); o.value=p.id; o.textContent=p.name || "Unnamed patient"; select.appendChild(o); });
    select.value = current;
  }
  function initPatients() {
    var form=document.getElementById("patientForm"), list=document.getElementById("patientList");
    if(!form||!list)return;
    function render(){var records=read("patients");list.innerHTML=records.length?records.map(function(p){return '<div class="record-card"><div class="record-avatar">'+escapeHTML((p.name||"?").slice(0,1).toUpperCase())+'</div><div class="record-main"><strong>'+escapeHTML(p.name)+'</strong><p>'+(p.age?("Age "+escapeHTML(p.age)+" · "):"")+escapeHTML(p.relation||"No label")+'</p><p>'+escapeHTML(p.notes||"No additional notes")+'</p><p>Updated '+escapeHTML(dateLabel(p.updatedAt||p.createdAt))+'</p><div class="record-actions"><button class="small-button" data-edit-patient="'+escapeHTML(p.id)+'">Edit</button><button class="small-button danger" data-delete-patient="'+escapeHTML(p.id)+'">Delete</button></div></div></div>';}).join(""):'<div class="empty-state"><span class="empty-icon">♙</span><strong>No patient profiles yet</strong><p>Add a fictional profile using the form.</p></div>';}
    function reset(){form.reset();document.getElementById("patientId").value="";document.getElementById("patientFormTitle").textContent="Add a patient";document.getElementById("cancelPatientEdit").classList.add("hidden");}
    form.addEventListener("submit",function(e){e.preventDefault();var name=document.getElementById("patientName").value.trim();if(!name){toast("Please enter a display name.",true);return;}var records=read("patients"),pid=document.getElementById("patientId").value,existing=records.find(function(p){return p.id===pid;});var duplicate=records.some(function(p){return p.id!==pid&&(p.name||"").trim().toLowerCase()===name.toLowerCase();});if(duplicate&&!window.confirm("A profile with this display name already exists. Save another profile anyway?"))return;var record={id:pid||id(),name:name,age:document.getElementById("patientAge").value,relation:document.getElementById("patientRelation").value.trim(),notes:document.getElementById("patientNotes").value.trim(),createdAt:existing?existing.createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};if(existing)records=records.map(function(p){return p.id===pid?record:p;});else records.unshift(record);if(write("patients",records)){toast(existing?"Profile updated.":"Profile saved.");reset();render();}});
    document.getElementById("cancelPatientEdit").addEventListener("click",reset);
    list.addEventListener("click",function(e){var edit=e.target.closest("[data-edit-patient]"),del=e.target.closest("[data-delete-patient]");if(edit){var p=read("patients").find(function(x){return x.id===edit.getAttribute("data-edit-patient");});if(!p)return;document.getElementById("patientId").value=p.id;document.getElementById("patientName").value=p.name||"";document.getElementById("patientAge").value=p.age||"";document.getElementById("patientRelation").value=p.relation||"";document.getElementById("patientNotes").value=p.notes||"";document.getElementById("patientFormTitle").textContent="Edit patient";document.getElementById("cancelPatientEdit").classList.remove("hidden");window.scrollTo(0,0);}if(del){var pid=del.getAttribute("data-delete-patient");var p=read("patients").find(function(x){return x.id===pid;});if(!p||!window.confirm("Delete "+(p.name||"this profile")+"? Related notes and tasks will be retained as unlinked records."))return;if(!write("patients",read("patients").filter(function(x){return x.id!==pid;})))return;var unlinkFailed=false;["entries","assessments","followups"].forEach(function(k){var arr=read(k);arr.forEach(function(x){if(x.patientId===pid)x.patientId="";});if(!write(k,arr))unlinkFailed=true;});toast(unlinkFailed?"Profile deleted, but some related records could not be updated. Check browser storage.":"Profile deleted. Related records were retained without a patient link.",unlinkFailed);render();}});
    render();
  }
  function initAssessment(){var form=document.getElementById("assessmentForm");if(!form)return;populatePatientSelect("assessmentPatient",false);form.addEventListener("submit",function(e){e.preventDefault();var symptoms=document.getElementById("symptomInput").value.trim();if(!symptoms)return;var parsed=symptoms.split(/[,;\n]+|\s+and\s+/i).map(function(s){return s.trim().replace(/^[-•]+\s*/,"").replace(/[.]+$/ ,"");}).filter(Boolean);var unique=[],seen={};parsed.forEach(function(s){var key=s.toLowerCase();if(!seen[key]){seen[key]=true;unique.push(s);}});var rec={patientId:document.getElementById("assessmentPatient").value,symptoms:symptoms,symptomItems:unique,duration:document.getElementById("symptomDuration").value.trim(),trend:document.getElementById("symptomTrend").value,context:document.getElementById("symptomContext").value.trim(),source:"User-reported",disclaimer:"Educational organization only; not a diagnosis."};var result=document.getElementById("assessmentResult");result.classList.remove("hidden");result.innerHTML="<h3>Review of the information you entered</h3><p><strong>Original note:</strong> "+escapeHTML(symptoms)+"</p><p><strong>Items identified for your review:</strong></p><ul>"+unique.map(function(item){return "<li>"+escapeHTML(item)+"</li>";}).join("")+"</ul>"+(unique.length<parsed.length?"<p class='muted'>Repeated items were shown once in this review; your original note remains unchanged.</p>":"")+(rec.duration?"<p><strong>Duration:</strong> "+escapeHTML(rec.duration)+"</p>":"")+(rec.trend?"<p><strong>Trend:</strong> "+escapeHTML(rec.trend)+"</p>":"")+"<p><strong>What this result means:</strong> This prototype organizes your wording only. It does not have a clinically validated combination-matching engine and will not infer a condition or provide a probability.</p><p><strong>Useful next step:</strong> Record when symptoms started, how they have changed, relevant measurements, and questions for a qualified healthcare professional.</p><p><strong>Safety:</strong> Emergency warning signs must be assessed independently of this form. If symptoms are severe or life-threatening, seek emergency help immediately.</p><div class='form-actions'><button class='button button-primary' id='saveAssessment' type='button'>Save to Health Story</button><a class='button button-secondary' href='visit-brief.html'>Prepare visit brief</a></div>";document.getElementById("saveAssessment").addEventListener("click",function(){var saveButton=document.getElementById("saveAssessment");saveButton.disabled=true;if(window.CareCatalyst.saveAssessment(rec)){toast("Assessment saved to this browser and added to Health Story.");result.classList.add("hidden");form.reset();}else{saveButton.disabled=false;toast("Assessment could not be saved. Check browser storage and try again.",true);}});});}
  function initStory(){var form=document.getElementById("entryForm"),list=document.getElementById("entryList");if(!form||!list)return;populatePatientSelect("entryPatient",false);var dateField=document.getElementById("entryDate");if(dateField){var now=new Date();dateField.value=now.getFullYear()+"-"+String(now.getMonth()+1).padStart(2,"0")+"-"+String(now.getDate()).padStart(2,"0")+"T"+String(now.getHours()).padStart(2,"0")+":"+String(now.getMinutes()).padStart(2,"0");}
    function render(){var type=document.getElementById("entryFilter").value,query=document.getElementById("entrySearch").value.toLowerCase(),entries=read("entries"),assessments=read("assessments").filter(function(a){return !entries.some(function(e){return e.type==="Symptom assessment"&&(e.assessmentId===a.id||(!e.assessmentId&&(e.patientId||"")===(a.patientId||"")&&(e.summary||"")===(a.symptoms||"")));});}).map(function(a){return Object.assign({type:"Symptom assessment",summary:a.symptoms,details:a.context,kind:"assessment"},a);}),records=entries.concat(assessments);records.sort(function(a,b){return new Date(b.createdAt||b.date||0)-new Date(a.createdAt||a.date||0);});records=records.filter(function(r){return(!type||r.type===type)&&(!query||JSON.stringify(r).toLowerCase().indexOf(query)>=0);});list.innerHTML=records.length?records.map(function(r){return '<div class="record-card"><div class="record-avatar">◷</div><div class="record-main"><strong>'+escapeHTML(r.summary||r.symptoms||r.type||"Health entry")+'</strong><p>'+escapeHTML(r.type||"Symptom assessment")+' · '+escapeHTML(dateLabel(r.createdAt||r.date))+'</p><p>'+escapeHTML(r.details||r.context||"No extra details")+'</p>'+(r.value?'<p>Measurement: '+escapeHTML(r.value)+' '+escapeHTML(r.unit||"")+'</p>':"")+'<p>Source: '+escapeHTML(r.source||"User-provided")+'</p>'+(r.kind==="assessment"?"":'<div class="record-actions"><button class="small-button danger" data-delete-entry="'+escapeHTML(r.id)+'">Delete</button></div>')+'</div></div>';}).join(""):'<div class="empty-state"><span class="empty-icon">◷</span><strong>No matching timeline entries</strong><p>Save a note or measurement to begin your timeline.</p></div>';}
    form.addEventListener("submit",function(e){e.preventDefault();var summary=document.getElementById("entrySummary").value.trim();if(!summary)return;var type=document.getElementById("entryType").value,rawDate=dateField.value,parsedDate=rawDate?new Date(rawDate):new Date();if(isNaN(parsedDate.getTime())){toast("Please enter a valid date and time.",true);dateField.focus();return;}var created=parsedDate.toISOString();var rec={patientId:document.getElementById("entryPatient").value,type:type,summary:summary,details:document.getElementById("entryDetails").value.trim(),value:document.getElementById("measurementValue").value.trim(),unit:document.getElementById("measurementUnit").value.trim(),source:"User-provided",createdAt:created};if(window.CareCatalyst.saveEntry(rec)){toast("Timeline entry saved.");form.reset();if(dateField){var now=new Date();dateField.value=now.getFullYear()+"-"+String(now.getMonth()+1).padStart(2,"0")+"-"+String(now.getDate()).padStart(2,"0")+"T"+String(now.getHours()).padStart(2,"0")+":"+String(now.getMinutes()).padStart(2,"0");}render();}});document.getElementById("entryFilter").addEventListener("change",render);document.getElementById("entrySearch").addEventListener("input",render);list.addEventListener("click",function(e){var b=e.target.closest("[data-delete-entry]");if(!b||!confirm("Delete this timeline entry?"))return;if(write("entries",read("entries").filter(function(r){return r.id!==b.getAttribute("data-delete-entry");}))){toast("Entry deleted.");render();}});render();}
  function initFollowups(){var form=document.getElementById("followForm"),list=document.getElementById("followList");if(!form||!list)return;populatePatientSelect("followPatient",false);function reset(){form.reset();document.getElementById("followId").value="";document.getElementById("followFormTitle").textContent="Create a follow-up";document.getElementById("cancelFollowEdit").classList.add("hidden");}function render(){var filter=document.getElementById("followFilter").value,records=read("followups").sort(function(a,b){return (a.dueDate||"9999").localeCompare(b.dueDate||"9999");});records=records.filter(function(f){return !filter||(filter==="pending"?(f.status||"pending")==="pending":followupCategory(f)===filter);});list.innerHTML=records.length?records.map(function(f){var cat=followupCategory(f),status=f.status||"pending";return '<div class="record-card"><div class="record-avatar">▣</div><div class="record-main"><strong>'+escapeHTML(f.title)+'</strong><p>'+escapeHTML(f.category||"Other")+' · '+escapeHTML(f.dueDate||"No due date")+'</p><p>'+escapeHTML(f.description||"No description")+'</p><p><span class="status-pill '+escapeHTML(status)+'">'+escapeHTML(status)+'</span> <span class="status-pill">'+escapeHTML(cat==="overdue"?"Overdue":cat==="today"?"Due today":cat==="upcoming"?"Due in 7 days":cat==="no-date"?"No due date":cat)+'</span></p><div class="record-actions">'+(status==="pending"?'<button class="small-button" data-complete="'+escapeHTML(f.id)+'">Complete</button><button class="small-button" data-cancel="'+escapeHTML(f.id)+'">Cancel</button>':'<button class="small-button" data-reopen="'+escapeHTML(f.id)+'">Reopen</button>')+'<button class="small-button" data-edit-follow="'+escapeHTML(f.id)+'">Edit</button><button class="small-button danger" data-delete-follow="'+escapeHTML(f.id)+'">Delete</button></div></div></div>';}).join(""):'<div class="empty-state"><span class="empty-icon">✓</span><strong>No tasks in this view</strong><p>Create a follow-up to keep a next step visible.</p></div>';}
    form.addEventListener("submit",function(e){e.preventDefault();var records=read("followups"),fid=document.getElementById("followId").value,old=records.find(function(f){return f.id===fid;}),rec={id:fid||id(),title:document.getElementById("followTitle").value.trim(),patientId:document.getElementById("followPatient").value,category:document.getElementById("followCategory").value,dueDate:document.getElementById("followDue").value,reminderDate:document.getElementById("followReminder").value,description:document.getElementById("followDescription").value.trim(),status:old?old.status:"pending",completedAt:old?old.completedAt:"",createdAt:old?old.createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};if(!rec.title)return;if(old)records=records.map(function(f){return f.id===fid?rec:f;});else records.unshift(rec);if(write("followups",records)){toast(old?"Follow-up updated.":"Follow-up saved.");reset();render();}});
    document.getElementById("cancelFollowEdit").addEventListener("click",reset);document.getElementById("followFilter").addEventListener("change",render);list.addEventListener("click",function(e){var b=e.target.closest("button");if(!b)return;var key=b.getAttribute("data-complete")||b.getAttribute("data-cancel")||b.getAttribute("data-reopen")||b.getAttribute("data-edit-follow")||b.getAttribute("data-delete-follow");if(!key)return;var records=read("followups"),f=records.find(function(x){return x.id===key;});if(!f)return;if(b.hasAttribute("data-delete-follow")){if(!confirm("Permanently delete this follow-up?"))return;records=records.filter(function(x){return x.id!==key;});if(write("followups",records)){toast("Follow-up deleted.");render();}return;}if(b.hasAttribute("data-edit-follow")){document.getElementById("followId").value=f.id;document.getElementById("followTitle").value=f.title||"";document.getElementById("followPatient").value=f.patientId||"";document.getElementById("followCategory").value=f.category||"Other";document.getElementById("followDue").value=f.dueDate||"";document.getElementById("followReminder").value=f.reminderDate||"";document.getElementById("followDescription").value=f.description||"";document.getElementById("followFormTitle").textContent="Edit follow-up";document.getElementById("cancelFollowEdit").classList.remove("hidden");window.scrollTo(0,0);return;}if(b.hasAttribute("data-complete")){f.status="completed";f.completedAt=new Date().toISOString();}if(b.hasAttribute("data-cancel")){f.status="cancelled";}if(b.hasAttribute("data-reopen")){f.status="pending";delete f.completedAt;}if(write("followups",records)){toast("Follow-up status updated.");render();}});render();}
  function initBrief() {
    var btn = document.getElementById("generateBrief"), print = document.getElementById("printBrief");
    if (!btn || !print) return;
    populatePatientSelect("briefPatient", true);
    btn.addEventListener("click", function () {
      var pid = document.getElementById("briefPatient").value;
      var patients = read("patients");
      if (patients.length && !pid) {
        toast("Choose one patient before generating a brief. This prevents mixing different patients' information.", true);
        document.getElementById("briefPatient").focus();
        return;
      }
      var patient = patients.find(function (p) { return p.id === pid; });
      if (pid && !patient) {
        toast("That patient profile is no longer available. Refresh the page and select a current profile.", true);
        populatePatientSelect("briefPatient", true);
        document.getElementById("briefPatient").focus();
        return;
      }
      var filter = function (record) { return !pid || record.patientId === pid; };
      var assessments = read("assessments").filter(filter).sort(function (a, b) {
        return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
      });
      var entries = read("entries").filter(function (entry) {
        if (!filter(entry)) return false;
        return !(entry.type === "Symptom assessment" && assessments.some(function (assessment) {
          return entry.assessmentId === assessment.id || (!entry.assessmentId && (assessment.patientId || "") === (entry.patientId || "") && (assessment.symptoms || "") === (entry.summary || ""));
        }));
      }).sort(function (a, b) { return new Date(b.createdAt || b.date || 0) - new Date(a.createdAt || a.date || 0); });
      var followups = read("followups").filter(filter);
      var open = followups.filter(function (f) { return (f.status || "pending") === "pending"; }).sort(function (a, b) {
        return (a.dueDate || "9999-99-99").localeCompare(b.dueDate || "9999-99-99");
      });
      var html = '<div id="printableBrief" class="print-brief"><p class="section-kicker">PATIENT-PREPARED INFORMATIONAL SUMMARY</p><h2>Doctor visit brief</h2>';
      html += '<p><strong>Generated:</strong> ' + escapeHTML(dateLabel(new Date().toISOString())) + '</p>';
      html += '<p><strong>Patient:</strong> ' + escapeHTML(patient ? patient.name : "No profile available") + '</p>';
      html += '<p><strong>Age:</strong> ' + escapeHTML(patient && patient.age ? patient.age : "Not provided") + '</p>';
      if (patient && patient.relation) html += '<p><strong>Relationship / note:</strong> ' + escapeHTML(patient.relation) + '</p>';
      if (patient && patient.notes) html += '<p><strong>Profile notes (user-entered):</strong> ' + escapeHTML(patient.notes) + '</p>';
      html += '<hr><h3>Main reported concerns</h3>';
      if (assessments.length) {
        html += '<ul>' + assessments.map(function (a) {
          return '<li>' + escapeHTML(a.symptoms || "Symptoms not specified") + ' — recorded ' + escapeHTML(dateLabel(a.createdAt)) + (a.duration ? '; duration: ' + escapeHTML(a.duration) : "") + (a.trend ? '; trend: ' + escapeHTML(a.trend) : "") + (a.context ? '; context: ' + escapeHTML(a.context) : "") + '</li>';
        }).join("") + '</ul>';
      } else html += '<p>No symptom assessments recorded for this selection.</p>';
      html += '<h3>Timeline and measurements</h3>';
      if (entries.length) {
        html += '<ul>' + entries.map(function (e) {
          return '<li><strong>' + escapeHTML(e.type || "Entry") + ':</strong> ' + escapeHTML(e.summary || "No summary") + ' (' + escapeHTML(dateLabel(e.createdAt || e.date)) + ')' + (e.value !== undefined && e.value !== "" ? ' — ' + escapeHTML(e.value) + ' ' + escapeHTML(e.unit || "") : "") + (e.details ? ' — ' + escapeHTML(e.details) : "") + '</li>';
        }).join("") + '</ul>';
      } else html += '<p>No timeline entries recorded for this selection.</p>';
      html += '<h3>Pending follow-ups</h3>';
      html += open.length ? '<ul>' + open.map(function (f) {
        return '<li>' + escapeHTML(f.title || "Follow-up task") + ' — due ' + escapeHTML(f.dueDate || "date not provided") + (f.description ? '; ' + escapeHTML(f.description) : "") + '</li>';
      }).join("") + '</ul>' : '<p>No pending follow-ups recorded.</p>';
      html += '<h3>Questions to ask</h3><p>' + escapeHTML(document.getElementById("briefQuestions").value || "Not provided") + '</p>';
      html += '<h3>Current medications (user-entered)</h3><p>' + escapeHTML(document.getElementById("briefMeds").value || "Unknown / not provided") + '</p>';
      html += '<h3>Relevant history (user-entered)</h3><p>' + escapeHTML(document.getElementById("briefHistory").value || "Unknown / not provided") + '</p>';
      html += '<h3>Information to clarify</h3><p>Confirm symptom onset, relevant history, medications, allergies, and any missing details directly with the patient and healthcare professional.</p>';
      html += '<p class="muted"><strong>Disclaimer:</strong> Patient-prepared informational summary. This document contains recorded or user-entered information only; it is not a clinical record, diagnosis, or medical opinion.</p></div>';
      document.getElementById("briefPreview").innerHTML = html;
      document.getElementById("printBrief").focus();
    });
    print.addEventListener("click", function () {
      if (!document.getElementById("printableBrief")) { toast("Generate the preview before printing.", true); return; }
      window.print();
    });
  }
  function initLibrary(){var list=document.getElementById("symptomTopics"),search=document.getElementById("librarySearch");if(!list||!search)return;var topics=[["Fever","A raised body temperature can occur for many reasons. Record the temperature, how it was measured, duration, and associated symptoms."],["Cough","A cough can have many causes. Note duration, whether it is dry or productive, triggers, and any breathing difficulty."],["Headache","Headaches vary in cause and severity. Record onset, location, duration, associated symptoms, and whether it is unusual for you."],["Fatigue","Tiredness may be related to many physical, emotional, sleep, or lifestyle factors. Note how long it has lasted and how it affects daily activities."],["Nausea","Record when nausea occurs, whether vomiting is present, hydration, related pain, and any relevant recent changes."],["Stomach discomfort","Note the location, severity, duration, relation to meals, and associated symptoms to discuss with a clinician."],["Dizziness","Describe whether you feel spinning, faintness, or imbalance, when it occurs, and any associated symptoms."],["Sore throat","Record duration, fever if measured, swallowing difficulty, and any breathing problems."],["Shortness of breath","Breathing difficulty can be urgent. Severe or sudden difficulty breathing requires emergency care."],["Chest pain","Severe, new, or unexplained chest pain may be an emergency, particularly with breathing difficulty, sweating, faintness, or pain spreading. Seek urgent care."]];function render(){var q=search.value.toLowerCase().trim(),found=topics.filter(function(t){return (t[0]+" "+t[1]).toLowerCase().indexOf(q)>=0;});list.innerHTML=found.map(function(t){return '<div class="record-card"><div class="record-avatar">i</div><div class="record-main"><strong>'+escapeHTML(t[0])+'</strong><p>'+escapeHTML(t[1])+'</p><p class="muted">General education only · Not a diagnostic rule</p></div></div>';}).join("")||'<div class="empty-state"><strong>No matching topic</strong><p>Try a broader search or consult a qualified professional.</p></div>';}search.addEventListener("input",render);render();}
  function initPrivacy(){var btn=document.getElementById("clearDemoData");if(!btn)return;btn.addEventListener("click",function(){if(!confirm("This permanently clears all Care Catalyst records stored under its current local keys in this browser. Continue?"))return;Object.keys(KEYS).forEach(function(k){try{localStorage.removeItem(KEYS[k]);}catch(e){}});toast("Care Catalyst records cleared.");});}
  window.addEventListener("beforeprint",function(){document.body.classList.add("printing");});
  window.addEventListener("afterprint",function(){document.body.classList.remove("printing");});
  document.addEventListener("DOMContentLoaded", function () {
    startWorkspace().then(function (ready) {
      if (!ready) return;
      mountSyncStatus(); setupMenu(); setupActiveNav(); setupLogout();
      var page=document.body.getAttribute("data-page");
      if(page==="dashboard")renderDashboard();
      if(page==="patients")initPatients();
      if(page==="care-pathway")initAssessment();
      if(page==="health-story")initStory();
      if(page==="follow-ups")initFollowups();
      if(page==="visit-brief")initBrief();
      if(page==="symptoms")initLibrary();
      if(page==="privacy")initPrivacy();
    });
  });
})();