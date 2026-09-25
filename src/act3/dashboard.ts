export const dashboardHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Caldova Production Guardian</title>
  <style>
    :root {
      color-scheme: light;
      --ink: #102a33;
      --muted: #5a6d73;
      --paper: #f5f8f6;
      --surface: #ffffff;
      --line: #cbd8d5;
      --teal: #007c83;
      --teal-dark: #005b61;
      --amber: #b85c00;
      --amber-pale: #fff2df;
      --green: #176b4d;
      --green-pale: #e6f4ed;
      --red: #a4262c;
    }

    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-width: 320px;
      color: var(--ink);
      background-color: var(--paper);
      background-image:
        linear-gradient(rgba(16, 42, 51, 0.035) 1px, transparent 1px),
        linear-gradient(90deg, rgba(16, 42, 51, 0.035) 1px, transparent 1px);
      background-size: 24px 24px;
      font-family: Aptos, "Segoe UI", sans-serif;
    }

    header {
      border-bottom: 1px solid var(--line);
      background: rgba(255, 255, 255, 0.96);
    }
    .tour-banner { width: 100%; height: 44px; object-fit: cover; object-position: center; display: block; }
    .topbar, main { width: min(1180px, calc(100% - 40px)); margin: 0 auto; }
    .topbar { min-height: 86px; display: flex; align-items: center; justify-content: space-between; gap: 24px; }
    .eyebrow { margin: 0 0 4px; color: var(--teal-dark); font-size: 12px; font-weight: 700; text-transform: uppercase; }
    h1 { margin: 0; font-family: Georgia, serif; font-size: clamp(25px, 3vw, 38px); font-weight: 600; letter-spacing: 0; }
    .runtime-state { display: flex; align-items: center; gap: 9px; color: var(--muted); font-size: 13px; white-space: nowrap; }
    .runtime-state::before { content: ""; width: 9px; height: 9px; border-radius: 50%; background: var(--green); box-shadow: 0 0 0 4px var(--green-pale); }

    main { padding: 32px 0 48px; }
    .section-heading { display: flex; justify-content: space-between; align-items: end; gap: 20px; margin-bottom: 14px; }
    h2 { margin: 0; font-family: Georgia, serif; font-size: 22px; font-weight: 600; letter-spacing: 0; }
    .context { margin: 0; color: var(--muted); font-size: 14px; }

    .metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 32px; }
    .metric { min-height: 112px; padding: 18px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); }
    .metric.critical { border-top: 4px solid var(--amber); background: var(--amber-pale); }
    .metric-label { display: block; color: var(--muted); font-size: 12px; font-weight: 700; text-transform: uppercase; }
    .metric-value { display: block; margin-top: 10px; font-family: Georgia, serif; font-size: 29px; font-variant-numeric: tabular-nums; }
    .metric-detail { display: block; margin-top: 4px; color: var(--muted); font-size: 12px; }

    .table-wrap { overflow-x: auto; border: 1px solid var(--line); background: var(--surface); }
    table { width: 100%; min-width: 840px; table-layout: fixed; border-collapse: collapse; font-size: 14px; }
    th:nth-child(1) { width: 34%; }
    th:nth-child(2) { width: 13%; }
    th:nth-child(3) { width: 21%; }
    th:nth-child(4) { width: 9%; }
    th:nth-child(5) { width: 10%; }
    th:nth-child(6) { width: 13%; }
    th, td { padding: 14px 16px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; }
    th { color: var(--muted); background: #eef3f1; font-size: 11px; text-transform: uppercase; }
    tbody tr:last-child td { border-bottom: 0; }
    tbody tr.recommended { background: var(--green-pale); }
    .option-name { display: block; font-weight: 700; overflow-wrap: anywhere; }
    .option-id { color: var(--muted); font-size: 12px; }
    .status { display: inline-block; font-weight: 700; }
    .status.pass { color: var(--green); }
    .status.blocked { color: var(--red); }

    .execution { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 32px; }
    .action { padding: 20px; border-left: 4px solid var(--teal); background: var(--surface); }
    .action h3 { margin: 0 0 8px; font-size: 17px; letter-spacing: 0; }
    .action p { margin: 0 0 15px; color: var(--muted); line-height: 1.45; }
    button { min-height: 38px; padding: 0 15px; border: 1px solid var(--teal-dark); border-radius: 4px; color: #fff; background: var(--teal-dark); font: inherit; font-weight: 700; cursor: pointer; }
    button:disabled { color: #68787c; background: #e7eceb; cursor: not-allowed; }
    .account { display: flex; align-items: center; gap: 12px; }
    .receipt { min-height: 20px; margin: 12px 0 0; color: var(--green); font-size: 12px; overflow-wrap: anywhere; }
    .evidence-note { margin: 18px 0 0; padding: 12px 14px; border: 1px solid var(--line); color: var(--muted); background: #eef3f1; font-size: 13px; line-height: 1.45; }
    .error { padding: 20px; border-left: 4px solid var(--red); color: var(--red); background: #fff; }

    @media (max-width: 800px) {
      .topbar { align-items: flex-start; flex-direction: column; padding: 18px 0; }
      .runtime-state { white-space: normal; }
      .metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .execution { grid-template-columns: 1fr; }
      .section-heading { align-items: flex-start; flex-direction: column; }
    }
    @media (max-width: 480px) {
      .topbar, main { width: min(100% - 24px, 1180px); }
      .metrics { grid-template-columns: 1fr; }
      .tour-banner { height: 36px; }
    }
  </style>
</head>
<body>
  <header>
    <img class="tour-banner" src="/assets/banner-ai-tour-27.png" alt="Microsoft AI Tour">
    <div class="topbar">
      <div>
        <p class="eyebrow">Caldova operations</p>
        <h1>Production Guardian</h1>
      </div>
      <div class="account">
        <div class="runtime-state" id="runtime-state">Connecting to Fabric</div>
        <button id="sign-in" type="button">Sign in</button>
      </div>
    </div>
  </header>
  <main>
    <div class="section-heading">
      <h2>Campaign capacity conflict</h2>
      <p class="context" id="context">Loading scenario contract...</p>
    </div>
    <section class="metrics" id="metrics" aria-label="Capacity metrics"></section>

    <div class="section-heading">
      <h2>Production options</h2>
      <p class="context">Recommended path must meet volume, order, and policy constraints.</p>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Plan</th><th>Delivered</th><th>Existing orders</th><th>Risk</th><th>Confidence</th><th>Policy</th></tr></thead>
        <tbody id="options"></tbody>
      </table>
    </div>

    <section class="execution" aria-label="Governed actions">
      <div class="action">
        <h3>Production plan change</h3>
        <p>Requires the named operations approver. Execution returns a correlated production receipt.</p>
        <button id="approve-production" disabled>Operations approval required</button>
        <p class="receipt" id="production-receipt" aria-live="polite"></p>
      </div>
      <div class="action">
        <h3>Maintenance deferral</h3>
        <p>Requires a separate maintenance approval. One approval cannot authorize both actions.</p>
        <button id="approve-maintenance" disabled>Maintenance approval required</button>
        <p class="receipt" id="maintenance-receipt" aria-live="polite"></p>
      </div>
    </section>
    <p class="evidence-note" id="evidence-note">Loading data provenance and execution state.</p>
  </main>
  <script src="/assets/msal-browser.min.js"></script>
  <script>
    const number = new Intl.NumberFormat("en-US");
    const percent = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
    const state = { auth: null, msal: null, account: null, accessToken: null, roles: [] };

    function metric(label, value, detail, critical = false) {
      const node = document.createElement("article");
      node.className = critical ? "metric critical" : "metric";
      const labelNode = document.createElement("span");
      labelNode.className = "metric-label";
      labelNode.textContent = label;
      const valueNode = document.createElement("strong");
      valueNode.className = "metric-value";
      valueNode.textContent = value;
      const detailNode = document.createElement("span");
      detailNode.className = "metric-detail";
      detailNode.textContent = detail;
      node.append(labelNode, valueNode, detailNode);
      return node;
    }

    function cell(text, className) {
      const node = document.createElement("td");
      if (className) node.className = className;
      node.textContent = text;
      return node;
    }

    function tokenRoles(token) {
      try {
        const encoded = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
        const payload = JSON.parse(atob(encoded));
        return Array.isArray(payload.roles) ? payload.roles : [];
      } catch {
        return [];
      }
    }

    function updateApprovalControls() {
      document.getElementById("approve-production").disabled = !state.roles.includes("ROLE-OPERATIONS-APPROVER");
      document.getElementById("approve-maintenance").disabled = !state.roles.includes("ROLE-MAINTENANCE-APPROVER");
      document.getElementById("runtime-state").textContent = state.account
        ? "Signed in"
        : "Signed out";
    }

    function showError(error) {
      const message = document.createElement("p");
      message.className = "error";
      message.textContent = error instanceof Error ? error.message : String(error);
      document.querySelector("main").prepend(message);
    }

    async function signIn() {
      const result = await state.msal.loginPopup({ scopes: [state.auth.apiScope] });
      state.account = result.account;
      const token = await state.msal.acquireTokenSilent({
        account: state.account,
        scopes: [state.auth.apiScope],
      });
      state.accessToken = token.accessToken;
      state.roles = tokenRoles(token.accessToken);
      updateApprovalControls();
      await loadSnapshot();
    }

    async function approve(path, receiptElementId) {
      const receiptElement = document.getElementById(receiptElementId);
      receiptElement.textContent = "Submitting authenticated approval...";
      const token = await state.msal.acquireTokenSilent({
        account: state.account,
        scopes: [state.auth.apiScope],
      });
      state.accessToken = token.accessToken;
      const response = await fetch(path, {
        method: "POST",
        headers: {
          "authorization": "Bearer " + state.accessToken,
          "content-type": "application/json",
        },
        body: JSON.stringify({ actionId: crypto.randomUUID(), correlationId: crypto.randomUUID() }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Approval failed");
      receiptElement.textContent = "Receipt " + body.receiptId + " · " + body.policyId + " " + body.policyVersion;
    }

    fetch("/v1/config").then((response) => response.json())
      .then(async (auth) => {
        state.auth = auth;
        state.msal = new msal.PublicClientApplication({
          auth: {
            clientId: auth.clientId,
            authority: "https://login.microsoftonline.com/" + auth.tenantId,
            redirectUri: window.location.origin,
          },
          cache: { cacheLocation: "sessionStorage" },
        });
        await state.msal.initialize();
        document.getElementById("sign-in").addEventListener("click", () => signIn().catch(showError));
        document.getElementById("approve-production").addEventListener("click", () =>
          approve("/v1/actions/production-plan", "production-receipt").catch(showError));
        document.getElementById("approve-maintenance").addEventListener("click", () =>
          approve("/v1/actions/maintenance-deferral", "maintenance-receipt").catch(showError));
        updateApprovalControls();
      })
      .catch(showError);

    async function loadSnapshot() {
        const response = await fetch("/v1/act3/snapshot", {
          headers: { authorization: "Bearer " + state.accessToken },
        });
        if (!response.ok) throw new Error("Snapshot request failed");
        const snapshot = await response.json();
        document.getElementById("evidence-note").textContent = snapshot.source?.mode === "fabric"
          ? "Live read from Fabric SQL and Eventhouse. Completed approvals return retained Fabric SQL receipts."
          : "Fixture runtime. No tenant execution is represented.";
        document.getElementById("context").textContent = snapshot.lineId + " · " + snapshot.maintenanceWindowId;
        document.getElementById("metrics").replaceChildren(
          metric("Campaign commitment", number.format(snapshot.requiredIncrementalUnits), "incremental units"),
          metric("Headroom with maintenance", number.format(snapshot.headroomWithMaintenanceUnits), "available units"),
          metric("Capacity shortfall", number.format(snapshot.shortfallUnits), "units requiring resolution", true),
          metric("Projected stress", percent.format(snapshot.projectedStressPctOfThreshold) + "%", "policy ceiling " + percent.format(snapshot.stressCeilingPct) + "%")
        );

        const table = document.getElementById("options");
        table.replaceChildren();
        for (const option of snapshot.options) {
          const row = document.createElement("tr");
          if (option.recommended) row.className = "recommended";
          const name = document.createElement("td");
          const strong = document.createElement("span");
          strong.className = "option-name";
          strong.textContent = option.name;
          const id = document.createElement("span");
          id.className = "option-id";
          id.textContent = option.optionId + (option.recommended ? " · recommended" : "");
          name.append(strong, id);
          const policy = cell(option.policyCompliant ? "Policy compliant" : "Blocked", "status " + (option.policyCompliant ? "pass" : "blocked"));
          row.append(
            name,
            cell(number.format(option.incrementalUnitsDelivered) + " units"),
            cell(option.effectOnExistingOrders),
            cell(option.riskLevel),
            cell(percent.format(option.confidence * 100) + "%"),
            policy
          );
          table.append(row);
        }
    }
  </script>
</body>
</html>`;